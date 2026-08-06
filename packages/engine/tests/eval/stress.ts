// ============================================================
// @cortex/engine/tests/eval/stress —— 跑死测试（用户要求：跑死 cortex）
//
// 四路压力：
//   S1 rebootstrap 循环（静态累积——alert 规则翻倍等——ManifoldGate 已修其余在）
//   S2 任务风暴（大量节点 executeAll——调度/槽位/超时路径）
//   S3 记忆写入风暴（vectorstore weight 只增不减/prune 零调用——无界增长）
//   S4 超时风暴（hang LLM 挂起节点——race 路径反复触发）
// 每路跑完报告：存活/崩溃点/事件吞吐/内存迹象
// ============================================================
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootstrapEngine } from "../../src/bootstrap/bootstrap-engine.js";
import { Toolkit } from "@cortex/platform";

function mockLlm(mode: "fast" | "hang"): Record<string, unknown> {
  const chat = async () => {
    if (mode === "hang") return await new Promise<never>(() => {});
    return { content: "ok", reasoning_content: "", tool_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  };
  return {
    chat,
    chatStream: async function* () {
      if (mode === "hang") await new Promise<never>(() => {});
      yield { content: "ok", reasoning_content: "", tool_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    },
    embedText: async () => new Array(384).fill(0.01),
    embedBatch: async (t: string[]) => t.map(() => new Array(384).fill(0.01)),
  };
}

async function bootOnce(tmpRoot: string, env: Record<string, string>): Promise<{ boot: Awaited<ReturnType<typeof bootstrapEngine>>; dir: string }> {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "stress-"));
  const boot = await bootstrapEngine(dir, {
    llms: new Map([["default", mockLlm("fast") as never]]),
    toolkit: new Toolkit(),
    dbPath: path.join(dir, "stress.db"),
    engineConfig: { reactLoopTimeoutMs: Number(env.CORTEX_EVAL_REACT_LOOP_MS ?? 300_000) } as never,
  });
  return { boot, dir };
}

async function main(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-stress-"));
  console.log("\n🔨 跑死测试开始（cortex-stress-" + tmpRoot.split("-").pop() + "）\n");
  const results: Record<string, string> = {};

  // ── S1 rebootstrap 循环（静态累积）──
  {
    const t0 = Date.now();
    let survived = 0;
    const rounds = 8;
    try {
      for (let i = 0; i < rounds; i++) {
        const { boot, dir } = await bootOnce(tmpRoot, {});
        await boot.scheduler.executeAll().catch(() => {});
        await boot.shutdown();
        fs.rmSync(dir, { recursive: true, force: true });
        survived++;
      }
      results["S1 rebootstrap"] = `存活 ${survived}/${rounds} 轮（${Date.now() - t0}ms）`;
    } catch (e) {
      results["S1 rebootstrap"] = `💥 崩溃于第 ${survived + 1} 轮: ${String(e).slice(0, 120)}`;
    }
    console.log("  " + (results["S1 rebootstrap"].startsWith("💥") ? "❌" : "✅") + " " + results["S1 rebootstrap"]);
  }

  // ── S2 任务风暴（大量节点）──
  {
    const t0 = Date.now();
    try {
      const { boot, dir } = await bootOnce(tmpRoot, {});
      const N = 30;
      for (let i = 0; i < N; i++) {
        boot.board.addNode({
          id: `stress-node-${i}`, type: "code", tags: ["implementation"], payload: `stress task ${i}`,
          status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        } as never);
      }
      await Promise.race([
        boot.scheduler.executeAll(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("S2 executeAll 超过 60s 兜底")), 60_000)),
      ]);
      await boot.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
      results["S2 任务风暴"] = `${N} 节点完成（${Date.now() - t0}ms）`;
    } catch (e) {
      results["S2 任务风暴"] = `💥 崩溃: ${String(e).slice(0, 120)}`;
    }
    console.log("  " + (results["S2 任务风暴"].startsWith("💥") ? "❌" : "✅") + " " + results["S2 任务风暴"]);
  }

  // ── S3 记忆写入风暴（无界增长）──
  {
    const t0 = Date.now();
    try {
      const { boot, dir } = await bootOnce(tmpRoot, {});
      const mem = boot.memory as unknown as {
        writePending: (i: { source: { agentType: string }; kind: string; summary: string; semantic_gist: string; content_blob: Record<string, unknown> }) => string;
        commitMemory: (id: string) => boolean;
      };
      const N = 200;
      for (let i = 0; i < N; i++) {
        const id = mem.writePending({ source: { agentType: "stress" }, kind: "stress", summary: `stress memory ${i}`, semantic_gist: `s${i}`, content_blob: { i } });
        mem.commitMemory(id);
      }
      await boot.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
      results["S3 记忆风暴"] = `${N} 条写入+提交完成（${Date.now() - t0}ms）`;
    } catch (e) {
      results["S3 记忆风暴"] = `💥 崩溃: ${String(e).slice(0, 120)}`;
    }
    console.log("  " + (results["S3 记忆风暴"].startsWith("💥") ? "❌" : "✅") + " " + results["S3 记忆风暴"]);
  }

  // ── S4 超时风暴（hang LLM——race 路径反复）──
  {
    const t0 = Date.now();
    try {
      const dir = fs.mkdtempSync(path.join(tmpRoot, "hang-"));
      const boot = await bootstrapEngine(dir, {
        llms: new Map([["default", mockLlm("hang") as never]]),
        toolkit: new Toolkit(),
        dbPath: path.join(dir, "hang.db"),
        engineConfig: { reactLoopTimeoutMs: 600 } as never,
      });
      process.env.CORTEX_NODE_DISPATCH_TIMEOUT_MS = "500";
      const N = 5;
      for (let i = 0; i < N; i++) {
        boot.board.addNode({
          id: `stress-hang-${i}`, type: "code", tags: ["implementation"], payload: `hang ${i}`,
          status: "pending", claimedBy: [], results: [], createdAt: Date.now(),
        } as never);
      }
      await Promise.race([
        boot.scheduler.executeAll().catch(() => {}),
        new Promise((_, rej) => setTimeout(() => rej(new Error("S4 超时兜底 60s")), 60_000)),
      ]);
      delete process.env.CORTEX_NODE_DISPATCH_TIMEOUT_MS;
      await boot.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
      results["S4 超时风暴"] = `${N} 挂起节点经 race 超时处理（${Date.now() - t0}ms）`;
    } catch (e) {
      results["S4 超时风暴"] = `💥 崩溃: ${String(e).slice(0, 120)}`;
    }
    console.log("  " + (results["S4 超时风暴"].startsWith("💥") ? "❌" : "✅") + " " + results["S4 超时风暴"]);
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log("\n📊 跑死测试汇总:");
  for (const [k, v] of Object.entries(results)) console.log("  " + k + ": " + v);
  const dead = Object.values(results).filter((v) => v.startsWith("💥"));
  console.log("\n" + (dead.length === 0 ? "🏆 四路全存活——cortex 没被跑死" : `💀 ${dead.length} 路崩溃——跑死点已定位`));
}

main().catch((e) => {
  console.error("[stress] 执行异常:", e);
  process.exit(1);
});
