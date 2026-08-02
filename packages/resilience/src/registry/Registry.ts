/**
 * Registry 相关符号桶（2026-06-20 RES-1 拆分后保留——index.ts 导出面不变）。
 */

export { CircuitState, ResilienceEvent, IRetryPolicy, ICircuitBreaker, ITimeoutPolicy, TimeoutResult, CircuitBreakerOpenError, TimeoutError } from "./registry.types.js";
export { ResilienceContext, ResilienceContextManager } from "./registry.context.js";
export { IResilienceRegistry, Registry } from "./registry.impl.js";
