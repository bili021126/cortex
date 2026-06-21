/**
 * cli-engine-integration.test.ts — CLI↔Engine 独立闭环集成测试
 *
 * 验证 CLI 作为 Cortex 唯一交互界面的完整契约：
 *   用户输入 → 命令路由 → EngineBridge → 引擎组件 → 结构化响应
 *
 * 覆盖 13 个命令 + EngineBridge 生命周期 + 错误处理 + 输出格式一致性。
 * 使用 MiniAgentPool + 内存 MemoryStore，零外部依赖，可独立运行。
 *
 * 运行: npx vitest run tests/cli-engine-integration.test.ts
 */
export {};
//# sourceMappingURL=cli-engine-integration.test.d.ts.map