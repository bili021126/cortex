/**
 * @cortex/plugin-runner — 集成测试：全链路验证
 *
 * 覆盖完整管道：注册（Registry）→ 校验（Validator）→ 执行（Runner init+execute）→ 销毁（destroy）
 *
 * 测试范围：
 *   1. 全链路快乐路径（单个插件：注册 → 校验 → init → execute → destroy）
 *   2. Schema 配置校验联动（validateConfig 拒绝 → 管道提前中断）
 *   3. 依赖解析 + 拓扑排序 + executeAll 批量执行（注册 → 依赖校验 → 按序执行 → 销毁）
 *   4. 异常隔离 + 资源清理（execute 抛出 → destroy 仍被调用）
 *   5. 多次执行 + 状态追踪
 *   6. shutdown 全局清理
 *   7. config.ts（PluginConfigManager）与 registry/runner 配合使用
 */
export {};
//# sourceMappingURL=integration.test.d.ts.map