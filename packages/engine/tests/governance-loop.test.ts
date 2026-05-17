// @ci: unit
/**
 * GovernanceLoop 治理闭环测试。
 *
 * 覆盖：loadPendingProposals / saveProposal / updateProposalStatus /
 * judgeProposals / applyApproved / summarizeGovernance
 *
 * 裁决权二分测试：
 * - judgeProposals 读提案+宪法 → 输出评判（昔涟职责）
 * - applyApproved 仅对 status=approved 的提案写入（开拓者裁决后）
 * - applyApproved 拒绝非 approved 状态的提案
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadPendingProposals,
  saveProposal,
  updateProposalStatus,
  judgeProposals,
  applyApproved,
  summarizeGovernance,
} from "../src/governance-loop.js";
import type { AmendmentProposal } from "@cortex/shared";

// ─── 辅助函数 ───────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-govloop-test-"));
}

function makeConstitution(dir: string, version = "v2.5.10"): string {
  const constitutionDir = path.join(dir, "docs", "constitution");
  fs.mkdirSync(constitutionDir, { recursive: true });
  const content = `# Cortex 概念顶层设计 v2.5

**版本**：${version}
**状态**：测试用宪法

---

## 二、六条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道。SafeErrorReporter 作为上层协议定义 fatal / degraded / silent 三档错误上报标准，杜绝静默吞错 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。Agent 之间协商不替代用户最终决策——用户始终保有否决权和最终裁量权 | 不可变 |

---

## 五、Agent 池

DocGovernAgent 是治理审计引擎。MetaAgent 是战术中枢。

---

## 八、PipelineObserver——可观测管道

所有可观测事件走统一管道。

### 8.1 SafeErrorReporter——统一错误上报协议

建于 PipelineObserver 之上。三档严重性。

---

**文档状态**：${version}。替代前一版本。
`;
  const filePath = path.join(constitutionDir, "Cortex 概念顶层设计 v2.5.md");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function makeValidProposal(overrides: Partial<AmendmentProposal> = {}): AmendmentProposal {
  return {
    id: "AM-TEST-001",
    version: "v2.5.11",
    section: "原则七",
    category: "modify",
    summary: "测试用修宪提案——将六条原则扩展为七条",
    rationale: "这是一个测试修宪提案，用于验证治理闭环的评判-裁决-写入链路。理由不少于五十字以确保通过格式一致性检查。",
    before: `## 二、六条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道。SafeErrorReporter 作为上层协议定义 fatal / degraded / silent 三档错误上报标准，杜绝静默吞错 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。Agent 之间协商不替代用户最终决策——用户始终保有否决权和最终裁量权 | 不可变 |`,
    after: `## 二、七条不可变原则

| 原则 | 内容 | 不可变性 |
|------|------|---------|
| **原则一** | 确认这个动作永远在用户手里。任何 L2/L3 不可逆操作必须经用户确认 | 不可变 |
| **原则二** | 规划与执行分离。MetaAgent 只规划不执行，Agent 只执行不规划 | 不可变 |
| **原则三** | 安全边界在 Toolkit 调用层。Toolkit 按 Agent 类型集中校验权限，Agent 以身份调用，不持有权限定义 | 不可变 |
| **原则四** | 谁调用谁负责。Agent 对其工具调用的后果承担全部责任 | 不可变 |
| **原则五** | 所有可观测事件走 PipelineObserver 统一管道。SafeErrorReporter 作为上层协议定义 fatal / degraded / silent 三档错误上报标准，杜绝静默吞错 | 不可变 |
| **原则六** | 用户是最终裁决者。多 Agent 并行产出须先经圆桌协商收束为统一视图，再呈用户裁决。Agent 之间协商不替代用户最终决策——用户始终保有否决权和最终裁量权 | 不可变 |
| **原则七** | 测试原则——新增的第七条不可变原则 | 不可变 |`,
    impact: {
      principles: [],
      crossReferences: ["二、六条不可变原则", "原则六"],
      agents: ["DocGovernAgent"],
      breaking: false,
    },
    source: {
      agent: "TestAgent",
      trace: "governance-loop.test.ts 单元测试",
    },
    status: "pending_judgment",
    ...overrides,
  };
}

function cleanup(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── 测试 ───────────────────────────────────────

describe("GovernanceLoop", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── 提案管理 ─────────────────────────────────

  describe("saveProposal / loadPendingProposals", () => {
    it("保存提案后可通过 loadPendingProposals 读取", () => {
      const proposal = makeValidProposal();
      saveProposal(proposal, tmpDir);

      const loaded = loadPendingProposals(tmpDir);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe("AM-TEST-001");
      expect(loaded[0].status).toBe("pending_judgment");
    });

    it("空目录返回空数组", () => {
      const loaded = loadPendingProposals(tmpDir);
      expect(loaded).toEqual([]);
    });

    it("不加载已 applied 的提案", () => {
      const proposal = makeValidProposal({ status: "applied" });
      saveProposal(proposal, tmpDir);

      const loaded = loadPendingProposals(tmpDir);
      expect(loaded).toHaveLength(0);
    });

    it("不加载已 rejected 的提案", () => {
      const proposal = makeValidProposal({ status: "rejected" });
      saveProposal(proposal, tmpDir);

      const loaded = loadPendingProposals(tmpDir);
      expect(loaded).toHaveLength(0);
    });

    it("加载 draft 状态的提案", () => {
      const proposal = makeValidProposal({ status: "draft" });
      saveProposal(proposal, tmpDir);

      const loaded = loadPendingProposals(tmpDir);
      expect(loaded).toHaveLength(1);
    });
  });

  describe("updateProposalStatus", () => {
    it("更新提案状态", () => {
      const proposal = makeValidProposal();
      saveProposal(proposal, tmpDir);

      updateProposalStatus("AM-TEST-001", "approved", tmpDir);

      const loaded = loadPendingProposals(tmpDir);
      // approved 状态的提案仍然不是"pending"，所以 loadPending 不再返回
      expect(loaded).toHaveLength(0);

      // 但文件应该存在且状态已更新
      const filePath = path.join(tmpDir, "docs", "amendments", "AM-TEST-001.json");
      const raw = fs.readFileSync(filePath, "utf-8");
      const updated = JSON.parse(raw) as AmendmentProposal;
      expect(updated.status).toBe("approved");
    });

    it("不存在的提案静默返回", () => {
      expect(() => updateProposalStatus("NONEXISTENT", "approved", tmpDir)).not.toThrow();
    });
  });

  // ─── 评判 ─────────────────────────────────────

  describe("judgeProposals", () => {
    it("对合法提案返回 APPROVED", () => {
      makeConstitution(tmpDir);
      const proposal = makeValidProposal();
      saveProposal(proposal, tmpDir);

      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      expect(judgments[0].proposalId).toBe("AM-TEST-001");
      expect(judgments[0].judgment.verdict).toBe("APPROVED");
      expect(judgments[0].judgment.checks).toHaveLength(6);
    });

    it("before 不匹配返回 BLOCKED", () => {
      makeConstitution(tmpDir);
      const proposal = makeValidProposal({
        before: "宪法中不存在的文本内容 ABCDEFG",
      });
      saveProposal(proposal, tmpDir);

      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      expect(judgments[0].judgment.verdict).toBe("BLOCKED");
    });

    it("触及不可变原则返回 BLOCKED", () => {
      makeConstitution(tmpDir);
      const proposal = makeValidProposal({
        impact: { principles: ["原则一"], crossReferences: [], agents: [], breaking: false },
      });
      saveProposal(proposal, tmpDir);

      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      expect(judgments[0].judgment.verdict).toBe("BLOCKED");
    });

    it("版本号不递增返回 NEEDS_CLARIFICATION", () => {
      makeConstitution(tmpDir, "v2.5.20"); // 当前版本比提案高
      const proposal = makeValidProposal({ version: "v2.5.11" });
      saveProposal(proposal, tmpDir);

      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      // 版本号不递增不属于阻塞级（非不可变原则/结构/引用失败），返回 NEEDS_CLARIFICATION
      expect(judgments[0].judgment.verdict).toBe("NEEDS_CLARIFICATION");
    });

    it("breaking=true 但其他全通过返回 APPROVED_WITH_CAVEATS", () => {
      makeConstitution(tmpDir);
      const proposal = makeValidProposal({
        impact: { principles: [], crossReferences: ["原则六"], agents: [], breaking: true },
      });
      saveProposal(proposal, tmpDir);

      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      expect(judgments[0].judgment.verdict).toBe("APPROVED_WITH_CAVEATS");
      expect(judgments[0].judgment.caveats).toBeDefined();
    });
  });

  // ─── 裁决执行 ─────────────────────────────────

  describe("applyApproved", () => {
    it("status=approved 时写入宪法成功", () => {
      const constitutionPath = makeConstitution(tmpDir);
      const proposal = makeValidProposal({ status: "approved" });
      saveProposal(proposal, tmpDir);

      const result = applyApproved(proposal, tmpDir);
      expect(result.success).toBe(true);
      expect(result.appliedVersion).toBe("v2.5.11");
      expect(result.filePath).toBe(constitutionPath);

      // 验证宪法文件已被修改
      const content = fs.readFileSync(constitutionPath, "utf-8");
      expect(content).toContain("## 二、七条不可变原则");
      expect(content).toContain("**原则七**");
      expect(content).toContain("**版本**：v2.5.11");

      // 提案状态应更新为 applied
      const proposalFile = path.join(tmpDir, "docs", "amendments", "AM-TEST-001.json");
      const raw = fs.readFileSync(proposalFile, "utf-8");
      const updated = JSON.parse(raw) as AmendmentProposal;
      expect(updated.status).toBe("applied");
    });

    it("status 不是 approved 时拒绝写入", () => {
      makeConstitution(tmpDir);
      const proposal = makeValidProposal({ status: "pending_judgment" });

      const result = applyApproved(proposal, tmpDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("approved");
    });
  });

  // ─── 治理摘要 ─────────────────────────────────

  describe("summarizeGovernance", () => {
    it("生成正确的治理摘要", () => {
      makeConstitution(tmpDir);

      // 保存多个不同状态的提案
      const p1 = makeValidProposal({ id: "AM-TEST-001", status: "pending_judgment" });
      const p2 = makeValidProposal({ id: "AM-TEST-002", status: "approved" });
      const p3 = makeValidProposal({ id: "AM-TEST-003", status: "applied" });
      saveProposal(p1, tmpDir);
      saveProposal(p2, tmpDir);
      saveProposal(p3, tmpDir);

      const summary = summarizeGovernance(tmpDir);
      expect(summary.pendingJudgment).toBe(1); // 只有 pending_judgment 被评判
      expect(summary.approved).toBe(1);
      expect(summary.applied).toBe(1);
      expect(summary.blocked).toBe(0);
      expect(summary.judgments).toHaveLength(1);
    });
  });

  // ─── 治理闭环全链路 ──────────────────────────

  describe("全链路", () => {
    it("提案 → 评判 → 裁决 → 写入 完整闭环", () => {
      makeConstitution(tmpDir);

      // 1. 凝光创建提案
      const proposal = makeValidProposal({ status: "pending_judgment" });
      saveProposal(proposal, tmpDir);

      // 2. 昔涟评判
      const judgments = judgeProposals(tmpDir);
      expect(judgments).toHaveLength(1);
      expect(judgments[0].judgment.verdict).toBe("APPROVED");

      // 3. 开拓者裁决通过 → 更新状态
      updateProposalStatus("AM-TEST-001", "approved", tmpDir);
      const approvedProposal = { ...proposal, status: "approved" as const };

      // 4. 写入宪法
      const result = applyApproved(approvedProposal, tmpDir);
      expect(result.success).toBe(true);

      // 5. 验证宪法包含新内容
      const constitutionPath = path.join(tmpDir, "docs", "constitution", "Cortex 概念顶层设计 v2.5.md");
      const content = fs.readFileSync(constitutionPath, "utf-8");
      expect(content).toContain("七条不可变原则");
      expect(content).toContain("v2.5.11");

      // 6. 治理摘要
      const summary = summarizeGovernance(tmpDir);
      expect(summary.applied).toBe(1);
      expect(summary.pendingJudgment).toBe(0);
    });
  });
});
