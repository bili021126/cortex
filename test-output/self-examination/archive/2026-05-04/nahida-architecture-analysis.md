# 🔬 纳西妲 · 架构全景分析

> **分析范围**: 全量 `packages/` 源码 + `docs/` 设计文档
> **分析日期**: 2025-07-17

---

## 一、总体架构概览

Cortex 是一个 **LLM 驱动的个人工具链**。从 v1.1 的"大脑隐喻"演进到 v2.x 的"工具链隐喻"，当前处于 Core-1 阶段。系统以 MetaAgent 为规划中枢，8 种执行 Agent 各司其职，通过共享类型契约层（`@cortex/shared`）完成模块间通信。

**物理包结构（v2.1 蒸馏后的最终形态）**：

```
cortex/
├── @cortex/shared      ← 纯类型契约层（零运行时依赖）
├── @cortex/engine      ← 全部运行时实现（依赖 shared + sql.js + playwright）
└── @cortex/testing     ← 测试合成数据（依赖 shared + uuid）
```

从 Meso-Lite 的 10 包/19 柱"过早架构化"蒸馏为 3 包——**这是 Meso 反思阶段最关键的架构决策**。

---

## 二、模块解耦分析

### 2.1 包级依赖方向

```
@cortex/shared  ←── @cortex/engine
        ↑
        └── @cortex/testing
```

- `shared` 不依赖任何 Cortex 包——纯类型 + 接口定义
- `engine` 依赖 `shared`（`workspace:*`）+ 两个外部库（`sql.js`、`playwright`）
- `testing` 依赖 `shared` + `uuid`，不依赖 engine
- **无循环依赖** ✅

### 2.2 Engine 内部模块分层

```
┌─────────────────────────────────────────────────┐
│                  调度层                           │
│  Scheduler → TaskBoard → AgentPool               │
│        ↓          ↓          ↓                   │
│  MetaAgent   (PipelineObserver 贯穿全部)          │
├─────────────────────────────────────────────────┤
│                  执行层                           │
│  BaseAgent ──→ CodeAgent / ReviewAgent /         │
│                 AnalysisAgent / DocGovernAgent    │
│  (独立) OpsAgent / LoopAgent / InspectorAgent    │
│  (独立) ButlerAgent / BrowserAgent / MetaAgent   │
│      ↓                                           │
│  ReAct Helper ←── LlmAdapter ←── Toolkit         │
│                      ↓              ↓             │
│                   DeepSeek API   ConfirmGate      │
│                                  FileLockManager  │
├─────────────────────────────────────────────────┤
│                  记忆层                           │
│  MemoryStore (sql.js + Map + BFS + CAS)          │
├─────────────────────────────────────────────────┤
│                  交互适配层                       │
│  CLIAdapter (PlatformBridge) / ConfirmGate        │
│  ButlerAgent → PipelineObserver                  │
└─────────────────────────────────────────────────┘
```

### 2.3 各模块职责边界

| 模块 | 单一职责 | 耦合点 | 耦合强度 |
|------|---------|--------|---------|
| **Scheduler** | 拓扑排序 + 逐层并行调度 + 重规划 | TaskBoard, AgentPool, PipelineObserver, ConfirmGate, MetaAgent | 中——5 个依赖但均为构造注入 |
| **TaskBoard** | 任务板：原子 claim/release/complete | 仅 `AGENT_TAGS`（shared） | 低 |
| **AgentPool** | 实例生命周期 + 配额管理 | 仅 shared type | 低 |
| **MemoryStore** | 记忆 CRUD + BFS + CAS + SQLite | 仅 shared type + sql.js + fs | **高内聚**——685 行单一文件 |
| **Toolkit** | 工具执行引擎 + 权限校验 | ConfirmGate, FileLockManager（可选注入） | 中 |
| **LlmAdapter** | DeepSeek API 适配 + LRU 缓存 | 仅 crypto + fetch | 低 |
| **ConfirmGate** | 可逆性等级拦截 | PlatformBridge（可选注入） | 低 |
| **PipelineObserver** | 优先级事件管道 | 纯回调注册 | **最低**——零模块依赖 |

---

## 三、Agent 层一致性分析

**发现：存在两种 Agent 实现模式，违反里氏替换原则。**

### 模式 A：继承 BaseAgent（4 个 Agent）
```
BaseAgent (abstract)
  ├── CodeAgent    —— 覆盖 getMemoryQuery()
  ├── ReviewAgent  —— 覆盖 getMemoryQuery()
  ├── AnalysisAgent—— 覆盖 getMemoryQuery()
  └── DocGovernAgent——覆盖 getMemoryQuery()
```
- 共享 ReAct 循环（`react-helper.ts`）
- 共享记忆增强执行管线
- 共享生命周期管理
- ✅ 符合开闭原则

### 模式 B：独立实现（5 个 Agent）
```
OpsAgent      —— 自管生命周期 + 调用 runReActLoop()
LoopAgent     —— 自管生命周期 + 调用 runReActLoop()
InspectorAgent—— 完全独立的 ReAct 循环（重复实现！）
BrowserAgent  —— 完全独立的 ReAct 循环（含 Playwright 管理）
ButlerAgent   —— 不执行任务，纯事件订阅
MetaAgent     —— 独立规划引擎
```

**关键发现**：`InspectorAgent` 和 `BrowserAgent` 各自复制了一份完整的 ReAct 循环（~60 行），与 `react-helper.ts` 中的 `runReActLoop` 逻辑同构但独立维护。`InspectorAgent` 注释中写"不继承 BaseAgent——自管 ReAct"，但理由与架构原则不符。

---

## 四、依赖方向精查

### 4.1 正向依赖（符合设计）
- 所有模块 → `@cortex/shared`（类型契约）✅
- Agent → LlmAdapter + Toolkit + MemoryStore（构造注入）✅
- Scheduler → TaskBoard + AgentPool + PipelineObserver（构造注入）✅

### 4.2 需要注意的依赖

| # | 依赖 | 问题 | 严重度 |
|---|------|------|--------|
| ① | `Toolkit` ↔ `ConfirmGate` | 可选注入（`setGate()`），但 execute() 内调 `this.gate?.xxx`——属于"运行时可选死代码" | 低 |
| ② | `BaseAgent` → `MemoryStore` | 可选注入（`memory?`），但 `_executeAndRemember` 内部有记忆写入逻辑——若 memory 为 undefined，静默跳过 | 低 |
| ③ | `Scheduler` → `MetaAgent` | 可选注入（`metaAgent?`），replan 逻辑完全依赖此判断——没有 MetaAgent 时失败的节点静默丢弃 | **中** |
| ④ | `MemoryStore._sqlRead` | 异常时静默回退到 `_memScanRead`——双重实现维护负担 | 中 |
| ⑤ | `Toolkit` vs `ToolRegistry` | 两个独立工具管理类：ToolRegistry 定义元数据，Toolkit 执行 + 校验——但 Toolkit 内置了 `TOOL_META` 而不使用 ToolRegistry | **高**——重复功能、数据不同步风险 |

### 4.3 嵌套异常

```
packages/engine/packages/engine/src/string-utils.ts
```

这是 engine 包内部嵌套了一个 engine 子包。`string-utils.ts`（`capitalize` + `truncate`）未被 engine 源码中的任何文件引用——是 Meso-Lite 旧结构的残留物。

---

## 五、核心设计模式评估

| 模式 | 位置 | 评价 |
|------|------|------|
| **模板方法** | `BaseAgent.getMemoryQuery()` | ✅ 每个 Agent 定义自己的"回家路径"——体现差异化检索策略 |
| **策略** | Agent 角色 systemPrompt | ✅ 共享 ReAct 循环，不同 persona 注入不同行为 |
| **观察者** | `PipelineObserver` | ✅ 优先级分层 + 隔离（单 handler 异常不阻断后续） |
| **CAS 乐观更新** | `MemoryStore.cas()` | ✅ 无锁并发，符合单线程模型 |
| **构造注入** | Scheduler/Agent constructor | ✅ 模块组合在外部，便于测试替换 |

---

## 六、架构整体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **模块边界清晰度** | ⭐⭐⭐⭐⭐ (5/5) | 3 包蒸馏是正确决策 |
| **依赖方向正确性** | ⭐⭐⭐⭐ (4/5) | 无循环依赖；Toolkit/ToolRegistry 重复 |
| **Agent 层一致性** | ⭐⭐⭐ (3/5) | 4 继承 + 5 独立 = 双轨维护负担 |
| **错误传播健壮性** | ⭐⭐⭐ (3/5) | MemoryStore 静默吞错 + Scheduler 可选依赖静默降级 |
| **架构演进可追溯性** | ⭐⭐⭐⭐ (4/5) | v1.1→v2.0 蒸馏路径清晰，但残留物（嵌套 engine 子包）尚存 |
| **综合** | ⭐⭐⭐⭐ (3.8/5) | 架构骨架坚实，Agent 层需统一 |

---

*—— 纳西妲，Cortex Analysis Agent*
