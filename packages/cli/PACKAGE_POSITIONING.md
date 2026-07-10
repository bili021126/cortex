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
