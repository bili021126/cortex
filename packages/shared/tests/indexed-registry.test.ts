// @ci: unit

import { describe, it, expect } from "vitest";
import { IndexedRegistry } from "../src/indexed-registry.js";
import type { IndexDefinition } from "../src/indexed-registry.js";

// ─── 测试用子类 ──────────────────────────────────

interface TestItem {
  id: string;
  type: string;
  tags: string[];
}

class TestRegistry extends IndexedRegistry<TestItem> {
  protected defineIndexes(): IndexDefinition<TestItem>[] {
    return [
      {
        name: "by_type",
        extractKey: (item) => item.type,
      },
      {
        name: "by_tags",
        extractKey: (item) => item.tags,
      },
    ];
  }

  /** 暴露 queryByIndex 供测试 */
  queryByType(type: string): TestItem[] {
    return this.queryByIndex("by_type", type);
  }

  queryByTag(tag: string): TestItem[] {
    return this.queryByIndex("by_tags", tag);
  }
}

// ─── 测试 ────────────────────────────────────────

describe("IndexedRegistry", () => {
  it("should register and retrieve items", () => {
    const registry = new TestRegistry();
    const item: TestItem = { id: "1", type: "a", tags: ["x"] };
    registry.register(item);

    expect(registry.get("1")).toEqual(item);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("should register all in batch", () => {
    const registry = new TestRegistry();
    const items: TestItem[] = [
      { id: "1", type: "a", tags: ["x"] },
      { id: "2", type: "b", tags: ["y"] },
      { id: "3", type: "a", tags: ["z"] },
    ];
    registry.registerAll(items);

    expect(registry.getAll()).toHaveLength(3);
    expect(registry.get("1")).toBeDefined();
    expect(registry.get("3")).toBeDefined();
  });

  it("should unregister items", () => {
    const registry = new TestRegistry();
    registry.register({ id: "1", type: "a", tags: ["x"] });
    registry.register({ id: "2", type: "a", tags: ["y"] });

    expect(registry.getAll()).toHaveLength(2);

    const removed = registry.unregister("1");
    expect(removed).toBe(true);
    expect(registry.get("1")).toBeUndefined();
    expect(registry.getAll()).toHaveLength(1);

    // 重复 unregister 返回 false
    expect(registry.unregister("1")).toBe(false);
  });

  it("should clear all items", () => {
    const registry = new TestRegistry();
    registry.registerAll([
      { id: "1", type: "a", tags: [] },
      { id: "2", type: "b", tags: [] },
    ]);

    registry.clear();
    expect(registry.getAll()).toHaveLength(0);
    expect(registry.get("1")).toBeUndefined();
  });

  it("should query by single index", () => {
    const registry = new TestRegistry();
    registry.registerAll([
      { id: "1", type: "code", tags: ["ts"] },
      { id: "2", type: "code", tags: ["js"] },
      { id: "3", type: "doc", tags: ["md"] },
    ]);

    const codeItems = registry.queryByType("code");
    expect(codeItems).toHaveLength(2);
    expect(codeItems.map((i) => i.id).sort()).toEqual(["1", "2"]);

    const docItems = registry.queryByType("doc");
    expect(docItems).toHaveLength(1);
    expect(docItems[0]!.id).toBe("3");
  });

  it("should query by multi-key index", () => {
    const registry = new TestRegistry();
    registry.registerAll([
      { id: "1", type: "a", tags: ["ts", "react"] },
      { id: "2", type: "b", tags: ["ts", "node"] },
      { id: "3", type: "c", tags: ["react", "native"] },
    ]);

    const tsItems = registry.queryByTag("ts");
    expect(tsItems).toHaveLength(2);

    const reactItems = registry.queryByTag("react");
    expect(reactItems).toHaveLength(2);

    const nativeItems = registry.queryByTag("native");
    expect(nativeItems).toHaveLength(1);

    const nonexistent = registry.queryByTag("nonexistent");
    expect(nonexistent).toHaveLength(0);
  });

  it("should handle empty queries", () => {
    const registry = new TestRegistry();
    // 空注册表查询
    expect(registry.queryByType("anything")).toEqual([]);
    expect(registry.queryByTag("anything")).toEqual([]);
    expect(registry.get("anything")).toBeUndefined();
    expect(registry.getAll()).toEqual([]);
  });

  it("should handle duplicate registration (overwrite)", () => {
    const registry = new TestRegistry();
    registry.register({ id: "1", type: "a", tags: ["x"] });
    registry.register({ id: "2", type: "b", tags: ["x"] });

    // 通过 tag x 查到 2 个
    expect(registry.queryByTag("x")).toHaveLength(2);

    // 覆盖 id=1
    registry.register({ id: "1", type: "c", tags: ["y"] });

    // id=1 现在类型为 c，不再是 type a
    expect(registry.queryByType("a")).toHaveLength(0);
    expect(registry.queryByType("c")).toHaveLength(1);

    // id=1 的标签改为 y，不再匹配 x
    expect(registry.queryByTag("x")).toHaveLength(1); // 只有 id=2
    expect(registry.queryByTag("y")).toHaveLength(1);
  });

  it("should return all items via getAll()", () => {
    const registry = new TestRegistry();
    const items = [
      { id: "a", type: "1", tags: [] },
      { id: "b", type: "2", tags: [] },
      { id: "c", type: "3", tags: [] },
    ];
    registry.registerAll(items);
    expect(registry.getAll()).toHaveLength(3);
    // getAll() 返回副本，不影响内部
    const all = registry.getAll();
    all.pop();
    expect(registry.getAll()).toHaveLength(3);
  });

  it("unregister should clean up indexes", () => {
    const registry = new TestRegistry();
    registry.register({ id: "1", type: "code", tags: ["ts", "react"] });
    registry.unregister("1");

    // 索引应被清理
    expect(registry.queryByType("code")).toHaveLength(0);
    expect(registry.queryByTag("ts")).toHaveLength(0);
    expect(registry.queryByTag("react")).toHaveLength(0);
  });

  it("should handle items with empty tags array", () => {
    const registry = new TestRegistry();
    registry.register({ id: "1", type: "a", tags: [] });
    registry.register({ id: "2", type: "a", tags: [] });

    expect(registry.queryByType("a")).toHaveLength(2);
    // 空 tags 不应产生索引键
    expect(registry.queryByTag("")).toHaveLength(0);
  });
});
