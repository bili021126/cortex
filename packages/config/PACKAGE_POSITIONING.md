# @cortex/config — 包定位

## 层级
基础层（Foundation）— 配置基础设施

## 核心职责
- 配置管理与解析（EngineConfig、CortexConfig）
- 默认配置生成与合并（resolveConfig）
- 常量定义（STALE_FREEZE_DAYS、FROZEN_OBLITERATE_DAYS、EMBEDDING_DIM 等）
- 词汇表与领域词典（vocabularies）

## 依赖
- @cortex/shared — 类型引用

## 被依赖
- @cortex/engine
- @cortex/shared
- @cortex/cli
- @cortex/tui
- @cortex/memory-store
- @cortex/governance
- @cortex/scheduler
