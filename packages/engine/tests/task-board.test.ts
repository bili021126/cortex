// @ci: unit
import { describe, it, expect } from "vitest";
import { TaskBoard } from "../src/task-board";
import { AgentType } from "@cortex/shared";

function makeNode(overrides: Partial<Parameters<TaskBoard["addNode"]>[0]> = {}) {
  return {
    id: "node-1",
    type: "implementation",
    tags: ["implementation"] as any[],
    needsMultiPerspective: false,
    status: "pending" as const,
    claimedBy: [] as AgentType[],
    results: [],
    payload: "写 hello world",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("TaskBoard", () => {
  // ── 普通节点（needsMultiPerspective = false） ──

  it("Agent 认领匹配标签的 pending 节点", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ tags: ["implementation"] }));
    const claimed = tb.claim("node-1", AgentType.Code);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("claimed");
  });

  it("拒绝标签不匹配的 Agent", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ tags: ["deploy"] }));
    expect(tb.claim("node-1", AgentType.Code)).toBeNull();
  });

  it("普通节点已认领后拒绝重复认领", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode());
    tb.claim("node-1", AgentType.Code);
    expect(tb.claim("node-1", AgentType.Code)).toBeNull();
  });

  it("findPending 返回标签匹配的 pending 节点", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ id: "a", tags: ["implementation"] }));
    tb.addNode(makeNode({ id: "b", tags: ["deploy"] }));
    tb.addNode(makeNode({ id: "c", tags: ["refactor"] }));
    const pending = tb.findPending(AgentType.Code);
    expect(pending).toHaveLength(2); // implementation + refactor
  });

  // ── needsMultiPerspective 多视角节点 ──

  it("多视角节点不同 Agent 类型可并行认领", () => {
    const tb = new TaskBoard();
    tb.addNode(
      makeNode({
        needsMultiPerspective: true,
        tags: ["review", "research"],
      }),
    );
    const r1 = tb.claim("node-1", AgentType.Review);
    expect(r1).not.toBeNull();
    expect(r1!.status).toBe("running"); // multi → running

    const r2 = tb.claim("node-1", AgentType.Analysis);
    expect(r2).not.toBeNull();
    expect(r2!.claimedBy).toContain(AgentType.Review);
    expect(r2!.claimedBy).toContain(AgentType.Analysis);
  });

  it("多视角节点同类型重复认领被拒绝", () => {
    const tb = new TaskBoard();
    tb.addNode(
      makeNode({
        needsMultiPerspective: true,
        tags: ["review", "research"],
      }),
    );
    tb.claim("node-1", AgentType.Review);
    expect(tb.claim("node-1", AgentType.Review)).toBeNull();
  });

  it("多视角节点 findPending 对已认领类型不可见", () => {
    const tb = new TaskBoard();
    tb.addNode(
      makeNode({
        needsMultiPerspective: true,
        tags: ["review", "research"],
      }),
    );
    tb.claim("node-1", AgentType.Review);
    // ReviewAgent 已认领 → findPending 不返回该节点
    const forReview = tb.findPending(AgentType.Review);
    expect(forReview).toHaveLength(0);
    // AnalysisAgent 未认领 → findPending 仍可见
    const forAnalysis = tb.findPending(AgentType.Analysis);
    expect(forAnalysis).toHaveLength(1);
  });

  it("多视角节点等齐全部 Agent 产出后自动 complete", () => {
    const tb = new TaskBoard();
    tb.addNode(
      makeNode({
        needsMultiPerspective: true,
        tags: ["review", "deploy"],
      }),
    );
    tb.claim("node-1", AgentType.Review);
    tb.claim("node-1", AgentType.Ops);

    // ReviewAgent 产出
    tb.complete("node-1", AgentType.Review, true, "审查通过");
    expect(tb.getNode("node-1")!.status).toBe("running"); // 不等齐
    expect(tb.allPerspectivesComplete("node-1")).toBe(false);

    // OpsAgent 产出 → 等齐，自动 done
    tb.complete("node-1", AgentType.Ops, true, "部署检查完成");
    expect(tb.getNode("node-1")!.status).toBe("done");
    expect(tb.allPerspectivesComplete("node-1")).toBe(true);
  });

  it("多视角节点已完成/失败后不可再认领", () => {
    const tb = new TaskBoard();
    tb.addNode(
      makeNode({
        needsMultiPerspective: true,
        tags: ["review"],
      }),
    );
    tb.claim("node-1", AgentType.Review);
    tb.complete("node-1", AgentType.Review, false, undefined, "审查失败");
    expect(tb.claim("node-1", AgentType.Analysis)).toBeNull();
  });

  // ── release 原语 ──

  it("普通节点 claimed 态 release → 回到 pending", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode());
    tb.claim("node-1", AgentType.Code);
    const ok = tb.release("node-1", AgentType.Code);
    expect(ok).toBe(true);
    const n = tb.getNode("node-1")!;
    expect(n.status).toBe("pending");
    expect(n.claimedBy).toEqual([]);
    // 释放后可被重新认领
    expect(tb.claim("node-1", AgentType.Code)).not.toBeNull();
  });

  it("普通节点非认领者 release 被拒绝", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ tags: ["implementation", "ops"] }));
    tb.claim("node-1", AgentType.Code);
    expect(tb.release("node-1", AgentType.Ops)).toBe(false);
    // CodeAgent 仍持有
    expect(tb.getNode("node-1")!.status).toBe("claimed");
  });

  it("普通节点 done/failed 态 release 被拒绝", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode());
    tb.claim("node-1", AgentType.Code);
    tb.complete("node-1", AgentType.Code, true, "ok");
    // failed 也一样
    expect(tb.release("node-1", AgentType.Code)).toBe(false);
    expect(tb.getNode("node-1")!.status).toBe("done");
  });

  it("多视角节点 running 态 release 移除单个 agentType", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ needsMultiPerspective: true, tags: ["review", "research"], id: "mp-1" }));
    tb.claim("mp-1", AgentType.Review);
    tb.claim("mp-1", AgentType.Analysis);
    // 模拟 Analysis spawn 失败
    const ok = tb.release("mp-1", AgentType.Analysis);
    expect(ok).toBe(true);
    const n = tb.getNode("mp-1")!;
    expect(n.claimedBy).toEqual([AgentType.Review]);
    expect(n.status).toBe("running"); // 仍在运行中（Review 继续）
  });

  it("多视角节点 release 后 claimedBy 为空 → 回到 pending", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ needsMultiPerspective: true, tags: ["review"], id: "mp-2" }));
    tb.claim("mp-2", AgentType.Review);
    const ok = tb.release("mp-2", AgentType.Review);
    expect(ok).toBe(true);
    const n = tb.getNode("mp-2")!;
    expect(n.status).toBe("pending");
    expect(n.claimedBy).toEqual([]);
  });

  it("多视角节点 done/failed 态 release 被拒绝", () => {
    const tb = new TaskBoard();
    tb.addNode(makeNode({ needsMultiPerspective: true, tags: ["review"], id: "mp-3" }));
    tb.claim("mp-3", AgentType.Review);
    tb.complete("mp-3", AgentType.Review, true, "done");
    expect(tb.release("mp-3", AgentType.Review)).toBe(false);
  });
});
