// @e2e: skill-e2e
// @covers: SkillRegistry加载→注册→查询→deriveStatus→结晶→Knowledge
// @covers-chain: Skill 全链路
// @cost: ~0.5元/次
// @overlap: core-smoke（本文件是 core-smoke 技能部分 × 深度）
//
// 纯 TS API 测试，无需 LLM 调用。
// 用法: npx tsx packages/engine/tests/manual/e2e/skill-e2e.ts
// ============================================================

import { SkillRegistry, deriveStatus } from "@cortex/skill-kit";
import type { SkillTemplate } from "@cortex/shared";

// ── 日志 ──────────────────────────────────────
function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

// ── 辅助：构造技能模板 ─────────────────────────
function makeSkill(overrides: Partial<SkillTemplate>): SkillTemplate {
  return {
    id: "test-" + Date.now(),
    kind: "action",
    name: "test skill",
    triggerTags: ["test"],
    trigger: "当有测试任务时",
    steps: ["step 1", "step 2"],
    expectedOutput: "测试输出",
    status: "trial",
    weight: 0,
    feedbackHistory: [],
    discoveredBy: "skill-e2e",
    createdAt: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════

async function main() {
  log("⚡ skill-e2e — SkillRegistry 全链路验证\n");

  let passed = 0;
  let failed = 0;

  function check(label: string, ok: boolean) {
    log(`   ${ok ? "✅" : "❌"} ${label}`);
    if (ok) passed++; else failed++;
  }

  // ── 1. 加载验证 ──
  log("── 1. 加载验证 ──");
  const reg = new SkillRegistry();
  check("SkillRegistry 构造成功", reg instanceof SkillRegistry);
  check("初始 activeCount = 0", reg.activeCount === 0);
  check("初始 totalCount = 0", reg.totalCount === 0);

  // ── 2. 注册验证 ──
  log("\n── 2. 注册+查询验证 ──");

  const skillActive = makeSkill({
    id: "test-skill-active",
    triggerTags: ["test", "e2e"],
    weight: 10,
    feedbackHistory: [{ rating: 1, agentId: "e2e", timestamp: Date.now() }],
  });
  reg.register(skillActive);

  const skillTrial = makeSkill({
    id: "test-skill-trial",
    triggerTags: ["test"],
    weight: 0,
    feedbackHistory: [],
  });
  reg.register(skillTrial);

  const skillDeprecated = makeSkill({
    id: "test-skill-deprecated",
    triggerTags: ["test"],
    weight: 0,
    feedbackHistory: [
      { rating: -1, agentId: "e2e", timestamp: Date.now() },
      { rating: -1, agentId: "e2e", timestamp: Date.now() },
      { rating: -1, agentId: "e2e", timestamp: Date.now() },
    ],
  });
  reg.register(skillDeprecated);

  check("totalCount = 3 已注册", reg.totalCount === 3);
  check("queryByTags([\"e2e\"]) 查到 active（精确标签匹配）", reg.queryByTags(["e2e"]).length === 1);
  check("queryByTags([\"test\"]) 查到 active+trial（2 个）", reg.queryByTags(["test"]).length === 2);

  // ── 3. 状态验证 ──
  log("\n── 3. deriveStatus 状态推导 ──");

  const s1 = deriveStatus(0, []);
  check('weight=0, feedbackHistory=[] → "trial"', s1 === "trial");

  const s2 = deriveStatus(1, [{ rating: 1, agentId: "e2e", timestamp: Date.now() }]);
  check('weight=1, feedbackHistory=[{rating:1}] → "active"', s2 === "active");

  const s3 = deriveStatus(0, [
    { rating: -1, agentId: "e2e", timestamp: Date.now() },
    { rating: -1, agentId: "e2e", timestamp: Date.now() },
    { rating: -1, agentId: "e2e", timestamp: Date.now() },
  ]);
  check('weight=0, feedbackHistory=[-1×3] → "deprecated"', s3 === "deprecated");

  // ── 4. 查询过滤 — deprecated 不被返回 ──
  log("\n── 4. 查询过滤 ──");
  const results = reg.queryByTags(["test"]);
  check('queryByTags(["test"]) = 2（不含 deprecated）', results.length === 2);
  const hasDeprecated = results.some((r) => r.id === "test-skill-deprecated");
  check("deprecated 技能被过滤", !hasDeprecated);
  const hasActive = results.some((r) => r.id === "test-skill-active");
  const hasTrial = results.some((r) => r.id === "test-skill-trial");
  check("active 技能在结果中", hasActive);
  check("trial 技能在结果中", hasTrial);

  // ── 5. 权重排序 ──
  log("\n── 5. 权重排序验证 ──");
  const weights = results.map((r) => r.weight);
  check("按 weight 降序排列", weights[0]! >= weights[1]!);
  check(`权重顺序: [${weights.join(", ")}]`, weights[0] === 10 && weights[1] === 0);

  // ── 6. recordFeedback 评价回流 ──
  log("\n── 6. 评价回流 ──");
  const feedbackOk = reg.recordFeedback("test-skill-trial", "e2e", 1);
  check("recordFeedback 成功", feedbackOk);
  const afterFeedback = reg.get("test-skill-trial")!;
  check("weight 累加（0 + 1 = 1）", afterFeedback.weight === 1);
  const afterStatus = deriveStatus(afterFeedback.weight, afterFeedback.feedbackHistory);
  check("评价后状态变为 active", afterStatus === "active");

  const feedbackNotFound = reg.recordFeedback("nonexistent-id", "e2e", 1);
  check("不存在的技能返回 false", !feedbackNotFound);

  // ── 7. cleanupOrphans ──
  log("\n── 7. 孤技能清理 ──");
  // 注册一个 weight=0, no feedback 的孤技能（让 createdAt 是过去时间）
  const orphanSkill = makeSkill({
    id: "test-skill-orphan",
    weight: 0,
    feedbackHistory: [],
    createdAt: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1年前
  });
  reg.register(orphanSkill);
  check("注册孤技能后 totalCount = 4", reg.totalCount === 4);
  const orphans = reg.cleanupOrphans(0); // maxAgeMs=0 → 所有满足条件的都清除
  check("清理孤技能", orphans.includes("test-skill-orphan"));
  check("清理后 totalCount = 3", reg.totalCount === 3);

  // ── 8. toJSON / fromJSON 序列化 ──
  log("\n── 8. 序列化 ──");
  const serialized = reg.toJSON();
  check("toJSON 返回 version=2", serialized.version === 2);
  check("toJSON templates 长度 = 3", serialized.templates.length === 3);

  const restored = SkillRegistry.fromJSON(serialized);
  check("fromJSON 恢复后 totalCount 一致", restored.totalCount === reg.totalCount);
  check("fromJSON 恢复后可正常查询", restored.queryByTags(["e2e"]).length === 1);

  const jsonStr = reg.toJSONString();
  check("toJSONString 输出合法 JSON", (() => { try { JSON.parse(jsonStr); return true; } catch { return false; } })());

  // ── 汇总 ──
  const totalOk = failed === 0;
  log(`\n${totalOk ? "✅ ALL PASSED" : "❌ FAILURES"} — skill-e2e complete`);
  log(`   passed=${passed} failed=${failed}`);
  process.exit(totalOk ? 0 : 1);
}

main().catch((e) => {
  log(`❌ skill-e2e crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
