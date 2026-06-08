// @ci: unit
// ============================================================
// @cortex/telemetry —— Sampler 策略单元测试
// ============================================================

import { describe, it, expect } from "vitest";
import { RateSampler, ThresholdSampler } from "../src/index.js";
import type { TelemetryData } from "../src/index.js";

function createTestData(overrides?: Partial<TelemetryData>): TelemetryData {
  return {
    id: overrides?.id ?? "test-id-001",
    name: overrides?.name ?? "test.metric",
    value: overrides?.value ?? 42,
    tags: overrides?.tags ?? [],
    timestamp: overrides?.timestamp ?? Date.now(),
    metadata: overrides?.metadata,
  };
}

// ─── RateSampler ──────────────────────────────────

describe("RateSampler", () => {
  describe("constructor", () => {
    it("should create with valid rate", () => {
      const sampler = new RateSampler(0.5);
      expect(sampler.name).toBe("rate");
    });

    it("should create with custom name", () => {
      const sampler = new RateSampler(0.5, "my-rate");
      expect(sampler.name).toBe("my-rate");
    });

    it("should accept rate = 0 (drop all)", () => {
      const sampler = new RateSampler(0);
      expect(sampler.name).toBe("rate");
    });

    it("should accept rate = 1 (accept all)", () => {
      const sampler = new RateSampler(1);
      expect(sampler.name).toBe("rate");
    });

    it("should throw for negative rate", () => {
      expect(() => new RateSampler(-0.1)).toThrow("between 0 and 1");
    });

    it("should throw for rate > 1", () => {
      expect(() => new RateSampler(1.5)).toThrow("between 0 and 1");
    });
  });

  describe("decide", () => {
    it("should reject all when rate = 0", () => {
      const sampler = new RateSampler(0);
      const data = createTestData();

      const decision = sampler.decide(data);
      expect(decision.accept).toBe(false);
    });

    it("should accept all when rate = 1", () => {
      const sampler = new RateSampler(1);
      const data = createTestData();

      const decision = sampler.decide(data);
      expect(decision.accept).toBe(true);
    });

    it("should produce deterministic results for same ID", () => {
      const sampler = new RateSampler(0.5);
      const data = createTestData({ id: "deterministic-id" });

      const decision1 = sampler.decide(data);
      const decision2 = sampler.decide(data);

      expect(decision1.accept).toBe(decision2.accept);
      expect(decision1.reason).toBe(decision2.reason);
    });

    it("should provide reason string in decision", () => {
      const sampler = new RateSampler(0.5);
      const data = createTestData();

      const decision = sampler.decide(data);
      expect(decision.reason).toContain("RateSampler");
      expect(decision.reason).toContain("rate=0.5");
    });

    it("should accept roughly rate proportion of data over many IDs", () => {
      const sampler = new RateSampler(0.3);
      const totalIds = 10_000;
      let accepted = 0;

      for (let i = 0; i < totalIds; i++) {
        const data = createTestData({ id: `id-${i}` });
        if (sampler.decide(data).accept) {
          accepted++;
        }
      }

      // Allow 2% tolerance
      const rate = accepted / totalIds;
      expect(rate).toBeGreaterThan(0.28);
      expect(rate).toBeLessThan(0.32);
    });
  });
});

// ─── ThresholdSampler ─────────────────────────────

describe("ThresholdSampler", () => {
  describe("constructor", () => {
    it("should create with threshold and default mode (gt)", () => {
      const sampler = new ThresholdSampler(100);
      expect(sampler.name).toBe("threshold");
    });

    it("should create with threshold and custom mode", () => {
      const sampler = new ThresholdSampler(100, "lt");
      expect(sampler.name).toBe("threshold");
    });

    it("should create with custom name", () => {
      const sampler = new ThresholdSampler(100, "gt", "my-threshold");
      expect(sampler.name).toBe("my-threshold");
    });
  });

  describe("decide (mode = gt)", () => {
    it("should accept when value > threshold", () => {
      const sampler = new ThresholdSampler(100, "gt");
      const data = createTestData({ value: 150 });

      const decision = sampler.decide(data);
      expect(decision.accept).toBe(true);
    });

    it("should reject when value <= threshold", () => {
      const sampler = new ThresholdSampler(100, "gt");
      const dataBelow = createTestData({ value: 50 });
      const dataEqual = createTestData({ value: 100 });

      expect(sampler.decide(dataBelow).accept).toBe(false);
      expect(sampler.decide(dataEqual).accept).toBe(false);
    });

    it("should provide meaningful reason", () => {
      const sampler = new ThresholdSampler(100, "gt");
      const data = createTestData({ value: 200 });

      const decision = sampler.decide(data);
      expect(decision.reason).toContain("200 > 100");
    });
  });

  describe("decide (mode = lt)", () => {
    it("should accept when value < threshold", () => {
      const sampler = new ThresholdSampler(100, "lt");
      const data = createTestData({ value: 50 });

      const decision = sampler.decide(data);
      expect(decision.accept).toBe(true);
    });

    it("should reject when value >= threshold", () => {
      const sampler = new ThresholdSampler(100, "lt");
      const dataEqual = createTestData({ value: 100 });
      const dataAbove = createTestData({ value: 150 });

      expect(sampler.decide(dataEqual).accept).toBe(false);
      expect(sampler.decide(dataAbove).accept).toBe(false);
    });

    it("should provide meaningful reason", () => {
      const sampler = new ThresholdSampler(50, "lt");
      const data = createTestData({ value: 10 });

      const decision = sampler.decide(data);
      expect(decision.reason).toContain("10 < 50");
    });
  });

  describe("edge cases", () => {
    it("should handle zero threshold", () => {
      const sampler = new ThresholdSampler(0, "gt");
      const positive = createTestData({ value: 1 });
      const zero = createTestData({ value: 0 });
      const negative = createTestData({ value: -1 });

      expect(sampler.decide(positive).accept).toBe(true);
      expect(sampler.decide(zero).accept).toBe(false);
      expect(sampler.decide(negative).accept).toBe(false);
    });

    it("should handle negative threshold", () => {
      const sampler = new ThresholdSampler(-10, "lt");
      const below = createTestData({ value: -20 });
      const above = createTestData({ value: 0 });

      expect(sampler.decide(below).accept).toBe(true);
      expect(sampler.decide(above).accept).toBe(false);
    });

    it("should handle large values consistently", () => {
      const sampler = new ThresholdSampler(1_000_000, "gt");
      const large = createTestData({ value: 9_999_999 });
      const small = createTestData({ value: 1 });

      expect(sampler.decide(large).accept).toBe(true);
      expect(sampler.decide(small).accept).toBe(false);
    });
  });
});
