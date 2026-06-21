/**
 * query-loop.test.ts — 统一 Agent 查询循环单元测试
 *
 * 覆盖：
 *   - extractHistory: 过滤 system 消息，保留 user/assistant
 *   - agentTalkPersona: 解析 agent → persona 文本
 *   - queryLoop 基本流程: 无 tool_calls → yield llm_chunk → 返回最终文本
 *   - queryLoop 历史注入: history 参数注入到消息列表
 *   - queryLoop hooks: onStreamStart/onStreamEnd/onChunk 调用顺序
 *   - queryLoop 最大工具轮次: 达到 MAX_TOOL_ROUNDS(10) 后停止
 *   - queryLoop 模式: 各 mode 产生正确的 system prompt
 */
export {};
//# sourceMappingURL=query-loop.test.d.ts.map