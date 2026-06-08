// @ci: unit
// ============================================================
// @cortex/telemetry —— Batcher 策略单元测试
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { SizeBatcher, TimeBatcher } from "../src/index.js";
import type { TelemetryData } from "../src/index.js";

let idCounter = 0;

function createTestData(overrides?: Partial<TelemetryData>): TelemetryData {
  idCounter++;
  return {
    id: overrides?.id ?? `test-id-${idCounter}`,
    name: overrides?.name ?? "test.metric",
    value: overrides?.value ?? 42,
    tags: overrides?.tags ?? [],
    timestamp: overrides?.timestamp ?? Date.now(),
    metadata: overrides?.metadata,
  };
}

// ─── SizeBatcher ──────────────────────────────────

describe("SizeBatcher", () => {
  describe("constructor", () => {
    it("should create with valid maxSize", () => {
      const batcher = new SizeBatcher(10);
      expect(batcher.name).toBe("size");
    });

    it("should create with custom name", () => {
      const batcher = new SizeBatcher(10, "my-size");
      expect(batcher.name).toBe("my-size");
    });

    it("should throw when maxSize < 1", () => {
      expect(() => new SizeBatcher(0)).toThrow("maxSize must be >= 1");
      expect(() => new SizeBatcher(-1)).toThrow("maxSize must be >= 1");
    });
  });

  describe("add", () => {
    it("should return undefined when buffer is below maxSize", () => {
      const batcher = new SizeBatcher(5);

      const result = batcher.add(createTestData());
      expect(result).toBeUndefined();
    });

    it("should return a batch when buffer reaches maxSize", () => {
      const batcher = new SizeBatcher(3);

      batcher.add(createTestData());
      batcher.add(createTestData());

      const batch = batcher.add(createTestData());
      expect(batch).toBeDefined();
      expect(batch!.size).toBe(3);
      expect(batch!.entries).toHaveLength(3);
    });

    it("should reset buffer after returning a batch", () => {
      const batcher = new SizeBatcher(2);

      batcher.add(createTestData());
      const batch = batcher.add(createTestData());

      expect(batch).toBeDefined();
      expect(batcher.pendingCount).toBe(0);
    });

    it("should accumulate entries correctly across multiple batches", () => {
      const batcher = new SizeBatcher(2);
      const totalBatches: number[] = [];

      for (let i = 0; i < 5; i++) {
        const batch = batcher.add(createTestData({ name: `event-${i}` }));
        if (batch) {
          totalBatches.push(batch.size);
        }
      }

      // 5 events with batch size 2 → 2 full batches (2+2), 1 pending
      expect(totalBatches).toEqual([2, 2]);
      expect(batcher.pendingCount).toBe(1);
    });

    it("should have batch id as a non-empty string", () => {
      const batcher = new SizeBatcher(2);

      batcher.add(createTestData());
      const batch = batcher.add(createTestData());

      expect(batch!.id).toBeDefined();
      expect(batch!.id.length).toBeGreaterThan(0);
    });

    it("should have createdAt timestamp in the batch", () => {
      const batcher = new SizeBatcher(2);

      batcher.add(createTestData());
      const batch = batcher.add(createTestData());

      expect(batch!.createdAt).toBeGreaterThan(0);
      expect(typeof batch!.createdAt).toBe("number");
    });
  });

  describe("flush", () => {
    it("should return undefined when buffer is empty", () => {
      const batcher = new SizeBatcher(5);
      expect(batcher.flush()).toBeUndefined();
    });

    it("should return all pending data as a batch", () => {
      const batcher = new SizeBatcher(10);

      batcher.add(createTestData());
      batcher.add(createTestData());
      batcher.add(createTestData());

      const batch = batcher.flush();
      expect(batch).toBeDefined();
      expect(batch!.size).toBe(3);
    });

    it("should clear buffer after flush", () => {
      const batcher = new SizeBatcher(10);

      batcher.add(createTestData());
      batcher.flush();

      expect(batcher.pendingCount).toBe(0);
    });
  });

  describe("pendingCount", () => {
    it("should start at 0", () => {
      const batcher = new SizeBatcher(5);
      expect(batcher.pendingCount).toBe(0);
    });

    it("should increase with each add", () => {
      const batcher = new SizeBatcher(10);

      batcher.add(createTestData());
      expect(batcher.pendingCount).toBe(1);

      batcher.add(createTestData());
      expect(batcher.pendingCount).toBe(2);
    });
  });

  describe("reset", () => {
    it("should clear all pending data", () => {
      const batcher = new SizeBatcher(10);

      batcher.add(createTestData());
      batcher.add(createTestData());
      batcher.add(createTestData());

      batcher.reset();
      expect(batcher.pendingCount).toBe(0);
      expect(batcher.flush()).toBeUndefined();
    });
  });
});

// ─── TimeBatcher ──────────────────────────────────

describe("TimeBatcher", () => {
  describe("constructor", () => {
    it("should create with valid windowMs", () => {
      const batcher = new TimeBatcher(1000);
      expect(batcher.name).toBe("time");
    });

    it("should create with custom name", () => {
      const batcher = new TimeBatcher(1000, "my-time");
      expect(batcher.name).toBe("my-time");
    });

    it("should throw when windowMs < 1", () => {
      expect(() => new TimeBatcher(0)).toThrow("windowMs must be >= 1");
      expect(() => new TimeBatcher(-100)).toThrow("windowMs must be >= 1");
    });
  });

  describe("add", () => {
    it("should return undefined for first data point (window just started)", () => {
      const batcher = new TimeBatcher(60_000);
      const result = batcher.add(createTestData());
      expect(result).toBeUndefined();
    });

    it("should return a batch when time window expires", async () => {
      // Use a very short window (1ms) so add triggers batch creation
      const batcher = new TimeBatcher(1);

      // First add starts the window
      batcher.add(createTestData());

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Second add should find the window expired and create batch
      const batch = batcher.add(createTestData());
      expect(batch).toBeDefined();
      expect(batch!.size).toBeGreaterThanOrEqual(1);
    });

    it("should include all data points collected within the window", async () => {
      const batcher = new TimeBatcher(1);

      batcher.add(createTestData({ name: "a" }));
      batcher.add(createTestData({ name: "b" }));
      batcher.add(createTestData({ name: "c" }));

      await new Promise((resolve) => setTimeout(resolve, 5));

      const batch = batcher.add(createTestData({ name: "d" }));
      expect(batch).toBeDefined();
      expect(batch!.size).toBe(4);
      expect(batch!.entries.map((e) => e.name)).toContain("a");
      expect(batch!.entries.map((e) => e.name)).toContain("b");
      expect(batch!.entries.map((e) => e.name)).toContain("c");
      expect(batch!.entries.map((e) => e.name)).toContain("d");
    });
  });

  describe("flush", () => {
    it("should return undefined when buffer is empty", () => {
      const batcher = new TimeBatcher(60_000);
      expect(batcher.flush()).toBeUndefined();
    });

    it("should return all pending data as a batch", () => {
      const batcher = new TimeBatcher(60_000);

      batcher.add(createTestData());
      batcher.add(createTestData());

      const batch = batcher.flush();
      expect(batch).toBeDefined();
      expect(batch!.size).toBe(2);
    });

    it("should clear buffer after flush", () => {
      const batcher = new TimeBatcher(60_000);

      batcher.add(createTestData());
      batcher.flush();

      expect(batcher.pendingCount).toBe(0);
    });
  });

  describe("pendingCount", () => {
    it("should start at 0", () => {
      const batcher = new TimeBatcher(1000);
      expect(batcher.pendingCount).toBe(0);
    });

    it("should increase with each add", () => {
      const batcher = new TimeBatcher(60_000);

      batcher.add(createTestData());
      expect(batcher.pendingCount).toBe(1);

      batcher.add(createTestData());
      expect(batcher.pendingCount).toBe(2);
    });
  });

  describe("reset", () => {
    it("should clear all pending data and reset window", () => {
      const batcher = new TimeBatcher(60_000);

      batcher.add(createTestData());
      batcher.add(createTestData());

      batcher.reset();
      expect(batcher.pendingCount).toBe(0);
      expect(batcher.flush()).toBeUndefined();
    });

    it("should allow new window to start after reset", () => {
      const batcher = new TimeBatcher(60_000);

      batcher.add(createTestData());
      batcher.reset();

      // After reset, add starts a new window
      const result = batcher.add(createTestData());
      expect(result).toBeUndefined(); // First add in new window, no batch yet
      expect(batcher.pendingCount).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle rapid successive adds within window", () => {
      const batcher = new TimeBatcher(60_000);

      for (let i = 0; i < 100; i++) {
        const result = batcher.add(createTestData());
        // No batch should be returned since window hasn't expired
        expect(result).toBeUndefined();
      }

      expect(batcher.pendingCount).toBe(100);
    });
  });
});
