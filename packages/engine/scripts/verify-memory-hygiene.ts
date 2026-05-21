/**
 * 记忆语义卫生五层验证脚本
 *
 * 用法: cd packages/engine && npx tsx scripts/verify-memory-hygiene.ts
 *
 * 验证内容:
 *   L1 SHA256 精确去重
 *   L2 BFS 噪声门限
 *   L3 权重自然老化
 *   L4 内存总量软上限
 *   L0 向量语义接入（需 @xenova/transformers 可用）
 */

import { MemoryStore } from "../src/memory/memory-store.js";
import { PipelineObserver } from "../src/core/pipeline-observer.js";
import { MemoryType, MemoryState, LinkType } from "../../shared/src/memory.js";
import { AgentType } from "../../shared/src/agent.js";

const PASS = "✅";
const FAIL = "❌";
const SKIP = "⏭️";
const INFO = "ℹ️";

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  ${PASS} ${label}`); passed++; }
  else      { console.log(`  ${FAIL} ${label}`); failed++; }
}

// ────────────────────────────────────────────────────────

async function main() {
  console.log("=== 记忆语义卫生五层验证 ===\n");

  const observer = new PipelineObserver();
  const store = new MemoryStore(observer);

  // ── L1: SHA256 精确去重 ──────────────────────────
  console.log("── L1 写入内容级去重 ──");

  const input1 = {
    memoryType: MemoryType.Episodic,
    content: { port: 3000, status: "occupied" },
    summary: "端口 3000 被占用",
    agentType: AgentType.Code,
    creatorId: "verify",
  };

  const id1 = await store.write(input1);
  assert(id1.startsWith("mem-"), `首次写入返回合法 id: ${id1.slice(0, 12)}...`);

  // 完全相同的输入 → 应返回同一个 id
  const id1dup = await store.write({ ...input1 });
  assert(id1dup === id1, `完全重复写入返回已有 id (SHA256 命中)`);

  // 措辞不同但语义相同 → 依赖向量去重（见 L0）
  const similarInput = {
    memoryType: MemoryType.Episodic,
    content: { port: 3000, status: "occupied" },
    summary: "侦测到 3000 端口冲突",
    agentType: AgentType.Code,
    creatorId: "verify",
  };
  const idSim = await store.write(similarInput);
  console.log(`  ${INFO} 语义相似写入 id: ${idSim.slice(0, 12)}... (SHA256 不同，向量去重见 L0)`);

  // ── L2: BFS 噪声门限 ────────────────────────────
  console.log("\n── L2 BFS 噪声门限 ──");

  // 创建一条高质量种子记忆
  const seedId = await store.write({
    memoryType: MemoryType.Episodic,
    content: { task: "seed" },
    summary: "核心开发任务：重构认证模块",
    agentType: AgentType.Code,
    creatorId: "verify",
    weight: 1.0,
  });

  // 创建高权重关联记忆（会被 BFS 召回）
  const highWId = await store.write({
    memoryType: MemoryType.Episodic,
    content: { task: "high" },
    summary: "认证模块依赖 bcrypt 升级",
    agentType: AgentType.Code,
    creatorId: "verify",
    weight: 1.0,
  });
  store.link(seedId, highWId, LinkType.DependsOn);

  // 创建低权重关联记忆（会被 BFS 门限过滤）
  const lowWId = await store.write({
    memoryType: MemoryType.Episodic,
    content: { task: "low" },
    summary: "无关紧要的杂项备忘",
    agentType: AgentType.Code,
    creatorId: "verify",
    weight: 0.01,
  });
  store.link(seedId, lowWId, LinkType.AccessedDuring);

  // 检索种子 → BFS 展开深度 2
  const bfsResults = await store.read({
    memoryTypes: [MemoryType.Episodic],
    keywords: ["重构", "认证"],
    bfsDepth: 2,
    bfsMaxNodes: 10,
    limit: 10,
  });

  const foundHigh = bfsResults.some((m) => m.id === highWId);
  const foundLow  = bfsResults.some((m) => m.id === lowWId);

  assert(foundHigh, `BFS 召回高权重关联记忆 (weight=1.0)`);
  assert(!foundLow, `BFS 过滤低权重噪音 (weight=0.01, decay后 < 0.1 门限)`);

  // ── L3: 权重自然老化 ────────────────────────────
  console.log("\n── L3 权重自然老化 ──");

  // 直接用 _storage.insert() 绕过 write() 的向量去重
  // （防止 "需要老化的测试记忆" 被意外匹配到已有低权重噪音记忆）
  const agingEntry = (store as any)._storage.insert({
    memoryType: MemoryType.Episodic,
    content: { task: "aging" },
    summary: "需要老化的测试记忆",
    agentType: AgentType.Code,
    creatorId: "verify",
    weight: 1.0,
  });
  const agingId = agingEntry.id;

  console.log(`  ${INFO} L3 aging insert id: ${agingId} (total: ${(store as any)._storage.memories.size})`);

  // 手动将 lastAccessedAt 推到 14 天前
  agingEntry.lastAccessedAt = Date.now() - 14 * 24 * 60 * 60 * 1000;

  // 先读一次触发老化
  const agedResults = await store.read({
    memoryTypes: [MemoryType.Episodic],
    limit: 50,
    trackAccess: false,
  });

  const agedEntry = agedResults.find((m) => m.id === agingId);
  if (agedEntry) {
    // 检查老化计算已执行（权重 < 原始值 1.0 且 > 0，排除异常零值）
    const aged = agedEntry.weight;
    assert(
      aged > 0 && aged < 1.0 && aged > 0.5,
      `权重老化生效: 原始 1.0 → ${aged.toFixed(4)} (期望在 0.5~1.0 之间，14天未访问 ≈0.9025)`
    );
  } else {
    assert(false, "权重老化: 未找到老化记忆");
  }

  // ── L4: 内存总量软上限 ──────────────────────────
  console.log("\n── L4 内存总量软上限 ──");
  console.log(`  ${INFO} 当前记忆量: ${(store as any)._storage.memories.size} 条 (上限 10000)`);
  console.log(`  ${INFO} 总量上限在 ≥10000 条时触发，当前量级不足以触发自动归档`);
  console.log(`  ${INFO} 验证方式: 持续写入 >10000 条记忆后检查 Archived 状态条目数`);
  skipped++;

  // ── L0: 向量语义接入 ────────────────────────────
  console.log("\n── L0 向量语义接入 ──");

  try {
    const { embedText } = await import("../src/memory/embedding.js");
    const vec: number[] = await embedText("端口 3000 被占用");
    assert(
      vec.length === 384,
      `embedText 生成 384d 向量: 实际 ${vec.length}d`
    );

    // 验证归一化 (L2 norm ≈ 1.0)
    const norm = Math.sqrt(vec.reduce((sum: number, v: number) => sum + v * v, 0));
    assert(
      Math.abs(norm - 1.0) < 0.01,
      `向量 L2 归一化: norm=${norm.toFixed(4)} (期望 ≈1.0)`
    );

    // 两个语义相似文本的余弦相似度应 > 0.8
    const vec1 = await embedText("端口 3000 被占用");
    const vec2 = await embedText("侦测到 3000 端口冲突");
    let dot = 0;
    for (let i = 0; i < 384; i++) dot += vec1[i] * vec2[i];
    assert(
      dot >= 0.8,
      `语义相似文本余弦相似度: ${dot.toFixed(4)} (期望 ≥0.8)`
    );

    // 语义无关文本的余弦相似度应 < 0.5
    const vec3 = await embedText("今天天气真好适合出去玩");
    let dot2 = 0;
    for (let i = 0; i < 384; i++) dot2 += vec1[i] * vec3[i];
    assert(
      dot2 < 0.5,
      `语义无关文本余弦相似度: ${dot2.toFixed(4)} (期望 <0.5)`
    );

    // 向量去重：写入语义极近的记忆（阈值 0.95）
    const dedupId = await store.write({
      memoryType: MemoryType.Episodic,
      content: { port: 3000, status: "occupied" },
      summary: "端口3000被占用",
      agentType: AgentType.Code,
      creatorId: "verify",
    });
    // 如果向量去重命中，应返回已有 id（id1 或 idSim）
    const dedupHit = dedupId === id1 || dedupId === idSim;
    assert(
      dedupHit,
      `向量相似去重命中: 写入"端口3000被占用" → 返回已有 id`
    );

  } catch (e: any) {
    console.log(`  ${SKIP} 向量验证跳过: ${e.message?.slice(0, 80) ?? String(e).slice(0, 80)}`);
    skipped += 4; // 跳过 4 个向量相关断言
  }

  // ── 收尾 ────────────────────────────────────────
  await store.close();
  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败, ${skipped} 跳过 ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("验证脚本异常:", e);
  process.exit(1);
});
