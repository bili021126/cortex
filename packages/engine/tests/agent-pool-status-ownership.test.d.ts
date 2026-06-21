/**
 * 测试文件: AgentPool 状态所有权测试 (方案B)
 *
 * 测试范围:
 * - AgentPool.getStatus() 单实例查询
 * - BaseAgent.status getter 委托到 AgentPool
 * - BaseAgent._setStatus() 走 Pool 写路径
 * - ButlerAgent.status getter 同样委托模式
 * - 无 Pool 时降级为 _localStatus（测试环境兼容）
 * - AgentPool.setStatus() 非法流转拒绝
 *
 * 治理判例: 方案B——AgentPool 为状态唯一权威源
 *
 * 测试数据用例:
 *   用例1: AgentPool.getStatus() 查询已注册实例状态
 *   用例2: BaseAgent.setPool() 后 status getter 委托到 Pool
 *   用例3: BaseAgent.wakeup() 通过 Pool 变更为 Awake
 *   用例4: BaseAgent.shutdown() 通过 Pool 变更为 Draining→Destroyed
 *   用例5: BaseAgent 无 Pool 时降级为 _localStatus
 *   用例6: AgentPool.setStatus() 非法流转拒绝
 */
export {};
//# sourceMappingURL=agent-pool-status-ownership.test.d.ts.map