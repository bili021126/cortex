import type { TaskNode } from "@cortex/shared";
import { AgentType as AT } from "@cortex/shared";
import type { LlmAdapter } from "./llm-adapter.js";
import type { Toolkit } from "./toolkit.js";
import type { MemoryStore } from "./memory-store.js";
import { BaseAgent } from "./base-agent.js";
import { execSync } from "node:child_process";

const SYSTEM_PROMPT = [
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

/**
 * InspectorAgent（安柏）—— 侦察骑士，纯事实提供者。
 *
 * 与 AnalysisAgent 的关键区别：
 * - AnalysisAgent: 调研→对比→结论（有推理和判断）
 * - InspectorAgent: 工具采集→逐条罗列→格式化输出（无推理，纯事实）
 *
 * **v2.1 确定性事实前置采集**：
 * 在进入 ReAct 循环之前，直接用 child_process 执行编译/测试命令，
 * 把原始输出作为"铁的事实"注入到上下文中。LLM 只负责格式化这些事实，
 * 绝不让它去猜"编译是否通过"——这是决定 Inspector 是"侦察骑士"还是"算命先生"的关键。
 *
 * LLM 在此只做两件事：
 * 1. 决定调用哪些工具收集数据
 * 2. 将工具返回结果格式化为结构化报告（包含前置采集的编译/测试事实）
 *
 * 输出是 MetaAgent/ButlerAgent/用户做决策的事实基础。
 */
export class InspectorAgent extends BaseAgent {
  readonly type = AT.Inspector;
  readonly systemPrompt = SYSTEM_PROMPT;

  /** Inspector 用更少的循环上限来降低幻觉风险。 */
  protected maxLoops = 24;

  /** 工作区根目录 — 用于 child_process 执行编译/测试命令 */
  private workspaceRoot: string | null = null;

  constructor(
    llm: LlmAdapter,
    toolkit: Toolkit,
    memory?: MemoryStore,
  ) {
    super(llm, toolkit, memory);
  }

  /**
   * 设置工作区根目录。设置后，execute() 会在 ReAct 前自动执行
   * tsc --noEmit 并注入编译结果作为事实数据。
   */
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
      } catch (e: any) {
        const stdout = e.stdout?.toString() ?? "";
        const stderr = e.stderr?.toString() ?? "";
        facts.push(`[tsc --noEmit] ❌ 编译失败 (exit ${e.status ?? "?"})`);
        if (stdout.trim()) facts.push(`[tsc stdout]\n${stdout.trim().slice(0, 800)}`);
        if (stderr.trim()) facts.push(`[tsc stderr]\n${stderr.trim().slice(0, 800)}`);
      }
    } catch {
      // tsc 不可用时跳过
      this._safeReporter?.({ source: "InspectorAgent._collectFacts.tsc", error: "tsc not available", severity: "silent" });
    }

    // ── tsx 测试执行（直接运行 .ts 测试文件）──
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
      } catch (e: any) {
        const stdout = e.stdout?.toString() ?? "";
        const stderr = e.stderr?.toString() ?? "";
        facts.push(`[tsx] ❌ 测试失败 (exit ${e.status ?? "?"})`);
        if (stdout.trim()) facts.push(`[tsx stdout]\n${stdout.trim().slice(0, 600)}`);
        if (stderr.trim()) facts.push(`[tsx stderr]\n${stderr.trim().slice(0, 600)}`);
      }
    } catch {
      // tsx 不可用时跳过
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
        // 测试框架不可用时跳过
        this._safeReporter?.({ source: "InspectorAgent._collectFacts.vitest_inner", error: "test runner not available", severity: "silent" });
      }
    } catch {
      // vitest 不可用时跳过
      this._safeReporter?.({ source: "InspectorAgent._collectFacts.vitest", error: "vitest not available", severity: "silent" });
    }

    return facts;
  }
}
