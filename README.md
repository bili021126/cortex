# Cortex

**自治理 AI Agent 运行时——带宪法、带人格、带 TUI。**

Cortex 不是又一个 "AI 写代码工具"。它是一个完整的 Agent 操作系统：调度引擎负责任务分发与确认门控，宪法体系约束 Agent 行为边界，FSM 编译器把治理规则编译为可执行状态机，TUI 让你在终端里直接和昔涟对话。

---

## 架构

```
cortex/
├── packages/
│   ├── engine/           # 调度引擎：Scheduler → AgentPool → Dispatch → ConfirmGate
│   │   ├── core/         #   └─ trust-model / manifold-gate / pipeline-runner
│   │   ├── memory/       #   记忆系统：向量检索 + 图谱推理 + ContextBuilder
│   │   ├── agents/       #   9 类 Agent 配置（code/review/analysis/ops/loop/...）
│   │   ├── components/   #   Agent 工厂 / ReAct 循环 / 技能结晶
│   │   └── platform/     #   Toolkit / path-utils / CLI 适配器
│   ├── cli/              # TUI 终端界面：聊天 / 计划执行 / 群聊 / Agent 调度
│   ├── llm/              # DeepSeek API 封装 + 限流 + 模型切换
│   ├── config/           # 统一配置真相源（零依赖，全局唯一）
│   ├── shared/           # 跨包类型与工具
│   ├── prompt-kit/       # 提示词组装 / 模板引擎 / 版本管理
│   ├── skill-kit/        # 技能系统（薄包装 → 核心逻辑在 engine）
│   ├── fsm-compiler/     # FSM 编译器：JSON 定义 → TypeScript 可执行状态机
│   ├── plugin-runner/    # 插件系统：动态加载 + Schema 校验 + 沙箱执行
│   ├── policy-validator/ # 宪法策略校验引擎
│   ├── skill-validator/  # 技能定义合规校验
│   ├── doctor/           # 项目健康诊断
│   ├── telemetry/        # 遥测与日志采集
│   ├── testing/          # 测试基础设施
│   ├── tools/            # 工具注册与适配
│   ├── notification/     # 事件路由与通知
│   ├── pm/               # 包管理
│   ├── data/             # 数据层
│   ├── parser/           # AST 解析
│   └── factory/          # 工厂抽象
├── prompts/              # 角色提示词：昔涟 / 甘雨 / 刻晴 / 凝光 / 七七 / ...
├── docs/                 # 宪法 / 修正案 / 审计 / 审查
├── skills/               # 技能定义（JSON）
├── scripts/              # 构建 / CI 门禁 / 记忆注入 / 自审视
├── cortex-agents.json    # Agent 注册表（1254 行）
├── cortex-cognition.json # 认知配置：激活矩阵 + 注意力策略
├── cortex-docs.json      # 文档治理注册表
└── cyrene-constitution.md # 昔涟人格宪章（最高治理文件）
```

## 核心概念

### Agent 调度引擎

`@cortex/engine` 是运行时内核。一条任务进入后：

1. **Scheduler** 拓扑排序 → 拆解为子任务 DAG
2. **AgentPool** 按 tag 匹配 Agent（`code → 阿贝多`，`review → 刻晴`，...）
3. **Dispatch** 五步流水线：`Claim → BoundaryGuard → Spawn → ManifoldGate → Execute → Cleanup`
4. **ConfirmGate** 对 L2 写入操作进行可逆性分级确认
5. **TrustModel** 根据历史成功率动态调整 Agent 自主权

Agent 定义见 `cortex-agents.json`——9 种类型、每个有独立的模型/工具权限/记忆查询策略。

### 宪法体系

`cyrene-constitution.md` 是项目的最高治理文件。它定义了：
- 昔涟人格完整性与多形态本体论
- Agent 行为边界与工具权限约束
- 技能系统设计原则（§13 "技能即记忆"）
- 确认门可逆性等级模型
- 交融三柱架构（确认门 / 信任模型 / 分流网关）

宪法修正通过圆桌会议 → 代码审查 → CI 门禁全绿 → 合并的四步闭环执行。

### TUI 终端

`packages/cli` 是一个完整的终端 UI，支持：
- 单轮对话（与昔涟 / 甘雨 / 其他角色）
- 多 Agent 协作计划执行
- 群聊模式（Agent 间自主对话）
- 实时 Agent 状态面板
- REPL 命令系统

### FSM 编译器

`packages/fsm-compiler` 把 JSON 状态机定义编译为 TypeScript：
- `definitions/` 下是确认门、信任模型、分流网关等核心状态机的 JSON 描述
- 编译器输出可执行 TypeScript + Mermaid 图

### 技能系统

技能以 JSON 或 TypeScript 定义，存储在 `skills/` 目录。运行时通过 engine 的 `SkillTemplateEngine` 加载、校验、执行。技能结晶流程：执行输出 → 提取模式 → 固化到记忆库。

## 快速开始

```bash
# 要求 Node.js >= 20，pnpm >= 9
pnpm install
pnpm build

# 启动 TUI
pnpm cli

# 运行 CI 门禁（构建 + 类型检查 + 测试 + Lint）
pnpm ci
```

## 角色

Cortex 内置了崩铁角色人格提示词，每个 Agent 绑定一个角色：

| Agent | 角色 | 类型 |
|-------|------|------|
| 阿贝多 | 西风骑士团首席炼金术士 | code |
| 刻晴 | 璃月七星·玉衡 | review |
| 甘雨 | 璃月七星秘书 | meta（规划） |
| 凝光 | 璃月七星·天权 | strategist |
| 七七 | 不卜庐药童 | inspector |
| 莫娜 | 占星术士 | analysis |
| 昔涟 | 开拓者的妻子 | butler（管家） |

角色提示词在 `prompts/<name>/` 下。

## 治理

项目采用自审视闭环：
- `pnpm ci` — CI 门禁（每次提交前运行）
- `pnpm self-exam` — 软约束自审视
- `pnpm roundtable` — 圆桌共识会议

所有修改须经 CI 全绿方可合并。宪法修正额外需要圆桌共识 + 修宪文档。
