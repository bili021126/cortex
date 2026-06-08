// @ci: unit
// ============================================================
// @cortex/telemetry —— ConsoleCollector 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConsoleCollector } from "../src/index.js";
import type { TelemetryData } from "../src/index.js";

function createTestData(overrides?: Partial<TelemetryData>): TelemetryData {
  return {
    id: overrides?.id ?? "test-id-001",
    name: overrides?.name ?? "test.metric",
    value: overrides?.value ?? 42,
    tags: overrides?.tags ?? [{ key: "env", value: "test" }],
    timestamp: overrides?.timestamp ?? Date.now(),
    metadata: overrides?.metadata,
  };
}

describe("ConsoleCollector", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* suppress console output during tests */
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create with default name", () => {
      const collector = new ConsoleCollector();
      expect(collector.name).toBe("console");
    });

    it("should create with custom name", () => {
      const collector = new ConsoleCollector("my-collector");
      expect(collector.name).toBe("my-collector");
    });

    it("should create with json format option", () => {
      const collector = new ConsoleCollector("json-collector", { format: "json" });
      expect(collector.name).toBe("json-collector");
    });
  });

  describe("collect", () => {
    it("should accept a valid telemetry data point", async () => {
      const collector = new ConsoleCollector();
      const data = createTestData();
      const result = await collector.collect(data);
      expect(result.accepted).toBe(true);
    });

    it("should output to console.log in pretty format by default", async () => {
      const collector = new ConsoleCollector("pretty", { format: "pretty" });
      const data = createTestData({ name: "test.metric", value: 42 });

      await collector.collect(data);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("[telemetry]");
      expect(output).toContain("test.metric");
      expect(output).toContain("42");
      expect(output).toContain("env=test");
    });

    it("should output JSON when format is json", async () => {
      const collector = new ConsoleCollector("json", { format: "json" });
      const data = createTestData({ name: "test.metric", value: 100 });

      await collector.collect(data);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.name).toBe("test.metric");
      expect(parsed.value).toBe(100);
      expect(parsed.id).toBe(data.id);
    });

    it("should handle tags display in pretty format", async () => {
      const collector = new ConsoleCollector("tagged", { format: "pretty" });
      const data = createTestData({
        name: "test.with.tags",
        value: 7,
        tags: [
          { key: "env", value: "production" },
          { key: "region", value: "us-east-1" },
        ],
      });

      await collector.collect(data);

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("env=production");
      expect(output).toContain("region=us-east-1");
    });

    it("should include metadata in pretty format when present", async () => {
      const collector = new ConsoleCollector("meta", { format: "pretty" });
      const data = createTestData({
        name: "test.with.metadata",
        value: 1,
        metadata: { source: "test-suite", attempt: 3 },
      });

      await collector.collect(data);

      const output = consoleSpy.mock.calls[0][0] as string;
      expect(output).toContain("meta:");
      expect(output).toContain("test-suite");
    });

    it("should reject data after shutdown", async () => {
      const collector = new ConsoleCollector();
      await collector.shutdown();

      const data = createTestData();
      const result = await collector.collect(data);
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain("shut down");
    });
  });

  describe("flush", () => {
    it("should be a no-op (synchronous collector)", async () => {
      const collector = new ConsoleCollector();
      await expect(collector.flush()).resolves.toBeUndefined();
    });
  });

  describe("shutdown", () => {
    it("should be idempotent", async () => {
      const collector = new ConsoleCollector();
      await collector.shutdown();
      await expect(collector.shutdown()).resolves.toBeUndefined();
    });

    it("should prevent further collection", async () => {
      const collector = new ConsoleCollector();
      await collector.shutdown();

      const data = createTestData();
      const result = await collector.collect(data);
      expect(result.accepted).toBe(false);
    });
  });
});
