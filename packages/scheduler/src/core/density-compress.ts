/**
 * DENSITY —— 上下文密度分级压缩工具。
 *
 * 子任务间传递上下文时，不机械全量传递，而是按密度分级。
 * 每个子任务产出附带 LLM 自标注的 [DENSITY: light/medium/heavy] 标签，
 * 下游子任务根据标签决定精读还是扫读。
 *
 * 对应策略：heavy → exhaustive, medium → conservative, light → greedy。
 *
 * @since RLM 递归拆解（思考执行体系总纲 §六）
 */

import type { DensityLevel, DensityAnnotated } from "@cortex/shared";
import { DENSITY_LIGHT_MAX_CHARS, DENSITY_MEDIUM_MAX_CHARS } from "@cortex/config";

/** DENSITY 标签的正则——匹配行首或独立出现的 [DENSITY: xxx] */
const DENSITY_TAG_RE = /\[DENSITY:\s*(light|medium|heavy)\s*\]/i;

/**
 * 从子任务输出中解析 DENSITY 标签。
 * 若未找到标签，默认视为 "medium"。
 */
export function parseDensityTag(output: string): DensityLevel {
  const m = output.match(DENSITY_TAG_RE);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (m) return m[1]!.toLowerCase() as DensityLevel;
  return "medium";
}

/**
 * 移除输出中的 DENSITY 标签本身（不影响内容）。
 */
export function stripDensityTag(output: string): string {
  return output.replace(DENSITY_TAG_RE, "").trim();
}

/**
 * 按密度级别压缩子任务输出。
 *
 * light:  一句话摘要——取前 150 字，截断处加 "…"
 * medium: 保留结构化行（列表项/标题/键值对/状态标记），去冗余空行，裁到 500 字
 * heavy:  保留全貌，不做压缩
 */
export function compressByDensity(raw: string, density: DensityLevel): string {
  const cleaned = stripDensityTag(raw);

  switch (density) {
    case "light":
      return compressLight(cleaned);
    case "medium":
      return compressMedium(cleaned);
    case "heavy":
      return cleaned;
  }
}

/**
 * 对子任务输出做完整的密度标注和压缩。
 */
export function annotateAndCompress(raw: string): DensityAnnotated {
  const density = parseDensityTag(raw);
  const compressed = compressByDensity(raw, density);
  return { raw, density, compressed };
}

/**
 * 将密度级别映射为对应的执行策略。
 * heavy → decompose（仔细拆解）, medium → react（标准循环）, light → direct（快速直达）
 */
export function densityToStrategy(density: DensityLevel): "decompose" | "react" | "direct" {
  switch (density) {
    case "heavy": return "decompose";
    case "medium": return "react";
    case "light": return "direct";
  }
}

/**
 * 将多个 DensityAnnotated 结果合并为上下文字符串。
 * heavy 全量保留，medium 取压缩版，light 只给摘要。
 * 用于构建子任务间的上下文传递。
 */
export function mergeContext(results: DensityAnnotated[]): string {
  if (results.length === 0) return "";

  const parts: string[] = [];
  for (const r of results) {
    const label = `[${r.density.toUpperCase()}]`;
    parts.push(`${label} ${r.compressed}`);
  }
  return parts.join("\n");
}

// ── 内部实现 ─────────────────────────────────────────────

function compressLight(text: string): string {
  const firstSentence = text.split(/[。！？\n]/)[0]?.trim() ?? text;
  if (firstSentence.length <= DENSITY_LIGHT_MAX_CHARS) return firstSentence;
  return firstSentence.slice(0, DENSITY_LIGHT_MAX_CHARS - 1) + "…";
}

function compressMedium(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      /^[-*#>]/.test(trimmed) ||
      /^[A-Za-z]+:/.test(trimmed) ||
      /^(✅|❌|⚠️|🔴|🟢|🟡)/.test(trimmed) ||
      /\b(error|warning|fail|pass|ok)\b/i.test(trimmed)
    ) {
      kept.push(trimmed);
    } else if (trimmed.length > 20) {
      kept.push(trimmed);
    }
  }

  const result = kept.join("\n");
  if (result.length <= DENSITY_MEDIUM_MAX_CHARS) return result;
  return result.slice(0, DENSITY_MEDIUM_MAX_CHARS - 1) + "…";
}
