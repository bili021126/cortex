// ============================================================
// @cortex/engine/plugin/agent-factory-registry —— Agent 工厂注册表
//
// 配置驱动：新增 Agent 类型只需 registerAgentFactory() + cortex-agents.json，
// 不再需要改 scheduler.plugin.ts 的 switch 分支。
//
// @since v3.1 — 配置驱动装配
// ============================================================
// ─── 注册表 ─────────────────────────────────────
const _factories = new Map();
/** 注册 Agent 工厂 */
export function registerAgentFactory(type, factory) {
    _factories.set(type, factory);
}
/** 获取 Agent 工厂 */
export function getAgentFactory(type) {
    return _factories.get(type);
}
/** 检查是否已注册 */
export function hasAgentFactory(type) {
    return _factories.has(type);
}
/** 列出所有已注册的 Agent 类型 */
export function getRegisteredAgentTypes() {
    return [..._factories.keys()];
}
//# sourceMappingURL=agent-factory-registry.js.map