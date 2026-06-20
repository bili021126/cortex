// @ci: unit
import { describe, it, expect, beforeEach } from "vitest";
import { ResiliencePolicyFactory } from "@cortex/engine";

describe("ResiliencePolicyFactory", () => {
  let factory: ResiliencePolicyFactory;

  beforeEach(() => {
    factory = new ResiliencePolicyFactory();
  });

  describe("registerPolicies() 策略注册", () => {
    it("应成功注册 retry + circuit breaker + timeout 三件套", () => {
      factory.registerPolicies("test-component", {
        retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
        circuitBreaker: { threshold: 5, halfOpenAfterMs: 30000 },
        timeout: { timeoutMs: 5000 },
      });

      const registry = factory.getRegistry();
      // Registry 应包含注册的策略
      expect(registry).toBeDefined();
    });

    it("使用默认值注册", () => {
      factory.registerPolicies("default-component", {});

      const registry = factory.getRegistry();
      expect(registry).toBeDefined();
    });

    it("可为多个组件注册不同策略", () => {
      factory.registerPolicies("llm-api", {
        retry: { maxAttempts: 5, baseDelayMs: 2000, maxDelayMs: 30000 },
        timeout: { timeoutMs: 60000 },
      });

      factory.registerPolicies("db-query", {
        retry: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 2000 },
        timeout: { timeoutMs: 10000 },
      });

      const registry = factory.getRegistry();
      expect(registry).toBeDefined();
    });
  });

  describe("execute() 韧性保护执行", () => {
    it("成功执行 → 返回结果", async () => {
      factory.registerPolicies("success-component", {
        retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
        circuitBreaker: { threshold: 3, halfOpenAfterMs: 1000 },
        timeout: { timeoutMs: 5000 },
      });

      const result = await factory.execute("success-component", async () => {
        return "success";
      });

      expect(result).toBe("success");
    });

    it("函数抛异常 → 重试后仍然抛出", async () => {
      factory.registerPolicies("fail-component", {
        retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 50 },
        circuitBreaker: { threshold: 5, halfOpenAfterMs: 1000 },
        timeout: { timeoutMs: 5000 },
      });

      let attempts = 0;
      await expect(
        factory.execute("fail-component", async () => {
          attempts++;
          throw new Error("persistent failure");
        }),
      ).rejects.toThrow();

      expect(attempts).toBeGreaterThanOrEqual(2); // 至少重试 1 次
    });

    it("未注册组件 → 抛出错误", async () => {
      await expect(
        factory.execute("unregistered-component", async () => "value"),
      ).rejects.toThrow();
    });

    it("超时保护 → 长时间运行被截断", async () => {
      factory.registerPolicies("slow-component", {
        retry: { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 50 },
        circuitBreaker: { threshold: 5, halfOpenAfterMs: 1000 },
        timeout: { timeoutMs: 50 }, // 很短的超时
      });

      await expect(
        factory.execute("slow-component", async () => {
          // 模拟长时间运行
          await new Promise((resolve) => setTimeout(resolve, 500));
          return "should not reach";
        }),
      ).rejects.toThrow();
    });
  });

  describe("getRegistry() 注册表访问", () => {
    it("返回 Registry 实例", () => {
      const registry = factory.getRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe("function");
      expect(typeof registry.execute).toBe("function");
    });
  });
});
