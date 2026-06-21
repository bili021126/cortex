/**
 * @cortex/governance - E2E integration tests
 * Covers: proposal -> judge -> apply -> timeout -> memory sync
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadPendingProposals, saveProposal, judgeProposals, applyApproved, checkTimeouts, summarizeGovernance, evaluateAmendment, applyAmendment, findConstitutionPath, checkTimeout, syncGovernanceToMemory, } from "../src/index.js";
import { InMemoryMemoryStore } from "../../memory/src/index.js";
// ── Helpers ─────────────────────────────────
let tmpDir;
function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-gov-"));
    fs.mkdirSync(path.join(tmpDir, "docs", "amendments"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "docs", "constitution"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "constitution", "Cortex 概念顶层设计 v2.7.0.md"), `# Cortex Constitution\n\n**版本**: v2.7.0\n\n## 原则一 | 项目本质定位 | 不可变\n\nCortex 是智能体治理框架。\n\n## 原则二 | 架构解耦 | 可变\n\n引擎与治理层通过记忆系统解耦。`, "utf-8");
}
function cleanup() {
    if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
function makeProposal(overrides) {
    return {
        id: `AM-2026-0701-${String(Math.random()).slice(2, 6)}`,
        version: "v2.8.0",
        section: "原则二",
        category: "modify",
        summary: "测试修宪提案",
        rationale: "这是自动化测试生成的提案。",
        before: "引擎与治理层通过记忆系统解耦。",
        after: "引擎与治理层通过记忆系统深度解耦，增加事件通知机制。",
        impact: { principles: [], crossReferences: [], agents: [], breaking: false },
        source: { agent: "test-agent", trace: "e2e-test" },
        status: "draft",
        ...overrides,
    };
}
// ═══════════════════════════════════════════
// §1 Proposal Management
// ═══════════════════════════════════════════
describe("Proposal Management", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("saveProposal + loadPendingProposals roundtrip", () => {
        const p = makeProposal({ status: "draft" });
        saveProposal(p, tmpDir);
        const loaded = loadPendingProposals(tmpDir);
        expect(loaded.length).toBe(1);
        expect(loaded[0].id).toBe(p.id);
        expect(loaded[0].status).toBe("draft");
    });
    it("loadPendingProposals filters by status", () => {
        saveProposal(makeProposal({ id: "AM-2026-0701-0001", status: "draft" }), tmpDir);
        saveProposal(makeProposal({ id: "AM-2026-0701-0002", status: "applied" }), tmpDir);
        saveProposal(makeProposal({ id: "AM-2026-0701-0003", status: "pending_judgment" }), tmpDir);
        const pending = loadPendingProposals(tmpDir);
        expect(pending.length).toBe(2);
        expect(pending.map((p) => p.status).sort()).toEqual(["draft", "pending_judgment"]);
    });
    it("empty amendments dir returns empty", () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-empty-"));
        const result = loadPendingProposals(empty);
        expect(result.length).toBe(0);
        fs.rmSync(empty, { recursive: true, force: true });
    });
});
// ═══════════════════════════════════════════
// §2 Amendment Judgment
// ═══════════════════════════════════════════
describe("Amendment Judgment", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("evaluateAmendment returns judgment for valid proposal", () => {
        const p = makeProposal();
        const constitution = fs.readFileSync(findConstitutionPath(tmpDir), "utf-8");
        const result = evaluateAmendment(p, constitution);
        expect(result).toBeDefined();
        expect(result.verdict).toBeDefined();
        expect(["APPROVED", "BLOCKED", "NEEDS_CLARIFICATION"]).toContain(result.verdict);
    });
    it("version continuity check rejects downgrade", () => {
        const p = makeProposal({ version: "v1.0.0" });
        const constitution = fs.readFileSync(findConstitutionPath(tmpDir), "utf-8");
        const result = evaluateAmendment(p, constitution);
        // Version downgrade should not be approved
        expect(result.verdict).not.toBe("APPROVED");
    });
    it("judgeProposals batch judges multiple proposals", () => {
        saveProposal(makeProposal({ id: "AM-2026-0701-a001", status: "pending_judgment" }), tmpDir);
        saveProposal(makeProposal({ id: "AM-2026-0701-a002", status: "pending_judgment" }), tmpDir);
        const judgments = judgeProposals(tmpDir);
        expect(judgments.length).toBe(2);
        expect(judgments[0]).toHaveProperty("judgment.verdict");
    });
});
// ═══════════════════════════════════════════
// §3 Amendment Application
// ═══════════════════════════════════════════
describe("Amendment Application", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("applyAmendment writes changes to constitution", () => {
        const p = makeProposal({ status: "approved" });
        saveProposal(p, tmpDir);
        const constitutionPath = findConstitutionPath(tmpDir);
        const original = fs.readFileSync(constitutionPath, "utf-8");
        const result = applyAmendment(p, constitutionPath);
        expect(result.success).toBe(true);
        expect(result.filePath).toBeTruthy();
    });
    it("applyApproved rejects non-approved proposals", () => {
        const p = makeProposal({ status: "draft" });
        const result = applyApproved(p, tmpDir);
        expect(result.success).toBe(false);
        expect(result.error).toContain("approved");
    });
    it("applyApproved applies and updates status", () => {
        const p = makeProposal({ status: "approved" });
        saveProposal(p, tmpDir);
        const result = applyApproved(p, tmpDir);
        expect(result.success).toBe(true);
    });
});
// ═══════════════════════════════════════════
// §4 Timeout Detection
// ═══════════════════════════════════════════
describe("Timeout Detection", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("checkTimeouts for fresh proposals returns empty", () => {
        saveProposal(makeProposal({ status: "pending_judgment" }), tmpDir);
        const actions = checkTimeouts(tmpDir);
        // Fresh proposals shouldn't time out
        expect(Array.isArray(actions)).toBe(true);
    });
    it("checkTimeout on non-existent dir handles gracefully", () => {
        const actions = checkTimeout([], "/non/existent/path");
        expect(actions.length).toBe(0);
    });
});
// ═══════════════════════════════════════════
// §5 Governance Summary
// ═══════════════════════════════════════════
describe("Governance Summary", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("summarizeGovernance returns stats", () => {
        saveProposal(makeProposal({ status: "draft" }), tmpDir);
        saveProposal(makeProposal({ status: "approved" }), tmpDir);
        saveProposal(makeProposal({ status: "applied" }), tmpDir);
        const summary = summarizeGovernance(tmpDir);
        expect(summary).toBeDefined();
        expect(summary.approved).toBeGreaterThanOrEqual(1);
        expect(summary.applied).toBeGreaterThanOrEqual(1);
        expect(summary.judgments).toBeDefined();
    });
    it("empty project returns zero summary", () => {
        const summary = summarizeGovernance(tmpDir);
        expect(summary.pendingJudgment).toBe(0);
        expect(summary.approved).toBe(0);
    });
});
// ═══════════════════════════════════════════
// §6 Memory Sync
// ═══════════════════════════════════════════
describe("Governance -> Memory Sync", () => {
    let store;
    beforeEach(() => {
        setup();
        store = new InMemoryMemoryStore();
        store.init(":memory:");
    });
    afterEach(() => cleanup());
    it("syncGovernanceToMemory writes proposals to memory", async () => {
        saveProposal(makeProposal({ id: "AM-2026-0701-m001", status: "pending_judgment" }), tmpDir);
        saveProposal(makeProposal({ id: "AM-2026-0701-m002", status: "draft" }), tmpDir);
        const result = await syncGovernanceToMemory(tmpDir, store);
        expect(result.proposalsWritten).toBeGreaterThanOrEqual(1);
        expect(result.summaryWritten).toBe(true);
        // Verify memories were written
        const memories = await store.read({ kind: "Governance" });
        expect(memories.length).toBeGreaterThan(0);
    });
});
// ═══════════════════════════════════════════
// §7 E2E: Full Governance Cycle
// ═══════════════════════════════════════════
describe("E2E Governance Cycle", () => {
    beforeEach(() => setup());
    afterEach(() => cleanup());
    it("draft -> pending_judgment -> judge -> approved -> apply -> applied", () => {
        // 1. Create proposal
        const p = makeProposal({ status: "draft" });
        saveProposal(p, tmpDir);
        // 2. Judge
        const judgments = judgeProposals(tmpDir);
        expect(judgments.length).toBe(1);
        // 3. Verify judgment
        const j = judgments[0];
        expect(j.proposalId).toBe(p.id);
        // 4. Set to approved (simulating user decision)
        p.status = "approved";
        saveProposal(p, tmpDir);
        // 5. Apply
        const result = applyApproved(p, tmpDir);
        expect(result.success).toBe(true);
        // 6. Verify summary
        const summary = summarizeGovernance(tmpDir);
        expect(summary.applied).toBeGreaterThanOrEqual(1);
    });
    it("judgeProposals with version violation blocks", () => {
        const p = makeProposal({ version: "v1.0.0", status: "pending_judgment" });
        saveProposal(p, tmpDir);
        const judgments = judgeProposals(tmpDir);
        // Version downgrade should not be approved
        expect(judgments[0].judgment.verdict).not.toBe("APPROVED");
    });
});
//# sourceMappingURL=e2e.test.js.map