/**
 * amendment-timeout 超时处置单元测试。
 *
 * 覆盖：
 *   - 新鲜提案（不超时）→ 无动作
 *   - pending_judgment 超过 TTL → needs_attention
 *   - draft 超过 TTL → warn_stale
 *   - 连续多次超时 → auto_reject
 *   - updateStaleCount 正确追踪计数
 *   - 非 draft/pending_judgment 提案被跳过
 *   - 自定义 TimeoutConfig
 */
export {};
//# sourceMappingURL=amendment-timeout.test.d.ts.map