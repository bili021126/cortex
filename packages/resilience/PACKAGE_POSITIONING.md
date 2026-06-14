# @cortex/resilience — 包定位文档

> **版本**: v0.1.0  
> **状态**: 设计中  
> **更新日期**: 2026-06  
> **治理关联**: 宪法 §五（补足声明）、§十五·四（包职责边界）

---

## 目录

1. [补足内容：填补了什么空白](#1-补足内容填补了什么空白)
2. [定位：在 Cortex 生态中扮演什么角色](#2-定位在-cortex-生态中扮演什么角色)
3. [价值：带来什么收益](#3-价值带来什么收益)
4. [宪法一致性](#4-宪法一致性)

---

## 1. 补足内容：填补了什么空白

### 1.1 现状：韧性代码的「散装」困局

在 `@cortex/resilience` 出现之前，Cortex 全仓的韧性代码分布如下：

| 位置 | 实现方式 | 问题 |
|------|---------|------|
| `packages/llm/src/llm-adapter.ts` | 内联 `_fetchWithRetry` + 硬编码指数退避 | 与 llm 包耦合，其他包无法复用 |
| `packages/platform/src/search-backend.ts` | 内联 `_delay` 线性退避 | 重复实现，逻辑重复 |
| `packages/engine/src/mcp-client.ts` | `AbortSignal.timeout(15000)` 硬编码 | 不可配置、不可替换 |
| `packages/engine/src/plugin-runner.ts` | `_withTimeout()` 用 `Promise.race` | 每包各写各的，无统一抽象 |
| `packages/scheduler/src/replan-manager.ts` | 类断路器行为（上限计数） | 仅有熔断概念，无独立断路器实现 |
| `packages/llm/src/__tests__/circuit-breaker.test.ts` | 断路器仅有测试用例 | 无生产实现（Core-2 计划悬空） |
| `packages/llm/src/chat-stream.ts` | 无重试 | 已知保护缺口 |
| 其余各处 | 11 处分散超时（`AbortSignal.timeout` / `Promise.race` / `setTimeout` 混用） | 无法统一治理和监控 |

**核心空白**：全仓**没有**一个可复用的韧性策略抽象层——重试逻辑重复 4+ 处、超时机制分散 11 处、断路器有测试无实现、策略无法编排组合。

### 1.2 填补了什么

`@cortex/resilience` 填补了以下空白：

| 空白 | 填补方式 | 交付物 |
|------|---------|--------|
| **无统一重试抽象** | `IRetryPolicy` 接口 + 4 种内置实现 | 可复用重试策略 |
| **无断路器生产实现** | `ICircuitBreaker` 接口 + 2 种内置实现 + `CircuitBreakerOpenError` | 生产级熔断保护 |
| **无统一超时抽象** | `ITimeoutPolicy` 接口 + 3 种内置实现 | 可替换超时机制 |
| **无策略编排能力** | `ResilienceRegistry` + 组合执行 `execute()` | 声明式韧性组合 |
| **无韧性事件监控** | `onEvent()` + 11 种事件类型 | 可观测性基础 |
| **无测试虚拟时间** | `TimeProvider` / `VirtualTimeProvider` | 可控的韧性测试 |
| **无自适应超时算法** | `AdaptiveTimeoutPolicy`（EMA 指数移动平均） | 适应 LLM 延迟波动 |
| **无空闲策略占位** | `NoRetry` / `NoBreaker` / `NoTimeout`（Null Object 模式） | 统一接口调用，消除判空 |

### 1.3 不填补什么（明确边界）

- ❌ 不填补限流（Rate Limiting）—— `@cortex/llm` 的 `RateLimiter` + `ManifoldGate` 已覆盖
- ❌ 不填补降级（Degradation）—— `SafeErrorReporter` / 业务回退已覆盖
- ❌ 不填补优雅关闭（Graceful Shutdown）—— `ShutdownWarden` / `LifecycleManager` 已覆盖
- ❌ 不填补错误隔离（Error Isolation）—— `PluginRunner` / `PipelineObserver` 已覆盖
- ❌ 不填补缓存（Cache）—— `LlmAdapter` LRU 缓存已覆盖
- ❌ 不填补健康检查 API—— `@cortex/telemetry` 计划补充

---

## 2. 定位：在 Cortex 生态中扮演什么角色

### 2.1 一句话定位

**`@cortex/resilience` 是 Cortex 生态的韧性策略统一抽象层**——位于 Layer 1（引擎/调度层），为全仓提供重试、断路器、超时三大韧性模式的接口定义、内置实现和注册编排管理。

### 2.2 在四层架构中的位置

```
Layer 3: 交互/技能层 (cli / skill-kit / prompt-kit ...)
     ↑ 调用
Layer 1: 引擎/调度层
     ├── @cortex/engine         ← 运行时内核
     ├── @cortex/scheduler      ← 调度引擎
     ├── @cortex/llm            ← LLM 适配器
     ├── @cortex/plugin-runner  ← 插件运行器
     ├── @cortex/factory        ← 工厂抽象
     └── ★ @cortex/resilience   ← 韧性策略统一抽象（本包）
     ↑ 调用
Layer 2: 校验/治理层 (doctor / policy-validator / telemetry ...)
     ↑ 继承/引用
Layer 0: 类型/配置层 (shared / config / tools)
```

**定位特征**：
- **Layer 1 成员**：与 engine、scheduler、llm 同层，被这些包消费
- **零运行时依赖**：不使用 `@cortex/shared` 或 `@cortex/config` 的运行时代码，保持可移植性
- **跨层消费**：任何层级的包都可引入（纯 TypeScript，无运行时包袱）
- **非侵入式**：不修改现有包的接口，通过「注册 → 执行」模式松耦合集成

### 2.3 在 Core-2 路线图中的位置

```
Core-1 已落地:  Retry(分散) + Timeout(分散) + 类断路器(ReplanManager上限)
                    │
                    ▼
Core-1.5 本包:  RetryPolicy统一 + CircuitBreaker独立 + TimeoutPolicy统一 + Registry编排
                    │
                    ▼
Core-2 规划:    IncidentEscalator + ContractEnforcer + Health Check API
```

本包是 Core-1 → Core-2 的桥梁：统一现有分散实现，为 Core-2 的高级韧性能力奠定基础。

### 2.4 与关键包的关系

```
@cortex/resilience
  │
  ├── 消费方
  │   ├── @cortex/llm        ← llm-adapter 的 _fetchWithRetry 替换为目标
  │   ├── @cortex/engine     ← mcp-client / plugin-runner 超时替换为目标
  │   ├── @cortex/scheduler  ← ReplanManager 断路器替换为目标
  │   └── @cortex/cli        ← CLI 操作的超时保护
  │
  └── 不依赖（运行时）
      ├── @cortex/shared     ← 不使用 shared 的运行时类型
      ├── @cortex/config     ← 配置由调用方传入，不依赖 config 包
      └── @cortex/telemetry  ← 事件通过 onEvent 回调暴露，不直接依赖 telemetry
```

### 2.5 与其他同类包的差异

| 对比维度 | @cortex/resilience | 通用重试库（如 retry/async-retry） |
|---------|-------------------|----------------------------------|
| 覆盖模式 | 重试 + 断路器 + 超时 | 仅重试 |
| 策略编排 | `ResilienceRegistry.execute()` 声明式组合 | 无编排能力 |
| 断路器 | 2 种内置实现 + Null Object | 无 |
| 自适应超时 | EMA 动态调整 | 无 |
| 可观测性 | 11 种事件类型 + 快照 | 无 |
| 测试工具 | 虚拟时间提供者 | 无 |
| 零依赖 | ✅ 纯 TypeScript，无运行时依赖 | 通常有外部依赖 |

---

## 3. 价值：带来什么收益

### 3.1 直接收益

| 收益 | 量化预期 | 说明 |
|------|---------|------|
| **消除代码重复** | 减少 4+ 处重复重试代码、11 处分散超时 | 一处定义，处处复用 |
| **填补断路器缺口** | 从 0 到 2 个生产级实现 | Core-2 能力提前落地 |
| **降低集成成本** | 新包引入韧性保护 ≤ 10 行配置 | `registry.register()` + `registry.execute()` |
| **提升可测试性** | 策略可 mock，虚拟时间支持 | 不再需要 mock 网络/时间 |
| **增强可观测性** | 全韧性事件可监听 | `onEvent()` 订阅 11 种事件类型 |
| **标准化治理** | 所有韧性行为走统一接口 | 宪法 §十五·四 包职责边界落地 |

### 3.2 量化评估

| 指标 | 当前状态 | 引入本包后 | 改善幅度 |
|------|---------|-----------|---------|
| 重试实现重复数 | 4+ 处 | 1 处（接口定义） | -75%+ |
| 超时机制种类 | 3 种（AbortSignal/Promise.race/setTimeout） | 1 种（ITimeoutPolicy） | -66% |
| 断路器生产实现 | 0 个 | 2 个 | ∞ |
| 新包添加韧性保护 | 需手动重写 | ≤ 10 行配置 | ~95% 简化 |
| 韧性测试覆盖 | 各包自测，重复造轮 | 复用虚拟时间 + 内置测试 | ~60% 测试代码减少 |

### 3.3 长期战略价值

1. **韧性能力平台化**：任何新包只需 `registry.register('my-service', {...})` 即可获得完整的重试+熔断+超时保护
2. **统一治理**：通过 `onEvent()` 可集中采集全仓韧性事件，纳入 `@cortex/telemetry` 监控
3. **渐进迁移**：旧代码无需一次性重写，可逐包迁移（search-backend → mcp-client → llm-adapter → plugin-runner）
4. **生态扩展**：社区可贡献自定义策略实现（如 `RedisCircuitBreaker`、`MLTimeoutPredictor`）
5. **Core-2 基石**：`IncidentEscalator` 和 `ContractEnforcer` 可复用以 resilience 为基础的事件和状态管理

### 3.4 风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|---------|
| 现有代码迁移阻力 | 中 | 保留旧实现，逐步替换；提供 MIGRATION_GUIDE.md |
| 零依赖限制灵活性 | 低 | 纯 TypeScript 可覆盖 95% 场景；特殊需求通过自定义实现满足 |
| 与 @cortex/scheduler 的 ReplanManager 重复 | 低 | ReplanManager 关注重规划逻辑，CircuitBreaker 关注熔断保护，职责正交 |
| 浏览器兼容性 | 低 | 使用标准 Web API（AbortSignal/AbortController），浏览器原生支持 |

---

## 4. 宪法一致性

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则一** — 每个组件可替换 | 所有核心能力通过接口定义（`IRetryPolicy` / `ICircuitBreaker` / `ITimeoutPolicy`），可实现自定义替换 |
| **原则二** — 可验证 | 每个内置实现有独立测试套件，虚拟时间支持可控测试 |
| **原则三** — 安全边界 | 断路器防止下游被压垮（快速失败），超时防止资源泄漏 |
| **原则四** — 职责清晰 | 本文档明确定义「做的事」与「不做的事」，与限流/降级/关闭等正交 |
| **原则五** — 可观测事件走统一管道 | `ResilienceRegistry.onEvent()` 提供 11 种事件类型，可接入 `PipelineObserver` |
| **原则六** — 无循环依赖 | 本包零运行时依赖，不引入任何循环引用 |
| **§五** — 补足声明 | 本文档 §1 完整分析「填补了什么空白」 |
| **§十五·四** — 包职责独立 | 本包 exports 仅包含接口、实现、编排类，无冗余导出 |

---

> **维护约定**:
> 1. 新增实现时，同步更新 §1 填补内容矩阵和 README.md 的 API 速览
> 2. 依赖关系变更时，同步更新 §2.4 的依赖关系图
> 3. 年度评估 §3 的量化指标，更新收益数据
> 4. 由 `@cortex/doctor` 的 `PositioningDocChecker` 自动化检查本文档存在性
