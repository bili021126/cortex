# Cortex — 包定位文档

> **版本**: v0.2.0  
> **状态**: 全量覆盖  
> **更新日期**: 2026-05-31  
> **治理关联**: 宪法 §五（补足声明）、§十五·四（包职责边界）

---

## 目录

1. [项目定位](#1-项目定位)
2. [包全景图](#2-包全景图)
3. [依赖关系拓扑](#3-依赖关系拓扑)
4. [各包定位速查](#4-各包定位速查)
5. [分层架构总览](#5-分层架构总览)
6. [宪法一致性](#6-宪法一致性)

---

## 一、项目定位

**Cortex** 是一个**自治理 AI Agent 运行时系统**——它不只是一个「AI 写代码工具」，而是一套完整的 Agent 操作系统：

- **调度引擎** 负责任务分发、确认门控、重规划闭环
- **宪法体系** 约束 Agent 行为边界，制度化治理流程
- **FSM 编译器** 把治理规则编译为可执行状态机
- **TUI 界面** 在终端里与角色人格 Agent 对话
- **技能系统** 从执行输出中提取模式、结晶为可复用的技能定义
- **记忆系统** 向量检索 + 图谱推理，为 Agent 提供长程上下文

> **一句话**: Cortex = Agent 运行时内核 + 宪法治理层 + 人格化交互层 + 技能结晶闭环。

---

## 二、包全景图

Cortex 采用 pnpm monorepo 架构，共 **21 个包**，按分层划分为 4 层：

```
Cortex Monorepo
│
├─ Layer 0: 类型 / 工具 / 配置层 ──────────────── 零依赖基底
│  ├── @cortex/shared        — 共享类型、枚举、工具函数（全项目类型协议层）
│  ├── @cortex/config         — 统一配置真相源（零外部依赖，全局唯一）
│  └── @cortex/tools          — 工具注册与适配
│
├─ Layer 1: 调度 / 引擎 / 执行层 ──────────────── 运行时核心
│  ├── @cortex/scheduler      — 任务调度执行引擎
│  ├── @cortex/engine         — 运行时内核（Agent 生命周期、记忆、工具包）
│  ├── @cortex/fsm-compiler   — 分层有限状态机编译工具链
│  ├── @cortex/llm            — LLM 适配器（DeepSeek API 封装 + 限流 + 模型切换）
│  ├── @cortex/plugin-runner  — 插件运行器（动态加载 + Schema 校验 + 沙箱执行）
│  └── @cortex/factory        — 工厂抽象（Agent 工厂、组件工厂）
│
├─ Layer 2: 校验 / 治理 / 合规层 ──────────────── 宪法保障
│  ├── @cortex/policy-validator  — 宪法策略校验引擎
│  ├── @cortex/skill-validator  — 技能定义合规校验
│  ├── @cortex/doctor           — 项目健康诊断（package.json 合规、定位文档门禁等）
│  ├── @cortex/notification     — 事件路由与通知管道
│  └── @cortex/telemetry        — 运行时遥测采集层
│
├─ Layer 3: 提示词 / 技能 / 交互层 ──────────────── 面向用户
│  ├── @cortex/prompt-kit       — 提示词工程工具包
│  ├── @cortex/skill-kit        — 技能系统（定义、加载、校验、执行）
│  ├── @cortex/cli              — TUI 终端界面 + CLI 入口
│  ├── @cortex/pm               — 包管理功能
│  ├── @cortex/data             — 数据层
│  ├── @cortex/parser           — AST 解析
│  └── @cortex/testing          — 测试基础设施
│
└─ 跨层工具 / 文档 / 配置
   ├── prompts/                 — 角色提示词（昔涟 / 甘雨 / 刻晴 / 凝光 / …）
   ├── docs/                    — 宪法 / 修正案 / 审计 / 审查
   ├── skills/                  — 技能定义（JSON）
   ├── scripts/                 — 构建 / CI 门禁 / 记忆注入 / 自审视
   ├── cortex-agents.json       — Agent 注册表
   ├── cortex-cognition.json    — 认知配置（激活矩阵 + 注意力策略）
   └── cortex-docs.json         — 文档治理注册表
```

---

## 三、依赖关系拓扑

### 3.1 全量依赖图

```
@cortex/shared (无依赖)
@cortex/config  (无依赖)
  ↑
@cortex/tools (无依赖)
  ↑
@cortex/llm ─── @cortex/shared
@cortex/fsm-compiler (无运行时依赖)
  ↑                    ↑
@cortex/scheduler ─── @cortex/shared、@cortex/config
  ↑                    ↑
@cortex/prompt-kit ── @cortex/config、@cortex/shared
  ↑
@cortex/engine ──── @cortex/config、@cortex/shared、@cortex/llm、@cortex/factory、@cortex/telemetry
  ↑                    ↑        ↑
@cortex/plugin-runner ─ @cortex/engine
@cortex/skill-validator ─ @cortex/engine、@cortex/shared
@cortex/policy-validator ─ @cortex/config、@cortex/shared
  ↑           ↑           ↑
@cortex/notification ─ @cortex/shared
@cortex/factory ────── @cortex/config、@cortex/shared、@cortex/notification
  ↑                    ↑           ↑
@cortex/doctor ──────── @cortex/shared、@cortex/tools
@cortex/skill-kit ──── @cortex/engine
@cortex/telemetry (无内部依赖)
  ↑                    ↑
@cortex/cli ────────── @cortex/config、@cortex/engine、@cortex/llm、@cortex/parser、
                       @cortex/prompt-kit、@cortex/doctor、@cortex/pm、@cortex/shared、
                       @cortex/tools
  ↑
@cortex/pm ────────── commander
@cortex/data ──────── cli-table3
@cortex/parser (无内部依赖)
@cortex/testing ──── @cortex/shared
```

### 3.2 关键边界原则

| 原则 | 内容 |
|------|------|
| **零依赖核心** | `@cortex/shared` 和 `@cortex/config` 无运行时依赖，是全项目的类型与配置基座 |
| **无循环依赖** | 所有包形成 DAG，不存在任何循环引用 |
| **引擎不依赖交互层** | `@cortex/engine` 不依赖 `@cortex/cli` 或 `@cortex/prompt-kit`，可独立运行 |
| **校验层不依赖运行时** | `policy-validator` / `skill-validator` 可脱离 engine 独立运行 |
| **FSM 编译器独立** | `@cortex/fsm-compiler` 无运行时依赖，可在任意项目中使用 |

---

## 四、各包定位速查

### Layer 0 — 类型 / 工具 / 配置层

| 包 | 一句话定位 | 关键依赖 | 被谁依赖 |
|----|-----------|---------|---------|
| **@cortex/shared** | 全项目类型协议层——定义 Agent/TaskNode/MemoryEntry 等所有跨包类型、枚举、工具函数 | 无 | 全部 18 个包 |
| **@cortex/config** | 统一配置真相源——零外部依赖，全局唯一的配置加载与解析入口 | 无 | engine/scheduler/cli/prompt-kit/factory/policy-validator |
| **@cortex/tools** | 工具注册与适配——为 Agent 提供可调用的工具函数注册表 | 无 | doctor/cli |

### Layer 1 — 调度 / 引擎 / 执行层

| 包 | 一句话定位 | 关键依赖 | 被谁依赖 |
|----|-----------|---------|---------|
| **@cortex/scheduler** | 任务调度执行引擎——接收 DAG 任务树，通过三抽象（策略/驱动/模型）将任务分发至 Agent 执行 | shared, config | engine |
| **@cortex/engine** | 运行时内核——Agent 生命周期管理、记忆系统（向量+图谱）、工具包、ReAct 循环、技能结晶 | shared, config, llm, factory, telemetry | cli, plugin-runner, skill-validator, skill-kit |
| **@cortex/fsm-compiler** | 分层 FSM 编译工具链——JSON DSL → 校验 AST → TypeScript 代码生成 → 运行时解释执行 | 无 | engine（未来） |
| **@cortex/llm** | LLM 适配器——DeepSeek API 封装 + 限流 + 模型切换 + 调用审计 | shared | engine, cli |
| **@cortex/plugin-runner** | 二级插件运行器——管理外部/用户定义插件的生命周期、沙箱执行、注册表与 Schema 校验 | engine | — |
| **@cortex/factory** | 工厂抽象——Agent 工厂、组件工厂的统一接口 | config, shared, notification | engine |

### Layer 2 — 校验 / 治理 / 合规层

| 包 | 一句话定位 | 关键依赖 | 被谁依赖 |
|----|-----------|---------|---------|
| **@cortex/policy-validator** | 宪法策略校验引擎——校验 Agent 行为是否违反宪法规则 | config, shared | — |
| **@cortex/skill-validator** | 技能定义合规校验——确保技能 JSON 定义符合项目规范 | engine, shared | — |
| **@cortex/doctor** | 项目健康诊断——自动化检查 package.json 合规、定位文档存在性、测试标注等 | shared, tools | cli |
| **@cortex/notification** | 事件路由与通知——跨 Agent、跨模块的事件通知管道 | shared | factory |
| **@cortex/telemetry** | 运行时遥测采集层——可插拔 Collector 接口 + 采样 + 批处理 | 无 | engine |

### Layer 3 — 提示词 / 技能 / 交互层

| 包 | 一句话定位 | 关键依赖 | 被谁依赖 |
|----|-----------|---------|---------|
| **@cortex/prompt-kit** | 提示词工程工具包——统一加载、声明式组装、模板渲染、校验、缓存 | config, shared | cli |
| **@cortex/skill-kit** | 技能系统——技能定义、加载、校验、执行、结晶的完整生命周期 | engine | — |
| **@cortex/cli** | TUI 终端界面——聊天/计划执行/群聊/Agent 调度/REPL 命令系统 | engine, llm, config, prompt-kit, doctor, tools, parser, pm, shared | — |
| **@cortex/pm** | 包管理功能 | commander | cli |
| **@cortex/data** | 数据层 | cli-table3 | — |
| **@cortex/parser** | AST 解析 | 无 | cli |
| **@cortex/testing** | 测试基础设施——测试工具、模拟数据、集成辅助 | shared | engine (devDependency) |

---

## 五、分层架构总览

### 5.1 四层调用流

```
  ┌──────────────────────────────────────────────────────────────┐
  │  用户交互层 (Layer 3)                                         │
  │  @cortex/cli │ @cortex/skill-kit │ @cortex/prompt-kit        │
  │  @cortex/pm  │ @cortex/data      │ @cortex/parser             │
  └──────────────────────┬───────────────────────────────────────┘
                         │ 调用
                         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  引擎/调度层 (Layer 1)                                       │
  │  @cortex/engine │ @cortex/scheduler │ @cortex/fsm-compiler   │
  │  @cortex/llm    │ @cortex/plugin-runner │ @cortex/factory     │
  └──────┬────────────────────┬──────────────────────────────────┘
         │ 调用               │ 调用
         ▼                    ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  治理/合规层 (Layer 2)                                       │
  │  @cortex/doctor │ @cortex/policy-validator                    │
  │  @cortex/skill-validator │ @cortex/notification               │
  │  @cortex/telemetry                                            │
  └──────────────────────┬───────────────────────────────────────┘
                         │ 继承/引用
                         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  类型/配置层 (Layer 0)                                       │
  │  @cortex/shared │ @cortex/config │ @cortex/tools              │
  └──────────────────────────────────────────────────────────────┘
```

### 5.2 Agent 一次执行的数据流

```
User (CLI/API)
  │  输入任务
  ▼
@cortex/cli ────────────────────────────────────── TUI 交互
  │  parseArguments + 加载配置
  ▼
@cortex/engine ─────────────────────────────────── 运行时内核
  │
  ├── MetaAgent (甘雨) ── 任务规划 → DAG 任务树
  │     └── 依赖 @cortex/llm (调用 DeepSeek)
  │
  ├── @cortex/scheduler ── 调度执行
  │     ├── Scheduler.executeAll()
  │     │   ├── TopologicalSort → 分层
  │     │   ├── Dispatch Pipeline (Claim → Spawn → Execute → BoundaryGuard → Cleanup)
  │     │   ├── AgentPool (实例管理)
  │     │   └── ReplanManager (失败重规划)
  │     └── 三抽象: IScheduleStrategy × ILoopDriver × IExecutionModel
  │
  ├── Agent 执行
  │     ├── 依赖 @cortex/fsm-compiler (状态机引擎: TaskNode/AgentPool/ConfirmGate)
  │     ├── 依赖 @cortex/prompt-kit (提示词渲染)
  │     ├── 依赖 @cortex/tools (工具调用)
  │     ├── Memory Store (向量检索 + 图谱推理)
  │     └── 技能系统 (SkillTemplateEngine 执行技能步骤)
  │
  ├── 治理门禁
  │     ├── @cortex/policy-validator (宪法规则检查)
  │     ├── @cortex/skill-validator (技能合规校验)
  │     ├── ConfirmGate (可逆性分级确认)
  │     └── TrustModel (动态信任评估)
  │
  └── 可观测性
        ├── @cortex/telemetry (采集)
        ├── @cortex/notification (事件通知)
        └── PipelineObserver (事件管道)
```

---

## 六、宪法一致性

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则一** — 每个组件可替换 | 所有核心接口（IScheduler、ITaskBoard、IAgentPool 等）均有接口定义 + 默认实现 |
| **原则二** — 可验证 | 每个包有独立测试套件，CI 门禁全绿方可合并 |
| **原则三** — 安全边界 | 工具调用层（Toolkit）统一管理安全边界，Agent 无直接文件系统权限 |
| **原则四** — 职责清晰 | 本文档明确界定了 21 个包的职责边界与「不做的事」 |
| **原则五** — 可观测事件走统一管道 | PipelineObserver + @cortex/telemetry + @cortex/notification 三层观测体系 |
| **原则六** — 无循环依赖 | 全量依赖图严格 DAG |
| **§五** — 补足声明 | 每个包必须有 PACKAGE_POSITIONING.md，由 @cortex/doctor 自动化检查 |
| **§十五·四** — 包职责独立 | 各包 exports 最小化，仅公开消费方需要的接口 |

---

> **维护约定**:
> 1. 新增包时，必须在此文档中添加条目并创建对应 `packages/<name>/PACKAGE_POSITIONING.md`
> 2. 依赖关系变更时，同步更新 §三 的依赖图
> 3. 删除包时，同时移除本文档对应条目和定位文档
> 4. 由 `@cortex/doctor` 的 `PositioningDocChecker` 自动化检查文档存在性
