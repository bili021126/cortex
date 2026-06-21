/**
 * bootstrap-integration.test.ts — Core-2 引擎集成验证
 *
 * 验证 bootstrapEngine() 从配置到运行时的完整流水线。
 * 使用 mock LLM 适配器，零 API 费用。
 *
 * 覆盖:
 *   T1: 启动全流水线——所有核心组件创建成功
 *   T2: MetaAgent.plan()——意图拆解为 TaskNode 树
 *   T3: Scheduler.executeAll()——Mock Agent 执行闭环
 *   T4: MemoryStore 读写——记忆持久化验证
 *
 * @ci unit（不依赖外部 API）
 */
export {};
//# sourceMappingURL=bootstrap-integration.test.d.ts.map