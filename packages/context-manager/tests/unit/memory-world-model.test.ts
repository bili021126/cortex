// @ci: unit
/**
 * @cortex/context-manager — MemoryWorldModel 单元测试
 *
 * V+M 层记忆世界模型：验证各子组件正确组装。
 * - encoder: PredictiveEncoder（含 SCENE_RULES 静态属性）
 * - retriever: PredictiveRetriever（含 getCurrentScene）
 * - domainGate: DomainGateController（默认 engineering）
 */
import { describe, it, expect } from "vitest";
import { MemoryWorldModel } from "../../src/memory-world-model.js";
import { PredictiveEncoder } from "../../src/predictive-encoder.js";
import { PredictiveRetriever } from "../../src/predictive-retriever.js";
import { DomainGateController } from "../../src/domain-gate.js";
import type { IMemoryStore } from "@cortex/shared";

/** 最小 MemoryStore Mock */
const mockStore: IMemoryStore = {
  isPersisted: false,
  size: 0,
  init: async () => {},
  beginSession: () => "mock-session",
  endSession: async () => 0,
  write: async () => "mock-id",
  read: async () => [],
  link: () => null,
  getLinks: () => [],
  has: () => false,
  cas: () => true,
  archive: () => true,
  freeze: () => true,
  obliterate: () => true,
  writePending: () => "mock-id",
  commitMemory: () => true,
  rollback: async () => true,
  cancel: () => true,
  getPending: () => [],
  hasPending: () => false,
  getBySession: () => [],
  peek: () => undefined,
  flush: async () => {},
  close: async () => {},
  maintain: () => ({ archived: 0, obliterated: 0 }),
  setPreWriteHook: () => {},
};

describe("MemoryWorldModel", () => {
  it("should aggregate encoder, retriever, and domain gate", () => {
    const mwm = new MemoryWorldModel(mockStore);

    expect(mwm.encoder).toBeInstanceOf(PredictiveEncoder);
    expect(mwm.retriever).toBeInstanceOf(PredictiveRetriever);
    expect(mwm.domainGate).toBeInstanceOf(DomainGateController);
  });

  it("should have encoder with SCENE_RULES", () => {
    const mwm = new MemoryWorldModel(mockStore);

    // PredictiveEncoder 的静态属性 SCENE_RULES
    const result = mwm.encoder.encode(
      {
        id: "t1",
        source: "agent",
        kind: "Insight",
        summary: "test",
        semantic_gist: "test",
        content_blob: {},
        semantic_state: "Active",
        weight: 1.0,
        accessCount: 0,
        lastAccessedAt: 0,
        createdAt: 0,
        content_hash: "x",
      },
      { scene: "code-repair", persona: "cyrene" },
    );

    expect(result.relevancePredict.scenes).toContain("code-repair");
    expect(result.relevancePredict.scenes).toContain("architecture");
  });

  it("should have retriever with getCurrentScene", () => {
    const mwm = new MemoryWorldModel(mockStore);
    expect(mwm.retriever.getCurrentScene()).toBe("general");
  });

  it("should have domain gate defaulting to engineering", () => {
    const mwm = new MemoryWorldModel(mockStore);
    expect(mwm.domainGate.getActiveDomains()).toEqual(["engineering"]);
  });
});
