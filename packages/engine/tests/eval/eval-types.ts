// ============================================================
// @cortex/engine/tests/eval/eval-types —— 活性层核心类型（v1）
//
// 目标：机器可读的"机制活性"断言——机制造出来要证明它真的跑过。
// 断言只有三种动词 + byDesign 槽位（"故意不接线"的决策台账——
// B2 心跳那种设计决策写在这里，下轮审计不再翻旧账）。
// ============================================================

/** 断言动词：三种——轨迹中必须出现 / 必须不出现 / 顺序 */
export type LivenessVerb = "event-seen" | "event-absent" | "event-order";

export interface LivenessAssert {
  /** 断言动词 */
  verb: LivenessVerb;
  /** 事件类型（PipelineEventType 的字符串名）或载荷子串 */
  eventType: string;
  /** 载荷子串匹配（可选——eventType 匹配后进一步过滤 payload） */
  payloadSubstring?: string;
  /** event-order 专用：A 先于 B（第二个事件类型） */
  after?: string;
  /**
   * @planned 设计性台账槽位：true = "这个能力有意不接线/不触发"——
   * 断言失败时不红（记录为 by-design），断言通过时记录为"设计确认"。
   * B2 心跳（race 主看门狗、心跳不接线）等决策写在这里。
   */
  byDesign?: boolean;
}

export interface GoldenCase {
  /** 用例唯一标识（kebab-case） */
  id: string;
  /** 分类（v1: liveness——活性） */
  category: "liveness";
  /** 输入：执行什么（v1 支持 task 节点注入 / chat 输入） */
  input: {
    type: "task" | "chat";
    /** task：注入调度器的节点（payload/tags/type） */
    node?: { type: string; tags: string[]; payload: string };
    /** chat：对话输入 */
    text?: string;
    /** 执行前注入的 process.env（超时用例前置——如 CORTEX_NODE_DISPATCH_TIMEOUT_MS） */
    setupEnv?: Record<string, string>;
  };
  /** 期望断言集合 */
  expect: LivenessAssert[];
  /** 单用例超时兜底（ms） */
  timeoutMs?: number;
  /** 用例说明（写入报告——决策台账的可读部分） */
  note?: string;
}
