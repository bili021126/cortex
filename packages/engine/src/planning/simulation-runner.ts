/**
 * SimulationRunner —— 世界模型仿真层执行器
 * 
 * 轻量版：不是完整物理仿真，而是对计划执行结果的因果推演。
 * LLM 本身就是最好的因果推理引擎——这里只提供输入构造和结果收束。
 */

import type { LlmAdapter } from "@cortex/llm";
import { resilienceFactory } from "../execution/resilience-integration.js";

/**
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export interface SimulationInput {
  planNodes: Array<{ type: string; intent: string }>;
  currentState: Record<string, unknown>;
  constraints: string[];
}

/**
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export interface SimulationResult {
  riskLevel: "low" | "medium" | "high";
  predictedFailures: string[];
  suggestedReplan: boolean;
  confidence: number;
}

export interface SimulationConfig {
  maxSimulations: number;     // 默认 3
  timeoutPerSimMs: number;    // 默认 30000
}

const DEFAULT_CONFIG: SimulationConfig = {
  maxSimulations: 3,
  timeoutPerSimMs: 30000,
};

export class SimulationRunner {
  private config: SimulationConfig;
  private _llm?: LlmAdapter;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setLlm(llm: LlmAdapter): void {
    this._llm = llm;
  }

  /**
   * 对计划执行因果推演
   * 
   * 有 LLM 时走真实因果推演；无 LLM 时退化为保守 stub。
   */
  async simulate(input: SimulationInput): Promise<SimulationResult> {
    // 如果没有 LLM 注入，退化为保守 stub
    if (!this._llm) {
      console.error(`[telemetry] simulation.stub_fallback nodes=${input.planNodes.length}`);
      // Core-3: 接入工具/记忆/调度仿真，替代节点数简单判定
      return {
        riskLevel: input.planNodes.length > 5 ? "medium" : "low",
        predictedFailures: [],
        suggestedReplan: false,
        confidence: 0.5,
      };
    }

    // 构造仿真 prompt
    const prompt = [
      "你是 Cortex 世界模型仿真层。对以下计划做因果推演：",
      `节点数: ${input.planNodes.length}`,
      `约束: ${input.constraints.join(", ") || "无"}`,
      "输出 JSON: {\"riskLevel\":\"low|medium|high\",\"predictedFailures\":[\"可能失败点\"],\"suggestedReplan\":true|false,\"confidence\":0-1}",
    ].join("\n");

    try {
      const res = await resilienceFactory.execute("llm-call", async () =>
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this._llm!.chat("deepseek-v4-flash", [
          { role: "user", content: prompt }
        ], [], undefined, undefined),
      );
      
      const json = this._extractJson(res.content ?? "");
      return {
        riskLevel: (json.riskLevel as "low" | "medium" | "high") ?? "low",
        predictedFailures: (json.predictedFailures as string[]) ?? [],
        suggestedReplan: (json.suggestedReplan as boolean) ?? false,
        confidence: (json.confidence as number) ?? 0.6,
      };
    } catch {
      // LLM 调用失败 → 保守 stub
      return {
        riskLevel: "medium",
        predictedFailures: ["仿真层 LLM 调用失败——无法评估计划风险"],
        suggestedReplan: false,
        confidence: 0.3,
      };
    }
  }

  /** 供 Ganyu 规划时调用——返回是否建议重规划 */
  async shouldReplan(input: SimulationInput): Promise<boolean> {
    const result = await this.simulate(input);
    return result.suggestedReplan || result.riskLevel === "high";
  }

  /**
   * 从 LLM 输出的文本中提取 JSON。
   * 兼容可能包含 markdown 代码块或额外前缀的回复。
   */
  private _extractJson(text: string): Record<string, unknown> {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : {};
    } catch {
      console.warn('[SimulationRunner] JSON 解析失败，返回空对象');
      return {};
    }
  }
}

export const simulationRunner = new SimulationRunner();
