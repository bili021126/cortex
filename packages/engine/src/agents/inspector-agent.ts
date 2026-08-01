// @layer 治理层
import { AgentType as AT } from "@cortex/shared";
import type { TaskNode, Agent, SafeErrorReporter, MemoryEntry, ReadMode } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "@cortex/platform";
import type { MemoryStore } from "@cortex/memory-store";
import type { AgentPool } from "@cortex/scheduler";
import { createAgent } from "../execution/agent-factory.js";
import type { AgentFactoryConfig } from "../execution/agent-factory.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveConfig, DEFAULT_ENGINE_CONFIG } from "@cortex/config";
import type { EngineConfig } from "@cortex/config";

/** 所有 execSync 统一超时上限（ms） */
const SAFE_EXEC_TIMEOUT = 60_000;

/**
 * M9 — 提取为独立模块函数，工厂版本和类版本共同调用，消除 80 行重复代码。
 *
 * 用 child_process 采集编译/测试事实，不依赖 LLM。
 * 返回事实字符串数组，每一条对应一个命令执行结果。
 */
const asyncExec = promisify(exec);

async function collectFacts(workspaceRoot: string, safeReporter?: SafeErrorReporter, timeouts?: Required<EngineConfig>["inspector"]): Promise<string[]> {
  const facts: string[] = [];
  const root = workspaceRoot;
  const T = timeouts ?? { tscTimeout: 30_000, testTimeout: 30_000, vitestTimeout: 60_000 };

  try {
    try {
      const { stdout: tscOut } = await asyncExec("npx tsc --noEmit --pretty false", {
        cwd: root,
        timeout: Math.min(T.tscTimeout ?? SAFE_EXEC_TIMEOUT, SAFE_EXEC_TIMEOUT),
        encoding: "utf-8",
        maxBuffer: 256 * 1024,
      });
      facts.push(`[tsc --noEmit] ✅ 编译通过。`);
      if (tscOut.trim()) facts.push(`[tsc 输出] ${tscOut.trim().slice(0, 500)}`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number | string };
      const stdout = err.stdout?.toString() ?? "";
      const stderr = err.stderr?.toString() ?? "";
      facts.push(`[tsc --noEmit] ❌ 编译失败 (exit ${err.code ?? "?"})`);
      if (stdout.trim()) facts.push(`[tsc stdout]\n${stdout.trim().slice(0, 800)}`);
      if (stderr.trim()) facts.push(`[tsc stderr]\n${stderr.trim().slice(0, 800)}`);
    }
  } catch {
    safeReporter?.({ source: "InspectorAgent.collectFacts.tsc", error: "tsc not available", severity: "silent" });
  }

  // calculator.test.ts 已移除，不执行
  facts.push(`[tsx] ⏭️ calculator.test.ts 已移除，跳过。`);

  try {
    try {
      const { stdout: testOut } = await asyncExec("npx vitest run --reporter verbose 2>&1", {
        cwd: root,
        timeout: Math.min(T.vitestTimeout ?? SAFE_EXEC_TIMEOUT, SAFE_EXEC_TIMEOUT),
        encoding: "utf-8",
        maxBuffer: 512 * 1024,
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      });
      const trimmed = testOut.trim();
      if (trimmed) {
        const passed = /(\d+)\s+passed/.test(trimmed);
        const failed = /(\d+)\s+failed/.test(trimmed);
        facts.push(`[vitest] ${passed ? "✅ 测试通过" : ""}${failed ? "❌ 测试失败" : ""}${!passed && !failed ? "⚠️ 未检测到测试结果" : ""}`);
        facts.push(`[vitest 输出]\n${trimmed.slice(0, 1000)}`);
      }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number | string };
      const stdout = err.stdout?.toString() ?? "";
      if (stdout.trim()) {
        // 测试失败但有输出——如实报告失败事实（inspector 的职责）
        const passed = /(\d+)\s+passed/.test(stdout);
        const failed = /(\d+)\s+failed/.test(stdout);
        facts.push(`[vitest] ${passed ? "✅ 测试通过" : ""}${failed ? "❌ 测试失败" : ""}${!passed && !failed ? "⚠️ 未检测到测试结果" : ""}`);
        facts.push(`[vitest 输出]\n${stdout.trim().slice(0, 1000)}`);
      } else {
        // 真·runner 缺失（ENOENT/无输出）
        safeReporter?.({ source: "InspectorAgent.collectFacts.vitest_inner", error: "test runner not available", severity: "silent" });
      }
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
    preExecuteHook: async (node: TaskNode): Promise<TaskNode> => {
      if (!workspaceRoot) return node;
      const facts = await collectFacts(workspaceRoot, safeReporterRef ?? undefined, resolved.inspector);
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
