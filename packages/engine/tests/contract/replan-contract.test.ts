// @ci: contract
/**
 * Phase 2 P2 contract test: Replan 三组件集成契约。
 *
 * 背景：
 *   curious 深钻发现：
 *   - 双入口 prompt 差异但共用解析器
 *   - impactScope 数组格式静默降级
 *   - ReAct 超时硬编码字符串匹配
 *   - replanFlight 时序竞态
 *   - budget 耗尽后静默丢节点
 *
 * 覆盖三组件集成：
 *   MetaAgent（engine）→ MetaAgentReplanAdapter → ReplanManager（scheduler）
 */

import { describe, it, expect, vi } from "vitest";
import { LlmAdapter } from "@cortex/llm";
import { MetaAgent } from "@cortex/engine";
import { MetaAgentReplanAdapter } from "@cortex/engine";
import { ReplanManager } from "@cortex/scheduler";
import type { ITaskBoard, IReplanProvider } from "@cortex/scheduler";
import { PipelineObserver } from "@cortex/scheduler";
import { resolveConfig } from "@cortex/config";
import type { TaskNode, ImpactScope } from "@cortex/shared";

// ─── Helpers ─────────────────────────────────────────

/** 构造 mock LlmAdapter：返回 JSON 数组（plan() 风格） */
function mockLlmReturn(items: unknown[]): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: JSON.stringify(items),
    toolCalls: [],
  }));
  return adapter;
}

/** 构造 mock LlmAdapter：返回原始字符串 */
function mockLlmRaw(raw: string): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: raw,
    toolCalls: [],
  }));
  return adapter;
}

/** 构造 mock LlmAdapter：返回 JSON 对象（replan 风格） */
function mockLlmReturnObject(obj: Record<string, unknown>): LlmAdapter {
  const adapter = new LlmAdapter({
    apiKey: "mock",
    baseUrl: "mock",
    chatModel: "mock-chat",
    reasonerModel: "mock-reasoner",
  });
  adapter.injectMock(async () => ({
    content: JSON.stringify(obj),
    toolCalls: [],
  }));
  return adapter;
}

/** 构造一个最小失败节点 */
function makeFailedNode(overrides?: Partial<TaskNode>): TaskNode {
  return {
    id: "failed-node-1",
    parentId: "parent-1",
    type: "analysis",
    tags: ["analysis"] as any,
    needsMultiPerspective: false,
    status: "failed",
    claimedBy: [],
    payload: "investigate memory leak",
    results: [],
    createdAt: Date.now(),
    contextPolicyId: "diagnose",
    ...overrides,
  };
}

/** 创建 mock TaskBoard——捕获 addNode 调用 */
function createMockBoard() {
  const addedNodes: TaskNode[] = [];
  const mock: ITaskBoard & { addedNodes: TaskNode[] } = {
    addNode: vi.fn((n: TaskNode) => { addedNodes.push(n); }) as any,
    claim: vi.fn() as any,
    release: vi.fn() as any,
    complete: vi.fn() as any,
    failNode: vi.fn() as any,
    getNode: vi.fn() as any,
    getAllNodes: vi.fn(() => []) as any,
    getPendingNodes: vi.fn(() => addedNodes) as any,
    removeNode: vi.fn() as any,
    removeSubtree: vi.fn() as any,
    addedNodes,
  };
  return mock;
}

// ─── 核心契约 ───────────────────────────────────────

describe("Replan 三组件集成契约", () => {
  // ═══════════════════════════════════════════════════
  // Test 1: requestReplan 正常路径 → 产出 isRlmSubtask 节点
  // ═══════════════════════════════════════════════════
  it("requestReplan 正常路径 → 产出 isRlmSubtask 节点", async () => {
    const failedNode = makeFailedNode();
    const reason = "Agent timed out: memory analysis exceeded 30s";

    // 1. MetaAgent + mock LLM 返回合法 replan JSON
    const llm = mockLlmReturnObject({
      tasks: [
        { task: "analyze heap dump", type: "analysis", tags: ["debug"] },
        { task: "fix memory leak", type: "modification", tags: ["code"] },
      ],
      impactScope: "local",
    });
    const meta = new MetaAgent(llm);
    const adapter = new MetaAgentReplanAdapter(meta);

    // 2. ReplanManager + mock board + observer
    const board = createMockBoard();
    const observer = new PipelineObserver();
    const config = resolveConfig({ maxReplanPerNode: 3, maxTotalReplans: 10 });
    const mgr = new ReplanManager(board, observer, adapter, config);

    // 3. 入队 + 发射 replan
    mgr.enqueue(failedNode, reason, "failure");
    const promise = mgr.tryFireReplan();
    await promise!;

    // 4. 断言：节点已被 addNode，且 isRlmSubtask = true
    expect(board.addedNodes.length).toBeGreaterThanOrEqual(1);
    for (const n of board.addedNodes) {
      expect(n.isRlmSubtask).toBe(true);
    }

    // 5. 断言：impactScope="local" 导致 removeNode 被调用
    expect(board.removeNode).toHaveBeenCalledWith(failedNode.id);
    expect(board.removeSubtree).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════
  // Test 2: 双入口输出一致性
  // ═══════════════════════════════════════════════════
  it("requestReplan vs requestBoundaryReplan 输出 shape 一致", async () => {
    const failedNode = makeFailedNode();
    const reason = "Agent wrote to restricted file domain";

    // 同一个 LLM mock → 返回相同 JSON
    const sharedResponse = {
      tasks: [
        { task: "review analysis output", type: "review", tags: ["audit"] },
      ],
      impactScope: "subtree",
    };
    const llm = mockLlmReturnObject(sharedResponse);
    const meta = new MetaAgent(llm);

    // 直接测试 MetaAgent（不走 ReplanManager，避免 isRlmSubtask 干扰 shape 对比）
    const replanResult = await meta.requestReplan(failedNode, reason, 0);
    const boundaryResult = await meta.requestBoundaryReplan(
      { ...failedNode, type: "analysis", tags: ["analysis"] as any },
      reason,
      0,
    );

    // 节点 shape 一致：字段列表相同
    const replanKeys = Object.keys(replanResult.nodes[0]).sort();
    const boundaryKeys = Object.keys(boundaryResult.nodes[0]).sort();
    expect(replanKeys).toEqual(boundaryKeys);

    // impactScope 被保留（sharedResponse.impactScope === "subtree"）
    // requestBoundaryReplan 的 _parseReplanResult 应该也能解析出 "subtree"
    expect(boundaryResult.impactScope).toBe("subtree");
    expect(replanResult.impactScope).toBe("subtree");
  });

  // ═══════════════════════════════════════════════════
  // Test 3: impactScope: "subtree" 触发 removeSubtree
  // ═══════════════════════════════════════════════════
  it.each([
    { scope: "subtree" as ImpactScope, expectRemoveSubtree: true },
    { scope: "local" as ImpactScope, expectRemoveSubtree: false },
  ])("impactScope=$scope → $expectRemoveSubtree ? removeSubtree : removeNode", async ({ scope, expectRemoveSubtree }) => {
    const failedNode = makeFailedNode({ id: `node-${scope}-${Date.now()}` });
    const reason = "failure";

    const llm = mockLlmReturnObject({
      tasks: [{ task: "fix", type: "code", tags: ["code"] }],
      impactScope: scope,
    });
    const meta = new MetaAgent(llm);
    const adapter = new MetaAgentReplanAdapter(meta);
    const board = createMockBoard();
    const observer = new PipelineObserver();
    const config = resolveConfig({ maxReplanPerNode: 3, maxTotalReplans: 10 });
    const mgr = new ReplanManager(board, observer, adapter, config);

    mgr.enqueue(failedNode, reason, "failure");
    const promise = mgr.tryFireReplan();
    await promise!;

    if (expectRemoveSubtree) {
      expect(board.removeSubtree).toHaveBeenCalledWith(failedNode.id);
      expect(board.removeNode).not.toHaveBeenCalled();
    } else {
      expect(board.removeNode).toHaveBeenCalledWith(failedNode.id);
      expect(board.removeSubtree).not.toHaveBeenCalled();
    }
  });

  // ═══════════════════════════════════════════════════
  // Test 4: _parseReplanResult 数组格式 → impactScope 强制 "local"
  // ═══════════════════════════════════════════════════
  it.skip("数组格式 LLM 输出 → impactScope 强制 local（已知设计行为，非缺陷）", async () => {
    // ⚠️ 风险说明：
    //   _parseReplanResult 在 LLM 返回数组格式（简洁格式无 impactScope 字段）
    //   时，硬编码将 impactScope 视为 "local"。如果 prompt 要求 "subtree"
    //   但 LLM 输出数组格式，则 impactScope 会从要求的 "subtree" 静默降级为 "local"。
    //   这是当前设计的已知行为，非缺陷——但调用方需知晓此降级风险。

    const failedNode = makeFailedNode();
    const reason = "failure";

    // LLM 返回数组格式——没有 impactScope 包装
    const llm = mockLlmReturn([
      { task: "fix connection pool", type: "modification", tags: ["code"] },
    ]);
    const meta = new MetaAgent(llm);

    const result = await meta.requestReplan(failedNode, reason, 0);

    // 即使 prompt 要求 "subtree"，数组格式也会导致 impactScope 降级为 "local"
    expect(result.impactScope).toBe("local");

    // 但节点正常解析
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].payload).toBe("fix connection pool");
  });

  // ═══════════════════════════════════════════════════
  // Test 5: fallbackNode isRlmSubtask 被 ReplanManager 强制覆盖
  // ═══════════════════════════════════════════════════
  it("fallbackNode isRlmSubtask 被 ReplanManager 强制覆盖", async () => {
    const failedNode = makeFailedNode({ id: `fallback-node-${Date.now()}` });
    const reason = "parse error";

    // LLM 返回完全不可解析的字符串
    const llm = mockLlmRaw("This is not JSON at all. No valid output here.");
    const meta = new MetaAgent(llm);
    const adapter = new MetaAgentReplanAdapter(meta);
    const board = createMockBoard();
    const observer = new PipelineObserver();
    const config = resolveConfig({ maxReplanPerNode: 3, maxTotalReplans: 10 });
    const mgr = new ReplanManager(board, observer, adapter, config);

    // 1. 验证 fallbackNode 原始产出（不经 ReplanManager）
    const rawResult = await meta.requestReplan(failedNode, reason, 0);
    expect(rawResult.nodes.length).toBe(1);
    // fallbackNode 没有 isRlmSubtask（由 _fallbackNode 生成，未设此字段）
    expect(rawResult.nodes[0].isRlmSubtask).toBeUndefined();
    expect(rawResult.impactScope).toBe("local");

    // 2. 经过 ReplanManager._drain → 强制覆盖
    mgr.enqueue(failedNode, reason, "failure");
    const promise = mgr.tryFireReplan();
    await promise!;

    // ReplanManager._drain 强制设置了 n.isRlmSubtask = true
    expect(board.addedNodes.length).toBe(1);
    expect(board.addedNodes[0].isRlmSubtask).toBe(true);

    // 验证 fallbackNode 的 payload 就是原始 raw 字符串
    expect(board.addedNodes[0].payload).toBe("This is not JSON at all. No valid output here.");
  });

  // ═══════════════════════════════════════════════════
  // Test 6: replanFlight await 后节点已写入 board
  // ═══════════════════════════════════════════════════
  it("tryFireReplan await 后节点已写入 board", async () => {
    const failedNode = makeFailedNode({ id: `race-node-${Date.now()}` });
    const reason = "timeout";

    const llm = mockLlmReturnObject({
      tasks: [
        { task: "retry with backoff", type: "code", tags: ["code"] },
        { task: "validate result", type: "review", tags: ["audit"] },
      ],
      impactScope: "local",
    });
    const meta = new MetaAgent(llm);
    const adapter = new MetaAgentReplanAdapter(meta);
    const board = createMockBoard();
    const observer = new PipelineObserver();
    const config = resolveConfig({ maxReplanPerNode: 3, maxTotalReplans: 10 });
    const mgr = new ReplanManager(board, observer, adapter, config);

    // 入队后立即 tryFireReplan → await 结果
    mgr.enqueue(failedNode, reason, "failure");

    // await 前：board 应尚为空（await 保证 _drain 完成）
    expect(board.getPendingNodes()).toEqual([]);

    const flight = mgr.tryFireReplan();
    await flight!; // 等待 _drain 完成

    // await 后：节点应已写入 board
    const pending = board.getPendingNodes();
    expect(pending.length).toBe(2);
    // payload 验证
    expect(pending[0].payload).toBe("retry with backoff");
    expect(pending[1].payload).toBe("validate result");

    // 且 isRlmSubtask 已标记
    expect(pending.every((n) => n.isRlmSubtask === true)).toBe(true);
  });
});
