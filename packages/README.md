# Cortex 包依赖拓扑

## 层级结构

基础层（零依赖）
  shared ← config
    ↓
核心层（依赖基础层）
  engine ← memory ← memory-store ← scheduler
  llm ← platform ← notification ← resilience
    ↓
能力层（依赖核心层）
  skill-kit ← prompt-kit ← consistency ← governance
  fsm-compiler ← parser ← pattern-extractor
    ↓
适配器层（依赖能力层）
  plugin-runner ← telemetry ← logging ← testing
  context-manager ← tools ← doctor
    ↓
接口层（依赖所有下层）
  cli ← tui

## 关键规则
- shared 持有类型接口（不可变核心契约）
- config 持有运行时词汇表与注册器（可扩展调度信号）
- engine 持有执行引擎（Agent 调度 + 插件系统）
- 禁止下层依赖上层
