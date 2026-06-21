/**
 * 宵宫视觉设计闭环 E2E —— CodeAgent + BrowserAgent + FixAgent 三 Agent 协作
 *
 * 场景：设计一个复杂的管理后台 Dashboard UI（纯 HTML + CSS，无框架）
 *
 * 用法: npx tsx tests/manual/e2e/webui-design-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证点：
 *   1. 阿贝多能否根据设计需求写出结构完整的 HTML+CSS
 *   2. 宵宫能否用 browser_do (navigate/screenshot/evaluate/measure) 做视觉审查
 *   3. 宵宫能否指出具体的视觉问题（间距、颜色、对齐等）
 *   4. 希格雯能否根据宵宫的反馈修复
 *   5. 闭环：修复后宵宫再审查 → 通过或继续迭代（最多 3 轮）
 *
 * 参与 Agent:
 *   CodeAgent (阿贝多)   —— 写 HTML+CSS
 *   BrowserAgent (宵宫)  —— navigate → screenshot → evaluate → 视觉反馈
 *   FixAgent (希格雯)    —— 接收反馈 → 修复
 */
export {};
//# sourceMappingURL=webui-design-e2e.d.ts.map