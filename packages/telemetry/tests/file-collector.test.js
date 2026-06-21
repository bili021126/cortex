// @ci: unit
// ============================================================
// @cortex/telemetry —— FileCollector 单元测试
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { FileCollector } from "../src/index.js";
const TEST_DIR = join(tmpdir(), "cortex-telemetry-test", randomUUID());
function createTestData(overrides) {
    return {
        id: overrides?.id ?? randomUUID(),
        name: overrides?.name ?? "test.metric",
        value: overrides?.value ?? 42,
        tags: overrides?.tags ?? [{ key: "env", value: "test" }],
        timestamp: overrides?.timestamp ?? Date.now(),
        metadata: overrides?.metadata,
    };
}
describe("FileCollector", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });
    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });
    describe("constructor", () => {
        it("should create with given file path and default name", () => {
            const filePath = join(TEST_DIR, "metrics.jsonl");
            const collector = new FileCollector(filePath);
            expect(collector.name).toBe("file");
        });
        it("should create with custom name", () => {
            const filePath = join(TEST_DIR, "metrics.jsonl");
            const collector = new FileCollector(filePath, "my-file-collector");
            expect(collector.name).toBe("my-file-collector");
        });
    });
    describe("collect and flush (append mode, default)", () => {
        it("should write a single data point to file", async () => {
            const filePath = join(TEST_DIR, "single.jsonl");
            const collector = new FileCollector(filePath);
            const data = createTestData({ name: "test.single", value: 1 });
            await collector.collect(data);
            await collector.flush();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(1);
            const parsed = JSON.parse(lines[0]);
            expect(parsed.name).toBe("test.single");
            expect(parsed.value).toBe(1);
        });
        it("should append multiple data points in order", async () => {
            const filePath = join(TEST_DIR, "multiple.jsonl");
            const collector = new FileCollector(filePath);
            const data1 = createTestData({ name: "metric.a", value: 10 });
            const data2 = createTestData({ name: "metric.b", value: 20 });
            await collector.collect(data1);
            await collector.collect(data2);
            await collector.flush();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(2);
            const parsed1 = JSON.parse(lines[0]);
            const parsed2 = JSON.parse(lines[1]);
            expect(parsed1.name).toBe("metric.a");
            expect(parsed1.value).toBe(10);
            expect(parsed2.name).toBe("metric.b");
            expect(parsed2.value).toBe(20);
        });
        it("should append to existing file", async () => {
            const filePath = join(TEST_DIR, "append.jsonl");
            const collector1 = new FileCollector(filePath, "c1");
            await collector1.collect(createTestData({ name: "first", value: 1 }));
            await collector1.flush();
            await collector1.shutdown();
            const collector2 = new FileCollector(filePath, "c2");
            await collector2.collect(createTestData({ name: "second", value: 2 }));
            await collector2.flush();
            await collector2.shutdown();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(2);
            expect(JSON.parse(lines[0]).name).toBe("first");
            expect(JSON.parse(lines[1]).name).toBe("second");
        });
        it("should handle collect without explicit flush (shutdown flushes)", async () => {
            const filePath = join(TEST_DIR, "shutdown-flush.jsonl");
            const collector = new FileCollector(filePath);
            await collector.collect(createTestData({ name: "auto.flush", value: 99 }));
            await collector.shutdown();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(1);
            expect(JSON.parse(lines[0]).value).toBe(99);
        });
        it("should flush only once when flush called multiple times with no data", async () => {
            const filePath = join(TEST_DIR, "idempotent-flush.jsonl");
            const collector = new FileCollector(filePath);
            await collector.flush(); // nothing to flush
            await collector.flush(); // still nothing
            await collector.collect(createTestData({ name: "after.idle", value: 5 }));
            await collector.flush();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(1);
        });
    });
    describe("overwrite mode", () => {
        it("should overwrite file content on each flush", async () => {
            const filePath = join(TEST_DIR, "overwrite.jsonl");
            const collector = new FileCollector(filePath, "overwrite", { mode: "overwrite" });
            await collector.collect(createTestData({ name: "first.batch", value: 1 }));
            await collector.flush();
            await collector.collect(createTestData({ name: "second.batch", value: 2 }));
            await collector.flush();
            const content = await readFile(filePath, "utf-8");
            const lines = content.trim().split("\n");
            expect(lines).toHaveLength(1);
            expect(JSON.parse(lines[0]).name).toBe("second.batch");
        });
    });
    describe("error handling", () => {
        it("should reject data after shutdown", async () => {
            const filePath = join(TEST_DIR, "shutdown-reject.jsonl");
            const collector = new FileCollector(filePath);
            await collector.shutdown();
            const result = await collector.collect(createTestData());
            expect(result.accepted).toBe(false);
            expect(result.reason).toContain("shut down");
        });
        it("should create parent directory automatically", async () => {
            const nestedDir = join(TEST_DIR, "nested", "deep");
            const filePath = join(nestedDir, "auto-create.jsonl");
            const collector = new FileCollector(filePath);
            await collector.collect(createTestData({ name: "auto.dir", value: 1 }));
            await collector.flush();
            expect(existsSync(filePath)).toBe(true);
            const content = await readFile(filePath, "utf-8");
            expect(content).toContain("auto.dir");
        });
    });
    describe("shutdown", () => {
        it("should be idempotent", async () => {
            const filePath = join(TEST_DIR, "idempotent-shutdown.jsonl");
            const collector = new FileCollector(filePath);
            await collector.shutdown();
            await expect(collector.shutdown()).resolves.toBeUndefined();
        });
    });
});
//# sourceMappingURL=file-collector.test.js.map