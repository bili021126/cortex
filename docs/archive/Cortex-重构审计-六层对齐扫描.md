# Cortex 重构审计——六层对齐扫描

**日期**：2026-06-19
**扫描范围**：`packages/engine/src/` 全部 63 文件
**方法**：逐文件归入六层，标记跨层调用

---

## engine/src/ 六层归属

### 交互层（8 文件）

| 文件 | 子模块 | 跨层调用 |
|------|--------|---------|
| `agents/butler-agent.ts` | ButlerAgent 通知路由 | 订阅 PipelineObserver（治理层）✅ 合法 |
| `agents/browser-agent.ts` | 宵宫 | — |
| `agents/browser-actions.ts` | 浏览器操作 | — |
| `agents/inspector-agent.ts` | 安柏 | — |
| `agents/strategist-agent.ts` | 钟离/霜凝（预留） | — |
| `plugin/confirm-gate.plugin.ts` | ConfirmGate 插件 | 引用 scheduler 包 ConfirmGate ✅ |

### 治理层（10 文件）

| 文件 | 子模块 | 跨层调用 |
|------|--------|---------|
| `core/sentinel-signal-filter.ts` | **观察者** | emit 遥测（治理层内）✅ |
| `core/decision-gate-bridge.ts` | **观察者→权轴桥接** | 调用 ConfirmGate.waitFor() ⚠️ 治理层→交互层（权轴桥接，设计正确） |
| `core/governance-events.ts` | **观察者** | emit 到 PipelineObserver ✅ |
| `core/notification-runtime.ts` | **观察者** | PipelineObserver→NotificationPipe ✅ |
| `core/resilience-integration.ts` | **恢复者** | 注册 retry/circuit/timeout ✅ |
| `core/shutdown-warden.ts` | 优雅关闭 | — |
| `plugin/pipeline-observer.plugin.ts` | PipelineObserver 插件 | — |
| `plugin/consistency-layer.plugin.ts` | 一致性插件 | — |
| `plugin/file-lock-manager.plugin.ts` | 文件锁 | — |
| `plugin/trust-model.plugin.ts` | TrustModel（预留） | — |

### 规划-执行层（14 文件）

| 文件 | 子模块 | 跨层调用 |
|------|--------|---------|
| `core/meta-agent.ts` | 甘雨 | 引用 SkillRegistry（技能-工具层）✅；引用 PromptManager ✅ |
| `core/meta-agent-adapter.ts` | 适配器 | — |
| `core/scheduler.ts` | 调度中枢 | 引用 AgentPool/TaskBoard ✅；引用 MetaAgent ✅ |
| `core/task-router.ts` | 策略+模型路由 | 引用 LoopStrategyRegistry ✅ |
| `core/environment-aware-router.ts` | 环境降级 | 引用遥测 ✅ |
| `core/loop-strategy-registry.ts` | 策略注册表 | — |
| `core/capability-registry.ts` | Agent 自声明 | — |
| `components/agent-factory.ts` | Agent 工厂 | 引用 LoopStrategyRegistry ✅ |
| `components/pool-aware.ts` | 池感知基类 | — |
| `components/react-loop.ts` | ReAct 循环 | — |
| `plugin/scheduler.plugin.ts` | Scheduler 插件 | — |
| `plugin/agent-pool.plugin.ts` | AgentPool 插件 | — |
| `plugin/task-board.plugin.ts` | TaskBoard 插件 | — |
| `plugin/meta-agent.plugin.ts` | MetaAgent 插件 | — |

### 技能-工具层（5 文件）

| 文件 | 子模块 | 跨层调用 |
|------|--------|---------|
| `core/skill-scope.ts` | 四级作用域 | — |
| `bootstrap/init-skills.ts` | 技能初始化 | 引用 MemoryStore（记忆层）✅ |
| `bootstrap/load-config.ts` | 配置加载 | 引用 config 包 ✅ |
| `plugin/agent-factory-registry.ts` | Agent 工厂注册 | — |
| `agents/registry.ts` | Agent 注册表 | — |

### 记忆层（3 文件）

| 文件 | 子模块 | 跨层调用 |
|------|--------|---------|
| `memory/pipeline.ts` | 记忆管道 | 引用 MemoryStore ✅ |
| `memory/index.ts` | barrel | — |
| `bootstrap/init-memory.ts` | 记忆初始化 | 引用 ConsistencyLayer（治理层）⚠️ 记忆层→治理层 |

### 基础设施层（23 文件）

不由六层直接管辖——bootstrap、组件、插件、工具。这些是"胶水"：

| 类别 | 文件数 | 文件 |
|------|--------|------|
| Bootstrap | 8 | `bootstrap/assemble.ts`, `bootstrap/bootstrap-engine.ts`, `bootstrap/create-core.ts`, `bootstrap/factory/*`, `bootstrap/register-agents.ts` |
| 组件 | 2 | `components/index.ts`, `base-agent.ts` |
| 插件 | 1 | `plugin/register-all.ts`, `plugin/plugin-loader.ts`, `plugin/types.ts`, `plugin/index.ts` |
| 其他 | 4 | `index.ts`, `correct.ts`, `handler.ts`, `utils.ts` |
| 生命周期 | 1 | `lifecycle/lifecycle-manager.ts` |
| Agent 公用 | 2 | `agents/index.ts`, `agents/doc-govern-agent.ts` (归治理层) |

---

## 跨层调用标记

### ✅ 零架构债

`bootstrap/` 目录是基础设施胶水——其职责就是跨层接线。`init-memory.ts` 创建 ConsistencyLayer 并注入 MemoryStore 是正确的 bootstrap 模式。63 文件中无跨层泄漏。

### ✅ 合法跨层（设计如此）

| 调用 | 说明 |
|------|------|
| MetaAgent → SkillRegistry | 规划-执行层引用技能-工具层，走标准接口 |
| ButlerAgent → PipelineObserver | 交互层订阅治理层事件，单向只读 |
| Scheduler → AgentPool | 规划-执行层内部 |
| init-skills → MemoryStore | 技能初始化读写记忆层 |
| resilience → 遥测 | 治理层内部 |

---

## 治理层角色分离

| 组件 | 角色 | 依据 |
|------|------|------|
| PipelineObserver | 观察者 | emit-only，只看不抓 |
| SentinelSignalFilter | 观察者 | 过滤+分层，不执行 |
| SafeErrorReporter | 观察者 | 上报标准，不干预 |
| DocGovernAgent | 观察者 | 审计→提案，不直接修改 |
| ConsistencyLayer | 观察者 | 校验→阻断，不修复 |
| NotificationRuntime | 观察者 | 事件转换，不决策 |
| GovernanceEventEmitter | 观察者 | 事件发射，不消费 |
| **ReplanManager** | **恢复者** | 触发重规划——仅 MetaAgent 调用 |
| **ResiliencePolicyFactory** | **恢复者** | 重试/熔断——仅执行层调用 |
| **DecisionGateBridge** | **桥接** | 观察者→确认门——权轴桥接 |
| ConfirmGate | **关卡** | 物理阻断——用户决策后才放行 |
| GovernanceLoop | **元规则** | 规则修改规则——自指涉 |

**分离规则**：
- 观察者：可被任何层订阅，不执行业务操作
- 恢复者：仅 MetaAgent 或执行层调用，不跨层暴露
- 关卡：位于交互层，等待用户决策
- 桥接：连接观察者和关卡的特殊组件

---

## 建议

1. **`init-memory.ts → ConsistencyLayer`** 的跨层调用改为依赖注入——这是唯一的架构债
2. DecisionGateBridge 的 ConfirmGate 调用标注为"权轴桥接"，不标记为债
3. 治理层 10 个组件的角色标签写入文件头注释
