// ============================================================
// @cortex/engine/tests/eval/eval-runner —— 活性层执行器（v1.1——审查修复）
//
// R13-审查修复：
//  - 超时兜底 timer 句柄 + finally clearTimeout（原 exec 成功后 setTimeout 无人 clear——
//    unhandledRejection 风险）
//  - mock LLM 双模式：CORTEX_EVAL_LLM_MODE=hang（chat 永不 resolve——慢节点）/ tool_call
//    （吐 write_file 工具调用——gate 类用例）
//  - input type "emit"：直接向 observer 打刺激事件（合法 eval 手法——decision-chain 用）
//  - bootstrapEngine 注入 engineConfig.reactLoopTimeoutMs 小值（timeout 用例——
//    race = Math.max(env, reactLoop) 会把 env 覆写吃掉）
// ============================================================
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootstrapEngine } from "../../src/bootstrap/bootstrap-engine.js";
import { PipelinePriority } from "@cortex/shared";
import type { EmittableEvent } from "@cortex/shared";
import { Toolkit } from "@cortex/platform";
import type { GoldenCase, LivenessAssert } from "./eval-types.js";

export interface EvalTrialResult {
  goldenId: string;
  asserts: { verb: string; eventType: string; passed: boolean; byDesign?: boolean; detail: string }[];
  passed: boolean;
  traceSummary: string[];
  durationMs: number;
  error?: string;
}

/** mock LLM 双模式（v1 全 deterministic——flash 定死规范延伸） */
function mockLlm(): Record<string, unknown> {
  const mode = process.env["CORTEX_EVAL_LLM_MODE"] ?? "fast";
  const chat = async () => {
    if (mode === "hang") {
      // 慢节点：永不 resolve（race 超时路径触发）
      return await new Promise<never>(() => { /* hang forever */ });
    }
    if (mode === "tool_call") {
      return {
        content: "",
        reasoning_content: "",
        tool_calls: [{ id: "eval-tc-1", name: "write_file", arguments: { path: "eval-out.txt", content: "ok" } }],
        usage: undefined,
      };
    }
    return { content: "ok", reasoning_content: "", tool_calls: [], usage: undefined };
  };
  const embedText = async () => new Array(384).fill(0.01);
  return {
    chat,
    streamChat: async () => ({ content: "ok" }),
    embedText,
    embedBatch: async (t: string[]) => t.map(() => new Array(384).fill(0.01)),
  };
}

/** 断言单条（轨迹 = 事件数组——eventType 用枚举值如 node.failed，非枚举键） */
function runAssert(a: LivenessAssert, events: EmittableEvent[]): { passed: boolean; detail: string } {
  const matched = events.filter(
    (e) => e.type === a.eventType && (!a.payloadSubstring || JSON.stringify(e.payload ?? "").includes(a.payloadSubstring)),
  );
  switch (a.verb) {
    case "event-seen":
      return { passed: matched.length > 0, detail: `${a.eventType} 出现 ${matched.length} 次` };
    case "event-absent":
      return { passed: matched.length === 0, detail: `${a.eventType} 出现 ${matched.length} 次（期望 0）` };
    case "event-order": {
      if (!a.after) return { passed: false, detail: "event-order 缺 after" };
      const aIdx = events.findIndex((e) => e.type === a.eventType);
      const bIdx = events.findIndex((e) => e.type === a.after);
      return { passed: aIdx > -1 && bIdx > -1 && aIdx < bIdx, detail: `${a.eventType}@${aIdx} vs ${a.after}@${bIdx}` };
    }
    default:
      return { passed: false, detail: `未知动词 ${a.verb}` };
  }
}

/** 执行单个 golden 用例 */
export async function runGoldenCase(golden: GoldenCase): Promise<EvalTrialResult> {
  const t0 = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-eval-"));
  const events: EmittableEvent[] = [];
  const envBackup = new Map<string, string | undefined>();
  let result: EvalTrialResult;
  let boot: Awaited<ReturnType<typeof bootstrapEngine>> | undefined;
  // R13-审查：超时兜底 timer 句柄——finally 里 clearTimeout（防 unhandledRejection）
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    for (const [k, v] of Object.entries(golden.input.setupEnv ?? {})) {
      envBackup.set(k, process.env[k]);
      process.env[k] = v;
    }

    boot = await bootstrapEngine(tmpDir, {
      llms: new Map([["default", mockLlm() as never]]),
      toolkit: new Toolkit(),
      dbPath: path.join(tmpDir, "eval.db"),
      // R13-审查：timeout 用例注入小值（race = Math.max(env, reactLoop)——env 覆写会被吃掉）
      engineConfig: { reactLoopTimeoutMs: Number(process.env["CORTEX_EVAL_REACT_LOOP_MS"] ?? 300_000) } as never,
    });

    const collect = (e: EmittableEvent) => events.push(e);
    boot.observer.on(PipelinePriority.HIGH, collect);
    boot.observer.on(PipelinePriority.NORMAL, collect);
    boot.observer.on(PipelinePriority.CRITICAL, collect);

    const exec = async () => {
      if (golden.input.type === "emit" && golden.input.emit) {
        // 刺激注入（合法 eval 手法——decision-chain 用）
        // 归因修复：golden 的 priority 是字符串（可读）——PipelinePriority 是数字枚举（HIGH=1）——
        // 不转换则 handler 分发按数字 key 查不到——collect 不被调——事件 0 次
        const p = golden.input.emit as { priority?: unknown; type?: unknown };
        const prioMap: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
        if (typeof p.priority === "string" && p.priority in prioMap) {
          (p as { priority?: number }).priority = prioMap[p.priority];
        }
        boot!.observer.emit(golden.input.emit as EmittableEvent);
        return null;
      }
      if (golden.input.type === "task" && golden.input.node) {
        boot!.board.addNode({
          id: `eval-${golden.id}-${Date.now()}`,
          type: golden.input.node.type,
          tags: golden.input.node.tags,
          payload: golden.input.node.payload,
          status: "pending",
          claimedBy: [],
          results: [],
          createdAt: Date.now(),
        } as never);
        return await boot!.scheduler.executeAll();
      }
      return null;
    };

    const timeoutMs = golden.timeoutMs ?? 15_000;
    const execP = exec();
    // R13-审查：timer 句柄保存——race 结束后 finally clear
    const timeoutP = new Promise<never>((_, rej) => {
      timeoutTimer = setTimeout(() => rej(new Error(`eval timeout ${timeoutMs}ms`)), timeoutMs);
    });
    await Promise.race([execP, timeoutP]);

    const asserts = golden.expect.map((a) => {
      const r = runAssert(a, events);
      const passed = r.passed || a.byDesign === true;
      return { verb: a.verb, eventType: a.eventType, passed, byDesign: a.byDesign, detail: r.detail + (a.byDesign ? " [by-design]" : "") };
    });

    result = {
      goldenId: golden.id,
      asserts,
      passed: asserts.every((a) => a.passed),
      traceSummary: events.map((e) => String(e.type)).slice(0, 12),
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    result = {
      goldenId: golden.id,
      asserts: [{ verb: "error", eventType: "runner", passed: false, detail: String(err).slice(0, 200) }],
      passed: false,
      traceSummary: events.map((e) => String(e.type)).slice(0, 12),
      durationMs: Date.now() - t0,
      error: String(err).slice(0, 200),
    };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try { await boot?.shutdown?.(); } catch { /* shutdown 失败不阻断 */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
    for (const [k, v] of envBackup) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return result;
}
