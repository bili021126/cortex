// @ci: unit
/**
 * amendment-timeout 超时处置单元测试。
 *
 * 覆盖：
 *   - 新鲜提案（不超时）→ 无动作
 *   - pending_judgment 超过 TTL → needs_attention
 *   - draft 超过 TTL → warn_stale
 *   - 连续多次超时 → auto_reject
 *   - updateStaleCount 正确追踪计数
 *   - 非 draft/pending_judgment 提案被跳过
 *   - 自定义 TimeoutConfig
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkTimeout, updateStaleCount } from "@cortex/governance";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
// ── 辅助函数 ─────────────────────────────────────
function makeProposal(overrides = {}) {
    return {
        id: "AM-2026-0615-001",
        version: "v2.6.0",
        section: "§5.1",
        category: "modify",
        summary: "测试提案",
        rationale: "测试用修宪理由",
        before: "old text",
        after: "new text",
        impact: {
            principles: [],
            crossReferences: [],
            agents: [],
            breaking: false
        },
        source: {
            agent: "TestAgent",
            trace: "测试追溯"
        },
        status: "pending_judgment",
        ...overrides
    };
}
/** 设置文件的 mtime 为 daysAgo 天前 */
function setFileAge(filePath, daysAgo) {
    const now = Date.now();
    const mtime = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, mtime, mtime);
}
// ── 测试套件 ─────────────────────────────────────
describe("amendment-timeout", () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-amendment-timeout-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    // ─── checkTimeout ──────────────────────────────
    describe("checkTimeout", () => {
        it("returns empty for fresh pending_judgment proposal", () => {
            const proposal = makeProposal({ id: "AM-001", status: "pending_judgment" });
            writeProposal(tmpDir, proposal);
            // 文件刚创建，0 天 → 不超时
            const actions = checkTimeout([proposal], tmpDir);
            expect(actions).toEqual([]);
        });
        it("returns empty for fresh draft proposal", () => {
            const proposal = makeProposal({ id: "AM-002", status: "draft" });
            writeProposal(tmpDir, proposal);
            const actions = checkTimeout([proposal], tmpDir);
            expect(actions).toEqual([]);
        });
        it("skips approved/rejected/applied proposals", () => {
            for (const status of ["approved", "rejected", "applied"]) {
                const proposal = makeProposal({ id: `AM-${status}`, status });
                writeProposal(tmpDir, proposal);
                const actions = checkTimeout([proposal], tmpDir);
                expect(actions).toEqual([]);
            }
        });
        it("returns needs_attention for expired pending_judgment (1st timeout)", () => {
            const proposal = makeProposal({ id: "AM-003", status: "pending_judgment" });
            writeProposal(tmpDir, proposal, /* daysAgo */ 10);
            const actions = checkTimeout([proposal], tmpDir, { judgmentTTLDays: 7 });
            expect(actions).toHaveLength(1);
            expect(actions[0]).toMatchObject({
                proposalId: "AM-003",
                action: "needs_attention",
                daysPending: 10
            });
            expect(actions[0].reason).toContain("AM-003");
            expect(actions[0].reason).toContain("10 天");
        });
        it("returns warn_stale for expired draft", () => {
            const proposal = makeProposal({ id: "AM-004", status: "draft" });
            writeProposal(tmpDir, proposal, /* daysAgo */ 20);
            const actions = checkTimeout([proposal], tmpDir, { draftTTLDays: 14 });
            expect(actions).toHaveLength(1);
            expect(actions[0]).toMatchObject({
                proposalId: "AM-004",
                action: "warn_stale",
                daysPending: 20
            });
            expect(actions[0].reason).toContain("AM-004");
            expect(actions[0].reason).toContain("20 天");
        });
        it("returns auto_reject after maxStaleCount consecutive timeouts", () => {
            const proposal = makeProposal({ id: "AM-005", status: "pending_judgment" });
            writeProposal(tmpDir, proposal, /* daysAgo */ 10);
            // 模拟已有 2 次超时计录
            const counterPath = path.join(tmpDir, ".timeout-counters.json");
            fs.writeFileSync(counterPath, JSON.stringify({ "AM-005": 3 }), "utf-8");
            const actions = checkTimeout([proposal], tmpDir, { judgmentTTLDays: 7, maxStaleCount: 3 });
            expect(actions).toHaveLength(1);
            expect(actions[0]).toMatchObject({
                proposalId: "AM-005",
                action: "auto_reject"
            });
            expect(actions[0].reason).toContain("自动拒绝");
        });
        it("handles multiple proposals with mixed results", () => {
            const freshProposal = makeProposal({ id: "AM-010", status: "pending_judgment" });
            const expiredProposal = makeProposal({ id: "AM-011", status: "pending_judgment" });
            const expiredDraft = makeProposal({ id: "AM-012", status: "draft" });
            const approvedProposal = makeProposal({ id: "AM-013", status: "approved" });
            writeProposal(tmpDir, freshProposal, 0);
            writeProposal(tmpDir, expiredProposal, 10);
            writeProposal(tmpDir, expiredDraft, 20);
            writeProposal(tmpDir, approvedProposal, 30);
            const actions = checkTimeout([freshProposal, expiredProposal, expiredDraft, approvedProposal], tmpDir, { judgmentTTLDays: 7, draftTTLDays: 14 });
            expect(actions).toHaveLength(2);
            expect(actions.map((a) => a.proposalId).sort()).toEqual(["AM-011", "AM-012"]);
        });
        it("handles missing proposal file gracefully (daysPending=0)", () => {
            const proposal = makeProposal({ id: "AM-099", status: "pending_judgment" });
            // 不写文件
            const actions = checkTimeout([proposal], tmpDir);
            expect(actions).toEqual([]);
        });
        it("respects custom TimeoutConfig", () => {
            const proposal = makeProposal({ id: "AM-020", status: "pending_judgment" });
            writeProposal(tmpDir, proposal, 5);
            // 自定义 TTL=3 → 4 天就超时
            const actions = checkTimeout([proposal], tmpDir, { judgmentTTLDays: 3 });
            expect(actions).toHaveLength(1);
            expect(actions[0].action).toBe("needs_attention");
        });
        it("returns empty when exactly at TTL boundary", () => {
            const proposal = makeProposal({ id: "AM-030", status: "pending_judgment" });
            writeProposal(tmpDir, proposal, 7);
            // 恰好 7 天，strict > check，不超时
            const actions = checkTimeout([proposal], tmpDir, { judgmentTTLDays: 7 });
            expect(actions).toEqual([]);
        });
    });
    // ─── updateStaleCount ──────────────────────────
    describe("updateStaleCount", () => {
        it("creates counter file and sets count to 1 on first call", () => {
            updateStaleCount("AM-100", tmpDir);
            const counterPath = path.join(tmpDir, ".timeout-counters.json");
            expect(fs.existsSync(counterPath)).toBe(true);
            const counters = JSON.parse(fs.readFileSync(counterPath, "utf-8"));
            expect(counters["AM-100"]).toBe(1);
        });
        it("increments existing count", () => {
            const counterPath = path.join(tmpDir, ".timeout-counters.json");
            fs.writeFileSync(counterPath, JSON.stringify({ "AM-101": 2 }), "utf-8");
            updateStaleCount("AM-101", tmpDir);
            const counters = JSON.parse(fs.readFileSync(counterPath, "utf-8"));
            expect(counters["AM-101"]).toBe(3);
        });
        it("adds new entry alongside existing ones", () => {
            const counterPath = path.join(tmpDir, ".timeout-counters.json");
            fs.writeFileSync(counterPath, JSON.stringify({ "AM-200": 1 }), "utf-8");
            updateStaleCount("AM-201", tmpDir);
            const counters = JSON.parse(fs.readFileSync(counterPath, "utf-8"));
            expect(counters["AM-200"]).toBe(1);
            expect(counters["AM-201"]).toBe(1);
        });
        it("handles corrupted counter file gracefully", () => {
            const counterPath = path.join(tmpDir, ".timeout-counters.json");
            fs.writeFileSync(counterPath, "not valid json {{{", "utf-8");
            // 不应抛异常，应从头开始
            expect(() => updateStaleCount("AM-300", tmpDir)).not.toThrow();
            const counters = JSON.parse(fs.readFileSync(counterPath, "utf-8"));
            expect(counters["AM-300"]).toBe(1);
        });
    });
});
// ── 内部辅助 ─────────────────────────────────────
function writeProposal(dir, proposal, daysAgo) {
    const filePath = path.join(dir, `${proposal.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2), "utf-8");
    if (daysAgo !== undefined) {
        setFileAge(filePath, daysAgo);
    }
}
//# sourceMappingURL=amendment-timeout.test.js.map