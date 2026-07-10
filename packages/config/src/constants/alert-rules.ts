/** 预置遥测告警规则——可通过 config 外部覆写 */
export const PRESET_ALERT_RULES = [
  { metric: "context.inflate", threshold: 50000, level: "notice", message: "上下文膨胀超 50K chars" },
  { metric: "llm.request_body_size", threshold: 200000, level: "notice", message: "LLM 请求体超 200K" },
  { metric: "agent_pool.idle_rate", threshold: 0, consecutive: 3, level: "alert", message: "Agent 池连续 3 轮空闲率为 0" },
] as const;
