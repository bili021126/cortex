// ============================================================
// @cortex/resilience —— 韧性策略统一抽象层
//
// @file-overview
// 桶导出（barrel）文件，统一导出所有公开 API。
// 所有外部消费者应从 `@cortex/resilience` 导入，而非深路径。
//
// @design 详见 DESIGN.md §8.2「桶导出」
// ============================================================
// ── 错误类型 ──
export { CircuitBreakerOpenError, TimeoutError, } from './registry/Registry.js';
// ── 编排层 ──
export { Registry, ResilienceContextManager, } from './registry/Registry.js';
// ── 实现层：重试 ──
export { ExponentialBackoff } from './retry/ExponentialBackoff.js';
export { FixedRetry } from './retry/FixedRetry.js';
// ── 实现层：断路器 ──
export { SimpleCircuitBreaker } from './circuit-breaker/SimpleCircuitBreaker.js';
export { StateMachineCircuitBreaker } from './circuit-breaker/StateMachineCircuitBreaker.js';
// ── 实现层：超时 ──
export { FixedTimeout } from './timeout/FixedTimeout.js';
export { AdaptiveTimeout } from './timeout/AdaptiveTimeout.js';
//# sourceMappingURL=index.js.map