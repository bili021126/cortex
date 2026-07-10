# @cortex/engine — 包定位

## 层级
核心层（Core）— 执行中枢

## 核心职责
- 执行引擎（Agent 工厂、ReAct 循环、引导启动）
- Agent 注册与调度（AgentRegistry、MetaAgent、WorkerAgent）
- 技能提取与执行（skill-extractor、skill-persister、skill-template-engine）
- 引导启动（bootstrap-engine、init-skills）
- Inspector 自检与事实采集

## 依赖
- @cortex/config
- @cortex/shared
- @cortex/memory-store
- @cortex/scheduler
- @cortex/llm
- @cortex/platform
- @cortex/governance
- @cortex/consistency
- @cortex/context-manager
- @cortex/logging
- @cortex/memory
- @cortex/notification
- @cortex/pattern-extractor
- @cortex/plugin-runner
- @cortex/prompt-kit
- @cortex/resilience
- @cortex/skill-kit
- @cortex/telemetry

## 被依赖
- @cortex/cli
- @cortex/tui
