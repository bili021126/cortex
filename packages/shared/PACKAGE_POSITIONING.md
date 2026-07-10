# @cortex/shared — 包定位

## 层级
基础层（Foundation）— 零依赖环，被全项目引用

## 核心职责
- 类型定义与枚举（AgentType、SemanticState、MemoryKind、LinkType 等）
- 接口协议（IMemoryStore、ILifecycle、IPipelineObserver、SafeErrorReporter 等）
- 状态转换表（MEMORY_VALID_TRANSITIONS）单一事实来源
- 工具函数（ID 生成、JSON 工具、文件锁等）
- 常量与配置映射（PipelineEventType、PipelinePriority）

## 依赖
- @cortex/config — 配置类型引用

## 被依赖
- @cortex/engine
- @cortex/memory-store
- @cortex/config
- @cortex/cli
- @cortex/tui
- @cortex/governance
- @cortex/memory
- @cortex/scheduler
- 及其他所有 @cortex/* 包
