// ============================================================
// Cyrene-Agent 记忆系统 — Worldbook 常量（适配版）
//
// 从 Cyrene-Agent src/main/rag/worldbook-constants.ts 提取。
// ============================================================

export const WORLDBOOK_CONSTANTS: {
  MAX_ACTIVE: number;
  DEFAULT_INTRINSIC_VALUE: number;
  MIN_INTRINSIC_VALUE: number;
  EPSILON: number;
  FLOOR_TRIGGER_STATE: string;
  STATES: {
    readonly ACTIVE: "Active";
    readonly DORMANT: "Dormant";
    readonly ARCHIVED: "Archived";
  };
} = {
  MAX_ACTIVE: 8,
  DEFAULT_INTRINSIC_VALUE: 60,
  MIN_INTRINSIC_VALUE: 1,
  EPSILON: 0.01,
  FLOOR_TRIGGER_STATE: "Archived",
  STATES: {
    ACTIVE: "Active",
    DORMANT: "Dormant",
    ARCHIVED: "Archived",
  },
};

export const INJECTION_HEADER = "【已激活的世界知识】";
export const INJECTION_PREAMBLE =
  "以下内容已由当前用户消息触发，视为真实且已知。回复时请自然使用这些信息，不要说「不知道」、「第一次听说」或要求用户介绍，除非内容本身存在矛盾。";
