# Cortex 系统架构分析报告

> 分析范围：27 包 monorepo 全量源码
> 分析日期：2026-06-21
> 关联文档：`docs/core/Cortex-概念顶层设计 v3.0.md`、`docs/analysis/129-code-review-report.md`

---

## 一、架构总览

Cortex 是一个插件化多 Agent 编排运行时，四层结构：

```
┌───────────────────────────────────────────────────────┐
│  应用层  │  cli · tui                                │
├───────────────────────────────────────────────────────┤
│  集成层  │  engine（运行时核心，依赖15包）              │
├───────────────────────────────────────────────────────┤
│  能力层  │  scheduler · memory-store · llm · platform │
│         │  resilience · notification · governance     │
│         │  consistency · prompt-kit · skill-kit       │
├───────────────────────────────────────────────────────┤
│  基础层  │  shared · config · logging · fsm-compiler  │
│         │  parser · cache · pm · telemetry · tools    │
│         │  testing · doctor · pattern-extractor       │
└───────────────────────────────────────────────────────┘
```

## 二、包依赖图谱

| 分类 | 包 | 特征 |
|------|-----|------|
| Foundation | shared, config, logging, fsm-compiler | 零或极少依赖 |
| Hub | engine(15), scheduler, memory-store | 连接多子系统 |
| Leaf | cli, tui | 终端消费者 |
| Standalone | parser, pm, cache, tools, pattern-extractor | 自包含 |

**关键发现**：
- 幽灵依赖：无
- 死依赖（声明但未 import）：17 处（多包仅 `import type` 使用 `@cortex/shared`）
- 循环依赖：无
- 最长依赖链：4 层（cli → engine → memory-store → fsm-compiler）

## 三、核心运行时——七步执行管线

```
用户意图 → Bootstrap(10插件拓扑) → MetaAgent.plan()(LLM分解)
→ Scheduler.executeAll()(拓扑排序层并行)
→ DispatchPipeline(Claim→Spawn→Execute→BoundaryGuard→Cleanup)
→ Agent.execute()(MemoryRetrieval→ReActLoop→MemoryWrite)
→ ExecutionReport → endSession()
```

### 调度四抽象

| 抽象 | 接口 | 实现 |
|:----:|------|------|
| Strategy | IScheduleStrategy | TagMatching / RoundRobin / PriorityFirst |
| Driver | ILoopDriver | TopologicalLayered / Sequential / Wave |
| ExecutionModel | IExecutionModel | Pipeline / SimpleExecute |
| Router | IModelRouter | Fixed / Semantic |

注：ModelRouter 是组合件而非独立可替换维度——DESIGN.md 的"三抽象"分类更准确。

## 四、数据流与通信架构

### 三层事件系统

| 系统 | 位置 | 事件数 |
|------|------|:------:|
| PipelineObserver | scheduler/core/pipeline-observer.ts | 40+ |
| TuiEventBus | cli/tui/event-bus.ts | 11 |
| NotificationPipe | notification/notification-pipe.ts | 4 通道 |

### 分布式状态管理

三个协调点：TaskBoard（会话级 DAG）、MemoryStore（持久化语义记忆）、AgentPool（实例生命周期）

### 核心数据模型

- TaskNode: 18 字段（id, parentId, edgeType, type, tags, status 5 态...）
- MemoryEntry: 四层结构（Identity + Cognitive + Lifecycle + Engineering）
- LlmMessage: system/user/assistant/tool 四角色 + tool_calls + reasoning_content

## 五、架构风险与瓶颈

### 关键风险

| 风险 | 等级 | 状态 |
|------|:----:|------|
| Engine 上帝包（依赖15包） | 🔴 High | 建议 Core-3 拆分 |
| TUI 代码分裂（重复代码） | 🔴 High | **本报告后立即修复** |
| Shared 类型膨胀（17模块无分组） | 🟡 Medium | 按领域分组 |
| 单线程天花板（ONNX/FSM阻塞） | 🟡 Medium | Worker 化 ~50 行 |
| 日志采用鸿沟（12/27包用console.log） | 🟡 Medium | 按日志量排序迁移 |
| Config schema 验证缺失 | 🟡 Medium | 引入运行时验证 |

### 性能瓶颈

| 位置 | 影响 | 修复方向 |
|------|------|---------|
| ReActLoop 工具执行串行 | 多工具线性叠加 | L0 工具并行化 |
| TopologicalLayeredDriver 全量重排 | 大 DAG 排序开销 | 增量拓扑缓存 |
| BoundaryGuard 文件扫描 | 大工作区扫描耗时 | 缓存 + 增量 |
| MemoryWriteStep embedding | 50-200ms/次 | Worker 化 |

## 六、演进建议

### 第一优先级（立即执行）
1. ~~WorkspaceRoot 动态解析~~ ✅ 已修复（C-2 pass）
2. **TUI 代码去重** ⬅ 本报告后立即执行
3. Config schema 验证 — 与 workspaceRoot 同为"就差最后一步"的收尾型缺陷

### 第二优先级（可观测性）
4. 日志迁移：memory-store > scheduler > resilience > platform
5. Logging-Telemetry 桥接
6. Config Schema 验证（可选，bootstrap 阶段 fail-fast）

### 第三优先级（性能）
7. 工具并行执行（L0 读工具 Promise.allSettled）
8. 增量拓扑排序
9. CPU 密集操作 Worker 化

## 七、报告缺漏（补充）

1. **治理层归纲断层**：16 个治理组件被分散到多包，无统一视图
2. **协作谱系缺失**：群策模式 + Committee session 的谱系未出现
3. **pattern-extractor 消费链**：被 skill-kit 内联消费（非 Standalone）

## 八、架构模式总结

Cortex 的六种贯穿模式：

| 模式 | 描述 | 实例 |
|------|------|------|
| 管线 | IStep[] 链 + 逆序 cleanup | PipelineRunner |
| 四抽象调度 | Strategy/Driver/ExecutionModel/Router | CompositeScheduler |
| 分布式状态+事件 | 三容器 + PipelineObserver | TaskBoard/MemoryStore/AgentPool |
| 声明式注册 | 注册表替代硬编码分支 | Agent/Tool/MemoryQuery注册 |
| 两阶段提交 | writePending→commitMemory/rollback | MemoryStore |
| 画布式 UI | 瞬态组件事件驱动生命周期 | 桌面端三层架构 |
