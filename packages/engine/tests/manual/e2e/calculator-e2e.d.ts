/**
 * 计算器系统 —— 专家协作闭环 E2E
 *
 * 用法: npx tsx tests/manual/calculator-e2e.ts
 * 前提: 项目根目录 .env 已配置 DEEPSEEK_API_KEY
 *
 * 场景：阿贝多写计算器代码 →阿贝多写测试 →安柏编译测试 →刻晴审查 →阿贝多修复
 * 这不是 Mock，所有工具调用都是真实的。编译输出、测试结果、计算答案——全都是真的。
 *
 * 三位专家的灵魂：
 *   CodeAgent (阿贝多)   —— PRODUCED_BY/REFACTORED_FROM 记忆 —— 工人视角
 *   InspectorAgent (安柏) —— 前置 child_process 采集 tsc/vitest —— 确定性事实
 *   ReviewAgent (刻晴)    —— CITED_IN_COMMITTEE/REFACTORED_FROM 记忆 —— 历史审视
 */
export {};
//# sourceMappingURL=calculator-e2e.d.ts.map