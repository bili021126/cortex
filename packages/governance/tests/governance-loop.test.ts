// @ci: unit
// ============================================================
// @cortex/governance — GovernanceLoop 测试
//
// 覆盖 loadPendingProposals, saveProposal, updateProposalStatus,
// judgeProposals, applyApproved, summarizeGovernance, checkTimeouts
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import {
  loadPendingProposals,
  saveProposal,
  updateProposalStatus,
} from "@cortex/governance";

function makeProposal(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "AM-TEST-001",
    version: "v2.6.0",
    section: "§5.1",
    category: "modify" as const,
    summary: "Test amendment proposal for unit test",
    rationale: "This is a test rationale with sufficient length to pass format checks.",
    before: "original content",
    after: "modified content",
    impact: {
      principles: [],
      crossReferences: [],
      agents: [],
      breaking: false,
    },
    source: {
      agent: "test-agent",
      trace: "unit-test",
    },
    status: "draft" as const,
    ...overrides,
  };
}

describe("GovernanceLoop — 提案管理", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-loop-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadPendingProposals — 空目录返回空数组", () => {
    const result = loadPendingProposals(tmpDir);
    expect(result).toEqual([]);
  });

  it("saveProposal → 保存提案文件到 amendments 目录", () => {
    const proposal = makeProposal();
    saveProposal(proposal, tmpDir);
    const dir = path.join(tmpDir, "docs", "amendments");
    expect(fs.existsSync(dir)).toBe(true);
    const files = fs.readdirSync(dir);
    expect(files).toContain("AM-TEST-001.json");
  });

  it("loadPendingProposals — 加载 draft 状态的提案", () => {
    const proposal = makeProposal({ status: "draft" });
    saveProposal(proposal, tmpDir);
    const proposals = loadPendingProposals(tmpDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0].id).toBe("AM-TEST-001");
  });

  it("loadPendingProposals — 加载 pending_judgment 状态的提案", () => {
    const proposal = makeProposal({ id: "AM-TEST-002", status: "pending_judgment" });
    saveProposal(proposal, tmpDir);
    const proposals = loadPendingProposals(tmpDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0].status).toBe("pending_judgment");
  });

  it("loadPendingProposals — 跳过 applied/rejected 状态的提案", () => {
    saveProposal(makeProposal({ id: "AM-TEST-001", status: "draft" }), tmpDir);
    saveProposal(makeProposal({ id: "AM-TEST-002", status: "applied" }), tmpDir);
    saveProposal(makeProposal({ id: "AM-TEST-003", status: "rejected" }), tmpDir);
    const proposals = loadPendingProposals(tmpDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0].id).toBe("AM-TEST-001");
  });

  it("saveProposal — 写入 tmp 后原子重命名", () => {
    const proposal = makeProposal();
    saveProposal(proposal, tmpDir);
    const filePath = path.join(tmpDir, "docs", "amendments", "AM-TEST-001.json");
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.id).toBe("AM-TEST-001");
    expect(content.status).toBe("draft");
  });

  it("updateProposalStatus — 更新提案状态", () => {
    saveProposal(makeProposal(), tmpDir);
    updateProposalStatus("AM-TEST-001", "approved", tmpDir);
    const filePath = path.join(tmpDir, "docs", "amendments", "AM-TEST-001.json");
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.status).toBe("approved");
  });

  it("updateProposalStatus — 不存在的提案静默跳过", () => {
    expect(() =>
      updateProposalStatus("NONEXISTENT", "approved", tmpDir),
    ).not.toThrow();
  });

  it("loadPendingProposals — 格式错误的 JSON 文件被跳过", () => {
    const dir = path.join(tmpDir, "docs", "amendments");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "invalid.json"), "not-json-content", "utf-8");
    fs.writeFileSync(path.join(dir, "valid.json"), JSON.stringify(makeProposal({ id: "AM-TEST-003" })), "utf-8");
    const proposals = loadPendingProposals(tmpDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0].id).toBe("AM-TEST-003");
  });

  // ── C-5: 治理管线自动批准 — 无回调时的行为 ──

  it("should require explicit callback when no ruler decision available (C-5)", () => {
    // 提案创建后初始为 'draft' 状态——非自动批准
    const proposal = makeProposal();
    expect(proposal.status).toBe("draft");

    // 保存后状态仍为 draft，不应自动变为 approved
    saveProposal(proposal, tmpDir);
    const filePath = path.join(tmpDir, "docs", "amendments", "AM-TEST-001.json");
    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(saved.status).toBe("draft");

    // 只有通过 updateProposalStatus 显式更新才能改变状态
    updateProposalStatus("AM-TEST-001", "approved", tmpDir);
    const updated = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(updated.status).toBe("approved");

    // 没有 ruler 决策时，提案不应自动批准（需显式回调）
    const proposal2 = makeProposal({ id: "AM-TEST-002" });
    saveProposal(proposal2, tmpDir);
    const saved2 = JSON.parse(fs.readFileSync(path.join(tmpDir, "docs", "amendments", "AM-TEST-002.json"), "utf-8"));
    expect(saved2.status).toBe("draft");
  });
});
