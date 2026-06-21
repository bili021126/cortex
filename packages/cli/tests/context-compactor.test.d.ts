/**
 * context-compactor.test.ts — 五层渐进式上下文压缩管线单元测试
 *
 * 覆盖所有导出函数 + 各压缩层边界条件：
 *   - estimateTokens
 *   - compactMessages 主入口（空消息、无 system prompt、各层触发与提前停止）
 *   - L1 孤立 tool 结果裁剪
 *   - L2 超长 tool 输出截断
 *   - L3 旧 tool 调用对合并
 *   - L4 LLM 摘要（含回调失败降级）
 *   - L5 最旧消息丢弃（含 keepRecentTurns 边界保护）
 */
export {};
//# sourceMappingURL=context-compactor.test.d.ts.map