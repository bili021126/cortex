// @ci: setup — 全局 resilience + isTTY mock，避免测试中 "No resilience policies registered" 错误
import { resilienceFactory } from "../src/execution/resilience-integration.js";

// Mock stdin.isTTY=true — ConfirmGate 测试需要交互终端环境
Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });

resilienceFactory.registerPolicies("llm-call", {
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  circuitBreaker: { threshold: 9999, halfOpenAfterMs: 100 },
  timeout: { timeoutMs: 10_000 },
});

resilienceFactory.registerPolicies("tool-exec", {
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  circuitBreaker: { threshold: 9999, halfOpenAfterMs: 100 },
  timeout: { timeoutMs: 10_000 },
});

resilienceFactory.registerPolicies("memory-write", {
  retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
  circuitBreaker: { threshold: 9999, halfOpenAfterMs: 100 },
  timeout: { timeoutMs: 5_000 },
});
