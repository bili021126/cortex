// @ci: unit
import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentType, LinkType, PipelinePriority } from "@cortex/shared";
import { MemoryStore, PipelineObserver } from "@cortex/engine";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ── 写入 & 基本检索 ─────────────────────────

  it("写入并检索单条记忆", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: { taskType: "implementation", entities: ["app.ts"], decision: "done" },
      summary: "Agent 完成文件修改",
      semantic_gist: "Agent 完成文件修改",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(id).toMatch(/^mem-/);

    const results = await store.read({
      keywords: ["文件修改"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].summary).toBe("Agent 完成文件修改");
    expect(results[0].kind).toBe("TaskLog");
    expect(results[0].source.agentType).toBe(AgentType.Code);
  });

  it("按 memoryType 过滤", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "经验记忆",
      semantic_gist: "代码实现经验记录 TaskLog",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    await store.write({
      kind: "Insight",
      content_blob: {},
      summary: "知识记忆",
      semantic_gist: "分析洞察知识沉淀 Insight",
      source: { agentType: AgentType.Analysis, taskId: "" },
    });

    const epis = await store.read({ kind: "TaskLog" });
    expect(epis).toHaveLength(1);
    expect(epis[0].summary).toBe("经验记忆");

    const know = await store.read({ kind: "Insight" });
    expect(know).toHaveLength(1);
    expect(know[0].summary).toBe("知识记忆");
  });

  it("按 agentType 过滤", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "code 产出",
      semantic_gist: "code 产出",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "review 产出",
      semantic_gist: "review 产出",
      source: { agentType: AgentType.Review, taskId: "" },
    });

    const code = await store.read({ agentTypes: [AgentType.Code] });
    expect(code).toHaveLength(1);
    expect(code[0].summary).toBe("code 产出");
  });

  it("关键词匹配 content JSON 字段", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: { taskType: "bugfix", entities: ["utils.ts"], decision: "加 null 检查" },
      summary: "修复 bug",
      semantic_gist: "修复 bug",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    // 关键词在 content 中
    const r1 = await store.read({ keywords: ["null"] });
    expect(r1).toHaveLength(1);

    // 关键词在 summary 中
    const r2 = await store.read({ keywords: ["修复"] });
    expect(r2).toHaveLength(1);

    // 不匹配
    const r3 = await store.read({ keywords: ["不存在"] });
    expect(r3).toHaveLength(0);
  });

  // ── 30 天 TTL ──────────────────────────────────

  it("30 天窗口外记忆自动过滤", async () => {
    // 写入一条记忆，createdAt 设为 31 天前
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "过期记忆",
      semantic_gist: "过期记忆",
      source: { agentType: AgentType.Code, taskId: "" },
      createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });

    const results = await store.read({});
    expect(results).toHaveLength(0);
  });

  it("30 天内记忆正常可见", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "新鲜记忆",
      semantic_gist: "新鲜记忆",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(await store.read({})).toHaveLength(1);
  });

  // ── 私密记忆 ──────────────────────────────────

  it("私密记忆默认不可见", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "公开",
      semantic_gist: "公开",
      source: { agentType: AgentType.Code, taskId: "" },
      isPrivate: false,
    });
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "私密",
      semantic_gist: "私密",
      source: { agentType: AgentType.Code, taskId: "" },
      isPrivate: true,
    });

    // v3: includePrivate 已移除，默认返回所有非湮灭态记忆
    const pub = await store.read({});
    expect(pub).toHaveLength(2);
  });

  // ── 关联 ───────────────────────────────────────

  it("建立关联边 + 幂等去重", async () => {
    const a = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "源记忆",
      semantic_gist: "源记忆",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const b = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "目标记忆",
      semantic_gist: "目标记忆",
      source: { agentType: AgentType.Review, taskId: "" },
    });

    // D5: link() 改为 3 参数签名
    const link1 = store.link(a, b, LinkType.ProducedBy);
    expect(link1).toBeTruthy();
    expect(link1!.sourceId).toBe(a);
    expect(link1!.targetId).toBe(b);
    expect(link1!.linkType).toBe(LinkType.ProducedBy);

    // 幂等去重
    const link2 = store.link(a, b, LinkType.ProducedBy);
    expect(link2).toBeNull();

    // v3: 所有 linkType 幂等去重
    const link3 = store.link(a, b, LinkType.AccessedDuring);
    expect(link3).toBeTruthy();
    const link4 = store.link(a, b, LinkType.AccessedDuring);
    expect(link4).toBeNull();
  });

  it("getLinks 返回所有出边", async () => {
    const a = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "源",
      semantic_gist: "源",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const b = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "目标1",
      semantic_gist: "目标1",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const c = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "目标2",
      semantic_gist: "目标2",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.link(a, b, LinkType.ProducedBy);
    store.link(a, c, LinkType.DependsOn);

    const links = store.getLinks(a);
    expect(links).toHaveLength(2);
  });

  // ── 权重排序 ──────────────────────────────────

  it("结果按 weight 降序排列", async () => {
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "低权重",
      semantic_gist: "低权重",
      source: { agentType: AgentType.Code, taskId: "" },
      weight: 0.3,
    });
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "高权重",
      semantic_gist: "高权重",
      source: { agentType: AgentType.Code, taskId: "" },
      weight: 0.9,
    });
    await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "中权重",
      semantic_gist: "中权重",
      source: { agentType: AgentType.Code, taskId: "" },
      weight: 0.6,
    });

    const results = await store.read({});
    expect(results).toHaveLength(3);
    expect(results[0].summary).toBe("高权重");
    expect(results[1].summary).toBe("中权重");
    expect(results[2].summary).toBe("低权重");
  });

  // ── 归档（CAS 保护） ───────────────────────────

  it("archive：Active → Archived（CAS）", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "待归档",
      semantic_gist: "待归档",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(await store.read({})).toHaveLength(1);

    expect(store.archive(id)).toBe(true);
    expect(await store.read({})).toHaveLength(0);
    expect(store.peek(id)!.semantic_state).toBe("Archived");
  });

  it("archive 拒绝非 Active 态的记忆", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "先归档再归档",
      semantic_gist: "先归档再归档",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(store.archive(id)).toBe(true);  // 第一次成功
    expect(store.archive(id)).toBe(false); // 已 Archived，CAS 预期 Active 失败
  });

  // ── 四态状态机 ────────────────────────────────

  it("has：存在性检查", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "存在",
      semantic_gist: "存在",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(store.has(id)).toBe(true);
    expect(store.has("nonexistent")).toBe(false);
  });

  it("cas：合法流转成功", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "cas 测试",
      semantic_gist: "cas 测试",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    expect(store.cas(id, "Active", "Archived")).toBe(true);
    expect(store.peek(id)!.semantic_state).toBe("Archived");
  });

  it("cas：expected 不匹配时失败", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "cas 冲突",
      semantic_gist: "cas 冲突",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    // 实际是 Active，expected 传 Archived → 失败
    expect(store.cas(id, "Archived", "Archived")).toBe(false);
    expect(store.peek(id)!.semantic_state).toBe("Active"); // 未变
  });

  it("cas：Obliterated 不可逆", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "湮灭不可逆",
      semantic_gist: "湮灭不可逆",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.obliterate(id);
    expect(store.peek(id)!.semantic_state).toBe("Obliterated");

    // 任何从 Obliterated 的 CAS 都失败
    expect(store.cas(id, "Obliterated", "Active")).toBe(false);
    expect(store.cas(id, "Obliterated", "Archived")).toBe(false);
    expect(store.peek(id)!.semantic_state).toBe("Obliterated");
  });

  it("freeze：Active|Archived → Frozen", async () => {
    const a = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "冻 Active",
      semantic_gist: "冻 Active",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const b = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "冻 Archived",
      semantic_gist: "冻 Archived",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.archive(b);

    expect(store.freeze(a)).toBe(true);
    expect(store.peek(a)!.semantic_state).toBe("Archived");

    expect(store.freeze(b)).toBe(true);
    expect(store.peek(b)!.semantic_state).toBe("Archived");

    // 已 Frozen 再 freeze 幂等返回 true（不抛错，状态不变）
    expect(store.freeze(a)).toBe(true);
  });

  it("obliterate：任何非 Obliterated 态 → Obliterated", async () => {
    const a = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "湮灭 Active",
      semantic_gist: "湮灭 Active",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const b = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "湮灭 Archived",
      semantic_gist: "湮灭 Archived",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.archive(b);

    expect(store.obliterate(a)).toBe(true);
    expect(store.peek(a)!.semantic_state).toBe("Obliterated");

    expect(store.obliterate(b)).toBe(true);
    expect(store.peek(b)!.semantic_state).toBe("Obliterated");

    // 已 Obliterated 再次 obliterate：幂等，返回 true
    expect(store.obliterate(a)).toBe(true);
  });

  it("cas 拒绝 Frozen → Active", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "冻结不可回 Active",
      semantic_gist: "冻结不可回 Active",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.freeze(id);
    expect(store.peek(id)!.semantic_state).toBe("Archived");

    // Frozen → Active 被 _isValidTransition 拒绝
    expect(store.cas(id, "Archived", "Active")).toBe(false);
    expect(store.peek(id)!.semantic_state).toBe("Archived");
  });

  it("freeze 后 cas Archived→Archived 幂等（自引用允许）", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "冻结后自引用",
      semantic_gist: "冻结后自引用",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.freeze(id);
    expect(store.peek(id)!.semantic_state).toBe("Archived");

    // Archived → Archived 自引用在 v3 允许（新态=旧态，无变更）
    expect(store.cas(id, "Archived", "Archived")).toBe(true);
    expect(store.peek(id)!.semantic_state).toBe("Archived");
  });

  it("cas 拒绝 Archived → Active", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "归档不可回 Active",
      semantic_gist: "归档不可回 Active",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.archive(id);
    expect(store.peek(id)!.semantic_state).toBe("Archived");

    // Archived → Active 被 _isValidTransition 拒绝
    expect(store.cas(id, "Archived", "Active")).toBe(false);
    expect(store.peek(id)!.semantic_state).toBe("Archived");
  });

  it("link 拒绝湮灭态记忆", async () => {
    const a = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "活记忆",
      semantic_gist: "活记忆",
      source: { agentType: AgentType.Code, taskId: "" },
    });
    const b = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "湮灭记忆",
      semantic_gist: "湮灭记忆",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    store.obliterate(b);

    expect(store.link(a, b, LinkType.ProducedBy)).toBeNull();
    expect(store.link(b, a, LinkType.DependsOn)).toBeNull();
  });

  // ── HCA/CSA 注意力区分 ────────────────────────

  it("trackAccess: false（HCA 规划扫描）不累加 accessCount", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "HCA 扫描目标",
      semantic_gist: "HCA 扫描目标",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    const before = store.peek(id)!.accessCount;

    // HCA 模式读 3 次
    await store.read({ keywords: ["HCA"] });                         // CSA 默认，累加
    await store.read({ keywords: ["HCA"] });                         // CSA 默认，累加
    await await store.read({ keywords: ["HCA"] }, "HCA");                  // HCA，不累加

    // 前两次（CSA 默认）累加了，第三次（HCA）没有
    expect(store.peek(id)!.accessCount).toBe(before + 2);
  });

  it("trackAccess: true（CSA 默认）正常累加", async () => {
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "CSA 检索目标",
      semantic_gist: "CSA 检索目标",
      source: { agentType: AgentType.Code, taskId: "" },
    });

    const before = store.peek(id)!.accessCount;
    await store.read({ keywords: ["CSA"] });
    await store.read({ keywords: ["CSA"], trackAccess: true });

    expect(store.peek(id)!.accessCount).toBe(before + 2);
  });

  // ── _deserializeRow null content 边界 ─────────

  it("_deserializeRow: null content 返回 null 不崩溃（observer 通道）", () => {
    const obs = new PipelineObserver();
    const s = new MemoryStore(obs);
    const emitted: any[] = [];
    obs.on(PipelinePriority.HIGH, (event) => {
      emitted.push({ type: event.type, payload: event.payload });
    });

    const result = (s as any)._storage.deserializeRow({ id: "mem-null", content_blob: null });
    expect(result).toBeNull();

    const failed = emitted.filter((e) => e.type === "memory.deserialize_failed");
    expect(failed.length).toBe(1);
    expect(failed[0].payload.reason).toBe("null content_blob");
  });

  it("_deserializeRow: undefined content 返回 null 不崩溃", () => {
    const result = (store as any)._storage.deserializeRow({ id: "mem-undefined", content_blob: undefined });
    expect(result).toBeNull();
  });

  it("_deserializeRow: null content 无 observer 时 console.error 兜底", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = (store as any)._storage.deserializeRow({ id: "mem-null-no-obs", content_blob: null });
    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[MemoryStore] null content")
    );
    errSpy.mockRestore();
  });

  // ── M3: embedding 维度校验 ─────────────────────

  it("M3: write() 校验 embedding 维度 (期望 384)", async () => {
    // 维度正确 → 成功写入
    const validEmbedding = new Array(384).fill(0.1);
    const id = await store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "合法 embedding",
      semantic_gist: "合法 embedding",
      source: { agentType: AgentType.Code, taskId: "" },
      embedding: validEmbedding,
    });
    expect(id).toMatch(/^mem-/);

    // 维度错误 → 抛出异常
    const invalidEmbedding = new Array(128).fill(0.5);
    await expect(store.write({
      kind: "TaskLog",
      content_blob: {},
      summary: "非法 embedding",
      semantic_gist: "非法 embedding",
      source: { agentType: AgentType.Code, taskId: "" },
      embedding: invalidEmbedding,
    })).rejects.toThrow(/embedding 维度不匹配/i);
  });

  it("M3: writePending() 也校验 embedding 维度", async () => {
    const invalidEmbedding = new Array(200).fill(0.3);
    expect(() => {
      store.writePending({
        kind: "TaskLog",
        content_blob: {},
        summary: "非法 embedding",
      semantic_gist: "非法 embedding",
        source: { agentType: AgentType.Code, taskId: "" },
        embedding: invalidEmbedding,
      });
    }).toThrow(/embedding 维度不匹配/i);
  });
});
