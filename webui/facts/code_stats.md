# 代码结构侦察报告

> 侦察范围: `packages/` 目录
> 侦察时间: 任务执行时刻
> 侦察员: 安柏 (InspectorAgent)

---

## 1. 总览

| 指标 | 数值 |
|---|---|
| 子包数量 | 10 |
| 源代码文件 (src/) | 约 143 个 |
| 测试文件 (tests/) | 约 48 个 |
| 代码文件总计 | 约 191 个 |
| 配置/构建文件 | 约 30 个 (package.json/tsconfig/vitest) |

---

## 2. 包依赖拓扑

```
Layer 0 (无内部依赖):
  @cortex/shared    ← 类型中枢，零 workspace 依赖
  @cortex/parser    ← Markdown→HTML 转换器
  @cortex/data      ← 任务实体 + 存储 (仅依赖 cli-table3)
  @cortex/pm        ← 包管理 (仅依赖 commander)
  @cortex/tools     ← monorepo 分析 + 漂移检测

Layer 1 (仅依赖 shared):
  @cortex/llm       ← shared
  @cortex/testing   ← shared
  @cortex/notification ← shared

Layer 2 (依赖 shared + Layer 1):
  @cortex/factory   ← shared, notification
  @cortex/engine    ← factory, llm, shared

Layer 3 (依赖 engine):
  @cortex/cli       ← engine, llm, parser, shared
```

### 依赖关系矩阵 (workspace 依赖)

| 包 | 依赖 workspace 包 |
|---|---|
| @cortex/cli | @cortex/engine, @cortex/llm, @cortex/parser, @cortex/shared |
| @cortex/data | (无) |
| @cortex/engine | @cortex/factory, @cortex/llm, @cortex/shared |
| @cortex/factory | @cortex/shared, @cortex/notification |
| @cortex/llm | @cortex/shared |
| @cortex/notification | @cortex/shared |
| @cortex/parser | (无) |
| @cortex/pm | (无) |
| @cortex/shared | (无) |
| @cortex/testing | @cortex/shared |
| @cortex/tools | (无) |

---

## 3. 子包详情报

### 3.1 @cortex/cli (v0.2.0)

**路径**: `packages/cli/src/`
**文件数**: 27

| 分组 | 文件 |
|---|---|
| 根级 | cli.ts, constants.ts, index.ts, main.ts, platform.ts, types.ts |
| commands/ | agent.ts, config.ts, confirm.ts, doc.ts, help.ts, index.ts, inspect.ts, memory.ts, repl.ts, roundtable.ts, run.ts, schedule.ts, setup.ts, task.ts, version.ts |
| formatters/ | color-formatter.ts, index.ts, json-formatter.ts, text-formatter.ts |
| services/ | config-manager.ts, engine-bridge.ts |

**说明**: CLI 命令注册 + 执行入口。commands 目录下 15 个命令处理器，覆盖 run/agent/task/memory/doc/schedule/roundtable/inspect/confirm/repl 等全部 CLI 操作。

---

### 3.2 @cortex/data (v0.1.0)

**路径**: `packages/data/src/`
**文件数**: 14

| 分组 | 文件 |
|---|---|
| config/ | index.ts |
| core/models/ | priority.ts, status.ts, task.ts |
| core/services/ | task.service.ts |
| formatters/ | json.formatter.ts, plain.formatter.ts, table.formatter.ts |
| storage/adapters/ | json-file.adapter.ts |
| storage/ | errors.ts |
| storage/interfaces/ | task.repository.ts |
| utils/ | date.ts, id.ts |
| 根级 | index.ts |

**说明**: 任务实体 (Task) 领域模型 + JSON 文件存储 + 格式化输出。源自 solo-flight 项目迁移。

---

### 3.3 @cortex/engine (v0.1.0)

**路径**: `packages/engine/src/`
**文件数**: ~60

| 分组 | 文件 |
|---|---|
| 根级 | index.ts, base-agent.ts, engine-config.ts, test-env.ts |
| agents/ (14) | analysis-agent.ts, api-agent.ts, browser-agent.ts, butler-agent.ts, code-agent.ts, data-agent.ts, doc-govern-agent.ts, fix-agent.ts, index.ts, inspector-agent.ts, loop-agent.ts, ops-agent.ts, review-agent.ts, strategist-agent.ts |
| bootstrap/ | bootstrap-engine.ts |
| components/ (6) | agent-factory.ts, index.ts, pool-aware.ts, react-loop.ts, skill-extractor.ts, skill-persister.ts |
| consistency/ (4) | consistency-layer.ts, init-verifier.ts, intent-fact-wall.ts, schema-enforcer.ts |
| core/ (6) | agent-pool.ts, confirm-gate.ts, meta-agent.ts, pipeline-observer.ts, scheduler.ts, task-board.ts |
| governance/ (4) | amendment-applier.ts, amendment-judge.ts, governance-loop.ts, governance-pipeline.ts |
| memory/ (12) | embedding.ts, index.ts, lifecycle.ts, memory-store.ts, monitor.ts, persistence.ts, pipeline.ts, query.ts, schema.ts, semi-finished.ts, skill-pipeline.ts, storage.ts |
| platform/ (7) | cli-adapter.ts, file-lock-manager.ts, mcp-client.ts, node-fs-adapter.ts, search-aggregator.ts, search-backend.ts, toolkit.ts |
| registry/ (2) | doc-registry.ts, skill-registry.ts |

**说明**: 引擎核心，最大子包。包含 Agent 系统、调度器、记忆系统、治理管线、搜索后端、工具系统。

---

### 3.4 @cortex/factory (v0.1.0)

**路径**: `packages/factory/src/`
**文件数**: 12

| 分组 | 文件 |
|---|---|
| 根级 | index.ts, bootstrap.ts, types.ts |
| assemblers/ | agent.assembler.ts, committee.assembler.ts, event-router.assembler.ts, index.ts, telescope.assembler.ts |
| loaders/ | agents.loader.ts, cognition.loader.ts, docs.loader.ts |
| schemas/ | cross-field.validator.ts |

**说明**: 唯一配置读取入口。加载 cortex-agents.json / cortex-cognition.json / cortex-docs.json，校验后组装。

---

### 3.5 @cortex/llm (v0.1.0)

**路径**: `packages/llm/src/`
**文件数**: 2

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 |
| llm-adapter.ts | DeepSeek API 适配器，含 LRU 缓存、重试、流式支持 |

---

### 3.6 @cortex/notification (v0.1.0)

**路径**: `packages/notification/src/`
**文件数**: 6

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 |
| types.ts | 事件/通知类型 |
| channels.ts | 通知通道 |
| notification-pipe.ts | 通知管线 |
| persistence.ts | 持久化 |
| route-table.ts | 路由表 |

---

### 3.7 @cortex/parser (v0.1.0)

**路径**: `packages/parser/src/`
**文件数**: 2

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 (convert, convertToDocument) |
| parser.ts | Markdown→HTML 转换器，支持标题/列表/代码块/引用/链接/图片/强调 |

---

### 3.8 @cortex/pm (v0.1.0)

**路径**: `packages/pm/src/`
**文件数**: 3

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 |
| crypto.ts | 加密工具 |
| store.ts | 包管理存储 |

---

### 3.9 @cortex/shared (v0.1.0)

**路径**: `packages/shared/src/`
**文件数**: 13

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 (11 个 export *) |
| agent.ts | AgentType 枚举、标签词汇表、状态机、工具权限、技能模板 |
| task.ts | TaskNode, PipelineEventType |
| memory.ts | MemoryEntry, MemoryState, MemoryQuery |
| toolkit.ts | 工具接口类型 |
| infra.ts | 基础设施类型 |
| cli-adapter.ts | CLI 适配器接口 |
| file-lock-manager.ts | 文件锁类型 |
| fs-adapter.ts | 文件系统适配器接口 |
| skill-registry.ts | 技能注册类型 |
| modification-record.ts | 修改记录类型 |
| doc-registry.ts | 文档注册类型 |
| amendment.ts | 修宪类型 |

---

### 3.10 @cortex/testing (v0.1.0)

**路径**: `packages/testing/src/`
**文件数**: 1

| 文件 | 说明 |
|---|---|
| index.ts | 合成数据生成器 (TaskNode, MemoryEntry) |

---

### 3.11 @cortex/tools (v0.1.0)

**路径**: `packages/tools/src/`
**文件数**: 3

| 文件 | 说明 |
|---|---|
| index.ts | 桶导出 (类型导出) |
| monorepo-analyzer.ts | 依赖图 + 循环依赖 + 版本漂移检测 |
| configuration-drift.ts | 跨包依赖版本一致性扫描 |

---

## 4. 测试文件分布

| 包 | 测试文件数 | 测试文件列表 (部分) |
|---|---|---|
| cli | 3 | cli.test.ts, cli-engine-integration.test.ts, e2e/ |
| data | 1 | data.test.ts |
| engine | 36 | agent-factory.test.ts, agent-pool.test.ts, scheduler.test.ts, memory-store.test.ts, governance-loop.test.ts, 等 |
| factory | 1 | smoke.test.ts |
| llm | 1 | llm-adapter.test.ts |
| notification | 1 | smoke.test.ts |
| parser | 1 | parser.test.ts |
| pm | 1 | pm.test.ts |
| shared | 1 | types.test.ts (__tests__/) |
| testing | 1 | synthetic.test.ts |
| tools | 1 | tools.test.ts |
| **总计** | **~48** | |

---

## 5. 外部依赖 (非 workspace)

| 依赖名 | 被引包 | 用途 |
|---|---|---|
| cli-table3 | @cortex/data | 表格渲染 |
| @xenova/transformers | @cortex/engine | ML 嵌入 |
| better-sqlite3 | @cortex/engine | SQLite 存储 |
| playwright | @cortex/engine (devDep) | 浏览器 Agent |
| tree-sitter | @cortex/engine (devDep) | 代码解析 |
| tree-sitter-typescript | @cortex/engine (devDep) | TypeScript 解析 |
| commander | @cortex/pm | CLI 参数解析 |

---

## 6. 侦察结论

1. **结构清晰**: 10 个子包按依赖层次分层 (Layer 0-3)，无循环依赖。
2. **类型中枢**: `@cortex/shared` 是唯一零内部依赖包，所有其他包均依赖它。
3. **引擎最大**: `@cortex/engine` 占源代码文件数约 42%，是项目核心。
4. **测试覆盖**: engine 包测试最充分 (36 个测试文件)，其他包测试较少。
5. **配置驱动**: factory 包负责从 JSON 配置文件加载并校验所有 Agent 定义。
6. **外部依赖少**: 仅 7 个非 workspace 外部依赖，且集中在 engine 和 data 包。
