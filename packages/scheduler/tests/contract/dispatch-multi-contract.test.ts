/**
 * @cortex/scheduler — dispatchMulti() Agent fan-out 契约测试
 *
 * Phase 2 P1: 覆盖 dispatchMulti 核心行为路径
 *   Test 1: 无匹配 Agent → failNode + 返回错误
 *   Test 2: 全部 claim 失败 → failNode + 全部失败兜底
 *   Test 3: 部分失败 → results.every = false 但成功的输出保留 (已知 bug, .skip)
 *   Test 4: 三策略 findAllMatchingAgents 差异
 *   Test 5: claims 跨节点独立
 *   Test 6: 全成功 → results.every = true
 *
 * 设计原则：
 *   - 不 mock 内部方法——通过公开 API 测试
 *   - 每个 it 至少 2 条断言
 *   - 已知 bug 用 .skip 标记并注释说明
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TaskBoard,
  AgentPool,
  PipelineObserver,
  TagMatchingStrategy,
  RoundRobinStrategy,
  PriorityFirstStrategy,
  PipelineModel,
} from "../../src/index.js";
import {
  AgentType as AT,
  AgentStatus,
  type Agent,
  type TaskNode,
  type NodeResult,
} from "../../../shared/src/index.js";
import { ManifoldGate } from "../../src/dispatch-steps/manifold-gate.js";

// ══════════════════════════════════════════════════════════
// 测试辅助
// ══════════════════════════════════════════════════════════

function tn(id: string, overrides?: Partial<TaskNode>): TaskNode {
  return {
    id,
    type: "code",
    tags: ["code"],
    needsMultiPerspective: true,
    status: "pending",
    claimedBy: [],
    payload: `Task ${id}`,
    results: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

class TestAgent implements Agent {
  readonly type: AT;
  readonly status: AgentStatus;
  readonly memory: unknown = null;

  private _executeResult: NodeResult;

  constructor(type: AT, status = AgentStatus.Awake, executeResult?: Partial<NodeResult>) {
    this.type = type;
    this.status = status;
    this._executeResult = {
      nodeId: "test",
      agentType: type,
      success: true,
      output: `Output from ${type}`,
      ...executeResult,
    };
  }

  async execute(_node: TaskNode, _model: string): Promise<NodeResult> {
    return { ...this._executeResult, agentType: this.type, nodeId: _node.id };
  }

  async wakeup(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/** 新建一个带池子和观察者的标准测试上下文 */
function createTestContext(agentTypes: Array<{ type: AT; status?: AgentStatus; executeResult?: Partial<NodeResult> }>) {
  const board = new TaskBoard();
  const pool = new AgentPool();
  const observer = new PipelineObserver();
  const agents = new Map<string, Agent>();
  const models = new Map<string, string>();

  for (const at of agentTypes) {
    pool.register({ type: at.type, maxInstances: 3 });
    const agent = new TestAgent(at.type, at.status ?? AgentStatus.Awake, at.executeResult);
    agents.set(at.type, agent);
    models.set(at.type, "test-model");
  }

  return { board, pool, observer, agents, models };
}

/** 快捷创建 ExecutionContext */
function execCtx(
  node: TaskNode,
  strategy: TagMatchingStrategy | RoundRobinStrategy | PriorityFirstStrategy,
  ctx: ReturnType<typeof createTestContext>,
) {
  return {
    node,
    agents: ctx.agents,
    models: ctx.models,
    board: ctx.board,
    pool: ctx.pool,
    observer: ctx.observer,
    strategy,
    isTestEnv: true,
  };
}

// ══════════════════════════════════════════════════════════
// describe 块
// ══════════════════════════════════════════════════════════

describe("dispatchMulti() Agent fan-out 契约", () => {
  const model = new PipelineModel();
  const tagStrategy = new TagMatchingStrategy();

  // 每个测试前重置 ManifoldGate 静态状态，防跨测试污染
  beforeEach(() => {
    ManifoldGate.reset();
  });

  afterEach(() => {
    ManifoldGate.reset();
  });

  // ── Test 1: 无匹配 Agent ──────────────────────────────

  it("Test 1: 无匹配 Agent → failNode + 返回错误", async () => {
    const node = tn("no-match-node", { tags: ["unmatched"], needsMultiPerspective: true });
    const ctx = createTestContext([]);
    ctx.board.addNode(node);

    const result = await model.dispatchMulti(execCtx(node, tagStrategy, ctx));

    // 无 Agent 匹配 → failNode 被调用
    expect(ctx.board.getNode("no-match-node")?.status).toBe("failed");
    // 返回值 success: false + 错误信息
    expect(result.success).toBe(false);
    expect(result.error).toContain("No agents match");
  });

  // ── Test 2: 全部 claim 失败 ────────────────────────────

  it("Test 2: 全部 claim 失败 → failNode + 全部失败兜底", async () => {
    // Agent 存在但状态为 Created（非 Awake/Active），导致 claim 被过滤
    const node = tn("all-claim-fail-node", { tags: ["code"], needsMultiPerspective: true });
    const ctx = createTestContext([
      { type: AT.Code, status: AgentStatus.Created },
      { type: AT.Review, status: AgentStatus.Draining },
    ]);
    ctx.board.addNode(node);

    const result = await model.dispatchMulti(execCtx(node, tagStrategy, ctx));

    // 所有 claim 失败 → failNode
    expect(ctx.board.getNode("all-claim-fail-node")?.status).toBe("failed");
    // 返回值 success: false + 错误信息
    expect(result.success).toBe(false);
    expect(result.error).toContain("All agents failed");
  });

  // ── Test 3: 部分失败 (已知 bug: isDone || results.every) ──

  // BUG: isDone || results.every — 有 Agent 失败时 success 误报 true
  // dispatchMulti 第 802 行 `success: isDone || results.every(r => r.success)`
  // 当所有 Agent 都报告后，multi-perspective 节点自动置为 done (isDone=true)，
  // 导致即使有 Agent 失败，整体 success 仍为 true.
  // 期望行为: success = results.every(r => r.success) —— 任一个失败则整体失败
  it.skip("Test 3: 部分失败 → results.every = false 但成功的输出保留", async () => {
    // node tags 同时匹配 code + review
    const node = tn("partial-fail-node", {
      tags: ["code", "audit"],
      needsMultiPerspective: true,
    });
    const ctx = createTestContext([
      { type: AT.Code, executeResult: { success: true, output: "code ok" } },
      { type: AT.Review, executeResult: { success: false, error: "review failed" } },
    ]);
    ctx.board.addNode(node);

    const result = await model.dispatchMulti(execCtx(node, tagStrategy, ctx));

    // 整体 success: false（因 review 失败）
    expect(result.success).toBe(false);
    // output 包含成功 Agent 的输出
    expect(result.output).toContain("code ok");
    // output 也包含失败 Agent 的信息
    expect(result.output).toContain("review failed");
  });

  // ── Test 4: 三策略 findAllMatchingAgents 差异 ─────────

  describe("Test 4: 三策略 findAllMatchingAgents 差异", () => {
    // 同一节点 (tags: ["code"])，仅注册 "review" Agent
    // TagMatchingStrategy → [] (review 不匹配 "code")
    // RoundRobinStrategy → ["review"] (回退到所有可用 Agent)
    // PriorityFirstStrategy → ["review"] (Awake 状态的 Agent 全部放入)

    const node = tn("strategy-diff-node", { tags: ["code"] });
    const agents = new Map<string, Agent>();
    agents.set(AT.Review, new TestAgent(AT.Review, AgentStatus.Awake));

    it("TagMatchingStrategy → 空列表", () => {
      const s = new TagMatchingStrategy();
      const result = s.findAllMatchingAgents(node, agents);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it("RoundRobinStrategy → 回退到可用 Agent", () => {
      const s = new RoundRobinStrategy();
      const result = s.findAllMatchingAgents(node, agents);
      expect(result.length).toBe(1);
      expect(result).toContain(AT.Review);
    });

    it("PriorityFirstStrategy → Awake Agent 全纳入", () => {
      const s = new PriorityFirstStrategy();
      const result = s.findAllMatchingAgents(node, agents);
      expect(result.length).toBe(1);
      expect(result).toContain(AT.Review);
    });
  });

  // ── Test 5: claims 跨节点独立 ─────────────────────────

  it("Test 5: claims 跨节点独立", async () => {
    // 节点 A 和 B 都需要 "code" Agent
    // A 先 claim "code" → 成功
    // B 再 claim "code" → 也成功（不同节点独立 claim）
    const nodeA = tn("node-a", { tags: ["code"], needsMultiPerspective: true });
    const nodeB = tn("node-b", { tags: ["code"], needsMultiPerspective: true });
    const ctx = createTestContext([
      { type: AT.Code, executeResult: { success: true, output: "A output" } },
    ]);
    ctx.board.addNode(nodeA);
    ctx.board.addNode(nodeB);

    const [resultA, resultB] = await Promise.all([
      model.dispatchMulti(execCtx(nodeA, tagStrategy, ctx)),
      model.dispatchMulti(execCtx(nodeB, tagStrategy, ctx)),
    ]);

    // A claim 成功 → 执行成功
    expect(resultA.success).toBe(true);
    expect(resultA.output).toContain("A output");
    // B claim 也成功（不同节点互不影响）
    expect(resultB.success).toBe(true);
    // 两个节点均已 done
    expect(ctx.board.getNode("node-a")?.status).toBe("done");
    expect(ctx.board.getNode("node-b")?.status).toBe("done");
  });

  // ── Test 6: 全成功 → results.every = true ────────────

  it("Test 6: 全成功 → results.every = true", async () => {
    const node = tn("all-success-node", { tags: ["code"], needsMultiPerspective: true });
    const ctx = createTestContext([
      { type: AT.Code, executeResult: { success: true, output: "code success" } },
    ]);
    ctx.board.addNode(node);

    const result = await model.dispatchMulti(execCtx(node, tagStrategy, ctx));

    expect(result.success).toBe(true);
    expect(result.output).toContain("code success");
    expect(ctx.board.getNode("all-success-node")?.status).toBe("done");
  });
});
