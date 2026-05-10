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
} from "../src/index.js";

describe("@cortex/shared v2.0 types", () => {
  it("AgentType includes Meta, Code, Review, Analysis, Ops, DocGovern, Inspector, Browser", () => {
    const types: AgentType[] = [
      AgentType.Meta, AgentType.Code, AgentType.Review,
      AgentType.Analysis, AgentType.Ops, AgentType.DocGovern,
      AgentType.Inspector, AgentType.Browser,
    ];
    expect(types).toHaveLength(8);
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
    expect(MemoryType.Episodic).toBe("EPISODIC");
  });

  it("MemoryState has four-state machine: Active/Archived/Frozen/Obliterated", () => {
    const states: MemoryState[] = [
      MemoryState.Active, MemoryState.Archived,
      MemoryState.Frozen, MemoryState.Obliterated,
    ];
    expect(states).toHaveLength(4);
    expect(MemoryState.Obliterated).toBe("OBLITERATED");
  });

  it("LinkType includes 7 association types for BFS graph traversal", () => {
    const linkTypes: LinkType[] = [
      LinkType.AccessedDuring, LinkType.ProducedBy,
      LinkType.DerivedFrom, LinkType.DependsOn,
      LinkType.RefactoredFrom, LinkType.CitedInCommittee,
      LinkType.CascadeTo,
    ];
    expect(linkTypes).toHaveLength(7);
  });

  it("TaskNode has required fields for scheduler dispatch", () => {
    const node: TaskNode = {
      id: "n1",
      type: "bugfix",
      tags: ["bugfix"],
      needsMultiPerspective: false,
      status: "pending",
      claimedBy: [],
      payload: "fix the thing",
      results: [],
      createdAt: Date.now(),
    };
    expect(node.id).toBe("n1");
  });

  it("NodeResult captures success/failure with optional output and error", () => {
    const ok: NodeResult = { nodeId: "n1", success: true, output: "done" };
    const fail: NodeResult = { nodeId: "n2", success: false, error: "oops" };
    expect(ok.success).toBe(true);
    expect(fail.error).toBe("oops");
  });

  it("MemoryEntry supports metadata and project fingerprint", () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      memoryType: MemoryType.Episodic,
      state: MemoryState.Active,
      content: { key: "val" },
      summary: "test",
      agentType: AgentType.Code,
      creatorId: AgentType.Code,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      weight: 1.0,
      metadata: { taskId: "t1" },
      isPrivate: false,
    };
    expect(entry.metadata?.taskId).toBe("t1");
  });

  it("MemoryQuery supports keywords, BFS graph, and metadata filtering", () => {
    const query: MemoryQuery = {
      keywords: ["scheduler"],
      memoryTypes: [MemoryType.Episodic],
      states: [MemoryState.Active],
      bfsDepth: 2,
      bfsMaxNodes: 20,
      linkTypes: [LinkType.ProducedBy],
      metadataFilter: { taskId: "t1" },
      limit: 5,
    };
    expect(query.keywords).toContain("scheduler");
  });

  it("ExecutionReport tracks total/completed/failed/duration", () => {
    const report: ExecutionReport = {
      totalNodes: 10,
      completed: 8,
      failed: 2,
      results: [],
      durationMs: 1500,
    };
    expect(report.totalNodes).toBe(10);
  });

  it("TAG_VOCABULARY includes inspect and doc_govern for new agent types", () => {
    expect(TAG_VOCABULARY).toContain("inspect");
    expect(TAG_VOCABULARY).toContain("doc_govern");
    expect(TAG_VOCABULARY).toContain("browser");
  });

  it("AGENT_TAGS maps Inspector to inspect, Browser to browser+ui_verify", () => {
    expect(AGENT_TAGS[AgentType.Inspector]).toContain("inspect");
    expect(AGENT_TAGS[AgentType.Browser]).toContain("browser");
    expect(AGENT_TAGS[AgentType.Browser]).toContain("ui_verify");
  });

  it("AGENT_TOOL_PERMISSIONS grants full toolset to Code/Review/Analysis agents", () => {
    const codePerms = AGENT_TOOL_PERMISSIONS[AgentType.Code];
    expect(codePerms).toContain("read_file");
    expect(codePerms).toContain("write_file");
    expect(codePerms).toContain("run_shell");
  });

  it("PipelinePriority CRITICAL < HIGH < NORMAL", () => {
    expect(PipelinePriority.CRITICAL).toBeLessThan(PipelinePriority.HIGH);
    expect(PipelinePriority.HIGH).toBeLessThan(PipelinePriority.NORMAL);
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
      id: "link-1",
      sourceId: "mem-1",
      targetId: "mem-2",
      linkType: LinkType.ProducedBy,
      weight: 0.5,
      targetState: MemoryState.Active,
      lastAccessedAt: Date.now(),
    };
    expect(link.linkType).toBe("PRODUCED_BY");
  });
});
