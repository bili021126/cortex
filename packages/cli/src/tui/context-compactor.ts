/**
 * tui/context-compactor.ts — 5 层渐进式上下文压缩管线
 *
 * Claude Code 对标：5-layer compaction pipeline。
 * 纯函数模块，与 EngineBridge 零依赖。
 * Persona（system prompt，messages[0]）永不参与压缩。
 *
 * 触发策略：
 * - 50-80% → 仅警告（query-loop 层负责）
 * - 80-95% → 严重警告
 * - ≥95% → 自动触发压缩
 *
 * 5 层递进（每层应用后检查是否已低于目标阈值）：
 *   L1 裁剪孤立工具结果
 *   L2 截断超长工具输出
 *   L3 压缩旧工具调用对
 *   L4 LLM 摘要旧轮次（可选回调）
 *   L5 丢弃最旧消息（兜底）
 *
 * @module tui/context-compactor
 * @since v3 — Claude Code 对标：Context as scarce resource
 */

import type { LlmMessage } from "@cortex/shared";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 压缩选项 */
export interface CompactionOptions {
  /** 上下文窗口上限（tokens） */
  contextLimit: number;
  /** 当前估算 token 数 */
  currentTokens: number;
  /** 触发压缩的阈值（0-1），默认 0.95 */
  triggerThreshold?: number;
  /** 最近 N 轮对话不参与压缩，默认 3 */
  keepRecentTurns?: number;
  /** 工具输出最大字符数（L2），超出则截断，默认 2000 */
  toolOutputMaxChars?: number;
  /** 压缩后目标 token 比例（0-1），默认 0.6（压缩到 60% 以下即停止） */
  targetRatio?: number;
  /** L4 可选：LLM 摘要回调 */
  summarize?: (messages: LlmMessage[]) => Promise<string>;
}

/** 压缩结果 */
export interface CompactionResult {
  /** 压缩后的消息列表 */
  messages: LlmMessage[];
  /** 各层压缩摘要（用于日志/UI） */
  summary: string;
  /** 被修改/移除的消息数 */
  compactedCount: number;
  /** 压缩后估算 token 数 */
  estimatedTokens: number;
  /** 实际应用了哪些层 */
  appliedLayers: number[];
}

// ═══════════════════════════════════════════════════════════
// §2 工具函数
// ═══════════════════════════════════════════════════════════

/** 估算消息 token 数（chars/4 简单启发式，含 reasoning_content 和 tool_call_id） */
export function estimateTokens(messages: LlmMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += (m.content?.length ?? 0);
    if (typeof m.reasoning_content === "string") {
      total += m.reasoning_content.length;
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        total += JSON.stringify(tc).length;
      }
    }
    if (m.role === "tool" && m.tool_call_id) {
      total += String(m.tool_call_id).length;
    }
  }
  return Math.ceil(total / 4);
}

/** 判断压缩后是否已达目标 */
function isBelowTarget(tokens: number, opts: CompactionOptions): boolean {
  const target = opts.targetRatio ?? 0.6;
  return tokens <= opts.contextLimit * target;
}

/** 计算保留边界——最近 N 轮对话不参与压缩 */
function keepBoundary(messages: LlmMessage[], keepTurns: number): number {
  if (keepTurns <= 0) return messages.length;
  // 从末尾向前数 keepTurns 轮 user 消息
  let userCount = 0;
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i]!.role === "user") {
      userCount++;
      if (userCount >= keepTurns) return i;
    }
  }
  return 1; // 至少保留 system prompt
}

// ═══════════════════════════════════════════════════════════
// §3 五层压缩
// ═══════════════════════════════════════════════════════════

/**
 * L1: 裁剪孤立工具结果。
 *
 * 扫描所有 assistant 消息的 tool_calls，收集所有被引用的 tool_call_id。
 * 移除 tool_call_id 不在引用集中的 tool 消息。
 */
function compactL1(messages: LlmMessage[]): { messages: LlmMessage[]; removed: number } {
  // 收集所有被后续引用的 tool_call_id
  const referencedIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc.id) referencedIds.add(tc.id);
      }
    }
  }

  let removed = 0;
  const filtered: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const toolCallId = m.tool_call_id;
      if (toolCallId && !referencedIds.has(toolCallId)) {
        removed++;
        continue; // 孤儿 tool 结果，丢弃
      }
    }
    filtered.push(m);
  }
  return { messages: filtered, removed };
}

/**
 * L2: 截断超长工具输出。
 *
 * tool 消息 content 超过 toolOutputMaxChars 字符时，
 * 截断为前 N 字符 + 标记原始长度。
 */
function compactL2(
  messages: LlmMessage[],
  maxChars: number,
): { messages: LlmMessage[]; truncated: number } {
  let truncated = 0;
  const result: LlmMessage[] = messages.map((m) => {
    if (m.role !== "tool" || !m.content || m.content.length <= maxChars) return m;
    truncated++;
    return {
      ...m,
      content: m.content.slice(0, maxChars) +
        `\n[截断，原始 ${m.content.length} 字符]`,
    };
  });
  return { messages: result, truncated };
}

/**
 * L3: 压缩旧工具调用对。
 *
 * 对于 keepBoundary 之前的 assistant(tool_calls) + tool 相邻对，
 * 合并为单条 summary 消息。
 */
function compactL3(
  messages: LlmMessage[],
  keepIdx: number,
): { messages: LlmMessage[]; compressed: number } {
  const result: LlmMessage[] = [];
  let compressed = 0;
  let i = 0;

  while (i < messages.length) {
    // system prompt 或保留区之后的消息不压缩
    if (i === 0 || i >= keepIdx) {
      result.push(messages[i]!);
      i++;
      continue;
    }

    const m = messages[i]!;
    // 查找 assistant(tool_calls) → tool 对
    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0
    ) {
      const toolCalls = m.tool_calls;
      const callIds = new Set(toolCalls.map((tc) => tc.id));

      // 收集紧随其后的 tool 结果消息
      const toolResults: string[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j]!.role === "tool") {
        const toolCallId = messages[j]!.tool_call_id;
        if (toolCallId && callIds.has(toolCallId)) {
          const summary = (messages[j]!.content ?? "").slice(0, 100);
          toolResults.push(summary);
          j++;
        } else {
          break;
        }
      }

      // 构建压缩摘要
      const toolNames = toolCalls.map((tc) => tc.name).join(", ");
      const summaryContent = toolResults.length > 0
        ? `[已执行工具: ${toolNames} → ${toolResults.join("; ")}${toolResults.some(r => r.length >= 100) ? "..." : ""}]`
        : `[已执行工具: ${toolNames}]`;

      result.push({ role: "assistant" as const, content: summaryContent });
      compressed += (j - i - 1); // 被合并的 tool 消息数
      i = j;
      continue;
    }

    result.push(messages[i]!);
    i++;
  }

  return { messages: result, compressed };
}

/**
 * L4: LLM 摘要旧轮次（可选）。
 *
 * 将 keepBoundary 之前的非 tool 对话压缩为一段摘要。
 * 通过 summarize 回调调用 fast model。
 */
async function compactL4(
  messages: LlmMessage[],
  keepIdx: number,
  summarize?: (messages: LlmMessage[]) => Promise<string>,
): Promise<{ messages: LlmMessage[]; compressed: number }> {
  if (!summarize) return { messages, compressed: 0 };

  const oldMessages = messages.slice(1, keepIdx).filter((m) => m.role !== "tool");
  if (oldMessages.length < 4) return { messages, compressed: 0 }; // 太少不值得压

  try {
    const summary = await summarize(oldMessages);
    if (!summary || summary.length < 10) return { messages, compressed: 0 };

    const compressed = keepIdx - 1;
    return {
      messages: [
        messages[0]!, // system prompt
        { role: "assistant" as const, content: `[对话摘要] ${summary}` },
        ...messages.slice(keepIdx), // 保留区
      ],
      compressed,
    };
  } catch (err) { console.warn('[DEGRADED:tui-compactor]', String(err));
    return { messages, compressed: 0 };
  }
}

/**
 * L5: 丢弃最旧消息（兜底）。
 *
 * 从 keepBoundary 之前开始逐条移除，
 * 直到估算 token 低于目标或只剩 system prompt + 保留区。
 */
function compactL5(
  messages: LlmMessage[],
  keepIdx: number,
  targetTokens: number,
): { messages: LlmMessage[]; dropped: number } {
  if (keepIdx <= 1) return { messages, dropped: 0 };

  let dropped = 0;
  const result = [...messages];

  // 逐条移除旧消息（从索引 1 开始，保留 system）
  while (result.length > keepIdx && estimateTokens(result) > targetTokens) {
    // 移除索引 1（跳过 system prompt）
    result.splice(1, 1);
    dropped++;
  }

  return { messages: result, dropped };
}

// ═══════════════════════════════════════════════════════════
// §4 主入口
// ═══════════════════════════════════════════════════════════

/**
 * 渐进式上下文压缩——5 层递进。
 *
 * 每层应用后检查是否已达目标阈值，达标则提前停止。
 * system prompt (messages[0]) 永不参与压缩。
 *
 * @param messages 完整消息列表（含 system prompt）
 * @param opts 压缩选项
 * @returns 压缩结果
 */
export async function compactMessages(
  messages: LlmMessage[],
  opts: CompactionOptions,
): Promise<CompactionResult> {
  const targetTokens = (opts.targetRatio ?? 0.6) * opts.contextLimit;
  const keepTurns = opts.keepRecentTurns ?? 3;
  const maxChars = opts.toolOutputMaxChars ?? 2000;
  const appliedLayers: number[] = [];
  let totalCompacted = 0;
  const summaryParts: string[] = [];

  // 无 system prompt 或消息太少，不压缩
  if (messages.length < 2 || messages[0]!.role !== "system") {
    return {
      messages,
      summary: "跳过压缩（无有效上下文）",
      compactedCount: 0,
      estimatedTokens: estimateTokens(messages),
      appliedLayers: [],
    };
  }

  let current = [...messages];

  // ── L1: 裁剪孤立工具结果 ──
  {
    const r = compactL1(current);
    current = r.messages;
    if (r.removed > 0) {
      appliedLayers.push(1);
      totalCompacted += r.removed;
      summaryParts.push(`L1 裁剪 ${r.removed} 条孤立工具结果`);
    }
    if (isBelowTarget(estimateTokens(current), opts)) {
      return buildResult(current, summaryParts, totalCompacted, appliedLayers);
    }
  }

  // ── L2: 截断超长工具输出 ──
  {
    const r = compactL2(current, maxChars);
    current = r.messages;
    if (r.truncated > 0) {
      appliedLayers.push(2);
      summaryParts.push(`L2 截断 ${r.truncated} 条超长工具输出`);
    }
    if (isBelowTarget(estimateTokens(current), opts)) {
      return buildResult(current, summaryParts, totalCompacted, appliedLayers);
    }
  }

  // 计算保留边界
  const keepIdx = keepBoundary(current, keepTurns);

  // ── L3: 压缩旧工具调用对 ──
  {
    const r = compactL3(current, keepIdx);
    current = r.messages;
    if (r.compressed > 0) {
      appliedLayers.push(3);
      totalCompacted += r.compressed;
      summaryParts.push(`L3 压缩 ${r.compressed} 条旧工具调用对`);
    }
    if (isBelowTarget(estimateTokens(current), opts)) {
      return buildResult(current, summaryParts, totalCompacted, appliedLayers);
    }
  }

  // ── L4: LLM 摘要旧轮次（可选）──
  {
    const r = await compactL4(current, keepIdx, opts.summarize);
    current = r.messages;
    if (r.compressed > 0) {
      appliedLayers.push(4);
      totalCompacted += r.compressed;
      summaryParts.push(`L4 LLM 摘要 ${r.compressed} 条旧对话`);
    }
    if (isBelowTarget(estimateTokens(current), opts)) {
      return buildResult(current, summaryParts, totalCompacted, appliedLayers);
    }
  }

  // ── L5: 丢弃最旧消息 ──
  {
    const currentKeepIdx = keepBoundary(current, keepTurns);
    const r = compactL5(current, currentKeepIdx, targetTokens);
    current = r.messages;
    if (r.dropped > 0) {
      appliedLayers.push(5);
      totalCompacted += r.dropped;
      summaryParts.push(`L5 丢弃 ${r.dropped} 条最旧消息`);
    }
  }

  // ── 后处理：修复 role 交替（L3/L4/L5 可能产生连续同 role 消息）──
  current = _fixRoleAlternation(current);

  return buildResult(current, summaryParts, totalCompacted, appliedLayers);
}

/** 修复压缩后可能破坏的 user/assistant 交替规则 */
function _fixRoleAlternation(messages: LlmMessage[]): LlmMessage[] {
  if (messages.length < 3) return messages;
  const result: LlmMessage[] = [messages[0]!];
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = messages[i]!;
    if (curr.role === "tool") { result.push(curr); continue; }
    if (prev.role === curr.role) {
      // 同 role → 合并内容
      const merged = (prev.content ?? "") + "\n" + (curr.content ?? "");
      result[result.length - 1] = { ...prev, content: merged.trim() || "(已压缩)" };
    } else {
      result.push(curr);
    }
  }
  return result;
}
function buildResult(
  messages: LlmMessage[],
  summaryParts: string[],
  compactedCount: number,
  appliedLayers: number[],
): CompactionResult {
  const summary = summaryParts.length > 0
    ? `[压缩管线] ${summaryParts.join(" → ")}`
    : "未触发压缩（已低于阈值）";

  return {
    messages,
    summary,
    compactedCount,
    estimatedTokens: estimateTokens(messages),
    appliedLayers,
  };
}
