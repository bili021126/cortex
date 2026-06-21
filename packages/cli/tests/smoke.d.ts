/**
 * smoke.ts — CLI 用户交互冒烟测试
 *
 * 目标：验证 CLI 命令处理器对用户可见的契约没有因内部重构而断裂。
 * 不依赖 LLM / Engine Bridge，只走纯函数路径。
 *
 * 用法:
 *   npx tsx packages/cli/tests/smoke.ts
 *   npx tsx packages/cli/tests/smoke.ts --verbose
 *
 * 验收标准（Core-1 终局）:
 *   全部 PASS → 退出码 0
 *   任一 FAIL → 退出码 1
 */
export {};
//# sourceMappingURL=smoke.d.ts.map