# Cortex 使用指南

> **适用版本**: v0.1+  
> **前置要求**: Node.js >= 20.0.0, pnpm >= 9.0.0

---

## 目录

1. [快速开始](#1-快速开始)
2. [环境配置](#2-环境配置)
3. [CLI 与 TUI](#3-cli-与-tui)
4. [项目管理命令](#4-项目管理命令)
5. [Agent 系统](#5-agent-系统)
6. [技能系统](#6-技能系统)
7. [治理与审计](#7-治理与审计)
8. [开发指南](#8-开发指南)
9. [故障排除](#9-故障排除)

---

## 一、快速开始

### 1.1 环境准备

```bash
# 1. 检查 Node.js 版本
node --version   # 必须 >= 20.0.0

# 2. 安装 pnpm（如未安装）
npm install -g pnpm@latest
pnpm --version   # 必须 >= 9.0.0

# 3. 克隆并安装
git clone <cortex-repo-url>
cd cortex
pnpm install
```

### 1.2 首次构建

```bash
# 全量构建（会构建所有 21 个包）
pnpm build

# 构建特定包
pnpm --filter @cortex/engine build
pnpm --filter @cortex/cli build

# 构建 + 类型检查 + 测试 + Lint（CI 门禁）
pnpm ci
```

### 1.3 启动 TUI

```bash
# 方式 A：使用 CLI 入口
pnpm cli

# 方式 B：直接使用编译后的 CLI
node packages/cli/dist/main.js

# 方式 C：使用 cortex 命令（需先构建）
node cortex-cli.mjs
```

### 1.4 验证安装

```bash
# 健康诊断
node packages/cli/dist/main.js doctor

# 查看可用命令
node packages/cli/dist/main.js --help
```

---

## 二、环境配置

### 2.1 配置文件

项目使用 `.env` 文件管理环境变量：

```bash
# 复制示例配置
cp .env.example .env
```

核心环境变量：

| 变量 | 说明 | 默认值 | 必填 |
|------|------|--------|------|
| `DEEPSEEK_CHAT` | DeepSeek Chat API Key | — | 是（使用 LLM 时） |
| `DEEPSEEK_REASONER` | DeepSeek Reasoner API Key | — | 是（使用推理模型时） |
| `DEEPSEEK_CYRENE` | 昔涟专用 API Key | — | 是（TUI 对话时） |
| `NODE_ENV` | 运行环境 | `development` | 否 |
| `LOG_LEVEL` | 日志级别 | `info` | 否 |
| `CONFIRM_GATE_TIMEOUT_MS` | 确认门超时(ms) | `300000` | 否 |

### 2.2 配置层级

Cortex 配置按优先级从高到低：

1. **环境变量** — 最高优先级，运行时覆盖
2. **`.env` 文件** — 开发环境本地配置
3. **`@cortex/config` 默认值** — 代码内建的默认配置

### 2.3 API Key 配置

```bash
# .env 文件示例
DEEPSEEK_CHAT=sk-your-chat-api-key
DEEPSEEK_REASONER=sk-your-reasoner-api-key
DEEPSEEK_CYRENE=sk-your-cyrene-api-key
```

> **注意**: 昔涟（Cyrene）Agent 使用独立的 `DEEPSEEK_CYRENE` API Key，允许不同的计费/限流策略。

---

## 三、CLI 与 TUI

### 3.1 对话模式

启动 TUI 后进入对话模式，可与不同角色 Agent 交流：

```bash
# 启动 TUI（默认与昔涟对话）
pnpm cli

# TUI 内部命令
/help           # 显示帮助
/agents         # 列出所有可用 Agent
/switch <name>  # 切换到指定 Agent（如 /switch 甘雨）
/plan           # 进入计划执行模式
/group          # 进入群聊模式
/status         # 显示 Agent 状态面板
/clear          # 清屏
/quit           # 退出 TUI
```

### 3.2 可用 Agent

| 命令 | Agent | 类型 | 适合场景 |
|------|-------|------|---------|
| `/switch 阿贝多` | 阿贝多 | code | 代码实现、重构、测试 |
| `/switch 刻晴` | 刻晴 | review | 代码审查、审计 |
| `/switch 纳西妲` | 纳西妲 | analysis | 架构分析、深度调研 |
| `/switch 甘雨` | 甘雨 | meta | 任务规划、战术调度 |
| `/switch 钟离` | 钟离 | strategist | 战略评估、契约守护 |
| `/switch 凝光` | 凝光 | doc-govern | 文档治理、合规审计 |
| `/switch 北斗` | 北斗 | ops | 构建、部署、CI |
| `/switch 莫娜` | 莫娜 | loop | 模式发现、技能结晶 |
| `/switch 久岐忍` | 久岐忍 | api | API 设计、契约验证 |
| `/switch 艾尔海森` | 艾尔海森 | data | 数据建模、迁移 |
| `/switch 安柏` | 安柏 | inspector | 侦察、事实收集 |
| `/switch 希格雯` | 希格雯 | fix | Bug 诊断、修复 |
| `/switch 宵宫` | 宵宫 | browser | UI 验证、浏览器操作 |

### 3.3 计划执行模式

```bash
# 在 TUI 中使用 /plan 进入计划模式
/plan

# 甘雨会分析任务并生成执行计划
# 然后调度多个 Agent 协同执行
```

### 3.4 群聊模式

```bash
# 在 TUI 中使用 /group 进入群聊
/group

# 多个 Agent 自主对话协商
# 凝光负责最终收束共识
```

### 3.5 命令行模式

```bash
# 直接执行命令，不进入 TUI
node packages/cli/dist/main.js doctor           # 项目健康诊断
node packages/cli/dist/main.js --agent 阿贝多    # 指定 Agent
node packages/cli/dist/main.js --task "..."     # 直接执行任务
```

### 3.6 REPL 命令系统

TUI 内置 REPL，支持以下系统命令：

| 命令 | 缩写 | 说明 |
|------|------|------|
| `/help` | `/h` | 显示帮助 |
| `/agents` | `/a` | 列出 Agent |
| `/switch <name>` | `/s <name>` | 切换 Agent |
| `/plan` | `/p` | 计划模式 |
| `/group` | `/g` | 群聊模式 |
| `/status` | `/st` | 状态面板 |
| `/clear` | `/c` | 清屏 |
| `/history` | `/hi` | 查看历史 |
| `/save` | `/sa` | 保存会话 |
| `/load` | `/l` | 加载会话 |
| `/quit` | `/q` | 退出 |

---

## 四、项目管理命令

### 4.1 构建命令

```bash
# 全量构建
pnpm build

# 监听模式（开发）
pnpm --filter @cortex/engine dev

# 清理并重建
pnpm --filter @cortex/engine build --clean
```

### 4.2 测试命令

```bash
# 全量测试
pnpm test

# 特定包测试
pnpm --filter @cortex/fsm-compiler test
pnpm --filter @cortex/doctor test

# 带覆盖率
pnpm --filter @cortex/engine test:coverage

# 监听模式
pnpm --filter @cortex/engine test:watch

# CI 测试（更严格）
pnpm --filter @cortex/engine test:ci
```

### 4.3 类型检查

```bash
# 全量类型检查
pnpm typecheck

# 特定包
pnpm --filter @cortex/fsm-compiler typecheck
```

### 4.4 Lint

```bash
# 全量 Lint
pnpm lint

# 特定包
pnpm --filter @cortex/engine lint
```

### 4.5 CI 门禁

```bash
# 标准 CI（构建 + 类型检查 + 测试 + Lint）
pnpm ci

# 全量 CI（包括耗时测试）
pnpm ci:all

# CI 预演（不实际执行，仅检查配置）
pnpm ci:dry
```

### 4.6 包管理

```bash
# 添加依赖
pnpm --filter @cortex/engine add some-package

# 添加开发依赖
pnpm --filter @cortex/engine add -D some-package

# 升级依赖
pnpm --filter @cortex/engine update some-package

# 查看依赖图
pnpm list --depth 3
```

### 4.7 FSM 编译器 CLI

```bash
# 编译 FSM 定义
pnpm --filter @cortex/fsm-compiler validate

# 生成 Mermaid 状态图
pnpm --filter @cortex/fsm-compiler diagram

# 监听模式（自动重新编译）
pnpm --filter @cortex/fsm-compiler watch
```

---

## 五、Agent 系统

### 5.1 Agent 类型体系

Cortex 内置 14 种 Agent 类型，每种绑定一个角色人格：

| 类型 | 角色 | 职责 | 模型 |
|------|------|------|------|
| `code` | 阿贝多 | 代码实现、重构 | deepseek-v4-flash |
| `review` | 刻晴 | 代码审查、质量 | deepseek-v4-flash |
| `analysis` | 纳西妲 | 架构分析、模式发现 | deepseek-v4-flash |
| `meta` | 甘雨 | 任务规划、重规划 | deepseek-v4-pro |
| `strategist` | 钟离 | 战略评估、契约守护 | deepseek-v4-pro |
| `ops` | 北斗 | 构建、CI、部署 | deepseek-v4-flash |
| `loop` | 莫娜 | 模式扫描、技能提取 | deepseek-v4-flash |
| `doc-govern` | 凝光 | 文档治理、合规审计 | deepseek-v4-flash |
| `fix` | 希格雯 | Bug 诊断、修复 | deepseek-v4-flash |
| `api` | 久岐忍 | API 设计、契约验证 | deepseek-v4-flash |
| `data` | 艾尔海森 | 数据建模、迁移 | deepseek-v4-flash |
| `inspector` | 安柏 | 侦察、信息收集 | deepseek-v4-flash |
| `browser` | 宵宫 | UI 验证、浏览器操作 | deepseek-v4-flash |
| `butler` | 昔涟 | 用户交互、管家 | deepseek-v4-flash |

### 5.2 Agent 调度流程

当一个任务进入系统，调度引擎按以下流程执行：

```
1. Scheduler 接收任务
2. TopologicalSort → 拆解为 DAG 子任务
3. AgentPool 按 tags 匹配 Agent
4. Dispatch Pipeline:
   a. ClaimStep — 认领任务节点
   b. SpawnStep — 启动 Agent 实例（受 mHC 流形约束）
   c. ExecuteStep — Agent 执行（ReAct 循环）
   d. BoundaryGuardStep — 检查边界违规
   e. CleanupStep — 释放资源
5. 失败时 ReplanManager 触发重规划
6. 全部完成后返回 ExecutionReport
```

### 5.3 Agent 配置

Agent 配置在 `cortex-agents.json` 中定义。核心字段：

```json
{
  "agents": {
    "albedo": {
      "type": "code",
      "model": "deepseek-v4-flash",
      "tags": ["code", "implementation", "refactor"],
      "toolPermissions": ["read_file", "write_file", "search_code", "run_shell"],
      "memoryQueryStrategy": "code",
      "systemPromptFile": "prompts/albedo/system.md"
    }
  }
}
```

### 5.4 自定义 Agent

可通过以下方式扩展 Agent：

1. **添加提示词** — 在 `prompts/<name>/` 下创建 `system.md` 和 `roundtable.md`
2. **注册到 cortex-agents.json** — 添加 Agent 配置条目
3. **实现 Agent 类** — 在 `packages/engine/src/agents/` 下实现（需重启构建）

---

## 六、技能系统

### 6.1 技能概述

技能（Skill）是从 Agent 执行经验中提取的可复用模板，存储在 `skills/` 目录下。

每个技能是一个 JSON 文件，定义执行步骤、输入输出和合规条件。

### 6.2 技能生命周期

```
执行输出 → 模式提取（莫娜） → 技能结晶 → 固化到记忆库 → 被其他 Agent 复用
```

### 6.3 技能文件结构

```json
{
  "id": "skill-p10-ci-gate-full-cycle",
  "name": "CI 门禁全流程",
  "description": "执行完整的 CI 门禁：构建 → 类型检查 → 测试 → Lint",
  "steps": [
    { "action": "build", "description": "构建所有包" },
    { "action": "typecheck", "description": "类型检查" },
    { "action": "test", "description": "运行测试" },
    { "action": "lint", "description": "代码检查" }
  ]
}
```

### 6.4 技能相关命令

```bash
# 技能结晶（莫娜执行）
/switch 莫娜
# 莫娜会自动分析执行记录并提取模式

# 列出所有可用技能
ls skills/
```

---

## 七、治理与审计

### 7.1 宪法体系

Cortex 内置宪法体系，定义项目治理的六条不可变原则：

1. **每个组件可替换** — 接口优先于实现
2. **可验证** — 所有行为有测试覆盖
3. **安全边界** — 工具调用层统一管控
4. **职责清晰** — 包边界明确
5. **可观测事件走统一管道** — PipelineObserver
6. **无循环依赖** — 依赖图严格 DAG

### 7.2 自审视

```bash
# 软约束自审视（推荐在提交前运行）
pnpm self-exam

# 圆桌共识会议（治理层决策）
pnpm roundtable

# 查看宪法内容
npx tsx scripts/show-constitution.ts
```

### 7.3 健康诊断

```bash
# 使用 CLI 的健康诊断
node packages/cli/dist/main.js doctor

# 或直接使用 @cortex/doctor
npx tsx -e "
  import { doctor } from '@cortex/doctor';
  const result = await doctor();
  console.log(JSON.stringify(result, null, 2));
"
```

诊断内容：
- `package.json` 字段合规检查
- `PACKAGE_POSITIONING.md` 存在性检查
- 测试文件首行 `// @ci:` 标注合规检查
- 健康评分与改进建议

### 7.4 审计轨迹

所有 Agent 行为通过以下途径可追溯：

1. **PipelineObserver 事件** — 调度生命周期事件
2. **@cortex/telemetry** — 运行时遥测数据采集
3. **FSM HistoryRecorder** — 状态机变迁全量记录
4. **MemoryStore** — 记忆存取记录

---

## 八、开发指南

### 8.1 项目结构速查

```
cortex/
├── packages/           # 21 个 npm 包
│   ├── engine/         # 运行时内核（核心）
│   ├── cli/            # TUI 终端
│   ├── scheduler/      # 调度引擎
│   └── ...
├── prompts/            # 角色提示词（17 个角色）
├── skills/             # 技能定义（22 个技能）
├── scripts/            # 构建/CI/工具脚本
├── docs/               # 宪法/审计/设计文档
├── cortex-agents.json  # Agent 注册表
└── cortex-cognition.json # 认知配置
```

### 8.2 开发工作流

```bash
# 1. 安装依赖
pnpm install

# 2. 构建依赖包（先构建底层包）
pnpm --filter @cortex/shared build
pnpm --filter @cortex/config build
pnpm --filter @cortex/llm build
pnpm --filter @cortex/engine build

# 3. 监听模式（开发）
pnpm --filter @cortex/engine dev

# 4. 运行测试
pnpm --filter @cortex/engine test:watch

# 5. 提交前运行 CI 门禁
pnpm ci
```

### 8.3 新增包流程

```bash
# 1. 创建包目录
mkdir packages/my-package
cd packages/my-package

# 2. 初始化 package.json
# 遵循命名规范: @cortex/<name>

# 3. 创建 PACKAGE_POSITIONING.md
# 说明：一句话定位、解决的问题、上下游关系、不做的事

# 4. 创建源代码
mkdir src
touch src/index.ts

# 5. 配置 TypeScript
# 创建 tsconfig.json（extends ../../tsconfig.base.json）

# 6. 在 workspace 中注册
# pnpm-workspace.yaml 已包含 "packages/*"

# 7. 构建并测试
pnpm --filter @cortex/my-package build
pnpm --filter @cortex/my-package test
```

### 8.4 编码规范

- TypeScript strict 模式
- 禁止 `any` 类型
- 禁止非空断言（`!`）
- 禁止裸 `console.log`（使用 PipelineObserver 或 telemetry）
- 导入排序：Node 内置 → `@cortex/*` → 同包相对导入
- 接口优先于实现
- 公开 API 最小化

### 8.5 测试规范

- 测试文件放在包内的 `tests/` 目录
- 首行标注 `// @ci: unit|llm|integration|e2e|manual`
- 单元测试覆盖正常路径、边界条件、异常场景
- CI 门禁要求测试全绿

---

## 九、故障排除

### 9.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| `pnpm build` 失败 | TypeScript 编译错误 | 运行 `pnpm typecheck` 定位错误 |
| TUI 无法启动 | API Key 未配置 | 检查 `.env` 文件中的 DEEPSEEK_CYRENE |
| Agent 无响应 | LLM 调用超时 | 检查网络连接和 API Key 余额 |
| 测试失败 | 依赖包未构建 | 先 `pnpm build` 再 `pnpm test` |
| 包找不到 | 未安装/未构建 | `pnpm install && pnpm --filter <pkg> build` |
| 类型错误 | 类型定义不匹配 | 运行 `pnpm typecheck` 检查 |

### 9.2 诊断命令

```bash
# 健康诊断
node packages/cli/dist/main.js doctor

# 检查包状态
pnpm list --depth 0

# 查看依赖图（需要 graphviz）
pnpm list --graph

# 查看构建输出
ls packages/engine/dist/

# 检查环境变量
npx tsx -e "console.log(process.env.DEEPSEEK_CHAT ? 'SET' : 'NOT SET')"

# 清理并重装
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm build
```

### 9.3 获取帮助

- 项目宪法：`docs/constitution/`
- 架构设计：`DESIGN.md`
- 包定位：`PACKAGE_POSITIONING.md`（根级别）+ 各包下的 `PACKAGE_POSITIONING.md`
- CI 配置：`scripts/ci-gate.ts`

---

> **文档维护**: 本文档应与项目实际行为保持一致。发现不一致时，请提交 Issue 或 PR 更新。
