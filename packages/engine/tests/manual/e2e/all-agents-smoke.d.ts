/**
 * 12-Agent 全量冒烟测试
 *
 * 用法: npx tsx tests/manual/e2e/all-agents-smoke.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 验证范围（共 12 个核心 Agent）:
 *   CodeAgent   ReviewAgent  AnalysisAgent  OpsAgent
 *   LoopAgent   DocGovern    ApiAgent       DataAgent
 *   FixAgent    Inspector    Browser        Butler
 *
 * 每个 Agent 接受一个与角色匹配的简单任务，
 * 验收标准: NodeResult.success === true 且 output 非空。
 */
export {};
//# sourceMappingURL=all-agents-smoke.d.ts.map