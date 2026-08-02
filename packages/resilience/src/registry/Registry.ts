/**
 * Registry 相关符号桶（2026-06-20 RES-1 拆分后保留——index.ts 导出面不变）。
 */

export type { CircuitState, ResilienceEvent, IRetryPolicy, ICircuitBreaker, ITimeoutPolicy, TimeoutResult } from "./registry.types.js";
export { CircuitBreakerOpenError, TimeoutError } from "./registry.types.js";
export type { ResilienceContext } from "./registry.context.js";
export { ResilienceContextManager } from "./registry.context.js";
export type { IResilienceRegistry } from "./registry.impl.js";
export { Registry } from "./registry.impl.js";
