// @ci: unit
// ============================================================
// @cortex/skill-kit — DefaultSkillCache 单元测试
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { type SkillDefinition, SkillCategory } from "../src/types.js";
import { DefaultSkillCache } from "../src/cache.js";

// ── 辅助函数 ──────────────────────────────────────────────────

function makeSkill(id: string): SkillDefinition {
  return {
    meta: {
      id,
      name: `技能 ${id}`,
      version: "1.0.0",
      description: "测试技能",
      category: SkillCategory.TOOL,
      triggerTags: ["test"],
      trigger: "测试",
      steps: ["步骤1"],
      expectedOutput: "输出",
    },
    async execute() {
      return { success: true, data: id };
    },
  };
}

// ── 测试 ──────────────────────────────────────────────────────

describe("DefaultSkillCache", () => {
  let cache: DefaultSkillCache;

  beforeEach(() => {
    cache = new DefaultSkillCache({ maxSize: 10, defaultTtlMs: 60_000 });
  });

  it("set() 后 get() 返回技能定义", () => {
    const skill = makeSkill("skill-1");
    cache.set("skill-1", skill);
    expect(cache.get("skill-1")).toBe(skill);
  });

  it("未 set 返回 undefined", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("has() 正确反映缓存状态", () => {
    expect(cache.has("skill-1")).toBe(false);
    cache.set("skill-1", makeSkill("skill-1"));
    expect(cache.has("skill-1")).toBe(true);
  });

  it("evict() 移除指定条目", () => {
    cache.set("skill-1", makeSkill("skill-1"));
    cache.evict("skill-1");
    expect(cache.get("skill-1")).toBeUndefined();
  });

  it("clear() 清空所有条目", () => {
    cache.set("skill-1", makeSkill("skill-1"));
    cache.set("skill-2", makeSkill("skill-2"));
    cache.clear();
    expect(cache.get("skill-1")).toBeUndefined();
    expect(cache.get("skill-2")).toBeUndefined();
  });

  it("stats() 返回正确的统计信息", () => {
    const skill = makeSkill("skill-1");
    cache.set("skill-1", skill);

    // 命中
    cache.get("skill-1");
    cache.get("skill-1");

    // 未命中
    cache.get("nonexistent");

    const stats = cache.stats();
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(10);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3);
  });

  it("超出 maxSize 时淘汰最旧条目（LRU）", () => {
    // 创建 maxSize=3 的缓存
    const smallCache = new DefaultSkillCache({ maxSize: 3, defaultTtlMs: 0 });

    smallCache.set("a", makeSkill("a"));
    smallCache.set("b", makeSkill("b"));
    smallCache.set("c", makeSkill("c"));

    // 访问 a，使其成为最近使用
    smallCache.get("a");

    // 插入 d，应淘汰最久未使用的 b
    smallCache.set("d", makeSkill("d"));

    expect(smallCache.get("a")).toBeDefined();
    expect(smallCache.get("b")).toBeUndefined();
    expect(smallCache.get("c")).toBeDefined();
    expect(smallCache.get("d")).toBeDefined();
  });

  it("TTL 过期后 get() 返回 undefined", async () => {
    const ttlCache = new DefaultSkillCache({ maxSize: 10, defaultTtlMs: 10 });
    const skill = makeSkill("fast-expire");
    ttlCache.set("fast-expire", skill);

    // 立即获取，应命中
    expect(ttlCache.get("fast-expire")).toBe(skill);

    // 等待 TTL 过期
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ttlCache.get("fast-expire")).toBeUndefined();
  });

  it("自定义 TTL 覆盖默认 TTL", async () => {
    const ttlCache = new DefaultSkillCache({ maxSize: 10, defaultTtlMs: 100 });
    const skill = makeSkill("custom-ttl");
    // 设置非常短的 TTL
    ttlCache.set("custom-ttl", skill, 10);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ttlCache.get("custom-ttl")).toBeUndefined();
  });

  it("ttlMs=0 永不过期", async () => {
    const noTtlCache = new DefaultSkillCache({ maxSize: 10, defaultTtlMs: 0 });
    const skill = makeSkill("no-expire");
    noTtlCache.set("no-expire", skill, 0);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noTtlCache.get("no-expire")).toBe(skill);
  });

  it("onDestroy 在 evict 时被调用", () => {
    let destroyed = false;
    const skill: SkillDefinition = {
      meta: makeSkill("destroyable").meta,
      async execute() {
        return { success: true, data: "ok" };
      },
      async onDestroy() {
        destroyed = true;
      },
    };

    cache.set("destroyable", skill);
    cache.markInitialized("destroyable");
    cache.evict("destroyable");
    expect(destroyed).toBe(true);
  });
});
