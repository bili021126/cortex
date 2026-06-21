/**
 * 宵宫飞书抓取——ReAct 自主闭环
 *
 * 架构：宵宫（DeepSeek 推理）→ Playwright（执行）→ 页面文本（感知）→ 宵宫（下一轮决策）
 * 零 tool_calls 依赖，零图片，纯文本 ReAct 循环。
 *
 * 用法: node --import tsx packages/engine/tests/manual/scripts/yoimiya-feishu.ts
 * 前提: .env 已配置 DEEPSEEK_API_KEY
 */
export {};
//# sourceMappingURL=yoimiya-feishu.d.ts.map