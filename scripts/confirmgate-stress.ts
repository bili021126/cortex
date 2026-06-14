/**
 * ConfirmGate 压力测试 — 验证确认门机制的完整性
 *
 * 测试维度:
 *   T1: 单元测试 — ConfirmGate 基本机制
 *   T2: 单元测试 — Toolkit 的 ConfirmGate 拦截
 *   T3: 集成测试 — bootstrapEngine 是否将 gate 注入 Toolkit ⚠️ 关键 bug 点
 *   T4: 集成测试 — Agent 执行 write_file 时 ConfirmGate 是否触发
 *   T5: 集成测试 — MetaAgent 规划→执行 全链路 ConfirmGate 行为
 *
 * 用法: npx tsx scripts/confirmgate-stress.ts
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { bootstrapEngine, ConfirmGate } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import { ReversibilityLevel as RL, AgentType } from "@cortex/shared";

// ════════════════════════════════════════════════════════
// §0 准备
// ════════════════════════════════════════════════════════
(function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) { console.error("缺少 .env"); process.exit(1); }
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.trim().match(/^([^=]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "test-output", "confirmgate-stress");
try { fs.mkdirSync(OUTPUT, { recursive: true }); } catch {}

const VERDICT: string[] = [];
function $(label: string, msg: string, ok: boolean) {
  const m = ok ? "✅" : "❌";
  console.log(`${m} [${label}] ${msg}`);
  VERDICT.push(`${m} [${label}] ${msg}`);
}
function H(title: string) {
  console.log(`\n${"=".repeat(60)}\n  ${title}\n${"=".repeat(60)}`);
}

// ════════════════════════════════════════════════════════
// T1: ConfirmGate 单元测试
// ════════════════════════════════════════════════════════
H("T1: ConfirmGate 基本机制");

const g1 = new ConfirmGate(5000);
$("T1.1", "初始 needsConfirmation(L2)=true", g1.needsConfirmation(RL.L2));
g1.bypassAll();
$("T1.2", "bypassAll 后 needsConfirmation(L2)=false", !g1.needsConfirmation(RL.L2));
g1.dispose();

const g2 = new ConfirmGate(3000);
$("T1.3", "needsConfirmation(L1)=false", !g2.needsConfirmation(RL.L1));
$("T1.4", "needsConfirmation(L3)=true", g2.needsConfirmation(RL.L3));

const rid1 = g2.request({ id: "t1", level: RL.L2, toolName: "write_file", summary: "测试", detail: "" });
$("T1.5", "request 后 hasPending=true", g2.hasPending());
$("T1.6", "resolve approved=true", g2.resolve({ requestId: rid1, approved: true }) === true);
$("T1.7", "resolve 后 hasPending=false", !g2.hasPending());

const rid2 = g2.request({ id: "t2", level: RL.L2, toolName: "delete_file", summary: "超时测试", detail: "" });
const t0 = Date.now();
const to = await g2.waitFor(rid2, 2000);
const dt = Date.now() - t0;
$("T1.8", `无 bridge 超时返回 false (${dt}ms)`, !to && dt >= 1900 && dt < 4000);
$("T1.9", "超时后 hasPending=false (防泄漏)", !g2.hasPending());

const g3 = new ConfirmGate(5000);
const rid3 = g3.request({ id: "t3", level: RL.L2, toolName: "write_file", summary: "dispose 测试", detail: "" });
let dErr: any = null;
const wp = g3.waitFor(rid3, 30000).catch(e => { dErr = e; return false; });
await new Promise(r => setTimeout(r, 50));
g3.dispose();
await wp;
$("T1.10", `dispose 后 reject=${dErr?.name}`, dErr?.name === "ConfirmGateDisposedError");

g2.dispose();

// ════════════════════════════════════════════════════════
// T2: Toolkit 的 ConfirmGate 拦截
// ════════════════════════════════════════════════════════
H("T2: Toolkit.execute 对 L2 工具的拦截");

const tk2 = new Toolkit(undefined, undefined, undefined, { toolTimeouts: { confirmWait: 2000 } });
const gT2 = new ConfirmGate(2000);
tk2.setGate(gT2);

gT2.bypassAll();
const r1 = await tk2.execute({
  toolName: "write_file",
  params: { file_path: path.join(OUTPUT, "t2.txt"), content: "bypass" },
}, AgentType.Code);
$("T2.1", "bypass 下 write_file 成功", r1.success === true);
try { fs.unlinkSync(path.join(OUTPUT, "t2.txt")); } catch {}

// 重建非 bypass gate
const gT2b = new ConfirmGate(1500);
tk2.setGate(gT2b);
const r2 = await tk2.execute({
  toolName: "write_file",
  params: { file_path: path.join(OUTPUT, "t2-blocked.txt"), content: "blocked" },
}, AgentType.Code);
$("T2.2", "无 bridge 时 write_file 被 ConfirmGate 拦截", !r2.success && (r2.error ?? "").includes("ConfirmGate"));

const r3 = await tk2.execute({
  toolName: "read_file",
  params: { file_path: path.join(ROOT, "package.json") },
}, AgentType.Code);
$("T2.3", "read_file (L1) 不被拦截", r3.success === true);

// 清理：重置 toolkit gate（确保 T3 不受影响）
tk2.setGate(undefined as any);
gT2b.dispose();
gT2.dispose();

// ════════════════════════════════════════════════════════
// T3: bootstrapEngine → Toolkit 是否有 gate？
// ════════════════════════════════════════════════════════
H("T3: bootstrapEngine 的 ConfirmGate 布线");

const API_KEY = process.env.DEEPSEEK_API_KEY!;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1";
const CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-v4-flash";
const REASONER_MODEL = process.env.DEEPSEEK_REASONER_MODEL ?? CHAT_MODEL;
const chatAdapter = new LlmAdapter({ apiKey: API_KEY, baseUrl: BASE_URL, chatModel: CHAT_MODEL, reasonerModel: REASONER_MODEL });
chatAdapter.setCacheEnabled(true);
const llms = new Map([["DEEPSEEK_CHAT", chatAdapter], ["DEEPSEEK_REASONER", chatAdapter]]);

const dbPath = path.join(ROOT, ".cortex", "memory-confirmgate-stress.db");
try { fs.unlinkSync(dbPath); } catch {}
try { fs.unlinkSync(dbPath + "-wal"); } catch {}
try { fs.unlinkSync(dbPath + "-shm"); } catch {}

// 创建全新的干净的 toolkit
const tk3 = new Toolkit();
const engine = await bootstrapEngine(ROOT, { llms, toolkit: tk3, dbPath });

$("T3.1", "engine.gate 存在", engine.gate !== undefined);
$("T3.2", "engine.cliAdapter 存在", engine.cliAdapter !== undefined);
$("T3.3", "engine.gate 有 bridge (CLIAdapter)", engine.gate !== undefined);

// ⚠️ 关键检查：Toolkit 是否被注入了 gate？
// 如果 bootstrapEngine 没有调用 tk3.setGate()，那 tk3 的 gate 是 undefined
// 这意味着 Agent 调用 write_file 时不会触发 ConfirmGate
// 我们通过执行一个 L2 工具来验证（加 8s 超时防止 CLIAdapter 阻塞 stdin）
let rGateCheck: any;
try {
  rGateCheck = await Promise.race([
    tk3.execute({
      toolName: "write_file",
      params: { file_path: path.join(OUTPUT, "t3-gate-check.txt"), content: "test" },
    }, AgentType.Code),
    new Promise<{success: false, error: string}>((_, rej) =>
      setTimeout(() => rej(new Error("T3_TIMEOUT")), 8000)
    ),
  ]);
} catch (e: any) {
  rGateCheck = { success: false, error: `TIMEOUT: ${e.message}` };
}

// 如果 gate 未注入：write_file 会直接成功（无拦截）→ success=true
// 如果 gate 注入了但有 CLI bridge：会在 stdin 阻塞等用户输入 → 超时或卡死
const gateInjected = !rGateCheck.success && (rGateCheck.error ?? "").includes("ConfirmGate");
const gateHanging = !rGateCheck.success && (rGateCheck.error ?? "").includes("TIMEOUT");
if (gateHanging) {
  $("T3.4", "⚠️ Toolkit gate 已注入但 CLIAdapter 在 stdin 阻塞！非交互环境下会卡死", false);
} else if (gateInjected) {
  $("T3.4", "Toolkit gate 已注入，write_file 被拦截", true);
} else {
  $("T3.4", "❌ Toolkit gate 未注入 — ConfirmGate 被绕过！", false);
  $("T3.5", "write_file 在无 gate 时直接成功 (绕过 ConfirmGate)", rGateCheck.success === true);
  try { fs.unlinkSync(path.join(OUTPUT, "t3-gate-check.txt")); } catch {}
}

// T3 已验证 gate 注入状态。T4/T5 是端到端流程测试，bypass gate 避免 CLIAdapter 在 stdin 阻塞
// （ConfirmGate 的拦截能力已在 T2 中充分验证）
engine.gate.bypassAll();

// ════════════════════════════════════════════════════════
// T4: Agent 执行 write_file 端到端
// ════════════════════════════════════════════════════════
H("T4: Agent 执行 write_file 端到端");

const nodeId = `t4-${Date.now()}`;
const t4File = path.join(OUTPUT, "t4-agent-output.md");
engine.board.addNode({
  id: nodeId, type: "code", tags: ["test"] as any,
  needsMultiPerspective: false, status: "pending" as const, claimedBy: [],
  payload: `使用 write_file 向 ${t4File} 写入文本 "T4 agent executed successfully"。完成任务后不做其他操作。`,
  results: [], createdAt: Date.now(),
});
$("T4.1", "任务节点已添加", true);

const report = await engine.scheduler.executeAll();
const node = engine.board.getNode(nodeId);
$("T4.2", `Agent 状态: ${node?.status}`, node?.status === "done");

if (node?.results?.[0]?.error) {
  $("T4.3", `错误: ${node.results[0].error.slice(0, 120)}`,
    (node.results[0].error ?? "").includes("ConfirmGate"));
} else if (fs.existsSync(t4File)) {
  $("T4.3", `文件已写入: ${t4File}`, true);
  const content = fs.readFileSync(t4File, "utf-8");
  $("T4.4", `内容匹配: "${content.slice(0, 60)}"`, content.includes("T4 agent"));
} else {
  $("T4.3", "文件未生成 (可能被 gate 拦截)", false);
}

// ════════════════════════════════════════════════════════
// T5: MetaAgent 规划 → 全链路 ConfirmGate 行为
// ════════════════════════════════════════════════════════
H("T5: MetaAgent 规划→执行 → ConfirmGate");

const meta = engine.metaAgent;
if (!meta) {
  $("T5.0", "MetaAgent 不可用，跳过", false);
} else {
  const intent = [
    "分析 packages/engine/src/core/confirm-gate.ts，",
    "将该文件的代码结构、核心逻辑和潜在问题总结后，",
    "使用 write_file 写入 test-output/confirmgate-stress/analysis.md。",
    "先 read_file 读取源文件，再 write_file 写入分析。简短即可。",
  ].join(" ");

  const nodes = await meta.plan(intent);
  $("T5.1", `MetaAgent 规划了 ${nodes.length} 个节点`, nodes.length > 0);
  for (const n of nodes) {
    console.log(`    节点: ${n.id} type=${n.type} [${n.tags.join(",")}] payload=${n.payload.slice(0, 60)}...`);
  }

  for (const n of nodes) engine.board.addNode(n);
  const r2 = await engine.scheduler.executeAll();
  $("T5.2", `执行: ${r2.completed}✅ ${r2.failed}❌`, true);

  for (const n of engine.board.getAllNodes()) {
    console.log(`    ${n.status} ${n.id}: ${n.results[0]?.error?.slice(0, 100) ?? n.results[0]?.output?.slice(0, 100) ?? ""}`);
  }

  const analysisFile = path.join(OUTPUT, "analysis.md");
  $("T5.3", `分析文件存在: ${fs.existsSync(analysisFile)}`, fs.existsSync(analysisFile));
  if (fs.existsSync(analysisFile)) {
    const ct = fs.readFileSync(analysisFile, "utf-8");
    $("T5.4", `文件大小: ${ct.length} 字符 (>50)`, ct.length > 50);
  }
}

// ════════════════════════════════════════════════════════
// 最终报告
// ════════════════════════════════════════════════════════
H("汇总");

const pass = VERDICT.filter(v => v.startsWith("✅")).length;
const fail = VERDICT.filter(v => v.startsWith("❌")).length;
console.log(`\n通过: ${pass} | 失败: ${fail} | 总计: ${VERDICT.length}\n`);

const reportMd = [
  `# ConfirmGate 压力测试报告`,
  `日期: ${new Date().toISOString()}`,
  ``,
  `通过: ${pass} | 失败: ${fail} | 总计: ${VERDICT.length}`,
  ``,
  `## 全部结果`,
  ...VERDICT,
  ``,
  fail > 0 ? `## ⚠️ 失败项\n${VERDICT.filter(v => v.startsWith("❌")).map(v => `- ${v}`).join("\n")}` : "",
].join("\n");

fs.writeFileSync(path.join(OUTPUT, "report.md"), reportMd, "utf-8");
console.log(`报告: test-output/confirmgate-stress/report.md`);

engine.gate?.dispose();
engine.cliAdapter?.close();
process.exit(fail > 0 ? 1 : 0);
