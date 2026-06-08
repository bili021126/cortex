/**
 * RLM decompose —— 从宏观 TaskNode 拆解出原子子任务。
 *
 * 在 ExecuteStep 内部调用——不走 AgentPool 完整生命周期。
 * 子任务是执行策略，非独立任务。
 *
 * 核心约束（思考执行体系总纲 §四）：
 * - 单文件、单维度、明确出口
 * - maxDepth=3 自限
 * - decompose confidence < 0.6 → 回退直接执行
 * - 已原子化的子任务不再拆
 *
 * @since RLM 递归拆解
 */

import type { DecomposeResult, SubTask } from "@cortex/shared";
import { RLM_MIN_CONFIDENCE, RLM_MAX_DEPTH, RLM_MIN_COMPLEXITY_CHARS } from "@cortex/config";

/**
 * LLM 可调用签名——与 MetaAgent 使用模式一致。
 * (model, messages) → response content string
 *
 * @contract 模块边界契约
 * - 调用方: Scheduler._buildLlmChat(), RlmExecuteStep._tryDecompose()
 * - 约定: 返回纯文本（非 JSON），失败抛异常
 * - 不保证: token 限制、重试、流式
 */
export type LlmCallable = (model: string, messages: Array<{ role: string; content: string }>) => Promise<string>;

/** 子任务拆解的最大递归深度（从 config 导入，模块内兼容别名） */
export const MAX_RLM_DEPTH = RLM_MAX_DEPTH;

const DECOMPOSE_SYSTEM = [
  "你是一个任务拆解专家。你的职责是将宏观任务拆解为原子级的子任务。",
  "",
  "拆解原则：",
  "1. 每个子任务必须是原子级的——单文件、单维度、明确出口",
  "2. 子任务之间通过 depends_on 声明依赖关系（子任务 ID 数组）",
  "3. 每个子任务标注密度级别：",
  "   - light: 确认性检查（「通过」「无异常」），一句话即可",
  "   - medium: 有结构的分析（错误列表、检查清单、diff 概览）",
  "   - heavy: 不可丢失的结论（架构决策、安全漏洞、设计理由）",
  "4. 每个子任务标注 confidence (0-1)，表示你对它原子性的信心",
  "5. 对整体拆解方案也标注 confidence (0-1)",
  "6. 即使任务描述已按维度/步骤分项，仍需为每个独立操作目标创建独立的子任务",
  "7. 如果任务确实已经原子化（单操作、单文件、单判断），才返回空的 subTasks 数组",
  "8. conservative 策略：宁可不拆，不可硬拆。confidence < 0.7 的子任务不如不拆",
  "",
  "输出严格的 JSON 格式（不要markdown代码块包裹）：",
  "{",
  '  "subTasks": [',
  '    {"id": "st-1", "description": "子任务描述", "dependsOn": [], "density": "medium", "confidence": 0.9}',
  "  ],",
  '  "confidence": 0.85,',
  '  "rationale": "拆解理由简述"',
  "}",
].join("\n");

/**
 * 判断节点是否足够复杂以触发 RLM 拆解。
 * 复杂度来源：payload 长度、analysis/research 标签、decompose 策略标注。
 *
 * @contract 模块边界契约
 * - 调用方: RlmExecuteStep._shouldAttemptDecompose()
 * - 保证: 纯函数，仅读取参数不修改全局状态
 * - 阈值: RLMMINCOMPLEXITY_CHARS=200
 */
export function shouldDecompose(payload: string, tags: string[], preferredStrategy?: string): boolean {
  if (preferredStrategy === "decompose") return true;
  if (payload.length > RLM_MIN_COMPLEXITY_CHARS) return true;
  if (tags.some((t) => t === "analysis" || t === "research")) return true;
  return false;
}

/**
 * 构建 decompose() 的用户提示词。
 */
export function buildDecomposePrompt(payload: string, currentDepth: number): string {
  const depthNote = currentDepth > 0
    ? `当前拆解深度: ${currentDepth}/${MAX_RLM_DEPTH}。接近上限，请确保子任务已足够原子化。`
    : `最大拆解深度: ${MAX_RLM_DEPTH}。`;

  return [
    `请将以下任务拆解为原子子任务：`,
    "",
    "```",
    payload,
    "```",
    "",
    depthNote,
    "如果任务已经足够原子化（单文件、单维度、明确出口），返回空的 subTasks 数组，confidence 设为 1.0。",
  ].join("\n");
}

/**
 * 调用 LLM 拆解任务，返回 DecomposeResult。
 *
 * @contract 模块边界契约
 * - 调用方: RlmExecuteStep._tryDecompose()
 * - 保证: 永远返回 DecomposeResult（不抛异常），LLM 调用失败 → subTasks=[]/confidence=0
 * - 副作用: LLM HTTP 调用
 *
 * @param llmCallable LLM 调用函数 (model, messages) → content
 * @param model 使用的模型名
 * @param payload 任务描述
 * @param currentDepth 当前递归深度
 */
export async function decompose(
  llmCallable: LlmCallable,
  model: string,
  payload: string,
  currentDepth: number = 0,
): Promise<DecomposeResult> {
  // 深度超限 → 不拆
  if (currentDepth >= MAX_RLM_DEPTH) {
    return {
      subTasks: [],
      confidence: 1.0,
      rationale: `已达到最大拆解深度 ${MAX_RLM_DEPTH}，不再拆解`,
    };
  }

  // 复杂度不足 → 不拆
  if (!shouldDecompose(payload, [], undefined)) {
    return {
      subTasks: [],
      confidence: 1.0,
      rationale: "任务复杂度不足，无需拆解",
    };
  }

  const prompt = buildDecomposePrompt(payload, currentDepth);

  let rawContent: string;
  try {
    rawContent = await llmCallable(model, [
      { role: "system", content: DECOMPOSE_SYSTEM },
      { role: "user", content: prompt },
    ]);
  } catch {
    // LLM 调用失败 → 回退直接执行
    return {
      subTasks: [],
      confidence: 0,
      rationale: "LLM 调用失败，回退直接执行",
    };
  }

  return parseDecomposeResponse(rawContent);
}

/**
 * 解析 LLM 的 JSON 响应为 DecomposeResult。
 * JSON 解析失败、格式不符 → 回退直接执行。
 */
export function parseDecomposeResponse(raw: string): DecomposeResult {
  // 尝试提取 JSON（LLM 可能用 markdown 代码块包裹）
  let jsonStr = raw.trim();

  // 去掉可能的 markdown 代码块包裹
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // 找到第一个 { 到最后一个 } 之间的内容
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr) as {
      subTasks?: Array<{
        id?: string;
        description?: string;
        dependsOn?: string[];
        density?: string;
        confidence?: number;
      }>;
      confidence?: number;
      rationale?: string;
    };

    const subTasks: SubTask[] = (parsed.subTasks ?? [])
      .filter((st) => st.id && st.description)
      .map((st, i) => ({
        id: st.id ?? `st-${i}`,
        description: st.description ?? "",
        dependsOn: Array.isArray(st.dependsOn) ? st.dependsOn : [],
        density: (["light", "medium", "heavy"].includes(st.density ?? "") ? st.density : "medium") as SubTask["density"],
        confidence: typeof st.confidence === "number" ? Math.max(0, Math.min(1, st.confidence)) : 0.8,
      }));

    const overallConfidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : (subTasks.length === 0 ? 1.0 : 0.5);

    return {
      subTasks,
      confidence: overallConfidence,
      rationale: parsed.rationale ?? (subTasks.length === 0 ? "任务已原子化" : `拆解为 ${subTasks.length} 个子任务`),
    };
  } catch {
    return {
      subTasks: [],
      confidence: 0,
      rationale: `JSON 解析失败，原始响应前 200 字: ${raw.slice(0, 200)}`,
    };
  }
}

/**
 * 对 DecomposeResult 做最终裁决——判断是否应该实际执行拆解。
 *
 * 不拆的情况：
 * - confidence < RLMMIN_CONFIDENCE
 * - subTasks 为空
 * - 只有一个子任务且 confidence < 0.8（拆了等于没拆）
 *
 * @contract 模块边界契约
 * - 调用方: RlmExecuteStep.run()
 * - 保证: 纯函数，无副作用
 */
export function shouldExecuteDecomposition(result: DecomposeResult): boolean {
  if (result.confidence < RLM_MIN_CONFIDENCE) return false;
  if (result.subTasks.length === 0) return false;
  if (result.subTasks.length === 1 && result.subTasks[0].confidence < 0.8) return false;
  return true;
}
