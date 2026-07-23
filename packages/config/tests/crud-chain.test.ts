// config/tests/crud-chain.test.ts — ConfigStore 写入→读取→校验全链路集成测试
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { resolveConfigDataDir, ModelStore, KeyStore, AgentManifestStore, TuningStore, ConfigFileReader, ConfigFileWriter } from "../src/index.js";

// 隔离测试数据目录——不污染真实 data/
const TEST_DIR = path.join(resolveConfigDataDir(), "..", "__test_data__");
const readFile: ConfigFileReader = (fp: string) => readFileSync(fp, "utf-8");
const writeFile: ConfigFileWriter = (fp: string, content: string) => writeFileSync(fp, content, "utf-8");

function seedFile(fileName: string, content: string) {
  const fp = path.join(TEST_DIR, fileName);
  writeFile(fp, content);
}

function cleanup() {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
}

describe("ConfigStore CRUD 链路", () => {
  beforeEach(() => {
    cleanup();
    mkdirSync(TEST_DIR, { recursive: true });
  });

  // ── ModelStore ──
  describe("ModelStore", () => {
    beforeEach(() => {
      seedFile("models.json", JSON.stringify({ models: {} }));
    });

    it("addModel → getModel → removeModel 全链路", () => {
      const store = new ModelStore(readFile, writeFile, TEST_DIR);

      // add
      store.addModel("test-model", {
        label: "Test",
        capabilities: ["chat", "streaming"],
        thinking: false,
        defaultFor: ["fix"],
        maxOutputTokens: 65536,
        contextWindow: 1_000_000,
      });

      // read back
      const m = store.getModel("test-model");
      expect(m).toBeTruthy();
      expect(m!.label).toBe("Test");
      expect(m!.maxOutputTokens).toBe(65536);

      // update
      store.updateModel("test-model", { label: "Updated" });
      expect(store.getModel("test-model")!.label).toBe("Updated");

      // remove
      store.removeModel("test-model");
      expect(store.getModel("test-model")).toBeUndefined();
    });

    it("重复 addModel 抛错", () => {
      const store = new ModelStore(readFile, writeFile, TEST_DIR);
      store.addModel("dup", { label: "Dup", capabilities: [], thinking: false, defaultFor: [] });
      expect(() => store.addModel("dup", { label: "Dup", capabilities: [], thinking: false, defaultFor: [] })).toThrow("已存在");
    });
  });

  // ── KeyStore ──
  describe("KeyStore", () => {
    it("addKey → list → contextLimit 全链路", () => {
      seedFile("keys-context.json", JSON.stringify({ keys: {}, contextLimits: {} }));
      const store = new KeyStore(readFile, writeFile, TEST_DIR);

      store.addKey("TEST_KEY", {
        label: "Test Key",
        envVar: "TEST_API_KEY",
        modelFallback: "DEEPSEEK_CHAT",
        agents: ["test-agent"],
      });

      store.addContextLimit("test-limit", { maxTokens: 64000, description: "test ctx" });

      const data = store.read();
      expect(data.keys["TEST_KEY"]).toBeTruthy();
      expect(data.contextLimits["test-limit"]).toBeTruthy();
    });
  });

  // ── AgentManifestStore ──
  describe("AgentManifestStore", () => {
    it("addAgent 自动注册 tags → _tags 主表", () => {
      seedFile("agent-manifests.json", JSON.stringify({ _profiles: {}, agents: {} }));
      const store = new AgentManifestStore(readFile, writeFile, TEST_DIR);

      store.addAgent("test-agent", {
        id: "test-agent",
        type: "code",
        role: "Test Agent",
        model: "deepseek-v4-flash",
        key: "DEEPSEEK_CHAT",
        tags: ["code", "test"],
        produces: ["test_output"],
      });

      const data = store.read();
      expect(data._tags).toContain("code");
      expect(data._tags).toContain("test");

      // removeAgent 清理孤儿标签
      store.removeAgent("test-agent");
      const afterRemove = store.read();
      expect(afterRemove._tags).not.toContain("test");
    });
  });

  // ── TuningStore ──
  describe("TuningStore", () => {
    it("点路径调参——setTuningParam / getTuningParam", () => {
      seedFile("tuning.json", JSON.stringify({
        env: {}, tuning: { execution: { reactMaxLoops: 10, reactContextHardLimit: 30000, maxToolRounds: 20, toolTimeoutMs: 30000, commandTimeoutSec: 120, taskTimeoutSec: 600, nodeDispatchTimeoutMs: 120000, executeAllTimeoutMs: 300000 }, scheduling: { workerPoolMaxQueue: 100, claimLeaseMs: 120000, maxReplanPerNode: 3, maxTotalReplans: 10 }, trust: { baseScore: 50, autoApproveL2: 70, autoApproveL3: 85, l0l1Bonus: 0.5, l2Penalty: 8, l3Penalty: 15, bypassTtlMs: 300000 }, verification: { cacheTtlMs: 60000, barrelMaxSize: 10, tsFileMaxSize: 10 }, memory: { bm25K1: 1.2, bm25B: 0.75, vectorDedupThreshold: 0.95, staleFreezeDays: 30, frozenObliterateDays: 7, maintenanceWeightThreshold: 0.05 }, rlm: { maxDepth: 3, minComplexityChars: 500, minConfidence: 0.6 } },
      }));
      const store = new TuningStore(readFile, writeFile, TEST_DIR);

      store.setTuningParam("execution.reactMaxLoops", 20);
      expect(store.getTuningParam("execution.reactMaxLoops")).toBe(20);

      store.setEnv("NEW_VAR", { default: "value", desc: "test" });
      expect(store.getEnv("NEW_VAR")?.default).toBe("value");
    });
  });
});
