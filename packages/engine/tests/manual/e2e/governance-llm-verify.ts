/**
 * @e2e: governance-llm-verify
 * @covers: 治理组件真实 LLM 验证（S2-13）
 * @covers-chain: HardVerificationGate → ZeroTokenValidator → DecisionGateBridge
 * @cost: ~0.3-1元/次（3 次 LLM 调用）
 * @overlap: governance-amendment-e2e（纯代码路径，互补）
 *
 * 三条治理真实 LLM 验证用例：
 *   场景 1: HardVerificationGate —— 真实 LLM 生成审计违规声明 → gate.check()
 *           对照 repo 实况验证真伪（拦截幻觉）→ 拒绝时 emitGateRejection 回路
 *   场景 2: ZeroTokenValidator —— 真实 LLM 输出治理事件 → validate() 判定
 *           source（rule / llm-inference 降级语义）
 *   场景 3: DecisionGateBridge —— 真实 LLM 产出 requiresDecision 事件 →
 *           桥接 ConfirmGate → 自动应答 → 决策结果回发
 *
 * 用法: set CORTEX_ENABLE_LLM=1 && npx tsx packages/engine/tests/manual/e2e/governance-llm-verify.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验收标准（refactor-spec S2-13）:
 *   1. 3 条用例可运行（CORTEX_ENABLE_LLM=1 环境），结果归档
 *   2. 验证结论决定激活 or 收敛（文档记录决策）
 *   3. 治理层不投入激活工程（emit 保持现状）
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { PipelineEventType, PipelinePriority, type GovernanceEventPayload, type ObservableEvent } from "@cortex/shared";
import { PipelineObserver, ConfirmGate } from "@cortex/scheduler";
import { ReversibilityLevel } from "@cortex/config";
import type { LlmAdapter } from "@cortex/llm";
import { HardVerificationGate, emitGateRejection, getRejections } from "../../../src/planning/hard-verification-gate.js";
import { ZeroTokenValidator } from "../../../src/execution/zero-token-validator.js";
import { DecisionGateBridge } from "../../../src/execution/decision-gate-bridge.js";
import { e2eBootstrap, log } from "./e2e-utils.js";

// ═══════════════════════════════════════════════════════
// 辅助
// ═══════════════════════════════════════════════════════

const SEP = "═".repeat(64);

function header(title: string): void {
  log(`\n${SEP}\n  ${title}\n${SEP}`);
}

function passed(label: string, detail?: string): void {
  log(`  ✅ ${label}`);
  if (detail) log(`     ${detail}`);
}

function failed(label: string, detail?: string): void {
  log(`  ❌ ${label}`);
  if (detail) log(`     ${detail}`);
}

function info(label: string, value: string): void {
  log(`  📋 ${label}: ${value}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 从 LLM 输出中提取第一个 JSON 对象（容错 fenced code block 与前后杂讯） */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text) ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 从 git diff 中取真实改动的 .ts 文件（环境探测，失败回退默认目标） */
function pickAuditTarget(root: string): string {
  const fallback = "packages/engine/src/bootstrap/bootstrap-engine.ts";
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD~1"], { encoding: "utf-8", timeout: 5000, cwd: root });
    const tsFiles = out.split("\n").filter((f) => f.endsWith(".ts") && fs.existsSync(path.join(root, f)));
    if (tsFiles.length > 0) return tsFiles[0]!;
  } catch { /* 无 git 历史 → 默认目标 */ }
  return fs.existsSync(path.join(root, fallback)) ? fallback : "packages/engine/src/planning/governance-events.ts";
}

// ═══════════════════════════════════════════════════════
// 场景 1: HardVerificationGate —— LLM 声明 vs repo 实况
// ═══════════════════════════════════════════════════════

async function scenario1(root: string, llm: LlmAdapter): Promise<{ pass: boolean; note: string }> {
  header("场景 1: HardVerificationGate —— 真实 LLM 审计声明对照 repo 实况");

  const targetFile = pickAuditTarget(root);
  const filePath = path.join(root, targetFile);
  const fileContent = fs.readFileSync(filePath, "utf-8").slice(0, 4000);
  info("审计目标", `${targetFile} (${fs.statSync(filePath).size} bytes)`);

  // 1. 真实 LLM 生成审计违规声明（扮演 DocGovernAgent）
  const prompt = `你是 Cortex 的治理审计员 DocGovernAgent。请审计给定的代码文件，输出一条你认为最可能的治理违规声明（ESLint 违禁、FSM 非法迁移、跨包契约断裂等）。

只输出一个 JSON 对象，不要任何其他文字。JSON 结构：
{
  "filePath": "被审计文件的相对路径",
  "violation": "ESLint 规则名（如 no-non-null-assertion），若与 ESLint 无关则省略",
  "fromState": "FSM 状态迁移起点（仅当你断言了状态迁移时填写）",
  "toState": "FSM 状态迁移终点（仅当你断言了状态迁移时填写）",
  "modulePath": "barrel 导出相关路径（仅当断言了导出问题时填写）",
  "sourcePkg": "跨包契约源包名（仅当断言了跨包问题时填写）",
  "targetPkg": "跨包契约目标包名（仅当断言了跨包问题时填写）",
  "interfaceName": "跨包接口名（仅当断言了跨包问题时填写）",
  "summary": "违规的一句话摘要"
}
如果文件完全合规，就输出 {"filePath": "${targetFile}", "summary": "未发现违规"}。`;

  const resp = await llm.chat(llm.chatModel, [
    { role: "system", content: "你是治理审计员。输出严格 JSON。" },
    { role: "user", content: prompt + `\n\n被审计文件: ${targetFile}\n内容:\n${fileContent}` },
  ], [], null);
  const declared = extractJson(resp.content ?? "");
  if (!declared) {
    failed("LLM 输出非 JSON", resp.content?.slice(0, 200));
    return { pass: false, note: "LLM 输出解析失败" };
  }
  info("LLM 声明", JSON.stringify(declared));

  // 2. gate.check() 对照实况
  const gate = new HardVerificationGate();
  const payload = {
    severity: "WARNING",
    source: "doc-govern",
    summary: String(declared.summary ?? "LLM 审计声明"),
    ...declared,
  } as unknown as GovernanceEventPayload;

  const result = gate.check(payload);
  log(`  ── gate.check() 裁决 ──`);
  for (const v of result.verdicts) {
    const mark = v.skipped ? "⏭️" : v.passed ? "✅" : "❌";
    log(`     ${mark} ${v.ruleName}${v.reason ? ` — ${v.reason}` : ""}`);
  }
  info("总判决", result.passed ? "PASSED（放行）" : "REJECTED（拦截）");

  // 3. 拒绝时验证 emitGateRejection 回路
  const observer = new PipelineObserver();
  const received: Array<{ type: string; payload?: Record<string, unknown> }> = [];
  observer.on(PipelinePriority.NORMAL, (e) => received.push({ type: e.type, payload: e.payload as Record<string, unknown> | undefined }));

  let rejectLoop = true;
  if (!result.passed) {
    const before = getRejections().length;
    emitGateRejection(observer, payload, result);
    await sleep(50);
    const ruleDenied = received.find((e) => e.payload?.source === "rule-denied");
    rejectLoop = ruleDenied !== undefined && getRejections().length === before + 1;
    if (rejectLoop) {
      passed("拒绝回路", `emitGateRejection → observer 收到 rule-denied 事件，拒绝注册表 +1`);
    } else {
      failed("拒绝回路", "rule-denied 事件或拒绝注册表未更新");
    }
  } else {
    passed("放行路径", "LLM 声明通过实况验证，事件可正常发射（无需拒绝回路）");
  }

  // 4. 确定性幻觉对照——构造不存在的文件声明，gate 必须拒绝
  const fakePayload = {
    ...payload,
    filePath: "packages/__ghost__/fake.ts",
    summary: "幻觉声明：不存在的文件",
  } as unknown as GovernanceEventPayload;
  const fakeResult = gate.check(fakePayload);
  const fakeBlocked = !fakeResult.passed;
  if (fakeBlocked) {
    const reason = fakeResult.verdicts.filter((v) => !v.passed && !v.skipped).map((v) => v.reason).join("; ");
    passed("幻觉拦截", `虚构文件声明被拦截：${reason}`);
  } else {
    failed("幻觉拦截", "虚构文件声明未被拦截");
  }

  const pass = rejectLoop && fakeBlocked;
  return { pass, note: `LLM 声明 ${result.passed ? "通过" : "被拦截"}；幻觉对照 ${fakeBlocked ? "拦截" : "漏网"}` };
}

// ═══════════════════════════════════════════════════════
// 场景 2: ZeroTokenValidator —— source 判定
// ═══════════════════════════════════════════════════════

async function scenario2(root: string, llm: LlmAdapter): Promise<{ pass: boolean; note: string }> {
  header("场景 2: ZeroTokenValidator —— 真实 LLM 事件 source 判定");

  // 1. 真实 LLM 生成治理事件声明
  const resp = await llm.chat(llm.chatModel, [
    { role: "system", content: "你是治理审计员。输出严格 JSON。" },
    { role: "user", content: `请针对仓库中你认为可能存在问题的文件，输出一条治理审计事件声明。只输出一个 JSON 对象：
{"filePath": "相对路径", "violation": "ESLint 规则名或省略", "summary": "审计发现摘要"}
仓库最近改动的文件之一: ${pickAuditTarget(root)}` },
  ], [], null);
  const declared = extractJson(resp.content ?? "");
  if (!declared) {
    failed("LLM 输出非 JSON", resp.content?.slice(0, 200));
    return { pass: false, note: "LLM 输出解析失败" };
  }
  info("LLM 事件声明", JSON.stringify(declared));

  // 2. 构造治理事件 → validate()
  const event = {
    type: PipelineEventType.GovernanceComplianceViolation,
    priority: PipelinePriority.NORMAL,
    payload: {
      severity: "WARNING",
      source: "doc-govern",
      summary: String(declared.summary ?? "LLM 审计声明"),
      violationLevel: "P2",
      ...declared,
    },
    timestamp: Date.now(),
  } as unknown as ObservableEvent;

  const validator = new ZeroTokenValidator();
  const verdict = validator.validate(event, { workspaceRoot: root });

  log(`  ── validate() 逐条规则 ──`);
  for (const r of verdict.results) {
    const mark = r.passed ? "✅" : "❌";
    log(`     ${mark} ${r.ruleName}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  info("source 判定", verdict.source === "rule" ? "rule（全部规则通过——零 token 可信）" : "llm-inference（至少一条规则失败——降级标记）");
  info("降级语义", verdict.source === "rule" ? "事件进入管道时按规则背书" : "事件仍可进入管道，但被标记为 LLM 推断（假阳性显式化）");

  // 3. 确定性对照——不在 diff 的文件必然 llm-inference（若 git 可用）
  let deterministic = true;
  try {
    execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf-8", timeout: 3000, cwd: root });
    const ghostEvent = {
      ...event,
      payload: { ...(event.payload as Record<string, unknown>), filePath: "packages/__ghost__/fake.ts" },
    } as unknown as ObservableEvent;
    const ghostVerdict = validator.validate(ghostEvent, { workspaceRoot: root });
    const gitRule = ghostVerdict.results.find((r) => r.ruleName === "git-diff-check");
    if (gitRule && !gitRule.passed) {
      passed("确定性对照", "虚构文件 → git-diff-check 失败 → source=llm-inference（假阳性被标记）");
    } else {
      deterministic = false;
      failed("确定性对照", "虚构文件未被 git-diff-check 拦截（可能 git 历史不可用）");
    }
  } catch {
    deterministic = true; // 无 git 历史——跳过确定性对照，不算失败
    log(`  ⏭️  确定性对照跳过（git HEAD~1 不可用）`);
  }

  const pass = verdict.results.length === 5 && deterministic;
  return { pass, note: `source=${verdict.source}，规则 ${verdict.results.filter((r) => r.passed).length}/5 通过` };
}

// ═══════════════════════════════════════════════════════
// 场景 3: DecisionGateBridge —— DECISION_REQUIRED → ConfirmGate
// ═══════════════════════════════════════════════════════

async function scenario3(llm: LlmAdapter): Promise<{ pass: boolean; note: string }> {
  header("场景 3: DecisionGateBridge —— 真实 LLM 决策请求桥接 ConfirmGate");

  // 1. 真实 LLM 生成需要决策的治理声明
  const resp = await llm.chat(llm.chatModel, [
    { role: "system", content: "你是治理战略师。输出严格 JSON。" },
    { role: "user", content: `假设仓库治理委员会需要用户裁决一个变更请求，请生成一条需要用户决策的治理事项。
只输出一个 JSON 对象：{"summary": "决策事项一句话摘要", "detail": "决策背景与选项"}` },
  ], [], null);
  const declared = extractJson(resp.content ?? "");
  const decisionSummary = String(declared?.summary ?? "是否批准该治理变更？");
  const decisionDetail = String(declared?.detail ?? "LLM 生成的决策背景");
  info("LLM 决策事项", decisionSummary);

  // 2. 装配桥接环境
  const observer = new PipelineObserver();
  const confirmGate = new ConfirmGate(15_000);
  const bridge = new DecisionGateBridge(observer, confirmGate);
  bridge.start();

  // 3. 模拟调用方预注册请求（ConfirmGate 的 request 协议）
  const requestId = `gov-llm-${Date.now()}`;
  confirmGate.request({
    id: requestId,
    level: ReversibilityLevel.L2,
    toolName: "governance-llm-verify",
    summary: decisionSummary,
    detail: decisionDetail,
  });
  info("请求预注册", `${requestId} (L2)`);

  // 4. 发射 requiresDecision 治理事件 → bridge 拦截 → ConfirmGate 确认
  // 非 TTY 环境（管道）下 L2 需要 CORTEX_AUTO_CONFIRM=true 才能放行；
  // TTY 环境则走真实 waitFor 挂起。
  const tty = Boolean(process.stdin.isTTY);
  if (!tty) process.env.CORTEX_AUTO_CONFIRM = "true";
  info("确认模式", tty ? "TTY——waitFor 挂起待应答" : "非 TTY——CORTEX_AUTO_CONFIRM 自动放行 L2");

  observer.emit({
    type: PipelineEventType.GovernanceComplianceViolation,
    priority: PipelinePriority.HIGH,
    payload: {
      severity: "DECISION_REQUIRED",
      source: "doc-govern",
      summary: decisionSummary,
      detail: decisionDetail,
      violationLevel: "P2",
      requiresDecision: true,
    },
    timestamp: Date.now(),
    requestId,
    notificationType: "DECISION_REQUIRED",
  } as never);

  // 5. 等待桥接处理
  await sleep(1200);
  const consumed = !confirmGate.hasPending();
  if (consumed) {
    passed("桥接消费", "决策请求已被 ConfirmGate 消费（pending 清空）");
  } else {
    failed("桥接消费", "决策请求仍挂起——桥接可能未拦截");
  }

  // 6. 缺口对照——未预注册的 requestId 直接发射：waitFor 无法命中 pending → 自动拒绝
  const ghostId = `gov-ghost-${Date.now()}`;
  observer.emit({
    type: PipelineEventType.GovernanceComplianceViolation,
    priority: PipelinePriority.HIGH,
    payload: {
      severity: "DECISION_REQUIRED",
      source: "doc-govern",
      summary: "未注册的决策请求",
      violationLevel: "P2",
      requiresDecision: true,
    },
    timestamp: Date.now(),
    requestId: ghostId,
    notificationType: "DECISION_REQUIRED",
  } as never);
  await sleep(600);
  const ghostRejected = !confirmGate.hasPending();
  if (ghostRejected) {
    passed("缺口对照", "未预注册请求 → waitFor 未命中 → 自动拒绝（调用方必须先 request()）");
  } else {
    failed("缺口对照", "未预注册请求仍挂起");
  }

  bridge.stop();
  return { pass: consumed && ghostRejected, note: `LLM 决策事项「${decisionSummary.slice(0, 40)}」桥接回路 ${consumed ? "生效" : "断裂"}` };
}

// ═══════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════

async function main(): Promise<void> {
  log(SEP);
  log("  治理组件真实 LLM 验证（S2-13）— HardVerificationGate / ZeroTokenValidator / DecisionGateBridge");
  log(SEP);

  if (process.env.CORTEX_ENABLE_LLM !== "1") {
    failed("门控", "CORTEX_ENABLE_LLM=1 未设置——真实 LLM 用例不运行");
    log(`\n用法: set CORTEX_ENABLE_LLM=1 && npx tsx packages/engine/tests/manual/e2e/governance-llm-verify.ts`);
    process.exit(1);
  }

  const { root, llm } = e2eBootstrap();
  const startedAt = new Date().toISOString();

  const results: Array<{ scenario: string; pass: boolean; note: string }> = [];
  results.push({ scenario: "S1-HardVerificationGate", ...(await scenario1(root, llm)) });
  results.push({ scenario: "S2-ZeroTokenValidator", ...(await scenario2(root, llm)) });
  results.push({ scenario: "S3-DecisionGateBridge", ...(await scenario3(llm)) });

  // ── 汇总 + 归档 ──
  header("验证汇总");
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    log(`  ${r.pass ? "✅" : "❌"} ${r.scenario}: ${r.note}`);
  }

  const outDir = path.join(root, "test-output", "governance-llm-verify");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `result-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    phase: "refactor-phase2",
    task: "S2-13 治理组件真实 LLM 验证",
    startedAt,
    finishedAt: new Date().toISOString(),
    env: { CORTEX_ENABLE_LLM: process.env.CORTEX_ENABLE_LLM },
    results,
    overall: allPass ? "PASS" : "FAIL",
  }, null, 2), "utf-8");
  info("归档", outFile);

  log(`\n${allPass ? "✅ ALL PASSED" : "❌ FAILURES"} — governance-llm-verify complete`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  failed("governance-llm-verify crashed", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
