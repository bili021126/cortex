import { AgentType as AT, type TaskNode, type Agent, type SafeErrorReporter, type MemoryEntry, type ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../platform/toolkit.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { AgentPool } from "../core/agent-pool.js";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { execSync } from "node:child_process";
import { type EngineConfig, resolveConfig, DEFAULT_ENGINE_CONFIG } from "@cortex/config";

/**
 * M9 — 提取为独立模块函数，工厂版本和类版本共同调用，消除 80 行重复代码。
 *
 * 用 child_process 采集编译/测试事实，不依赖 LLM。
 * 返回事实字符串数组，每一条对应一个命令执行结果。
 */
function collectFacts(workspaceRoot: string, safeReporter?: SafeErrorReporter, timeouts?: Required<EngineConfig>["inspector"]): string[] {
  const facts: string[] = [];
  const root = workspaceRoot;
  const T = timeouts ?? { tscTimeout: 30_000, testTimeout: 30_000, vitestTimeout: 60_000 };

  try {
    try {
      const tscOut = execSync("npx tsc --noEmit --pretty false", {
        cwd: root,
        timeout: T.tscTimeout,
        encoding: "utf-8",
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      facts.push(`[tsc --noEmit] ✅ 编译通过。`);
      if (tscOut.trim()) facts.push(`[tsc 输出] ${tscOut.trim().slice(0, 500)}`);
    } catch (e) {
      const err = e as { stdout?: unknown; stderr?: unknown; status?: number | string };
      const stdout = err.stdout?.toString() ?? "";
      const stderr = err.stderr?.toString() ?? "";
      facts.push(`[tsc --noEmit] ❌ 编译失败 (exit ${err.status ?? "?"})`);
      if (stdout.trim()) facts.push(`[tsc stdout]\n${stdout.trim().slice(0, 800)}`);
      if (stderr.trim()) facts.push(`[tsc stderr]\n${stderr.trim().slice(0, 800)}`);
    }
  } catch {
    safeReporter?.({ source: "InspectorAgent.collectFacts.tsc", error: "tsc not available", severity: "silent" });
  }

  try {
    try {
      const tsxOut = execSync("npx tsx test/calculator.test.ts", {
        cwd: root,
        timeout: T.testTimeout,
        encoding: "utf-8",
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      facts.push(`[tsx] ✅ 测试全部通过。`);
      if (tsxOut.trim()) facts.push(`[tsx 输出]\n${tsxOut.trim().slice(0, 500)}`);
    } catch (e) {
      const err = e as { stdout?: unknown; stderr?: unknown; status?: number | string };
      const stdout = err.stdout?.toString() ?? "";
      const stderr = err.stderr?.toString() ?? "";
      facts.push(`[tsx] ❌ 测试失败 (exit ${err.status ?? "?"})`);
      if (stdout.trim()) facts.push(`[tsx stdout]\n${stdout.trim().slice(0, 600)}`);
      if (stderr.trim()) facts.push(`[tsx stderr]\n${stderr.trim().slice(0, 600)}`);
    }
  } catch {
    safeReporter?.({ source: "InspectorAgent.collectFacts.tsx", error: "tsx not available", severity: "silent" });
  }

  try {
    try {
      const testOut = execSync("npx vitest run --reporter verbose 2>&1 || npx jest --verbose 2>&1 || echo NO_TEST_RUNNER", {
        cwd: root,
        timeout: T.vitestTimeout,
        encoding: "utf-8",
        maxBuffer: 512 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      });
      const trimmed = testOut.trim();
      if (trimmed && !trimmed.includes("NO_TEST_RUNNER")) {
        const passed = /(\d+)\s+passed/.test(trimmed);
        const failed = /(\d+)\s+failed/.test(trimmed);
        facts.push(`[vitest] ${passed ? "✅ 测试通过" : ""}${failed ? "❌ 测试失败" : ""}${!passed && !failed ? "⚠️ 未检测到测试结果" : ""}`);
        facts.push(`[vitest 输出]\n${trimmed.slice(0, 1000)}`);
      }
    } catch {
      safeReporter?.({ source: "InspectorAgent.collectFacts.vitest_inner", error: "test runner not available", severity: "silent" });
    }
  } catch {
    safeReporter?.({ source: "InspectorAgent.collectFacts.vitest", error: "vitest not available", severity: "silent" });
  }

  return facts;
}

/**
 * 创建 InspectorAgent——编译事实前置采集的侦察骑士。
 * 返回符合 Agent 接口的对象，附加 setWorkspaceRoot 扩展方法。
 */
export function createInspectorAgent(
  llm: LlmAdapter,
  toolkit: Toolkit,
  memory?: MemoryStore,
  engineConfig?: EngineConfig,
  systemPrompt?: string,
  filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[],
): Agent & {
  setPool(pool: AgentPool, instanceId: string): void;
  setSafeReporter(reporter: SafeErrorReporter): void;
  setWorkspaceRoot(root: string): void;
} {
  let workspaceRoot: string | null = null;
  let safeReporterRef: SafeErrorReporter | null = null;
  const resolved = resolveConfig(engineConfig);

  const config: AgentFactoryConfig = {
    type: AT.Inspector,
    systemPrompt: systemPrompt ?? '',
    maxLoops: DEFAULT_ENGINE_CONFIG.inspectorMaxLoops,
    memoryEnabled: true,
    filterRead,
    preExecuteHook: (node: TaskNode): TaskNode => {
      if (!workspaceRoot) return node;
      const facts = collectFacts(workspaceRoot, safeReporterRef ?? undefined, resolved.inspector);
      if (facts.length === 0) return node;
      return {
        ...node,
        payload: `${node.payload}\n\n[系统自动采集的编译事实——以下是真实命令输出，请如实报告]\n${facts.join("\n")}`,
      };
    },
  };

  const agent = createAgent(config, llm, toolkit, memory);

  // 用 getOwnPropertyDescriptors 保留 agent 的 getter（status 等），避免展开丢失
  const descriptors = Object.getOwnPropertyDescriptors(agent);
  const wrapped = Object.defineProperties({} as typeof agent, descriptors) as typeof agent & {
    setWorkspaceRoot(root: string): void;
  };

  wrapped.setWorkspaceRoot = function (root: string) {
    workspaceRoot = root;
  };
  wrapped.setSafeReporter = function (reporter: SafeErrorReporter) {
    safeReporterRef = reporter;
    agent.setSafeReporter(reporter);
  };

  return wrapped;
}
