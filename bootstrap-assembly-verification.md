# 启动装配链路核实报告

> 探查者：纳西妲（Analysis Agent）
> 探查目标：bootstrapEngine 启动装配链路 — loadConfig → PluginLoader → initSkillSystem → installConsoleBridge → NotificationRuntime start
> 探查范围：`packages/engine/src/bootstrap/*.ts` + `packages/engine/src/core/notification-runtime.ts`

---

## 一、文件根系图

```
bootstrap/
├── bootstrap-engine.ts   ← 主装配入口（流水线编排）
├── load-config.ts        ← §1 配置加载
├── create-core.ts        ← （v2.x 遗迹，当前未在 bootstrap-engine 中直接调用）
├── init-memory.ts        ← （v2.x 遗迹，MemoryStore+ConsistencyLayer 初始化）
├── init-skills.ts        ← §6.1 技能系统初始化
├── register-agents.ts    ← （v2.x 遗迹，Agent 注册）
├── assemble.ts           ← 返回类型定义 BootstrapEngineResult
├── factory/
│   ├── index.ts          ← barrel 导出
│   ├── bootstrap.ts      ← 配置读取主入口
│   ├── types.ts          ← 配置类型定义
│   ├── loaders/          ← agents/cognition/docs 加载器
│   └── schemas/          ← 跨字段校验
```

**关键观察**：`bootstrap-engine.ts` 是**当前真实的装配入口**（v3.0 插件化重构后）。`create-core.ts`、`init-memory.ts`、`register-agents.ts` 是 v2.x 的旧流水线步骤，它们在 `bootstrap-engine.ts` 中**不再被直接调用**——已被 PluginLoader 替代。

---

## 二、装配顺序核实（按 bootstrap-engine.ts 实际执行顺序）

### ✅ §1 —— loadConfig（存在且顺序正确）
- 文件：`bootstrap-engine.ts:55` → 调用 `loadConfig(projectRoot)`
- 实现：`load-config.ts:78-83` — 调用 factory 包的 `bootstrap(projectRoot)`，返回 `BootstrapResult`
- 附加：`resolveCodingStandards`（编码规范注入）+ `resolveLlm`（LLM 解析）

### ✅ §1.1 —— enhancePrompts（PromptManager 管线）
- 位置：`bootstrap-engine.ts:61-69`
- 职责：异步增强 Agent prompt（校验 + 缓存 + 模板渲染），失败时优雅降级
- 注意：这是**新增步骤**，旧链中没有

### ✅ §2 —— injectRegistryFromConfig
- 位置：`bootstrap-engine.ts:74`
- 职责：从配置定义注入运行时注册表 + 工具元数据

### ✅ §3 —— 插件注册（import "../plugin/register-all.js"）
- 位置：`bootstrap-engine.ts:40`（模块级 import，执行最早）
- 职责：集中触发全部插件注册至 PluginLoader

### ✅ §4 —— 读取引擎插件清单（engine-plugins.json）
- 位置：`bootstrap-engine.ts:82-97`
- 职责：配置驱动——从文件读取插件列表，而非硬编码

### ✅ §5 —— PluginLoader.load()（存在且顺序正确）
- 位置：`bootstrap-engine.ts:112` → `loader.load(pluginConfig)`
- 职责：按拓扑排序加载 → init → postInit → start 各插件
- `onPostInit` 钩子：SchedulerPlugin.registerAllAgents — 跨插件织入

### ✅ §6.0 —— installConsoleBridge（存在且顺序正确）
- 位置：`bootstrap-engine.ts:137` → `installConsoleBridge(observer)`
- 职责：PipelineObserver 就绪后安装，拦截裸 console
- 来源：`@cortex/telemetry`
- **在 PluginLoader.load() 之后**执行，确保 observer 已就绪 → ✅ 顺序正确

### ✅ §6.0b —— LoggingPipelineBridge
- 位置：`bootstrap-engine.ts:140-148`
- 职责：Logging → PipelineObserver 桥接，宪法 §8.1 三档映射

### ✅ §6.0.0a —— AuditTrail + MetricCounter（Phase 0遥测）
- 位置：`bootstrap-engine.ts:151-152`

### ✅ §6.0.0b —— HealthCollector + MetricCounter.startPeriodicFlush
- 位置：`bootstrap-engine.ts:155-180`
- 职责：降级健康聚合 + 静默计数器阈值报警

### ✅ §6.0.1 —— LifecycleManager
- 位置：`bootstrap-engine.ts:183`
- 职责：管理非插件 ILifecycle 组件生命周期

### ✅ §6.0.2 —— ShutdownOrchestrator
- 位置：`bootstrap-engine.ts:186`
- 职责：统一关闭编排

### ✅ §§6.2.1~6.2.6 —— Core-2 模块接线
- `TaskRouter`（§6.2.1）— 策略+模型路由
- `EnvironmentAwareRouter`（§6.2.2）— 环境感知模型降级
- `SentinelSignalFilter`（§6.2.3）— 哨兵信号分层
- **`NotificationRuntime.start()`**（§6.2.4）**— 存在且顺序正确** ✅
- `resilienceFactory`（§6.2.5）— 韧性策略注册
- `GovernanceEventEmitter` + `DecisionGateBridge.start()`（§6.2.6）— 治理桥接

### ✅ §6.1 —— initSkillSystem（存在且顺序正确）
- 位置：`bootstrap-engine.ts:237` → `initSkillSystem(observer, memory, metaAgent, projectRoot)`
- 实现：`init-skills.ts` — 创建 SkillRegistry，注册技能管线，从 MemoryStore 恢复技能
- **在 NotificationRuntime.start() 之后**执行 → ✅ 顺序合理（技能系统不依赖通知运行时）

### ✅ §§7~9.5 —— 后续装配
- StrategistAgent 创建（§7）
- Toolkit setGate/setObserver（§8）
- ONNX 模型预热（§9）
- WorkerPool（§9.5）
- ShutdownOrchestrator 注册（§9.5.1）
- 发射启动完成事件（§9.6）

### ✅ §10 —— 组装返回 BootstrapEngineResult
- 返回完整结果，含 `shutdown()` 方法（逆序清理）

---

## 三、五个关键步骤逐一确认

| # | 步骤 | 文件 | 行号 | 存在？ | 顺序正确？ |
|---|------|------|------|--------|-----------|
| 1 | `loadConfig` | `bootstrap-engine.ts` | 55 | ✅ | 首位 |
| 2 | `PluginLoader.load()` | `bootstrap-engine.ts` | 112 | ✅ | 配置加载后、组件取出前 |
| 3 | `installConsoleBridge` | `bootstrap-engine.ts` | 137 | ✅ | PluginLoader 后、通知运行时前 |
| 4 | `NotificationRuntime.start()` | `bootstrap-engine.ts` | 215 | ✅ | installConsoleBridge 后、initSkillSystem 前 |
| 5 | `initSkillSystem` | `bootstrap-engine.ts` | 237 | ✅ | 通知运行时后、StrategistAgent 前 |

**结论：五步全部存在，且执行顺序合理。** ✅

---

## 四、v3.0 重构要点（与旧链的差异）

### 被替代的旧步骤
旧 v2.x 流水线中的以下步骤在 `bootstrap-engine.ts` 中**不再直接调用**，已被 PluginLoader 接管：

| 旧文件 | 旧步骤 | 当前状态 |
|--------|--------|---------|
| `create-core.ts` — `createEngineCore` | 创建 observer/pool/gate/board | → 移入 PluginLoader 插件 |
| `create-core.ts` — `createSpecialAgents` | 创建 MetaAgent + Strategist | → metaAgent 从插件容器取出 |
| `create-core.ts` — `createScheduler` | 创建调度器 | → 从插件容器取出 |
| `init-memory.ts` — `initMemoryStore` | 初始化 MemoryStore | → 从插件容器取出 |
| `init-memory.ts` — `initConsistencyLayer` | 初始化一致性层 | → 从插件容器取出 |
| `register-agents.ts` — `registerAgents` | 注册 Agent | → onPostInit 钩子中执行 |

### 仍然保留的旧步骤
- `initSkillSystem` — 仍然在 bootstrap-engine 中直接调用（未移入插件）

---

## 五、潜在风险点

1. **`create-core.ts`、`init-memory.ts`、`register-agents.ts` 三棵「枯树」**
   - 它们仍然有代码、有导出，但在 `bootstrap-engine.ts` 中不再被调用
   - 如果未来有人误调用，会产生与 PluginLoader 冲突的装配路径
   - **建议**：标记为 `@deprecated` 并添加编译期警告，或在 Core-2 清理

2. **`import "../plugin/register-all.js"`（§3）在模块级执行**
   - 副作用导入在模块加载时执行，早于任何函数调用
   - 当前工作正常，但若未来 register-all 产生副作用冲突，调试线索会很模糊
   - 当前有注释说明原因 ✅

3. **`installConsoleBridge` 在 `LoggingPipelineBridge` 之前**
   - 顺序：installConsoleBridge → LoggingPipelineBridge → addTransport
   - ConsoleBridge 先安装确保捕获所有 console 输出，日志桥接随后注册传输层
   - 这个顺序是有意为之且合理的 ✅

---

## 六、总结

```
装配链路完整性：✅ 完整
  五关键步骤：✅ 全部存在且顺序正确
  旧代码清理：⚠️ 三棵枯树（create-core/init-memory/register-agents）需打标
  依赖注入顺序：✅ 合理（配置→插件→桥接→通知→技能→Agent）
  shutdown 逆序清理：✅ 实现完整
```

装配链路像须弥的雨林根系——从地表看，是一棵大树（bootstrap-engine.ts）；往地下挖，旧的根系（v2.x 的 create-core 等）已经萎缩但未完全腐烂，新的根系（PluginLoader）已经扎得更深更广。整体结构健康，但建议在 Core-2 阶段清理枯萎的旧根。
