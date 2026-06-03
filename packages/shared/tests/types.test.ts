// @ci: unit
// ============================================================
// @cortex/shared —— v2.0 类型定义编译期验证
// 不测试运行时行为，仅确保关键类型正确导出且可编译
// ============================================================

import { describe, it, expect } from "vitest";
import {
  AgentType,
  AgentStatus,
  ReversibilityLevel,
  TaskNode,
  NodeResult,
  MemoryType,
  MemoryState,
  MemoryEntry,
  MemoryLink,
  LinkType,
  MemoryQuery,
  PipelinePriority,
  ExecutionReport,
  LockType,
  PlatformKind,
  RiskDomain,
  TAG_VOCABULARY,
  AGENT_TAGS,
  AGENT_TOOL_PERMISSIONS,
  getTagVocabulary,
} from "../src/index.js";
import { resolveAgentPermissions } from "../src/agent-permissions.js";
import { AgentContext } from "../src/agent-enums.js";

describe("@cortex/shared v2.0 types", () => {
  it("AgentType includes Meta, Code, Review, Analysis, Ops, DocGovern, Inspector, Browser", () => {
    const types: AgentType[] = [
      AgentType.Meta, AgentType.Code, AgentType.Review,
      AgentType.Analysis, AgentType.Ops, AgentType.DocGovern,
      AgentType.Inspector, AgentType.Browser,
    ];
    expect(types).toHaveLength(8);
  });

  it("AgentType includes Loop and Butler as core-1 types", () => {
    expect(AgentType.Loop).toBe("loop");
    expect(AgentType.Butler).toBe("butler");
  });

  it("core-1 types do not overlap with core-2 reserved types (Api, Browser, Data)", () => {
    expect(AgentType.Api).toBe("api");
    expect(AgentType.Browser).toBe("browser");
    expect(AgentType.Data).toBe("data");
    const core1 = new Set([
      "meta", "code", "review", "analysis", "ops",
      "loop", "doc-govern", "butler", "inspector",
    ]);
    expect(core1.has(AgentType.Api)).toBe(false);
    expect(core1.has(AgentType.Browser)).toBe(false);
    expect(core1.has(AgentType.Data)).toBe(false);
  });

  it("AgentStatus follows Created → Awake → Active → Draining → Destroyed", () => {
    const states: AgentStatus[] = [
      AgentStatus.Created, AgentStatus.Awake, AgentStatus.Active,
      AgentStatus.Draining, AgentStatus.Destroyed,
    ];
    expect(states).toHaveLength(5);
  });

  it("MemoryType uses v2.0 EPISODIC/CONCEPTUAL/KNOWLEDGE/SKILL naming", () => {
    const types: MemoryType[] = [
      MemoryType.Episodic, MemoryType.Conceptual,
      MemoryType.Knowledge, MemoryType.Skill,
    ];
    expect(types).toHaveLength(4);
  });

  it("MemoryState has four-state machine: Active/Archived/Frozen/Obliterated", () => {
    const states: MemoryState[] = [
      MemoryState.Active, MemoryState.Archived,
      MemoryState.Frozen, MemoryState.Obliterated,
    ];
    expect(states).toHaveLength(4);
  });

  it("LinkType includes 9 association types for BFS graph traversal", () => {
    const types: LinkType[] = [
      LinkType.AccessedDuring, LinkType.ProducedBy, LinkType.DerivedFrom,
      LinkType.DependsOn, LinkType.RefactoredFrom, LinkType.CitedInCommittee,
      LinkType.CascadeTo, LinkType.ConfirmedUseful, LinkType.ConfirmedNoise,
    ];
    expect(types).toHaveLength(9);
  });

  it("TaskNode has required fields for scheduler dispatch", () => {
    const node: TaskNode = {
      id: "t1", type: "audit", tags: ["audit"],
      needsMultiPerspective: false, status: "pending",
      claimedBy: [], payload: "", results: [], createdAt: Date.now(),
    };
    expect(node.id).toBe("t1");
    expect(node.status).toBe("pending");
  });

  it("NodeResult captures success/failure with optional output and error", () => {
    const success: NodeResult = { nodeId: "n1", success: true, output: "ok" };
    const failure: NodeResult = { nodeId: "n2", success: false, error: "fail" };
    expect(success.success).toBe(true);
    expect(failure.success).toBe(false);
  });

  it("MemoryEntry supports metadata and project fingerprint", () => {
    const entry: MemoryEntry = {
      id: "mem-1", memoryType: MemoryType.Episodic,
      state: MemoryState.Active,
      content: { text: "test" },
      summary: "test memory", agentType: AgentType.Code,
      creatorId: "test-creator",
      createdAt: Date.now(), lastAccessedAt: Date.now(),
      accessCount: 0, weight: 1.0, isPrivate: false,
      projectFingerprint: "cortex",
    };
    expect(entry.id).toBe("mem-1");
    expect(entry.projectFingerprint).toBe("cortex");
  });

  it("MemoryQuery supports keywords, BFS graph, and metadata filtering", () => {
    const query: MemoryQuery = {
      keywords: ["test"], linkTypes: [LinkType.DependsOn],
      bfsDepth: 2,
    };
    expect(query.keywords).toContain("test");
    expect(query.bfsDepth).toBe(2);
  });

  it("ExecutionReport tracks total/completed/failed/duration", () => {
    const report: ExecutionReport = {
      totalNodes: 3, completed: 2, failed: 1,
      results: [], durationMs: 100,
    };
    expect(report.totalNodes).toBe(3);
    expect(report.failed).toBeLessThanOrEqual(report.totalNodes);
  });

  it("TAG_VOCABULARY includes inspect, doc-govern, browser, and self-examination tags", () => {
    expect(TAG_VOCABULARY).toContain("inspect");
    expect(TAG_VOCABULARY).toContain("doc-govern");
    expect(TAG_VOCABULARY).toContain("browser");
    expect(TAG_VOCABULARY).toContain("audit");
    expect(TAG_VOCABULARY).toContain("review");
    expect(TAG_VOCABULARY).toContain("pattern_scan");
  });

  it("getTagVocabulary() returns a readonly tuple with no duplicates", () => {
    const vocab = getTagVocabulary();
    expect(vocab).toContain("audit");
    expect(vocab).toContain("review");
    expect(vocab).toContain("inspect");
    const seen = new Set<string>();
    for (const tag of vocab) {
      expect(seen.has(tag)).toBe(false);
      seen.add(tag);
    }
  });

  it("AGENT_TAGS maps Inspector to inspect, Browser to browser+ui_verify", () => {
    expect(AGENT_TAGS[AgentType.Inspector]).toContain("inspect");
    expect(AGENT_TAGS[AgentType.Browser]).toContain("browser");
    expect(AGENT_TAGS[AgentType.Browser]).toContain("ui_verify");
  });

  it("AGENT_TOOL_PERMISSIONS grants run_shell to Code/Review/Ops for test analysis", () => {
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Code]).toContain("run_shell");
    // Review 在生产模式不含 run_shell，自查模式通过 resolveAgentPermissions 获得
    expect(resolveAgentPermissions(AgentType.Review, AgentContext.SelfExamination)).toContain("run_shell");
    expect(AGENT_TOOL_PERMISSIONS[AgentType.Ops]).toContain("run_shell");
  });

  it("resolveAgentPermissions: Review in Production has no run_shell (BASE_TOOLSET)", () => {
    const perms = resolveAgentPermissions(AgentType.Review, AgentContext.Production);
    expect(perms).not.toContain("run_shell");
    expect(perms).toContain("read_file");
    expect(perms).toContain("write_file");
  });

  it("resolveAgentPermissions: non-Review agents ignore context (static table)", () => {
    // Code always has FULL_TOOLSET regardless of context
    expect(resolveAgentPermissions(AgentType.Code, AgentContext.Production)).toContain("run_shell");
    expect(resolveAgentPermissions(AgentType.Code, AgentContext.SelfExamination)).toContain("run_shell");
    // Analysis always has BASE_TOOLSET
    const analysisPerms = resolveAgentPermissions(AgentType.Analysis, AgentContext.Production);
    expect(analysisPerms).not.toContain("run_shell");
    expect(resolveAgentPermissions(AgentType.Analysis, AgentContext.SelfExamination)).not.toContain("run_shell");
  });

  it("PipelinePriority CRITICAL < HIGH < NORMAL", () => {
    expect(PipelinePriority.CRITICAL).toBe(0);
    expect(PipelinePriority.HIGH).toBe(1);
    expect(PipelinePriority.NORMAL).toBe(2);
  });

  it("ReversibilityLevel L0 read-only, L3 irreversible", () => {
    expect(ReversibilityLevel.L0).toBe("L0");
    expect(ReversibilityLevel.L3).toBe("L3");
  });

  it("PlatformKind distinguishes CLI from Electron", () => {
    expect(PlatformKind.CLI).toBe("cli");
    expect(PlatformKind.Electron).toBe("electron");
  });

  it("LockType Read/Write for file lock manager", () => {
    expect(LockType.Read).toBe("read");
    expect(LockType.Write).toBe("write");
  });

  it("RiskDomain covers file_write/shell_exec/network/config_change", () => {
    const domains: RiskDomain[] = ["file_write", "shell_exec", "network", "config_change"];
    expect(domains).toHaveLength(4);
  });

  it("MemoryLink references source-target with link type and weight", () => {
    const link: MemoryLink = {
      id: "link-1", sourceId: "a", targetId: "b",
      linkType: LinkType.DependsOn, weight: 1.0,
      targetState: MemoryState.Active, lastAccessedAt: Date.now(),
    };
    expect(link.sourceId).toBe("a");
    expect(link.linkType).toBe(LinkType.DependsOn);
  });
});
