/** 预置遥测告警规则——可通过 config 外部覆写 */
// S2-6 诚实收敛：context.inflate 无真实生产者（无 record 点）已移除；
// llm.request_body_size 由 llm-adapter 两处 recordTelemetry 生产；
// agent_pool.idle_rate 由 scheduler 直接入 telemetryController（真实 idleRate）。
export const PRESET_ALERT_RULES = [
  { metric: "llm.request_body_size", threshold: 200000, level: "notice", message: "LLM 请求体超 200K" },
  { metric: "agent_pool.idle_rate", threshold: 0, consecutive: 3, level: "alert", message: "Agent 池连续 3 轮空闲率为 0" },
] as const;
