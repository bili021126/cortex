# 🔍 母项目探索报告 — cortex monorepo

> **生成时间**: 2026-06-01  
> **目标**: 为 `@cortex/plugin-runner` 建包提供全景上下文  
> **范围**: monorepo 配置、包依赖拓扑、barrel 导出、插件体系、关键接口

---

## 1. Monorepo 全景

### 1.1 根配置

| 属性 | 值 |
|------|-----|
| **根包名** | `cortex`（private） |
| **包管理器** | pnpm@9.15.4 |
| **工作区声明** | `pnpm-workspace.yaml` → `packages/*` + `projects/*` |
| **模块系统** | ESM (`"type": "module"`) |
| **TypeScript** | `tsconfig.base.json` → `target: ES2022`, `module: Node16`, `moduleResolution: Node16` |
| **tsconfig.json** | 入口空文件，通过 `references` 引用所有子包 + scripts |
| **引擎要求** | Node >=20.0.0 <25.0.0 |

### 1.2 包清单（18 个包）

| 包名 | 目录 | 职责 | 零依赖? |
|------|------|------|---------|
| `@cortex/config` | `packages/config` | **配置中枢** — 类型/常量/默认值/可插拔加载器 | ✅ 零运行时依赖 |
| `@cortex/shared` | `packages/shared` | **类型中枢** — Agent/Task/Memory/LLM 协议/可观测性 | 依赖 config |
| `@cortex/notification` | `packages/notification` | **通知路由** — 四通道物理分层/委员会通知 | 依赖 shared |
| `@cortex/factory` | `packages/factory` | **唯一配置读取入口** — bootstrap() 装配 JSON→运行时配置 | 依赖 config+shared+notification |
| `@cortex/llm` | `packages/llm` | **LLM 适配层** — 独立性，仅依赖 shared 类型 | 依赖 shared |
| `@cortex/data` | `packages/data` | **数据层** — Task 实体/存储/格式化 | 零 cortex 依赖 |
| `@cortex/parser` | `packages/parser` | **Markdown→HTML 转换** | 零依赖 |
| `@cortex/pm` | `packages/pm` | **密码管理器** — AES-256-GCM 加密 | 零 cortex 依赖 |
| `@cortex/tools` | `packages/tools` | **Monorepo 分析 + 配置漂移探测** (CLI+API) | 零 cortex 依赖 |
| `@cortex/telemetry` | `packages/telemetry` | **遥测采集** — Collector/Sampler/Batcher 可插拔 | 零 cortex 依赖 |
| `@cortex/testing` | `packages/testing` | **测试工具** — 合成 TaskNode/Memory 数据生成 | 依赖 shared |
| `@cortex/engine` | `packages/engine` | **🧠 引擎核心** — Scheduler/AgentPool/Memory/插件体系 | 依赖 config+factory+llm+shared+telemetry |
| `@cortex/cli` | `packages/cli` | **CLI 前端** — 命令统一入口，桥接引擎 | 依赖多包 |
| `@cortex/doctor` | `packages/doctor` | **健康诊断** — Monorepo 健康检查管线 | 依赖 shared+tools |
| `@cortex/skill-validator` | `packages/skill-validator` | **技能 JSON 校验**（薄包装，核心在 engine） | 依赖 engine+shared |
| `@cortex/skill-kit` | `packages/skill-kit` | **技能开发工具包**（薄包装，核心在 engine） | 依赖 engine |
| `@cortex/policy-validator` | `packages/policy-validator` | **策略校验引擎** — 规则注册/加载/执行 | 依赖 config+shared |
| `@cortex/prompt-kit` | `packages/prompt-kit` | **提示词工程工具包** — 加载/组装/渲染/校验/缓存/版本 | 依赖 config+shared |

---

## 2. 包依赖拓扑（DAG）

```
@cortex/config  (根基——零依赖)
    │
    ▼
@cortex/shared  (类型中枢——依赖 config)
    │
    ├──▶ @cortex/notification  (依赖 shared)
    ├──▶ @cortex/llm           (依赖 shared)
    ├──▶ @cortex/factory       (依赖 config + shared + notification)
    ├──▶ @cortex/testing       (依赖 shared)
    ├──▶ @cortex/policy-validator (依赖 config + shared)
    ├──▶ @cortex/prompt-kit    (依赖 config + shared)
    │
    ├──▶ @cortex/engine        (依赖 config + factory + llm + shared + telemetry)
    │       │
    │       ├──▶ @cortex/skill-validator (依赖 engine + shared)
    │       ├──▶ @cortex/skill-kit       (依赖 engine)
    │       └──▶ @cortex/cli             (依赖 engine + 多包)
    │
    └──▶ @cortex/doctor        (依赖 shared + tools)

独立包（零 cortex 依赖）:
  @cortex/data
  @cortex/parser
  @cortex/pm
  @cortex/tools
  @cortex/telemetry
```

### 核心依赖链（plugin-runner 关注）

```
@cortex/config ──→ @cortex/shared ──→ @cortex/engine ──→ @cortex/skill-validator
                   (类型/枚举)         (插件体系)          @cortex/skill-kit
                                     (调度器/记忆)
                                     (PluginLoader)
```

---

## 3. Barrel 导出深度分析

### 3.1 `@cortex/config` 桶结构

**入口**: `packages/config/src/index.ts`

分层导出：
```
interfaces/        → 14 组配置接口（EngineConfig/AgentDefinition/EventRoutingConfig 等）
constants/         → ~60 个常量（版本/超时/文件路径/环境变量/Agent 标签/RLM 参数 等）
defaults           → DEFAULT_ENGINE_CONFIG + resolveConfig()
loader             → CONFIG_DOMAINS + loadConfigDomain() + loadAllConfig() + CortexConfig 类型
```

**关键类型**（plugin-runner 需了解）：
- `EngineConfig` — 引擎运行时配置（循环上限/超时/搜索/LLM/文件路径）
- `EnginePluginLoadConfig` — 插件加载配置（声明于引擎包，非 config 导出）
- `CortexConfig` — 全量域索引配置

### 3.2 `@cortex/shared` 桶结构

**入口**: `packages/shared/src/index.ts`

导出分组：
| 模块 | 内容 |
|------|------|
| `agent.ts` | AgentType 枚举 / Tag 类型 / AgentConfig / MemoryAware / Executable / Agent 接口 |
| `agent-display.ts` | Agent 展示中文名映射 |
| `task.ts` | TaskNode / NodeResult / ExecutionReport / DecomposeResult / SubTask / ReplanResult |
| `memory.ts` | MemoryEntry / MemoryQuery / MemoryWriteInput / IMemoryStore 接口 |
| `infra.ts` | **PipelineEventType 枚举**（~35 事件）/ IPipelineObserver / ICortexApi / LlmMessage / SafeErrorReporter |
| `toolkit.ts` | 工具执行上下文/确认门接口 |
| `fs-adapter.ts` | IFileSystemAdapter 接口 |
| `context-policy.ts` | 上下文管理策略类型 |
| `kv-store.ts` | KV 存储接口 |
| `modification-record.ts` / `doc-registry.ts` / `amendment.ts` | 治理相关类型 |

**plugin-runner 最需关注**：
- `IPipelineObserver` — 事件总线接口（插件间通信通道）
- `PipelineEventType` — 事件类型枚举（35+ 事件）
- `ICortexApi` — CLI↔Engine 公共通信契约
- `IMemoryStore` — 记忆存储接口
- `Agent` / `AgentConfig` — Agent 接口契约

### 3.3 `@cortex/engine` 桶结构

**入口**: `packages/engine/src/index.ts`

导出分组（超 100 项）：
| 域 | 关键导出 |
|----|---------|
| **组件** | `createAgent` / `runReActLoop` / `SkillTemplateEngine` / 技能提取/校验/持久化 |
| **Agent 注册** | 9 个 Agent 工厂函数 + 配置/记忆查询 |
| **记忆子系统** | `MemoryStore` / `executeWithMemoryPipeline` / `embedText` / `ContextBuilder` |
| **Bootstrap** | `bootstrapEngine(options)` — **插件装配入口** / `resolveLlm` |
| **引擎核心** | `Scheduler` / `TaskBoard` / `AgentPool` / `ConfirmGate` / `PipelineRunner` / `ReplanManager` |
| **调度组合** | `CompositeScheduler` / 3 策略 / 3 驱动 / 2 执行模型 |
| **一致性** | `ConsistencyLayer` / `IntentFactWall` / `SchemaEnforcer` / `InitVerifier` |
| **搜索** | `SearchAggregator` / `McpSearchBackend` / `DdgSearchBackend` / `McpClient` |
| **遥测** | `getTelemetry` / `recordTelemetry` |
| **治理** | 修宪管线：evaluateAmendment → applyAmendment / 治理循环 |
| **插件体系** 🎯 | `PluginLoader` / `EnginePluginLoadConfig` / `registerAgentFactory` / 插件类型 |
| **内建插件** | PipelineObserver / TaskBoard / AgentPool / ConfirmGate / MemoryStore / ConsistencyLayer / MetaAgent / Governance / Scheduler / TrustModel |

### 3.4 其他关键包的桶

| 包 | 核心导出 |
|----|---------|
| `@cortex/factory` | `bootstrap()` — 唯一配置装配入口 |
| `@cortex/llm` | `LlmAdapter` — LLM 适配器类 |
| `@cortex/notification` | `NotificationPipe`, `RouteTable`, 四通道 (Urgent/Important/Routine/Info) |
| `@cortex/tools` | `analyzeMonorepo`, `detectCycles`, `detectDrift` |
| `@cortex/telemetry` | `CollectorRegistry`, `ConsoleCollector`, `FileCollector`, `RateSampler`, `SizeBatcher` |
| `@cortex/testing` | `syntheticTaskNode()`, `generateSyntheticMemories()` |
| `@cortex/doctor` | `HealthChecker`, `doctor()` — 一键诊断工厂 |
| `@cortex/policy-validator` | `RuleEngine`, `RuleRegistry`, `RuleLoader` |
| `@cortex/prompt-kit` | `PromptOrchestrator`, `PromptLoader`, `PromptTemplateEngine` |

---

## 4. 引擎插件体系（plugin-runner 的母体）

### 4.1 插件生命周期

```
PluginLoader.register(name, ctor)   ← 插件自注册（副作用导入）
         │
    EnginePluginLoadConfig {
      plugins: string[],           ← 从 engine-plugins.json 读取
      engineConfig?: EngineConfig,
      workspaceRoot: string,
      externals: PluginExternals
    }
         │
         ▼
    PluginLoader.load(config)
         │
         ├── 1. _instantiate()      —— 实例化全部插件
         ├── 2. _topologicalSort()   —— Kahn 算法（按 dependencies 排序）
         ├── 3. _createContext()     —— 创建 PluginContext（栈分配）
         ├── 4. **init(ctx)** ✨     —— 依次调用每个插件的 init()
         ├── 5. _postInit()         —— 跨插件织入（Scheduler.registerAllAgents）
         └── 6. **start()** ✨      —— 依次调用每个插件的 start()
                  │
                  ▼
          返回 PluginContainer {
            get<T>(name): T,
            has(name): boolean,
            shutdown: () => Promise<void>  ← 逆序 stop()
          }
```

### 4.2 插件接口

```typescript
interface EnginePlugin {
  readonly name: string;
  readonly dependencies: string[];
  init(ctx: PluginContext): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): PluginHealth;  // "healthy" | "degraded" | "dead"
}
```

### 4.3 插件上下文（PluginContext）

```typescript
interface PluginContext {
  get<T>(name: string): T;              // 获取已初始化的依赖插件
  observer: IPipelineObserver;          // 事件总线（插件间通信通道）
  config: Required<EngineConfig>;       // 合并后全局配置
  workspaceRoot: string;                // 工作区根目录
  externals: PluginExternals;           // 外部注入的依赖
}

interface PluginExternals {
  llms: Map<string, LlmAdapter>;         // LLM 适配器映射
  toolkit: Toolkit;                       // 工具包
  codingStandards: string;                // 编码规范文本
  factoryConfig: BootstrapResult;         // 工厂配置
  dbPath?: string;                        // SQLite 路径
  fs?: IFileSystemAdapter;               // 文件系统适配器
}
```

### 4.4 内建插件清单（engine-plugins.json 默认配置）

| 插件名 | 角色 | 依赖 |
|--------|------|------|
| `pipelineObserver` | 可观测事件管道 | — |
| `taskBoard` | DAG 状态管理 | pipelineObserver |
| `agentPool` | Agent 实例池 | pipelineObserver, taskBoard |
| `confirmGate` | 确认门 | pipelineObserver |
| `trustModel` | 信任模型 | confirmGate |
| `memoryStore` | SQLite 记忆存储 | pipelineObserver |
| `metaAgent` | MetaAgent 实例 | pipelineObserver, memoryStore, taskBoard |
| `consistencyLayer` | 六层一致性防御 | pipelineObserver |
| `governance` | 修宪治理循环 | pipelineObserver, memoryStore |
| `scheduler` | 调度器（含 Agent 注册） | 全部以上 |

### 4.5 插件注册机制

- 每个插件 `.plugin.ts` 文件末尾调用 `PluginLoader.register(name, ctor)` 自注册
- `packages/engine/src/plugin/register-all.ts` 通过副作用 `import` 触发所有注册
- `bootstrapEngine()` 通过 `import "../plugin/register-all.js"` 加载
- 新插件只需创建 `xx.plugin.ts` → 在 `register-all.ts` 加一行 import

---

## 5. 配置系统架构

### 5.1 双层配置

**层 1：可插拔 JSON 加载**（`@cortex/config/loader.ts`）
- 13 个注册域（agents / engine / tools / eventRouting / roundtable / searchProviders / mcpServers / selfExamination / crossVerification / seedMemories / governancePipeline / cognition / docs）
- 必需域：agents, eventRouting —— 缺失报错
- 可选域：其余 11 个 —— 缺失静默跳过

**层 2：TypeScript 编译时默认值**（`@cortex/config/defaults.ts`）
- `DEFAULT_ENGINE_CONFIG` — 全字段默认值
- `resolveConfig(partial?)` — 部分合并 → 全量配置

### 5.2 配置域文件

配置 JSON 文件位于 `packages/config/data/` 目录，构建时被复制到 `dist/data/`：
```
cortex-agents.json        → Agent 定义
engine.json               → 引擎运行时参数
event-routing.json        → 事件路由（必需）
tools.json                → 工具元数据
roundtable.json           → 圆桌会议模板
search-providers.json     → 搜索后端（旧格式）
mcp-servers.json          → MCP Server（新标准格式）
engine-plugins.json       → 🔌 插件加载清单 ← plugin-runner 需关注
...（其他）
```

---

## 6. 关键接口契约（plugin-runner 需实现/对接）

### 6.1 必须实现的接口

作为 `EnginePlugin`，`@cortex/plugin-runner` 必须：
1. **实现 `EnginePlugin` 接口** — name / dependencies / init / start / stop / health
2. **自注册** — 文件末尾调用 `PluginLoader.register("pluginRunner", PluginRunner)`
3. **在 `register-all.ts` 注册** — 添加 `import "./plugin-runner.plugin.js"`

### 6.2 可能依赖的内建插件

- `pipelineObserver` — 发送/监听事件
- `memoryStore` — 读写记忆
- `taskBoard` — 观察任务状态
- `scheduler` — 获取已注册 Agent

### 6.3 可用的共享类型

- 从 `@cortex/config`：`EngineConfig`, `EnginePluginLoadConfig` 等配置类型
- 从 `@cortex/shared`：`TaskNode`, `IPipelineObserver`, `IMemoryStore`, `PipelineEventType` 等
- 从 `@cortex/llm`：`LlmAdapter`（如需调用 LLM）

---

## 7. 编译/测试状态快照

| 检查项 | 结果 |
|--------|------|
| `tsc --noEmit` | ✅ 编译通过 |
| `tsx` 测试 | ❌ 失败 (`ERR_MODULE_NOT_FOUND`: 找不到 `test/calculator.test.ts`) |

> **注意**：tsx 测试失败的原因是测试入口路径问题，非项目编译错误。tsc 编译完全通过。

---

## 8. 代码约定（宪法要点）

- **模块化铁律（§四 Barrel 铁律）**：所有公开符号必须通过 barrel 导出，测试文件禁止相对导入
- **类型中枢**：跨包类型定义集中在 `@cortex/shared`，零业务逻辑
- **配置真相源**：配置类型/常量/默认值集中在 `@cortex/config`，零运行时依赖
- **插件封装**：引擎子系统已全部插件化，新增功能优先以插件形式实现
- **依赖方向**：低层包不能依赖高层包（config ← shared ← engine ← cli）

---

## 9. 对 `@cortex/plugin-runner` 的建包建议

### 9.1 package.json 骨架

```json
{
  "name": "@cortex/plugin-runner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "dependencies": {
    "@cortex/config": "workspace:*",
    "@cortex/shared": "workspace:*",
    "@cortex/engine": "workspace:*",
    "@cortex/llm": "workspace:*"
  }
}
```

### 9.2 目录结构建议

```
packages/plugin-runner/
├── .plan/
│   └── exploration.md          ← 本文件
├── src/
│   ├── index.ts                ← barrel 导出
│   ├── plugin-runner.plugin.ts ← EnginePlugin 实现 + 自注册
│   ├── runner.ts               ← 插件运行核心逻辑
│   └── types.ts                ← 插件运行器专用类型
├── tests/
│   └── plugin-runner.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 9.3 需对接的现有机制

1. **plugin-register**：在 `packages/engine/src/plugin/register-all.ts` 添加 `import`
2. **engine-plugins.json**：在配置清单中加入 `"pluginRunner"`
3. **依赖拓扑**：声明 `dependencies: ["scheduler", "memoryStore"]` 等依赖关系
4. **Event 通信**：通过 `ctx.observer.emit()` 发布事件，`ctx.observer.on()` 监听

---

*报告结束。下一步：实现 `@cortex/plugin-runner` 的 `EnginePlugin` 接口和核心运行逻辑。*
