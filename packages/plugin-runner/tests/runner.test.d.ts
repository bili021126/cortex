/**
 * @cortex/plugin-runner — PluginRunner 沙箱执行引擎 单元测试
 *
 * 覆盖：
 *   - execute() 完整流程（合规校验 → 执行 → 收尾）
 *   - 边界：插件未注册、配置校验失败、依赖缺失
 *   - 异常隔离：init / execute / destroy 抛出异常时捕获并返回 error result
 *   - 超时切断：Promise.race 超时后返回超时错误
 *   - AbortSignal 外部取消
 *   - executeAll() 批量执行（拓扑排序批次、并行执行、结果聚合）
 *   - getStatus() 运行时状态查询
 *   - shutdown() 优雅关闭（清理插件 + 工作目录 + 清空状态）
 */
export {};
//# sourceMappingURL=runner.test.d.ts.map