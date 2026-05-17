# 🗺️ Cortex 项目统计报告

> **侦察骑士·安柏 实地勘察报告**
> 侦察范围：`docs/` 宪法文件结构 + `packages/` 全量代码库
> 侦察时间：实时扫描

---

## 一、宪法文件结构（docs/）

### 目录全景

| 路径 | 类型 | 文件数 | 说明 |
|------|------|--------|------|
| `docs/constitution/` | 宪法主体 | 1 | `Cortex 概念顶层设计 v2.5.md` (37,368 字符, ~900 行) |
| `docs/amendments/` | 修宪提案 | 8 | AM-2025/2026 系列修宪记录 JSON/MD |
| `docs/core/` | 核心设计 | 4 | 治理层设计、Agent标签词汇表、意图响应体系、技能沉淀机制 |
| `docs/analysis/` | 分析文档 | 1 | 宪法缺口影响分析 |
| `docs/auditing/` | 审计报告 | 1 | 2026-06-06 宪法审计 |
| `docs/inspection/` | 审查结构 | 1 | 宪法结构审查 |
| `docs/reviews/` | 审查记录 | 1 | 宪法审计审查 |
| `docs/archive/` | 归档 | 若干 | 历史版本存档 |
| `docs/assets/` | 资产 | — | 资源文件 |
| `docs/consistency-design.md` | 设计文档 | 1 | 一致性层设计（含多组 export class） |

### 宪法核心内容

- **七条不可变原则**：确认权在用户、规划执行分离、安全边界在 Toolkit、谁调用谁负责、统一可观测管道、用户最终裁决、系统自我修改受宪法约束
- **系统架构**：Engine 容器 → LLM 适配层 → 基础设施 → 管家 → 治理层
- **物理包结构**：9 个包（v2.5.9），严格依赖倒置单向无循环
- **MetaAgent 战术中枢** + **11 种 Agent** 执行单元

---

## 二、packages/ 代码库统计

### 总体概览

| 包名 | 版本 | 源文件数 | 估算行数 | 关键类 | 导出函数 |
|------|------|----------|----------|--------|----------|
| `@cortex/shared` | 0.1.0 | 13 | ~3,500 | 1 类 | 0 (纯类型) |
| `@cortex/engine` | 0.1.0 | 50+ | ~18,000+ | 23+ 类 | 5+ 函数 |
| `@cortex/cli` | 0.2.0 | 23 | ~3,000 | 4 类 | 20+ 函数 |
| `@cortex/llm` | 0.1.0 | 2 | ~1,000 | 1 类 | 0 (均为方法) |
| `@cortex/parser` | 0.1.0 | 2 | ~500 | 0 类 | 2 函数 |
| `@cortex/pm` | 0.1.0 | 3 | ~200 | 0 类 | 5 函数 |
| `@cortex/data` | 0.1.0 | 15 | ~2,000 | 0 类 | 若干 |
| `@cortex/testing` | 0.1.0 | 1 | ~100 | 0 类 | 4 函数 |
| `@cortex/tools` | 0.1.0 | 3 | ~1,000 | 若干 | 若干 |
| **合计** | — | **~112** | **~29,300** | **~29+ 类** | **~36+ 函数** |

> 行数为基于源文件内容长度的估算值（含注释和空行）。

---

### 2.1 @cortex/shared — 共享类型中枢

**依赖**：无 workspace 依赖

**源文件清单** (13 文件):

| 文件 | 内容概要 |
|------|---------|
| `agent.ts` | AgentType/AgentStatus 枚举、TAG_VOCABULARY、AGENT_TAGS、AGENT_TOOL_PERMISSIONS、SkillTemplate/MemoryAware/Executable 接口、AgentConstructor 类型 |
| `task.ts` | TaskNode/NodeResult/ReplanResult/ExecutionReport 接口、ImpactScope 类型 |
| `memory.ts` | MemoryType/MemoryState/MemorySubType/LinkType 枚举、MemoryEntry/MemoryWriteInput/MemoryLink/MemoryQuery 接口 |
| `infra.ts` | PipelinePriority/PipelineEventType 枚举、ObservableEvent/EventPayloadMap、SafeErrorReporter、LlmMessage/LlmResponse/Agent/AgentConfig 接口 |
| `toolkit.ts` | ToolCategory/ReversibilityLevel 枚举、ToolDefinition/ToolInvocation/ToolResult/IConfirmGate/TrustScore 接口 |
| `file-lock-manager.ts` | LockType 枚举、IFileLockManager 接口 |
| `cli-adapter.ts` | PlatformKind 枚举、PlatformContext/PlatformBridge 接口 |
| `fs-adapter.ts` | DirectoryEntry/IFileSystemAdapter 接口 |
| `skill-registry.ts` | SerializedSkillRegistry 接口、SkillRegistry 类 |
| `modification-record.ts` | ModificationType/ReversibilityClass 枚举 |
| `doc-registry.ts` + `amendment.ts` | 文档注册与修宪类型 |
| `index.ts` | 桶导出 |

**关键类**：`SkillRegistry`

**枚举**：14 个 (AgentType, AgentStatus, PipelinePriority, PipelineEventType, MemoryType, MemoryState, MemorySubType, LinkType, ToolCategory, ReversibilityLevel, PlatformKind, LockType, ModificationType, ReversibilityClass)

**接口/类型**：30+ (TaskNode, NodeResult, MemoryEntry, ObservableEvent, LlmMessage, Agent 等)

---

### 2.2 @cortex/engine — 执行引擎 ★ 最大包

**依赖**：`@cortex/shared`、`@cortex/llm`

**根级文件** (22 文件): `AgentPool`, `BaseAgent`(abstract), `MetaAgent`, `Scheduler`, `TaskBoard`, `PipelineObserver`, `ConfirmGate`, `Toolkit`, `CLIAdapter`, `FileLockManager`, `NodeFileSystemAdapter`, `PoolAwareState`, `StrategistAgent`, `SkillRegistry`, `DocRegistry`, `config`, `amendment-applier`, `amendment-judge`, `governance-loop`, `test-env`, `index`

**agents/ 子目录** (13 文件 — 13 种 Agent):

| Agent | 代号 | 类型 |
|-------|------|------|
| CodeAgent | 阿贝多 | 执行 |
| ReviewAgent | 行秋 | 执行 |
| AnalysisAgent | 丽莎 | 执行 |
| OpsAgent | 北斗 | 执行 |
| LoopAgent | 荒泷一斗 | 执行 |
| DocGovernAgent | 凝光 | 执行/审计 |
| InspectorAgent | 安柏 | 执行/侦察 |
| BrowserAgent | 菲谢尔 | 执行 |
| ButlerAgent | 托马 | 管家(类) |
| FixAgent | 希格雯 | 执行 |
| ApiAgent | (Core-2) | 预留 |
| DataAgent | (Core-2) | 预留 |

**memory/ 子目录** (12 文件): `MemoryStore`(Facade), `MemoryStorage`, `MemoryPersistence`, `MemoryLifecycle`(五态状态机), `MemoryQueryEngine`(BFS+向量召回), `pipeline`, `schema`, `embedding`, `monitor`, `semi-finished`, `skill-pipeline`, `index`

**components/ 子目录** (5 文件): `createAgent`, `runReActLoop`, `extractSkillsFromOutput`, `skill-persister`, `index`

**consistency/ 子目录** (3 文件): `ConsistencyLayer`, `InitVerifier`, `SchemaEnforcer`

**engine 关键类汇总** (23+):

`AgentPool`, `BaseAgent`, `MetaAgent`, `Scheduler`, `TaskBoard`, `PipelineObserver`, `ConfirmGate`, `Toolkit`, `CLIAdapter`, `FileLockManager`, `NodeFileSystemAdapter`, `PoolAwareState`, `StrategistAgent`, `SkillRegistry`, `DocRegistry`, `MemoryStore`, `MemoryStorage`, `MemoryPersistence`, `MemoryLifecycle`, `MemoryQueryEngine`, `MemoryStoreMonitor`, `SemiFinishedMgr`, `ButlerAgent`, `ConsistencyLayer`, `InitVerifier`, `SchemaEnforcer`

---

### 2.3 @cortex/cli — 命令行工具

**依赖**：`@cortex/engine`, `@cortex/llm`, `@cortex/parser`, `@cortex/shared`

**源文件结构** (23 文件):

| 路径 | 说明 |
|------|------|
| 根级 (5 文件) | `cli.ts`, `main.ts`, `platform.ts`, `types.ts`, `index.ts` |
| commands/ (14 文件) | `agent`, `config`, `confirm`, `doc`, `help`, `inspect`, `memory`, `repl`, `roundtable`, `run`, `schedule`, `task`, `version` |
| formatters/ (4 文件) | `ColorFormatter`, `JsonFormatter`, `TextFormatter`, `index` |
| services/ (2 文件) | `config-manager.ts`, `engine-bridge.ts` |

**关键类**：`CommandRegistry`, `ColorFormatter`, `JsonFormatter`, `TextFormatter`
**关键函数**：14 个 `createXxxHandler` + `getPlatformBridge` + `closePlatformBridge` + `getFormatter` + `detectDefaultFormat`

---

### 2.4 @cortex/llm — LLM 适配层

**依赖**：`@cortex/shared`

**源文件** (2 文件):

| 文件 | 说明 |
|------|------|
| `llm-adapter.ts` | `class LlmAdapter` — API 适配、LRU 缓存、重试、流式、指纹匹配 (~500 行) |
| `index.ts` | 桶导出 |

**关键方法**：`chat`, `chatStream`, `setCacheEnabled`, `setCacheMode`, `injectMock`, `saveCache`, `loadCache`, `clearCache`

---

### 2.5 @cortex/parser — Markdown 解析器

**依赖**：无 workspace 依赖

**源文件** (2 文件): `parser.ts` + `index.ts`
**关键函数**：`convert(markdown)`、`convertToDocument(markdown, title)`
**内部辅助函数**：`parseInline`, `escapeHtml`, `escapeAttr`, `isThematicBreak`, `isHeading`, `isBlockquote`, `isUnorderedListItem`, `isOrderedListItem`, `isFenceStart`, `parseCodeBlock`

---

### 2.6 @cortex/pm — 密码管理器

**依赖**：`commander`

**源文件** (3 文件): `crypto.ts`, `store.ts`, `index.ts`
**关键函数**：`encrypt`(AES-256-GCM)、`decrypt`、`addEntry`、`getEntry`、`listEntries`
**接口**：`PasswordEntry`

---

### 2.7 @cortex/data — 数据处理层

**依赖**：`cli-table3`

**源文件** (15 文件): `index.ts`, `config/index.ts`, `core/models/{task,priority,status}.ts`, `core/services/task.service.ts`, `formatters/{json,plain,table}.formatter.ts`, `storage/adapters/json-file.adapter.ts`, `storage/interfaces/task.repository.ts`, `utils/{date,id}.ts`

---

### 2.8 @cortex/testing — 测试基础设施

**依赖**：`@cortex/shared`

**源文件** (1 文件): `index.ts`
**关键函数**：`syntheticTaskNode`, `syntheticTaskTree`, `generateSyntheticMemories`, `generateMemoriesWithStates`

---

### 2.9 @cortex/tools — Monorepo 分析工具

**依赖**：无 workspace 依赖

**源文件** (3 文件): `monorepo-analyzer.ts` (~700 行), `configuration-drift.ts`, `index.ts`
**关键功能**：依赖图分析、循环依赖 DFS 检测、版本漂移检测

---

## 三、依赖关系图

```
@cortex/shared  (基础类型，无 workspace 依赖)
     ↑
     ├── @cortex/llm      (依赖 shared)
     ├── @cortex/testing  (依赖 shared)
     ├── @cortex/parser   (零 workspace 依赖)
     ├── @cortex/pm       (零 workspace 依赖)
     ├── @cortex/data     (零 workspace 依赖)
     └── @cortex/tools    (零 workspace 依赖)
     
@cortex/llm ← @cortex/engine   (依赖 shared + llm)
@cortex/parser ← @cortex/cli   (依赖 engine + llm + parser + shared)
```

**依赖方向**：`shared → llm → engine → cli`
**无循环依赖** ✅

---

## 四、关键统计摘要

| 指标 | 数值 |
|------|------|
| 总包数 | 9 |
| 源文件总数 | ~112 |
| 总估算行数 | ~29,300 |
| 关键类总数 | ~29+ |
| 导出函数总数 | ~36+ |
| 枚举定义数 | ~17 |
| 接口定义数 | 30+ |
| Agent 种类 | 13 (含 2 个 Core-2 预留) |
| 宪法文档大小 | 37,368 字符 (~900 行) |
| 宪法原则 | 7 条不可变原则 + 7 项子约束 |
| 修宪提案数 | 8 个 |
| 依赖层级 | 4 层 |

---

*报告完毕。侦察区域未发现异常结构或隐蔽依赖。*
*地图已绘制，交给指挥部决策。*
