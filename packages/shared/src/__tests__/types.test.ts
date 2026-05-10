import { describe, it, expect } from "vitest";
import { AgentType, AgentStatus, TAG_VOCABULARY } from "../agent.js";
import type { TaskNode, NodeResult, ExecutionReport } from "../task.js";

describe("AgentType", () => {
  it("contains all core-1 agent types", () => {
    const coreTypes = [
      AgentType.Meta,
      AgentType.Code,
      AgentType.Review,
      AgentType.Analysis,
      AgentType.Ops,
      AgentType.Loop,
      AgentType.DocGovern,
      AgentType.Butler,
      AgentType.Inspector,
    ];
    for (const t of coreTypes) {
      expect(typeof t).toBe("string");
      expect(t.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes core-1 from core-2 reserved types", () => {
    // Core-2 预留类型
    expect(AgentType.Api).toBe("api");
    expect(AgentType.Browser).toBe("browser");
    expect(AgentType.Data).toBe("data");
    // 与 core-1 类型无重叠
    const core1 = new Set(["meta", "code", "review", "analysis", "ops", "loop", "doc-govern", "butler", "inspector"]);
    expect(core1.has(AgentType.Api)).toBe(false);
    expect(core1.has(AgentType.Browser)).toBe(false);
    expect(core1.has(AgentType.Data)).toBe(false);
  });
});

describe("AgentStatus", () => {
  it("has all 5 lifecycle states", () => {
    expect(AgentStatus.Created).toBe("created");
    expect(AgentStatus.Awake).toBe("awake");
    expect(AgentStatus.Active).toBe("active");
    expect(AgentStatus.Draining).toBe("draining");
    expect(AgentStatus.Destroyed).toBe("destroyed");
  });
});

describe("TAG_VOCABULARY", () => {
  it("includes audit and review tags for self-examination", () => {
    expect(TAG_VOCABULARY).toContain("audit");
    expect(TAG_VOCABULARY).toContain("review");
    expect(TAG_VOCABULARY).toContain("inspect");
    expect(TAG_VOCABULARY).toContain("pattern_scan");
  });

  it("is a readonly tuple with no duplicates", () => {
    const seen = new Set<string>();
    for (const tag of TAG_VOCABULARY) {
      expect(seen.has(tag)).toBe(false);
      seen.add(tag);
    }
  });
});

describe("TaskNode type shape", () => {
  it("accepts a valid minimal TaskNode", () => {
    const node: TaskNode = {
      id: "task-1",
      type: "audit",
      tags: ["audit", "review"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "Review memory-store.ts",
      results: [],
      createdAt: Date.now(),
    };
    expect(node.id).toBe("task-1");
    expect(node.status).toBe("pending");
  });

  it("accepts a TaskNode with optional fields", () => {
    const node: TaskNode = {
      id: "task-2",
      parentId: "task-1",
      type: "pattern_scan",
      tags: ["pattern_scan"],
      needsMultiPerspective: true,
      status: "done",
      claimedBy: [AgentType.Review, AgentType.Code],
      payload: "Scan for anti-patterns",
      results: [
        { nodeId: "task-2", agentType: AgentType.Review, success: true, output: "No issues" },
        { nodeId: "task-2", agentType: AgentType.Code, success: true, output: "Clean" },
      ],
      createdAt: Date.now() - 1000,
      reasoningEffort: "max",
    };
    expect(node.parentId).toBe("task-1");
    expect(node.claimedBy).toHaveLength(2);
    expect(node.results).toHaveLength(2);
    expect(node.reasoningEffort).toBe("max");
  });
});

describe("NodeResult type shape", () => {
  it("accepts success result", () => {
    const r: NodeResult = { nodeId: "n1", success: true, output: "done" };
    expect(r.success).toBe(true);
    expect(r.output).toBe("done");
  });

  it("accepts failure result", () => {
    const r: NodeResult = { nodeId: "n2", success: false, error: "timeout" };
    expect(r.success).toBe(false);
    expect(r.error).toBe("timeout");
  });
});

describe("ExecutionReport type shape", () => {
  it("has correct structure", () => {
    const report: ExecutionReport = {
      totalNodes: 3,
      completed: 2,
      failed: 1,
      results: [{ nodeId: "n1", success: true, output: "ok" }],
      durationMs: 1500,
    };
    expect(report.totalNodes).toBe(3);
    expect(report.completed + report.failed).toBeLessThanOrEqual(report.totalNodes);
  });
});
