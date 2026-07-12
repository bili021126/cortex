# @cortex/context-manager

## 定位
上下文策略解析层——Phase 3 上下文管理层核心，根据检索场景（RetrievalScene）和人物（PersonaId）解析上下文策略，返回 Token 预算、检索模式、管线配置等已解析上下文。

## 上游依赖
- @cortex/config（ConfigRegistry — 上下文策略注册表）
- @cortex/shared（RetrievalScene, PersonaId 类型）

## 下游消费者
- @cortex/engine（引擎运行时按场景解析上下文策略）

## 接口契约
- `ContextManager` — 上下文管理器，提供 `resolve(input: ContextResolveInput): ResolvedContext`
- `DomainGateController` — C 层域门控（Phase 6）
- `PredictiveEncoder` — 预测编码器（Phase 6 V+M 层）
- `PredictiveRetriever` — 预测检索器（Phase 6 V+M 层）
- `MemoryWorldModel` — 记忆世界模型（Phase 6 V+M 层）
- `ContextResolveInput` / `ResolvedContext` — 输入输出类型

## 不做什么
- 不管理记忆条目存储（委托 @cortex/memory-store）
- 不做向量嵌入与检索（委托 @cortex/memory-store）
- 不调度 Agent / 任务管线（委托 @cortex/engine / @cortex/scheduler）
- 不记录日志与遥测（委托 @cortex/logging / @cortex/telemetry）
