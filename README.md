# Cortex

> **自治理 AI Agent 运行时** — 带宪法、带人格、带 TUI。
>
> 26 个包 · 14 种 Agent 类型 · 17 个角色人格 · 22 个预置技能

[📖 包定位文档](PACKAGE_POSITIONING.md) · [📘 使用指南](USAGE.md) · [🏗️ 架构设计](DESIGN.md) · [📜 宪法](docs/constitution/)

---

Cortex **不是又一个 "AI 写代码工具"**。它是一个完整的 Agent 操作系统：

- **调度引擎** — 负责任务分发与确认门控，三抽象架构（策略 × 驱动 × 范式）
- **宪法体系** — 六条不可变原则约束 Agent 行为边界，制度化治理流程
- **FSM 编译器** — 把治理规则编译为可执行状态机，带自动 Mermaid 图生成
- **TUI 界面** — 在终端里和昔涟/甘雨/刻晴等角色对话，支持群聊与计划执行
- **技能系统** — 从执行输出中提取模式、结晶为可复用的技能定义
- **记忆系统** — 向量检索 + 图谱推理，为 Agent 提供长程上下文

---

## 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [核心概念](#核心概念)
  - [Agent 调度引擎](#agent-调度引擎)
  - [TUI 终端](#tui-终端)
  - [FSM 编译器](#fsm-编译器)
  - [技能系统](#技能系统)
  - [宪法治理](#宪法治理)
- [Agent 角色一览](#agent-角色一览)
- [包生态速览](#包生态速览)
- [治理与自审视](#治理与自审视)
- [学习路径](#学习路径)
- [贡献指南](#贡献指南)

---

## 快速开始

```bash
# 1. 前置要求
node --version   # 需要 >= 20.0.0
pnpm --version   # 需要 >= 9.0.0

# 2. 安装依赖
pnpm install

# 3. 全量构建（26 个包）
pnpm build

# 4. 启动 TUI（与昔涟对话）
pnpm cli

# 5. 运行 CI 门禁（构建 + 类型检查 + 测试 + Lint）
pnpm ci
```

> **首次使用？** 详见 [📘 使用指南](USAGE.md) 的环境配置章节，需配置 API Key 方可使用 LLM 功能。

---

## 项目结构

```
cortex/
│
├── packages/                     # 26 个 npm 包（pnpm workspace）
│   ├── engine/                   # ⭐ 运行时内核（调度、记忆、Agent、工具包）
│   ├── scheduler/                #   调度执行引擎（三抽象架构）
│   ├── cli/                      #   命令行入口 + EngineBridge 桥接
│   ├── tui/                      #   终端渲染层（独立包，被 cli 依赖）
│   ├── fsm-compiler/             #   有限状态机编译工具链
│   ├── llm/                      #   DeepSeek API 封装 + 限流
│   ├── prompt-kit/               #   提示词工程工具包
│   ├── skill-kit/                #   技能系统
│   ├── config/                   #   统一配置真相源（零依赖）
│   ├── shared/                   #   共享类型协议层
│   ├── doctor/                   #   项目健康诊断
│   ├── telemetry/                #   遥测采集层
│   ├── notification/             #   事件路由与通知
│   ├── plugin-runner/            #   插件运行器
│   ├── tools/                    #   工具注册与适配
│   ├── parser/                   #   AST 解析
│   ├── testing/                  #   测试基础设施
│   ├── governance/               #   治理层——制度化制度
│   ├── consistency/              #   一致性检查
│   ├── context-manager/          #   上下文管理
│   ├── logging/                  #   结构化日志
│   ├── memory/                   #   记忆系统核心
│   ├── memory-store/             #   记忆存储与检索
│   ├── pattern-extractor/        #   模式提取器
│   ├── platform/                 #   平台层（Toolkit 等）
│   ├── resilience/               #   容错与重试
│
├── prompts/                      # 17 个角色的人格提示词
│   ├── cyrene/                   #   昔涟（但丁，记忆守望者）
│   ├── ganyu/                    #   甘雨（七星秘书，战术调度）
│   ├── keqing/                   #   刻晴（玉衡，代码审查）
│   ├── albedo/                   #   阿贝多（炼金术士，实现）
│   ├── nahida/                   #   纳西妲（草神，分析）
│   └── ...                       #   钟离、凝光、莫娜、北斗、安柏...
│
├── skills/                       # 22 个预置技能定义（JSON）
├── scripts/                      # 构建 / CI 门禁 / 记忆注入 / 自审视
├── docs/                         # 宪法 / 修正案 / 审计 / 设计文档
│   ├── constitution/             #   宪法体系
│   ├── amendments/               #   修正案
│   └── auditing/                 #   审计报告
│
├── cortex-agents.json            # Agent 注册表（14 个 Agent 定义）
├── cortex-cognition.json         # 认知配置（激活矩阵 + 注意力策略）
├── cortex-docs.json              # 文档治理注册表
├── PACKAGE_POSITIONING.md        # 包定位文档
├── USAGE.md                      # 使用指南
├── DESIGN.md                     # 调度器架构设计
└── tsconfig.base.json            # TypeScript 基础配置
```

---

## 核心概念

### Agent 调度引擎

`@cortex/engine`（依赖 `@cortex/scheduler`）是运行时内核。一条任务进入后的完整链路：

```
MetaAgent (甘雨) 规划
    │
    ▼
Scheduler 拓扑排序 → 拆解为 DAG 子任务
    │
    ▼
AgentPool 按 tags 匹配 Agent（code → 阿贝多，review → 刻晴，...）
    │
    ▼
Dispatch Pipeline（五步流水线）
    ├── ClaimStep       — 认领任务节点
    ├── SpawnStep       — 启动 Agent 实例（受 mHC 流形约束）
    ├── ExecuteStep     — ReAct 循环执行（LLM + 工具调用）
    ├── BoundaryGuard   — 检查边界违规
    └── CleanupStep     — 释放资源
    │
    ▼
ConfirmGate — 对 L2 写入操作进行可逆性分级确认
TrustModel  — 根据历史成功率动态调整 Agent 自主权
    │
    ▼
失败时 → ReplanManager 触发重规划
完成时 → 返回 ExecutionReport
```

**三抽象架构**（`@cortex/scheduler`）：

| 抽象 | 接口 | 默认实现 | 职责 |
|------|------|---------|------|
| 调度策略 | `IScheduleStrategy` | `TagMatchingStrategy` | 决定任务由哪个 Agent 执行 |
| 循环驱动 | `ILoopDriver` | `TopologicalLayeredDriver` | 控制执行循环如何推进 |
| 执行范式 | `IExecutionModel` | `PipelineModel` | 控制单节点执行方式 |

### TUI 终端

`packages/cli` 是一个完整的终端 UI，支持：

| 模式 | 说明 | 进入方式 |
|------|------|---------|
| 💬 **对话** | 与单个角色 Agent 对话 | 默认模式 |
| 📋 **计划执行** | 甘雨规划 → 多 Agent 协同执行 | `/plan` |
| 👥 **群聊** | 多 Agent 自主对话协商 | `/group` |
| 📊 **状态面板** | 实时查看 Agent 运行状态 | `/status` |
| ⌨️ **REPL 命令** | `/help`, `/switch`, `/clear` 等 | 直接输入 |

### FSM 编译器

`packages/fsm-compiler` 把 JSON 状态机定义编译为 TypeScript：

```
JSON DSL (task-node.fsm.json)  →  FsmParser  →  AST
  →  FsmValidator（可达性/死锁检测）  →  TypeScriptGenerator（代码）
  →  DiagramGenerator（Mermaid 图）
  →  StateMachine（运行时解释执行）
```

已定义的 FSM：

| 定义文件 | 建模对象 | 状态数 | 用途 |
|---------|---------|--------|------|
| `task-node.fsm.json` | 任务节点 | 5 | pending → running → paused/completed/failed |
| `agent-pool.fsm.json` | Agent 池 | 3 | idle → active → draining |
| `confirm-gate.fsm.json` | 确认门禁 | 2 | open → closed |
| `manifold-gate.fsm.json` | 流形门禁 | 3 | waiting → evaluating → resolved |
| `memory-entry.fsm.json` | 记忆条目 | 3 | draft → confirmed → archived |
| `trust-model.fsm.json` | 信任模型 | 3 | baseline → elevated → restricted |

### 技能系统

技能以 JSON 定义，存储在 `skills/` 目录。当前预置 22 个技能。

**技能生命周期**：

```
Agent 执行输出 → 莫娜（loop）提取模式
  → 技能结晶 → 固化到记忆库
    → 其他 Agent 复用技能模板
```

### 宪法治理

Cortex 六条不可变原则：

| # | 原则 | 含义 |
|---|------|------|
| ① | **可替换** | 每个组件有接口定义，可替换实现 |
| ② | **可验证** | 所有行为有测试覆盖，CI 门禁全绿方可合并 |
| ③ | **安全边界** | 工具调用层统一管控，Agent 无裸 FS 权限 |
| ④ | **职责清晰** | 包边界明确，21 个包各司其职 |
| ⑤ | **可观测** | 事件走统一管道（PipelineObserver） |
| ⑥ | **无循环依赖** | 依赖图严格 DAG |

---

## Agent 角色一览

Cortex 内置 14 种 Agent 类型，每种绑定一个角色人格：

| Agent | 角色 | 类型 | 模型 | 核心职责 |
|-------|------|------|------|---------|
| ⚗️ **阿贝多** | 西风骑士团首席炼金术士 | `code` | flash | 代码实现、重构、测试 |
| ⚡ **刻晴** | 璃月七星·玉衡 | `review` | flash | 代码审查、质量审计 |
| 🌿 **纳西妲** | 须弥草神，智慧化身 | `analysis` | flash | 架构分析、模式发现 |
| 📋 **甘雨** | 璃月七星秘书 | `meta` | **pro** | 任务规划、重规划 |
| ☄️ **钟离** | 往生堂客卿，契约守护者 | `strategist` | **pro** | 战略评估、契约守护 |
| ⚓ **北斗** | 南十字船队大姊 | `ops` | flash | 构建、CI、部署 |
| 🔮 **莫娜** | 星天水占术士 | `loop` | flash | 模式扫描、技能提取 |
| 💎 **凝光** | 璃月七星·天权 | `doc-govern` | flash | 文档治理、合规审计 |
| 💉 **希格雯** | 梅洛彼得堡护士长 | `fix` | flash | Bug 诊断、修复 |
| 😈 **久岐忍** | 荒泷派外务奉行 | `api` | flash | API 设计、契约验证 |
| 📚 **艾尔海森** | 教令院大书记官 | `data` | flash | 数据建模、迁移 |
| 🐰 **安柏** | 西风骑士团侦察骑士 | `inspector` | flash | 侦察、信息收集 |
| 🎆 **宵宫** | 长野原烟花店老板 | `browser` | flash | UI 验证、浏览器操作 |
| 🍀 **昔涟** | 记忆命途守望者 | `butler` | flash | 用户交互、管家 |

角色提示词在 `prompts/<name>/` 下。每份包含 `system.md`（系统提示）和 `roundtable.md`（圆桌提示）。

---

## 包生态速览

| 层级 | 包 | 一句话定位 |
|------|----|-----------|
| **L0 类型/配置** | `@cortex/shared` | 全项目类型协议层，定义跨包类型与枚举 |
| | `@cortex/config` | 统一配置真相源，零外部依赖 |
| | `@cortex/tools` | 工具注册与适配 |
| **L1 引擎/调度** | `@cortex/engine` | ⭐ 运行时内核——Agent 生命周期、记忆、工具包 |
| | `@cortex/scheduler` | 任务调度执行引擎（三抽象架构） |
| | `@cortex/fsm-compiler` | 有限状态机编译工具链 |
| | `@cortex/llm` | LLM 适配器（通用） |
| | `@cortex/plugin-runner` | 插件运行器 |
| | `@cortex/platform` | 平台层（Toolkit 等） |
| **L2 校验/治理** | `@cortex/doctor` | 项目健康诊断 |
| | `@cortex/notification` | 事件路由与通知 |
| | `@cortex/telemetry` | 遥测采集层 |
| | `@cortex/governance` | 治理层——制度化制度 |
| | `@cortex/consistency` | 一致性检查 |
| | `@cortex/logging` | 结构化日志 |
| | `@cortex/resilience` | 容错与重试 |
| **L3 交互/技能** | `@cortex/cli` | 命令行入口 + EngineBridge 桥接 |
| | `@cortex/tui` | 终端渲染层（独立包，被 cli 依赖） |
| | `@cortex/prompt-kit` | 提示词工程工具包 |
| | `@cortex/skill-kit` | 技能系统 |
| | `@cortex/context-manager` | 上下文管理 |
| | `@cortex/memory` | 记忆系统核心 |
| | `@cortex/memory-store` | 记忆存储与检索 |
| | `@cortex/pattern-extractor` | 模式提取器 |
| | `@cortex/parser` | AST 解析 |
| | `@cortex/testing` | 测试基础设施 |

> 完整包定位分析见 [PACKAGE_POSITIONING.md](PACKAGE_POSITIONING.md)（含依赖图、边界原则）。

---

## 治理与自审视

```bash
# CI 门禁（每次提交前运行）
pnpm ci                 # 标准门禁：构建 + 类型检查 + 测试 + Lint
pnpm ci:all             # 全量门禁（含耗时测试）
pnpm ci:dry             # 预演模式

# 自审视
pnpm self-exam          # 软约束自审视（推荐提交前运行）
pnpm roundtable         # 圆桌共识会议（治理层决策）

# 健康诊断
node packages/cli/dist/main.js doctor

# 查看宪法
npx tsx scripts/show-constitution.ts
```

**治理闭环**：`pnpm ci`（门禁）→ `pnpm self-exam`（审视）→ `pnpm roundtable`（共识）→ 文档存档

所有修改须经 CI 全绿方可合并。宪法修正额外需要圆桌共识 + 修宪文档。

---

## 学习路径

按角色选择合适的入口文档：

| 角色 | 推荐文档 | 内容 |
|------|---------|------|
| 🆕 **新用户** | [USAGE.md](USAGE.md) | 环境配置、CLI 操作、故障排除 |
| 🏗️ **架构师** | [PACKAGE_POSITIONING.md](PACKAGE_POSITIONING.md) | 包依赖图、职责边界、分层架构 |
| ⚙️ **开发者** | [DESIGN.md](DESIGN.md) | 调度器设计、接口契约、三抽象 |
| 📜 **治理者** | `docs/constitution/` | 宪法条款、修正案流程 |
| 🔧 **维护者** | `scripts/ci-gate.ts` | CI 门禁配置、检查清单 |

---

## 贡献指南

1. Fork 仓库，创建特性分支
2. 确保 `pnpm ci` 全绿
3. 新增包须创建 `PACKAGE_POSITIONING.md`
4. 新增测试须首行标注 `// @ci: unit|llm|integration|e2e|manual`
5. 提交 PR 前运行 `pnpm self-exam`
6. 涉及宪法修改需圆桌共识 + 修宪文档

---

## 相关资源

| 文档 | 位置 | 说明 |
|------|------|------|
| 📖 包定位文档 | `PACKAGE_POSITIONING.md` | 26 个包的职责边界与依赖关系 |
| 📘 使用指南 | `USAGE.md` | 环境配置、CLI 操作、开发工作流 |
| 🏗️ 调度器设计 | `DESIGN.md` | 三抽象架构、接口契约、数据流 |
| 📜 宪法体系 | `docs/constitution/` | 不可变原则与治理规则 |
| 🔍 架构审计 | `docs/auditing/` | 架构推演与一致性分析 |
| 📋 Agent 注册表 | `cortex-agents.json` | 14 个 Agent 的完整配置 |
| 🧠 认知配置 | `cortex-cognition.json` | 激活矩阵与注意力策略 |
