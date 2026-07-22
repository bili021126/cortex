// @ci: unit
// ============================================================
// @cortex/memory —— Worldbook DMAE 引擎 + v3 知识图谱桥接 单元测试
//
// 覆盖两层：
//   v2 仿真层：DMAE 激活奖励/衰减数学、阈值状态机、活跃条目排序
//   v3 图谱层：toKnowledgeEntities（条目→实体）/ createRelation（有向边）
//
// 背景：世界模型仿真层(v2) → 世界知识图谱(v3)。此前该文件零测试覆盖。
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { WorldbookEngine } from "@cortex/memory";
import type { WorldbookEntry } from "@cortex/memory";

function makeEntry(id: string, opts: Partial<WorldbookEntry> = {}): WorldbookEntry {
  return {
    id,
    keywords: opts.keywords ?? [id],
    content: opts.content ?? `content-${id}`,
    priority: opts.priority ?? 1,
    intrinsicValue: opts.intrinsicValue ?? 1,
    linkTriggers: opts.linkTriggers ?? [],
    permanent: opts.permanent ?? false,
  };
}

describe("WorldbookEngine — DMAE 仿真引擎(v2)", () => {
  let engine: WorldbookEngine;
  beforeEach(() => {
    engine = new WorldbookEngine();
  });

  it("register: 新条目初始 activation=0 → Archived", () => {
    engine.register(makeEntry("e1"));
    expect(engine.getStateSnapshot().get("e1")?.activation).toBe(0);
    expect(engine.getDmaeState("e1")).toBe("Archived");
  });

  it("onUserHit: 单次命中 activation +20（Bu·(1+γ·ln1)）→ Dormant", () => {
    engine.register(makeEntry("e1"));
    engine.onUserHit("e1");
    // Bu=20, γ=0.5, userSilence=0 → reward = 20·(1+0.5·ln(1)) = 20
    expect(engine.getStateSnapshot().get("e1")?.activation).toBe(20);
    expect(engine.getDmaeState("e1")).toBe("Dormant");
  });

  it("两次命中越过阈值(30) → Active 且进入 getActiveEntries", () => {
    engine.register(makeEntry("e1"));
    engine.onUserHit("e1");
    engine.onUserHit("e1"); // 命中会重置 silence，故第二次仍 +20 → 40
    expect(engine.getStateSnapshot().get("e1")?.activation).toBe(40);
    expect(engine.getDmaeState("e1")).toBe("Active");
    expect(engine.getActiveEntries().map((e) => e.id)).toContain("e1");
  });

  it("onUserMiss: 衰减降低 activation", () => {
    engine.register(makeEntry("e1"));
    engine.onUserHit("e1");
    engine.onUserHit("e1");
    const before = engine.getStateSnapshot().get("e1")?.activation ?? 0;
    engine.onUserMiss();
    const after = engine.getStateSnapshot().get("e1")?.activation ?? 0;
    expect(after).toBeLessThan(before);
  });

  it("getActiveEntries: 仅含 ≥阈值，且按 activation 降序", () => {
    engine.register(makeEntry("hi"));
    engine.register(makeEntry("lo"));
    engine.onUserHit("hi");
    engine.onUserHit("hi"); // hi=40 → Active
    engine.onUserHit("lo"); // lo=20 → Dormant（低于阈值 30）
    const active = engine.getActiveEntries();
    expect(active.map((e) => e.id)).toEqual(["hi"]);
  });

  it("getDmaeState: 未知条目 → Archived", () => {
    expect(engine.getDmaeState("never-registered")).toBe("Archived");
  });

  it("unregister: 移除条目与状态", () => {
    engine.register(makeEntry("e1"));
    engine.unregister("e1");
    expect(engine.getStateSnapshot().has("e1")).toBe(false);
  });

  it("构造参数覆盖默认值，未覆盖项保留默认", () => {
    const e2 = new WorldbookEngine({ promptThreshold: 50 });
    expect(e2.getParams().promptThreshold).toBe(50);
    // userRewardBase 未覆盖 → 保留默认 Bu=20
    expect(e2.getParams().userRewardBase).toBe(20);
  });
});

describe("WorldbookEngine — v3 知识图谱桥接", () => {
  let engine: WorldbookEngine;
  beforeEach(() => {
    engine = new WorldbookEngine();
  });

  it("toKnowledgeEntities: permanent→persona，否则→concept；labels=keywords", () => {
    engine.register(makeEntry("p", { permanent: true, keywords: ["k1", "k2"] }));
    engine.register(makeEntry("c", { permanent: false, keywords: ["k3"] }));
    const ents = engine.toKnowledgeEntities();
    const p = ents.find((e) => e.id === "p");
    const c = ents.find((e) => e.id === "c");
    expect(p?.type).toBe("persona");
    expect(c?.type).toBe("concept");
    expect(p?.labels).toEqual(["k1", "k2"]);
    expect(p?.properties.permanent).toBe(true);
    expect(p?.entry?.id).toBe("p");
  });

  it("createRelation: 双方已注册 → 返回关系；默认 weight/confidence=0.5", () => {
    engine.register(makeEntry("a"));
    engine.register(makeEntry("b"));
    const rel = engine.createRelation("a", "b", "depends_on");
    expect(rel).not.toBeNull();
    expect(rel?.sourceId).toBe("a");
    expect(rel?.targetId).toBe("b");
    expect(rel?.type).toBe("depends_on");
    expect(rel?.weight).toBe(0.5);
    expect(rel?.confidence).toBe(0.5);
    expect(rel?.id).toBe("rel-a-b-depends_on");
  });

  it("createRelation: 任一端未注册 → null", () => {
    engine.register(makeEntry("a"));
    expect(engine.createRelation("a", "missing", "references")).toBeNull();
    expect(engine.createRelation("missing", "a", "references")).toBeNull();
  });

  it("createRelation: 自定义 weight/confidence/provenance 透传", () => {
    engine.register(makeEntry("a"));
    engine.register(makeEntry("b"));
    const rel = engine.createRelation("a", "b", "causes", {
      weight: 0.9,
      confidence: 0.8,
      provenance: "llm",
    });
    expect(rel?.weight).toBe(0.9);
    expect(rel?.confidence).toBe(0.8);
    expect(rel?.provenance).toBe("llm");
  });
});
