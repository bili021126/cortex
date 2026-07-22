/**
 * presence/emotion-map.ts — WS 事件 → 表情/行为映射
 *
 * 定义 WSServerEvent 到 Live2D 表情参数的映射规则。
 * 这不是"动画效果"——是她的存在感。
 *
 * 所有数值来源：./design-spec.ts（设计侧裁定，工程侧不得自行修改）。
 *
 * @module renderer/presence/emotion-map
 * @since v7 — 三端 UI 设计 Phase P1
 */

import { EXPRESSION_IDS, RULES, type ExpressionRule } from "./design-spec";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

/** 表情变化指令（presence-engine 消费的唯一接口） */
export interface ExpressionDelta {
  /** 表情名称（对应 model3.json 中的 Expressions，通过 EXPRESSION_IDS 查表） */
  expression?: string;
  /** 嘴型开合度 0-1（覆盖 MouthSync） */
  mouthOpen?: number;
  /** 嘴型动作持续时间 ms */
  mouthDurationMs?: number;
  /** 视线目标：输入框方向 / 用户方向 / 别处 / 保持 */
  gaze?: "input" | "user" | "away" | "hold";
  /** 呼吸深度倍率（1.0 = 正常） */
  breathDepth?: number;
  /** 微笑幅度增量（叠加到当前表情） */
  smileDelta?: number;
  /** 持续时间 ms（之后自动恢复中性） */
  durationMs?: number;
  /** 是否打断当前正在播放的表情 */
  interrupt?: boolean;
}

/** 事件类型标识（与 @cortex/protocol WSServerEvent.data.type 对齐） */
export type PresenceEventType =
  | "chat.chunk"
  | "chat.tool_start"
  | "chat.tool_result"
  | "chat.complete"
  | "chat.error"
  | "gate.request"
  | "gate.notify"
  | "agent.status_change"
  | "system.status"
  | "system.shutdown"
  | "session.created"
  | "session.ended"
  | "user.input_start"
  | "user.idle";

/** 事件载荷（精简版，仅 presence 关心的字段） */
export interface PresenceEvent {
  type: PresenceEventType;
  /** chat.chunk 的文本增量长度 */
  chunkLength?: number;
  /** chat.tool_result 是否成功 */
  success?: boolean;
  /** 工具名 */
  toolName?: string;
  /** gate 等待超时 ms */
  gateTimeoutMs?: number;
}

// ═══════════════════════════════════════════════════════════
// §2 RULES → ExpressionDelta 转换
// ═══════════════════════════════════════════════════════════

/**
 * 将 design-spec 的 ExpressionRule 转为 presence-engine 消费的 ExpressionDelta。
 *
 * 映射逻辑：
 *   - expression: 通过 EXPRESSION_IDS 查表得到 model3.json 中文名
 *   - durationMs > 0 时才触发表情过渡（chunk 等高频事件不切表情）
 *   - holdMs > 0 → delta.durationMs = durationMs + holdMs（过渡+停留后恢复）
 *   - holdMs === -1 → 不设 durationMs（不自动恢复，等下一个 event）
 *   - gaze "center" → "user"（engine 中两者均调用 focusCenter）
 */
function ruleToDelta(rule: ExpressionRule): ExpressionDelta {
  const delta: ExpressionDelta = {};

  // 表情切换（durationMs=0 表示不触发过渡，仅 mouth/gaze 变化）
  if (rule.durationMs > 0) {
    delta.expression = EXPRESSION_IDS[rule.expression];
  }

  // 嘴型
  if (rule.mouthMs > 0) {
    delta.mouthOpen = 0.35;
    delta.mouthDurationMs = rule.mouthMs;
  }

  // 视线（"center" 在 engine 中等价于 "user" → focusCenter）
  delta.gaze = rule.gaze === "center" ? "user" : rule.gaze;

  // 呼吸
  delta.breathDepth = rule.breath;

  // 微笑偏移
  if (rule.smileDelta !== 0) {
    delta.smileDelta = rule.smileDelta;
  }

  // 自动恢复时序
  if (rule.holdMs > 0) {
    delta.durationMs = rule.durationMs + rule.holdMs;
  } else if (rule.holdMs === 0 && rule.durationMs > 0) {
    delta.durationMs = rule.durationMs;
  }
  // holdMs === -1 → 不设 durationMs，不自动恢复

  // 不自动恢复的事件视为高优先级打断
  if (rule.holdMs === -1) {
    delta.interrupt = true;
  }

  return delta;
}

// ═══════════════════════════════════════════════════════════
// §3 映射表（数值全部来自 design-spec.ts RULES）
// ═══════════════════════════════════════════════════════════

/** 安全取规则——键恒来自 design-spec，缺失即编码错误，fail-fast（替代裸 ! 断言） */
function getRule(key: string) {
  const r = RULES[key];
  if (!r) throw new Error(`[emotion-map] 缺失情绪规则: ${key}`);
  return r;
}

export const EMOTION_MAP: Record<PresenceEventType, (event: PresenceEvent) => ExpressionDelta> = {

  // #1: 流式文本到达 → 轻微张嘴跟随（不切表情——每秒数百个 chunk）
  "chat.chunk": (e) => {
    const rule = getRule("chat.chunk");
    return {
      mouthOpen: Math.min(0.5, 0.15 + (e.chunkLength ?? 1) * 0.04),
      mouthDurationMs: rule.mouthMs,
      gaze: "user",          // center → user (focusCenter)
      breathDepth: rule.breath,
    };
  },

  // #2: 工具开始执行 → 专注（浅呼吸 + 看向输入框）
  "chat.tool_start": () => {
    const rule = getRule("chat.tool_start");
    return ruleToDelta(rule);
  },

  // #3/#4: 工具执行结果 → 成功闪耀 / 失败圈圈眼
  "chat.tool_result": (e) => {
    const rule = e.success !== false
      ? getRule("chat.tool_result")
      : getRule("__tool_result_fail__");
    return ruleToDelta(rule);
  },

  // #5: 权限确认请求 → 问号表情，持续到 resolve（不自动恢复）
  "gate.request": () => {
    const rule = getRule("gate.request");
    return ruleToDelta(rule);
  },

  // #5b: gate 已解决（server 发 gate.notify）→ 恢复中性
  "gate.notify": () => ({
    expression: EXPRESSION_IDS.neutral,
    breathDepth: 1.0,
    gaze: "input" as const,
    durationMs: 500,
  }),

  // #6: 对话完成 → 闪耀 + 保持 + 看向用户（"我做完啦"）
  "chat.complete": () => {
    const rule = getRule("chat.complete");
    return ruleToDelta(rule);
  },

  // #9: 对话出错 → 圈圈眼 + 看向用户（"对不起"）
  "chat.error": () => {
    const rule = getRule("chat.error");
    return ruleToDelta(rule);
  },

  // #10: daemon 连通 → 轻微微笑确认（非启动问候，克制）
  "system.status": () => ({
    smileDelta: 0.02,
    durationMs: 1000,
    gaze: "hold" as const,
    breathDepth: 1.0,
  }),

  // #11: daemon 关闭 → 渐暗，回归中性
  "system.shutdown": () => ({
    expression: EXPRESSION_IDS.neutral,
    mouthOpen: 0,
    breathDepth: 0.5,
    gaze: "away" as const,
    interrupt: true,
  }),

  // #12: 新会话 → 星星眼问候（对应 RULES["system.daemon"] 启动时序）
  "session.created": () => {
    const rule = getRule("system.daemon");
    return { ...ruleToDelta(rule), interrupt: true };
  },

  // 会话结束 → 轻微点头，恢复中性
  "session.ended": () => ({
    expression: EXPRESSION_IDS.neutral,
    smileDelta: 0.01,
    durationMs: 800,
    gaze: "hold" as const,
  }),

  // #7: 用户空闲 → 深呼吸 + 看向别处（不自动恢复，等下一个 event）
  "user.idle": () => {
    const rule = getRule("__idle__");
    return ruleToDelta(rule);
  },

  // #8: 用户开始输入 → 打断当前，注视输入框
  "user.input_start": () => ({
    gaze: "input" as const,
    smileDelta: 0.01,
    breathDepth: 1.0,
    interrupt: true,
  }),

  // agent 状态变化 → 不直接映射表情（由 pipeline 视图消费）
  "agent.status_change": () => ({
    gaze: "hold" as const,
  }),
};

// ═══════════════════════════════════════════════════════════
// §4 查询接口
// ═══════════════════════════════════════════════════════════

/**
 * 将 presence 事件解析为表情变化指令。
 * 返回 null 表示该事件不影响 presence 层。
 */
export function resolveExpression(event: PresenceEvent): ExpressionDelta | null {
  const mapper = EMOTION_MAP[event.type];
  if (!mapper) return null;
  return mapper(event);
}
