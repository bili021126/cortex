import { describe, it, expect, beforeEach } from "vitest";
import { MemoryType, MemoryState, AgentType, LinkType } from "@cortex/shared";
import { MemoryStore } from "../src/memory-store";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ── 写入 & 基本检索 ─────────────────────────

  it("写入并检索单条记忆", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: { taskType: "implementation", entities: ["app.ts"], decision: "done" },
      summary: "Agent 完成文件修改",
      agentType: AgentType.Code,
      creatorId: "code-agent-1",
    });

    expect(id).toMatch(/^mem-/);

    const results = store.read({
      keywords: ["文件修改"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("Agent 完成文件修改");
    expect(results[0].memoryType).toBe(MemoryType.Episodic);
    expect(results[0].agentType).toBe(AgentType.Code);
  });

  it("按 memoryType 过滤", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "经验记忆",
      agentType: AgentType.Code,
      creatorId: "a",
    });
    store.write({
      memoryType: MemoryType.Knowledge,
      content: {},
      summary: "知识记忆",
      agentType: AgentType.Analysis,
      creatorId: "b",
    });

    const epis = store.read({ memoryTypes: [MemoryType.Episodic] });
    expect(epis).toHaveLength(1);
    expect(epis[0].summary).toBe("经验记忆");

    const know = store.read({ memoryTypes: [MemoryType.Knowledge] });
    expect(know).toHaveLength(1);
    expect(know[0].summary).toBe("知识记忆");
  });

  it("按 agentType 过滤", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "code 产出",
      agentType: AgentType.Code,
      creatorId: "a",
    });
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "review 产出",
      agentType: AgentType.Review,
      creatorId: "b",
    });

    const code = store.read({ agentTypes: [AgentType.Code] });
    expect(code).toHaveLength(1);
    expect(code[0].summary).toBe("code 产出");
  });

  it("关键词匹配 content JSON 字段", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: { taskType: "bugfix", entities: ["utils.ts"], decision: "加 null 检查" },
      summary: "修复 bug",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // 关键词在 content 中
    const r1 = store.read({ keywords: ["null"] });
    expect(r1).toHaveLength(1);

    // 关键词在 summary 中
    const r2 = store.read({ keywords: ["修复"] });
    expect(r2).toHaveLength(1);

    // 不匹配
    const r3 = store.read({ keywords: ["不存在"] });
    expect(r3).toHaveLength(0);
  });

  // ── 30 天 TTL ──────────────────────────────────

  it("30 天窗口外记忆自动过滤", () => {
    // 写入一条记忆，createdAt 设为 31 天前
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "过期记忆",
      agentType: AgentType.Code,
      creatorId: "a",
      createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });

    const results = store.read({});
    expect(results).toHaveLength(0);
  });

  it("30 天内记忆正常可见", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "新鲜记忆",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    expect(store.read({})).toHaveLength(1);
  });

  // ── 私密记忆 ──────────────────────────────────

  it("私密记忆默认不可见", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "公开",
      agentType: AgentType.Code,
      creatorId: "a",
      isPrivate: false,
    });
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "私密",
      agentType: AgentType.Code,
      creatorId: "a",
      isPrivate: true,
    });

    const pub = store.read({ includePrivate: false });
    expect(pub).toHaveLength(1);
    expect(pub[0].summary).toBe("公开");

    const all = store.read({ includePrivate: true });
    expect(all).toHaveLength(2);
  });

  // ── 关联 ───────────────────────────────────────

  it("建立关联边 + 幂等去重", () => {
    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "源记忆",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "目标记忆",
      agentType: AgentType.Review,
      creatorId: "y",
    });

    const link1 = store.link(a, b, LinkType.ProducedBy, "code");
    expect(link1).toBeTruthy();
    expect(link1!.sourceId).toBe(a);
    expect(link1!.targetId).toBe(b);
    expect(link1!.linkType).toBe(LinkType.ProducedBy);

    // 幂等去重
    const link2 = store.link(a, b, LinkType.ProducedBy, "code");
    expect(link2).toBeNull();

    // ACCESSED_DURING 可以重复
    const link3 = store.link(a, b, LinkType.AccessedDuring, "code");
    expect(link3).toBeTruthy();
    const link4 = store.link(a, b, LinkType.AccessedDuring, "code");
    expect(link4).toBeTruthy();
  });

  it("getLinks 返回所有出边", () => {
    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "源",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "目标1",
      agentType: AgentType.Code,
      creatorId: "y",
    });
    const c = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "目标2",
      agentType: AgentType.Code,
      creatorId: "z",
    });

    store.link(a, b, LinkType.ProducedBy, "x");
    store.link(a, c, LinkType.DependsOn, "x");

    const links = store.getLinks(a);
    expect(links).toHaveLength(2);
  });

  // ── 权重排序 ──────────────────────────────────

  it("结果按 weight 降序排列", () => {
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "低权重",
      agentType: AgentType.Code,
      creatorId: "a",
      weight: 0.3,
    });
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "高权重",
      agentType: AgentType.Code,
      creatorId: "a",
      weight: 0.9,
    });
    store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "中权重",
      agentType: AgentType.Code,
      creatorId: "a",
      weight: 0.6,
    });

    const results = store.read({});
    expect(results).toHaveLength(3);
    expect(results[0].summary).toBe("高权重");
    expect(results[1].summary).toBe("中权重");
    expect(results[2].summary).toBe("低权重");
  });

  // ── 归档（CAS 保护） ───────────────────────────

  it("archive：Active → Archived（CAS）", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "待归档",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    expect(store.read({})).toHaveLength(1);

    expect(store.archive(id)).toBe(true);
    expect(store.read({})).toHaveLength(0);
    expect(store.read({ states: [MemoryState.Archived] })).toHaveLength(1);
  });

  it("archive 拒绝非 Active 态的记忆", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "先归档再归档",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    expect(store.archive(id)).toBe(true);  // 第一次成功
    expect(store.archive(id)).toBe(false); // 已 Archived，CAS 预期 Active 失败
  });

  // ── 四态状态机 ────────────────────────────────

  it("has：存在性检查", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "存在",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    expect(store.has(id)).toBe(true);
    expect(store.has("nonexistent")).toBe(false);
  });

  it("cas：合法流转成功", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "cas 测试",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    expect(store.cas(id, MemoryState.Active, MemoryState.Archived)).toBe(true);
    expect(store.peek(id)!.state).toBe(MemoryState.Archived);
  });

  it("cas：expected 不匹配时失败", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "cas 冲突",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    // 实际是 Active，expected 传 Archived → 失败
    expect(store.cas(id, MemoryState.Archived, MemoryState.Frozen)).toBe(false);
    expect(store.peek(id)!.state).toBe(MemoryState.Active); // 未变
  });

  it("cas：Obliterated 不可逆", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "湮灭不可逆",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    store.obliterate(id);
    expect(store.peek(id)!.state).toBe(MemoryState.Obliterated);

    // 任何从 Obliterated 的 CAS 都失败
    expect(store.cas(id, MemoryState.Obliterated, MemoryState.Active)).toBe(false);
    expect(store.cas(id, MemoryState.Obliterated, MemoryState.Archived)).toBe(false);
    expect(store.peek(id)!.state).toBe(MemoryState.Obliterated);
  });

  it("freeze：Active|Archived → Frozen", () => {
    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "冻 Active",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "冻 Archived",
      agentType: AgentType.Code,
      creatorId: "x",
    });

    store.archive(b);

    expect(store.freeze(a)).toBe(true);
    expect(store.peek(a)!.state).toBe(MemoryState.Frozen);

    expect(store.freeze(b)).toBe(true);
    expect(store.peek(b)!.state).toBe(MemoryState.Frozen);

    // 已 Frozen 不可再 freeze
    expect(store.freeze(a)).toBe(false);
  });

  it("obliterate：任何非 Obliterated 态 → Obliterated", () => {
    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "湮灭 Active",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "湮灭 Archived",
      agentType: AgentType.Code,
      creatorId: "x",
    });

    store.archive(b);

    expect(store.obliterate(a)).toBe(true);
    expect(store.peek(a)!.state).toBe(MemoryState.Obliterated);

    expect(store.obliterate(b)).toBe(true);
    expect(store.peek(b)!.state).toBe(MemoryState.Obliterated);

    // 已 Obliterated 再次 obliterate：幂等，返回 true
    expect(store.obliterate(a)).toBe(true);
  });

  it("cas 拒绝 Frozen → Active", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "冻结不可回 Active",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    store.freeze(id);
    expect(store.peek(id)!.state).toBe(MemoryState.Frozen);

    // Frozen → Active 被 _isValidTransition 拒绝
    expect(store.cas(id, MemoryState.Frozen, MemoryState.Active)).toBe(false);
    expect(store.peek(id)!.state).toBe(MemoryState.Frozen);
  });

  it("cas 拒绝 Frozen → Archived", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "冻结不可回 Archived",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    store.freeze(id);
    expect(store.peek(id)!.state).toBe(MemoryState.Frozen);

    // Frozen → Archived 被 _isValidTransition 拒绝
    expect(store.cas(id, MemoryState.Frozen, MemoryState.Archived)).toBe(false);
    expect(store.peek(id)!.state).toBe(MemoryState.Frozen);
  });

  it("cas 拒绝 Archived → Active", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "归档不可回 Active",
      agentType: AgentType.Code,
      creatorId: "a",
    });

    store.archive(id);
    expect(store.peek(id)!.state).toBe(MemoryState.Archived);

    // Archived → Active 被 _isValidTransition 拒绝
    expect(store.cas(id, MemoryState.Archived, MemoryState.Active)).toBe(false);
    expect(store.peek(id)!.state).toBe(MemoryState.Archived);
  });

  it("link 拒绝湮灭态记忆", () => {
    const a = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "活记忆",
      agentType: AgentType.Code,
      creatorId: "x",
    });
    const b = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "湮灭记忆",
      agentType: AgentType.Code,
      creatorId: "y",
    });

    store.obliterate(b);

    // 湮灭态 target 拒绝关联
    expect(store.link(a, b, LinkType.ProducedBy, "x")).toBeNull();
    // 湮灭态 source 也拒绝
    expect(store.link(b, a, LinkType.DependsOn, "y")).toBeNull();
  });

  // ── HCA/CSA 注意力区分 ────────────────────────

  it("trackAccess: false（HCA 规划扫描）不累加 accessCount", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "HCA 扫描目标",
      agentType: AgentType.Code,
      creatorId: "meta",
    });

    const before = store.peek(id)!.accessCount;

    // HCA 模式读 3 次
    store.read({ keywords: ["HCA"] });                         // CSA 默认，累加
    store.read({ keywords: ["HCA"] });                         // CSA 默认，累加
    store.read({ keywords: ["HCA"], trackAccess: false });     // HCA，不累加

    // 前两次（CSA 默认）累加了，第三次（HCA）没有
    expect(store.peek(id)!.accessCount).toBe(before + 2);
  });

  it("trackAccess: true（CSA 默认）正常累加", () => {
    const id = store.write({
      memoryType: MemoryType.Episodic,
      content: {},
      summary: "CSA 检索目标",
      agentType: AgentType.Code,
      creatorId: "code",
    });

    const before = store.peek(id)!.accessCount;
    store.read({ keywords: ["CSA"] });
    store.read({ keywords: ["CSA"], trackAccess: true });

    expect(store.peek(id)!.accessCount).toBe(before + 2);
  });
});
