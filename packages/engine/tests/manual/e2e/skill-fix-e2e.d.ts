/**
 * skill-fix-e2e.ts — 技能闭环 + 多 Agent + 事件管线 真实 LLM E2E
 *
 * v2.6.0 技能系统重构后：
 *   - 技能是"被参照"而非"被注入"——Agent 自主 queryByTags 拉取经验
 *   - SkillExecutor 已移除——SkillRegistry 是唯一技能池
 *   - registerSkillPipeline 监听 NodeComplete → 自动提取技能入池
 *   - 评价回流：recordFeedback(id, agentId, rating) → weight 累加
 *
 * 场景：
 *   多 Agent 并行：FixAgent 修配置 + CodeAgent 答问题
 *   技能池预注册 CI 修复技能 → FixAgent 按标签命中
 *   事件管线验证：PipelineObserver 订阅全部关键事件
 *
 * 用法: npx tsx tests/manual/e2e/skill-fix-e2e.ts [--verbose]
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验收标准:
 *   1. SkillRegistry.queryByTags 正确匹配技能（fix 标签）
 *   2. registerSkillPipeline 事件订阅成功
 *   3. FixAgent (react) 实际修复 tsconfig.json
 *   4. CodeAgent (direct) 产出有意义的回答（多 Agent 共存）
 *   5. PipelineObserver 捕获 NodeStart/NodeComplete/SchedulerDone 事件
 *   6. 评价回流：recordFeedback → weight 更新 + feedbackHistory 追加
 *   7. 临时目录清理完成
 */
export {};
//# sourceMappingURL=skill-fix-e2e.d.ts.map