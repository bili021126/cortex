# @cortex/memory-store — 包定位

## 层级
适配器层（Adapter）— 桥接 engine 与 memory 后端

## 核心职责
- MemoryStore 适配器实现（IMemoryStore + ILifecycle）
- Embedding 生成与缓存（384d ONNX）
- 两阶段提交（writePending / commitMemory / rollback）
- 混合检索（BM25 + 向量）
- 权重老化与 maintain 维护
- 去重（content_hash SHA256 + 向量去重）

## 依赖
- @cortex/config
- @cortex/shared
- @cortex/memory（存储核心：InMemoryMemoryStore / FileBasedMemoryStore）
- @cortex/fsm-compiler
- @cortex/llm

## 被依赖
- @cortex/engine
- @cortex/cli
- @cortex/platform
