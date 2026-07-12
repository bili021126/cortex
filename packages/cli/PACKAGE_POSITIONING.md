# @cortex/cli

## 定位
命令行入口层——提供 `cortex` 命令树，负责命令路由、参数解析、用户交互编排，桥接底层引擎与服务。

## 上游依赖
- @cortex/config
- @cortex/engine
- @cortex/shared
- @cortex/memory-store
- @cortex/governance
- @cortex/platform
- @cortex/scheduler
- @cortex/doctor
- @cortex/llm
- @cortex/parser
- @cortex/prompt-kit
- @cortex/skill-kit
- @cortex/tools
- @cortex/tui

## 下游消费者
- 用户直接使用（交互入口）

## 接口契约
- `runCli()` — CLI 主入口
- `CommandRegistry` — 命令注册与路由
- `ConfigManager` — CLI 端配置管理
- `EngineBridge` — CLI ↔ Engine 桥接
- `SlashCommandParser` — 斜杠命令解析（Core-2）
- 各类命令处理器：createRunHandler / createAgentHandler / createTaskHandler / createMemoryHandler / createConfirmHandler / createScheduleHandler / createSetupHandler / createHelpHandler / createVersionHandler / createConfigHandler / createDocHandler / createSkillHandler / createInspectHandler / createDoctorHandler / createRoundtableHandler
- `getFormatter` / `detectDefaultFormat` — 输出格式器

## 不做什么
- 不执行 Agent 逻辑（委托 @cortex/engine）
- 不管理记忆存储（委托 @cortex/memory-store）
- 不调度任务管线（委托 @cortex/scheduler）
- 不运行诊断逻辑（委托 @cortex/doctor）
# @cortex/cli — 包定位

## 层级
接口层（Interface）— 命令行入口

## 核心职责
- 命令行界面（cortex 命令树）
- 命令路由与参数解析
- 用户交互入口（init、run、memory、skill 等子命令）

## 依赖
- @cortex/config
- @cortex/engine
- @cortex/shared
- @cortex/memory-store
- @cortex/governance
- @cortex/platform
- @cortex/scheduler
- @cortex/doctor
- @cortex/llm
- @cortex/parser
- @cortex/prompt-kit
- @cortex/skill-kit
- @cortex/tools
- @cortex/tui

## 被依赖
- 用户直接使用（无包内消费方）
