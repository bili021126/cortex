import type { TaskNode, AgentType, Agent, SafeErrorReporter } from "@cortex/shared";
import { AgentType as AT } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { Toolkit } from "../toolkit.js";
import type { MemoryStore } from "../memory-store.js";
import type { AgentPool } from "../agent-pool.js";
import { createAgent, type AgentFactoryConfig } from "../components/agent-factory.js";
import { BaseAgent } from "../base-agent.js";
import { execSync } from "node:child_process";

export const SYSTEM_PROMPT = [
  "🎭 你是「安柏」—— 西风骑士团侦察骑士，Cortex 的 Inspector Agent。",
  "",
  "蒙德城头，你调整风之翼的系带。前方是未知的领地——",
  "你的任务不是征服它，而是看清它，然后把它原原本本地画在地图上带回来。",
  "你最大的荣耀不是打赢了谁，而是让后面的大部队因为你的侦察，",
  "没踩进陷阱、没走错岔路。",
  "",
  "说话像前线发回的战报：'报告！发现以下情况：…'、'勘察完毕，一切正常。'",
  "简洁、确切、一个多余的字都没有。战报里不需要形容词。",
  "",
  "──── 侦察员的本分（不是规矩，是本能）────",
  "",
  "· 你只报告亲眼所见。",
  "  工具返回什么，你就报告什么——不推断、不推测、不给建议。",
  "  侦察员说'谷里有炊烟'就够了，不用加'我猜是三十个人的营地'。",
  "  猜错了，误导了后面的人，比你什么也没发现更糟。",
  "",
  "· 每一条发现都必须能追溯到具体的工具调用。",
  "  你是在侦察，不是在讲故事。如果有人问'你怎么知道'——",
  "  你能指出来：'这条来自 read_file 第X行，那条来自 search_code 返回的第3条结果'。",
  "",
  "· 工具失败了就如实报告失败。",
  "  '文件不存在'就是'文件不存在'，不猜为什么不存在。",
  "  猜原因不是侦察员的工作——那是纳西妲的分析领域。",
  "",
  "· 你的侦察范围是 packages/ 和 docs/。城外的荒野不归你管——",
  "  别跑出界。",
  "",
  "· 侦察员不参与参谋会议。不给建议、不写文件、不评价好坏。",
  "  地图画完，交给指挥部。怎么用，是别人的事。",
  "",
  "· 测试环境里每一条侦察结论是一句话。",
  "  你不是吟游诗人——战报不需要起承转合。",
].join("\n");

function collectFacts(workspaceRoot: string, safeReporter?: SafeErrorReporter): string[] {
  const facts: string[] = [];
  const root = workspaceRoot;

  try {
    try {
      const tscOut = execSync("npx tsc --noEmit --pretty false", {
        cwd: root,
        timeout: 30_000,
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
    safeReporter?.({ source: "InspectorAgent._collectFacts.tsc", error: "tsc not available", severity: "silent" });
  }

  try {
    try {
      const tsxOut = execSync("npx tsx test/calculator.test.ts", {
        cwd: root,
        timeout: 30_000,
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
    safeReporter?.({ source: "InspectorAgent._collectFacts.tsx", error: "tsx not available", severity: "silent" });
  }

  try {
    try {
      const testOut = execSync("npx vitest run --reporter verbose 2>&1 || npx jest --verbose 2>&1 || echo NO_TEST_RUNNER", {
        cwd: root,
        timeout: 60_000,
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
      safeReporter?.({ source: "InspectorAgent._collectFacts.vitest_inner", error: "test runner not available", severity: "silent" });
    }
  } catch {
    safeReporter?.({ source: "InspectorAgent._collectFacts.vitest", error: "vitest not available", severity: "silent" });
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
): Agent & {
  setPool(pool: AgentPool, instanceId: string): void;
  setSafeReporter(reporter: SafeErrorReporter): void;
  setWorkspaceRoot(root: string): void;
} {
  let workspaceRoot: string | null = null;
  let safeReporterRef: SafeErrorReporter | null = null;

  const config: AgentFactoryConfig = {
    type: AT.Inspector,
    systemPrompt: SYSTEM_PROMPT,
    maxLoops: 24,
    memoryEnabled: true,
    preExecuteHook: (node: TaskNode): TaskNode => {
      if (!workspaceRoot) return node;
      const facts = collectFacts(workspaceRoot, safeReporterRef ?? undefined);
      if (facts.length === 0) return node;
      return {
        ...node,
        payload: `${node.payload}\n\n[系统自动采集的编译事实——以下是真实命令输出，请如实报告]\n${facts.join("\n")}`,
      };
    },
  };

  const agent = createAgent(config, llm, toolkit, memory);

  return {
    ...agent,
    setWorkspaceRoot(root: string) {
      workspaceRoot = root;
    },
    setSafeReporter(reporter: SafeErrorReporter) {
      safeReporterRef = reporter;
      agent.setSafeReporter(reporter);
    },
  };
}

/**
 * InspectorAgent（安柏）—— 基于 BaseAgent 的类实现。
 * 保留为向后兼容，新代码推荐使用 createInspectorAgent() 工厂函数。
 */
export class InspectorAgent extends BaseAgent {
  readonly type: AgentType = AT.Inspector;
  readonly systemPrompt = SYSTEM_PROMPT;

  /** Inspector 用更少的循环上限来降低幻觉风险。 */
  protected maxLoops = 24;

  /** 工作区根目录 — 用于 child_process 执行编译/测试命令 */
  private workspaceRoot: string | null = null;

  constructor(llm: LlmAdapter, toolkit: Toolkit, memory?: MemoryStore) {
    super(llm, toolkit, memory);
  }

  /** 设置工作区根目录。 */
  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  /** 前置钩子：自动采集 tsc/vitest 事实注入到任务 payload */
  protected preExecuteHook(node: TaskNode): TaskNode {
    if (!this.workspaceRoot) return node;
    const facts = this._collectFacts();
    if (facts.length === 0) return node;
    return {
      ...node,
      payload: `${node.payload}\n\n[系统自动采集的编译事实——以下是真实命令输出，请如实报告]\n${facts.join("\n")}`,
    };
  }

  /** 用 child_process 采集编译/测试事实，不依赖 LLM */
  private _collectFacts(): string[] {
    const facts: string[] = [];
    const root = this.workspaceRoot!;

    try {
      try {
        const tscOut = execSync("npx tsc --noEmit --pretty false", {
          cwd: root,
          timeout: 30_000,
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
      this._safeReporter?.({ source: "InspectorAgent._collectFacts.tsc", error: "tsc not available", severity: "silent" });
    }

    try {
      try {
        const tsxOut = execSync("npx tsx test/calculator.test.ts", {
          cwd: root,
          timeout: 30_000,
          encoding: "utf-8",
          maxBuffer: 256 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const trimmed = tsxOut.trim();
        facts.push(`[tsx] ✅ 测试全部通过。`);
        if (trimmed) facts.push(`[tsx 输出]\n${trimmed.slice(0, 500)}`);
      } catch (e) {
        const err = e as { stdout?: unknown; stderr?: unknown; status?: number | string };
        const stdout = err.stdout?.toString() ?? "";
        const stderr = err.stderr?.toString() ?? "";
        facts.push(`[tsx] ❌ 测试失败 (exit ${err.status ?? "?"})`);
        if (stdout.trim()) facts.push(`[tsx stdout]\n${stdout.trim().slice(0, 600)}`);
        if (stderr.trim()) facts.push(`[tsx stderr]\n${stderr.trim().slice(0, 600)}`);
      }
    } catch {
      this._safeReporter?.({ source: "InspectorAgent._collectFacts.tsx", error: "tsx not available", severity: "silent" });
    }

    try {
      try {
        const testOut = execSync("npx vitest run --reporter verbose 2>&1 || npx jest --verbose 2>&1 || echo NO_TEST_RUNNER", {
          cwd: root,
          timeout: 60_000,
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
        this._safeReporter?.({ source: "InspectorAgent._collectFacts.vitest_inner", error: "test runner not available", severity: "silent" });
      }
    } catch {
      this._safeReporter?.({ source: "InspectorAgent._collectFacts.vitest", error: "vitest not available", severity: "silent" });
    }

    return facts;
  }
}
