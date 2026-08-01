/**
 * @cortex/presence — 昔涟 Presence 设计规约
 *
 * 此文件定义 Desktop 端 Live2D 交互层的所有设计决策。
 * Qwen 的 emotion-map.ts / presence-engine.ts 实现时以此为准。
 *
 * 取值来源：
 *   - 模型: packages/desktop/resources/models/cyrene/Cyrene.model3.json
 *   - 人设: .cortex/lore/cyrene/persona-talk.txt
 *   - 表情名: model3.json Expressions 中定义的中文名（"闪耀"/"问号"/"星星眼"/"圈圈眼"/"墨镜"）
 *
 * 色值（§4）：S1-3 收编后直接消费 @cortex/design-tokens（CYRENE_PALETTE），
 * 不再维护本地副本。
 */

import { CYRENE_PALETTE, type PersonaPalette } from "@cortex/design-tokens";

// ═══════════════════════════════════════════════════
// §1 表情→Live2D Expression 映射
// ═══════════════════════════════════════════════════

/** 情感标签 → Live2D Expression ID（model3.json 中定义的中文名） */
export const EXPRESSION_IDS = {
  neutral:  "表情回正",
  sparkle:  "闪耀",       // 成功/完成/惊喜
  question: "问号",       // gate 等待确认
  sunglasses: "墨镜",     // （预留——未来可用于幽默场景）
  stareyes: "星星眼",     // 强喜悦（启动问候、"我爱你"级别）
  spiral:   "圈圈眼",     // 困惑/错误/不知所措
  /** "开" 和 "关" 是 Live2D 辅助开关表情，不作为语义表情暴露 */
} as const;

// ═══════════════════════════════════════════════════
// §2 事件→表情时序表（12 条规则）
// ═══════════════════════════════════════════════════

export interface ExpressionRule {
  /** 目标表情 ID */
  expression: keyof typeof EXPRESSION_IDS;
  /** 过渡时长 ms */
  durationMs: number;
  /** 停留时长 ms（0=立即恢复，-1=不自动恢复） */
  holdMs: number;
  /** 微笑幅度偏移（叠加到当前微笑值上，不是绝对值） */
  smileDelta: number;
  /** 恢复后的表情（-1=不恢复，保持 event 触发的表情直到下一个 event） */
  revertTo?: keyof typeof EXPRESSION_IDS;
  /** 张嘴时长 ms */
  mouthMs: number;
  /** 注视目标 */
  gaze: "user" | "input" | "center" | "away";
  /** 呼吸倍率（1.0=正常，0.7=浅，1.3=深） */
  breath: number;
}

/**
 * 事件→表情映射表
 *
 * 时序原则：
 *   - 流式事件的表达式应该"轻"——不能每个 chunk 都切表情，否则抖动
 *   - tool_result 是唯一应触发显著表情变化的事件——用户等的就是这个
 *   - gate.request 持续到 resolve 或 timeout，期间不自动恢复
 *   - idle 是自动恢复的目的地
 */
export const RULES: Record<string, ExpressionRule> = {

  // ── chat channel ────────────────────────────────

  "chat.chunk": {
    // 收到 AI 回复的 token 流——轻微张嘴 + 注视对话区
    // 不做表情切换（每秒可能数百个 chunk），仅 mouth + gaze
    expression: "neutral",
    durationMs: 0,       // 不触发表情过渡
    holdMs: 0,
    smileDelta: 0,
    mouthMs: 120,        // 轻微张嘴，不显迟钝
    gaze: "center",
    breath: 1.0,
  },

  "chat.tool_start": {
    // 开始执行工具——专注 + 浅呼吸
    expression: "neutral",
    durationMs: 0,
    holdMs: 0,
    smileDelta: 0,
    mouthMs: 0,
    gaze: "input",       // 看向"她在操作"的方向
    breath: 0.8,         // 浅呼吸 = 专注
  },

  "chat.tool_result": {
    // 工具执行完毕——这是她表情变化的主战场
    // 成功 → 闪耀（800ms）→ 恢复 neutral + 微扬嘴角
    // 失败 → 圈圈眼（1200ms）→ 恢复 neutral
    //
    // 注意：这个映射在代码中需要根据 data.success 分叉，
    // Qwen 的 emotion-map.ts 已正确处理了条件分支。
    expression: "sparkle",   // 成功默认
    durationMs: 800,
    holdMs: 0,
    smileDelta: 0.04,        // 微扬
    revertTo: "neutral",
    mouthMs: 0,
    gaze: "center",
    breath: 1.0,
  },

  // 工具失败——作为特殊规则注入 emotion-map.ts 的条件分支
  "__tool_result_fail__": {
    expression: "spiral",
    durationMs: 1200,
    holdMs: 800,             // 多困惑一会再恢复
    smileDelta: -0.05,
    revertTo: "neutral",
    mouthMs: 0,
    gaze: "center",
    breath: 0.9,
  },

  "chat.complete": {
    // 对话完成——闪耀 + 保持 1.5s 张嘴 + 恢复微笑
    expression: "sparkle",
    durationMs: 600,
    holdMs: 1500,            // 说完最后一个字后保持张嘴
    smileDelta: 0.03,
    revertTo: "neutral",
    mouthMs: 0,
    gaze: "user",            // 看向用户——"我做完啦"
    breath: 1.1,             // 微加速 = 做完事的满足感
  },

  "chat.error": {
    expression: "spiral",
    durationMs: 1000,
    holdMs: 2000,            // 错误需要更长时间消化
    smileDelta: -0.03,
    revertTo: "neutral",
    mouthMs: 0,
    gaze: "user",            // 看向用户——"对不起"
    breath: 0.85,
  },

  // ── gate channel ─────────────────────────────────

  "gate.request": {
    // 等待确认——问号表情。持续到 resolve 或 timeout，不自动恢复。
    expression: "question",
    durationMs: 400,
    holdMs: -1,              // -1 = 不自动恢复，等待下一个 event
    smileDelta: 0,
    mouthMs: 0,
    gaze: "user",            // 看着你等你点头
    breath: 0.7,             // 等待中的浅呼吸
  },

  // ── system channel ─────────────────────────────

  "system.daemon": {
    // 启动问候——星星眼 + 微笑 + 2s 过渡 + 恢复
    expression: "stareyes",
    durationMs: 2000,
    holdMs: 3000,
    smileDelta: 0.08,
    revertTo: "neutral",
    mouthMs: 0,
    gaze: "user",
    breath: 1.0,
  },

  // ── idle（30s 无事件）───────────────────────────

  "__idle__": {
    expression: "neutral",
    durationMs: 2000,         // 2s 渐入 idle
    holdMs: -1,              // 保持到下一个 event
    smileDelta: 0,            // 不笑——只是等，不是开心
    mouthMs: 0,
    gaze: "away",            // 偶尔看向别处
    breath: 1.2,             // 深呼吸 = 放松状态
  },
};

// ═══════════════════════════════════════════════════
// §3 启动时序
// ═══════════════════════════════════════════════════

/** Desktop 启动流程各阶段时长（ms） */
export const BOOT_SEQUENCE = {
  /** Live2D 模型加载 + 站立 + 环顾四周 */
  modelLoadMs: 3000,
  /** Daemon 健康检测超时（GET /api/v1/daemon/health） */
  healthCheckTimeoutMs: 3000,
  /** 连通后停留问候表情的时间 */
  greetingHoldMs: 4000,
  /** 整体启动目标——从进程启动到交互就绪 */
  targetTotalMs: 8000,
} as const;

// ═══════════════════════════════════════════════════
// §4 PRESENCE palette（收编自 @cortex/design-tokens）
// ═══════════════════════════════════════════════════

/**
 * 昔涟的 palette——直接引用 @cortex/design-tokens 的 CYRENE_PALETTE
 * （[权威] 逐区取自她的 Live2D 贴图 texture_0.png）。
 *
 * 来源：packages/desktop/resources/models/cyrene/texture_0.png
 *   primary  #b57edc  ← 主发色·薰衣草紫（披风与发梢主调）
 *   accent   #8fd9c4  ← 薄荷青挑染（发尾渐变的青绿）
 *   warmth   #fce8dd  ← 暖象牙肤色（面部/手部基底）
 *   bg.base  #14101c  ← 星空披风最深处的暖紫暗，不是蓝黑
 *   bg.surface #1d1730 ← 深紫底
 *
 * S1-3 收编：双源清零——本地不再维护色值副本，只保留消费层别名。
 * 多角色（甘雨/纳西妲）见 design-tokens 的 PRESENCE_PALETTES。
 */
export const PRESENCE_COLORS = {
  bg: CYRENE_PALETTE.bg,
  primary: CYRENE_PALETTE.primary,
  primaryHover: CYRENE_PALETTE.primaryHover,
  primaryMuted: CYRENE_PALETTE.primaryMuted,
  accent: CYRENE_PALETTE.accent,
  warmth: CYRENE_PALETTE.warmth,
  warmthMuted: CYRENE_PALETTE.warmthMuted,
} as const satisfies Pick<PersonaPalette, "bg" | "primary" | "primaryHover" | "primaryMuted" | "accent" | "warmth" | "warmthMuted">;
