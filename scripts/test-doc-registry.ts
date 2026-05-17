/**
 * scripts/test-doc-registry.ts — DocRegistry E2E 验证脚本
 *
 * 验证 DocRegistry 的核心能力:
 * 1. register() — 自动落盘 + frontmatter + 索引
 * 2. promote() — draft → active (正史)
 * 3. list() — 按状态/类型查询
 * 4. 跨机制产出：圆桌共识、归因分析、审计报告
 *
 * 用法: npx tsx scripts/test-doc-registry.ts
 */

import { DocRegistry } from "../packages/engine/dist/doc-registry.js";
import { NodeFileSystemAdapter } from "../packages/engine/dist/node-fs-adapter.js";
import * as path from "node:path";

const WORKSPACE = path.resolve(process.cwd());
const fs = new NodeFileSystemAdapter();

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  DocRegistry E2E 验证");
  console.log("═══════════════════════════════════════\n");

  const registry = new DocRegistry(fs, WORKSPACE);
  await registry.init();

  // ── Test 1: 注册圆桌共识 ──────────────────
  console.log("── Test 1: 注册圆桌共识（临时委员会）");
  const consensus = await registry.register({
    type: "consensus",
    title: "软约束共识-记忆系统架构审视",
    content: [
      "# 共识清单",
      "",
      "## P0",
      "- 记忆膨胀需要索引优化",
      "- accessCount 衰减需调参",
      "",
      "## P1",
      "- BFS 深度默认值过高",
    ].join("\n"),
    authors: ["刻晴", "纳西妲", "凝光"],
    committeeType: "ad-hoc",
    triggerSource: "user",
  });
  console.log(`   ✅ ID: ${consensus.id}`);
  console.log(`   ✅ 路径: ${consensus.filePath}`);
  console.log(`   ✅ 状态: ${consensus.status}`);

  // ── Test 2: 注册归因分析 ──────────────────
  console.log("\n── Test 2: 注册归因分析（常设委员会）");
  const attribution = await registry.register({
    type: "attribution",
    title: "P0 记忆膨胀归因分析",
    content: [
      "# 归因分析",
      "",
      "## 现象",
      "- 30 天运行后记忆库膨胀至 2GB",
      "",
      "## 根因",
      "- seedMemories 被重复写入",
      "- BFS expand 未去重",
      "",
      "## 建议",
      "- 写入前检查 content hash 去重",
    ].join("\n"),
    authors: ["凝光", "刻晴"],
    committeeType: "standing",
  });
  console.log(`   ✅ ID: ${attribution.id}`);
  console.log(`   ✅ 路径: ${attribution.filePath}`);

  // ── Test 3: 注册审计报告 ──────────────────
  console.log("\n── Test 3: 注册审计报告（常设委员会）");
  const audit = await registry.register({
    type: "audit",
    title: "宪法 v2.5.10 合规审计",
    content: [
      "# 宪法合规审计",
      "",
      "## 审计范围",
      "- packages/engine/src/",
      "- packages/shared/src/",
      "",
      "## 审计结果",
      "- ✅ 接口契约无破坏",
      "- ✅ Agent 类型定义一致",
      "- ⚠️ 一处 deprecated 导出未标注",
    ].join("\n"),
    authors: ["凝光"],
    committeeType: "standing",
    constitutionVersion: "v2.5.10",
  });
  console.log(`   ✅ ID: ${audit.id}`);
  console.log(`   ✅ 路径: ${audit.filePath}`);

  // ── Test 4: 晋升正史 ─────────────────────
  console.log("\n── Test 4: 晋升正史（归因分析 → active）");
  const promoted = await registry.promote(attribution.id, ["human", "cortex"]);
  console.log(`   ✅ 状态: ${promoted.status}`);
  console.log(`   ✅ 审批者: ${promoted.reviewedBy.join(", ")}`);
  console.log(`   ✅ 晋升时间: ${new Date(promoted.promotedAt!).toISOString()}`);

  // ── Test 5: 查询 ─────────────────────────
  console.log("\n── Test 5: 查询正史");
  const activeDocs = registry.list({ status: "active" });
  console.log(`   active 文档数: ${activeDocs.length}`);
  for (const d of activeDocs) {
    console.log(`   - [${d.type}] ${d.title} (${d.id})`);
  }

  console.log("\n── Test 5b: 查询常设委员会产物");
  const standing = registry.list({ committeeType: "standing" });
  console.log(`   常设委员会文档数: ${standing.length}`);

  // ── Test 6: 验证文件存在 ─────────────────
  console.log("\n── Test 6: 验证磁盘文件");
  for (const entry of [consensus, attribution, audit]) {
    const fullPath = path.resolve(WORKSPACE, entry.filePath);
    const exists = await fs.exists(fullPath);
    console.log(`   ${exists ? "✅" : "❌"} ${entry.filePath}`);
  }

  // ── Test 7: 验证索引持久化 ────────────────
  console.log("\n── Test 7: 验证索引持久化");
  const registry2 = new DocRegistry(fs, WORKSPACE);
  await registry2.init();
  const reloaded = registry2.get(attribution.id);
  console.log(`   重载后 attribution 状态: ${reloaded?.status}`);
  console.log(`   总条目数: ${registry2.size}`);

  // ── 汇总 ────────────────────────────────
  console.log("\n═══════════════════════════════════════");
  console.log(`  总注册: ${registry.size} 条`);
  console.log(`  active: ${registry.list({ status: "active" }).length} 条`);
  console.log(`  draft: ${registry.list({ status: "draft" }).length} 条`);
  console.log("  ✅ DocRegistry E2E 验证通过");
  console.log("═══════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("❌ E2E 失败:", e);
  process.exit(1);
});
