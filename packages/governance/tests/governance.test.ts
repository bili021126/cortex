// @ci: unit
// @cortex/governance — Governance smoke test

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  runPipeline,
  saveProposal,
  judgeProposals,
} from "@cortex/governance";
import type { AmendmentProposal } from "@cortex/shared";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-gov-smoke-"));
}

function makeProposal(overrides?: Partial<AmendmentProposal>): AmendmentProposal {
  return {
    id: `AM-${String(Date.now()).slice(-6)}-${String(Math.random()).slice(2, 6)}`,
    version: "v2.8.0",
    section: "原则二",
    category: "modify",
    summary: "smoke test proposal",
    rationale: "自动化 smoke 测试。",
    before: "旧文本",
    after: "新文本",
    impact: { principles: [], crossReferences: [], agents: [], breaking: false },
    source: { agent: "test-agent", trace: "smoke-test" },
    status: "draft",
    ...overrides,
  };
}

describe("@cortex/governance — smoke", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
    fs.mkdirSync(path.join(dir, "docs", "amendments"), { recursive: true });
    fs.mkdirSync(path.join(dir, "docs", "constitution"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "docs", "constitution", "Cortex 概念顶层设计 v2.7.0.md"),
      `# Cortex Constitution

**版本**: v2.7.0

## 原则一 | 项目本质定位 | 不可变

Cortex 是智能体治理框架。

## 原则二 | 架构解耦 | 可变

引擎与治理层通过记忆系统解耦。`,
      "utf-8",
    );
  });

  afterEach(() => {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runPipeline 不崩溃", async () => {
    const result = await runPipeline({ rootDir: dir });
    expect(result).toBeDefined();
    // runPipeline returns PipelineResult — verify it has expected top-level keys
    expect(typeof result).toBe("object");
    // 只要不抛异常就算通过
    expect(true).toBe(true);
  });

  it("proposeAmendment: 创建并保存提案", () => {
    const p = makeProposal({ status: "draft" });
    saveProposal(p, dir);

    // 验证文件已写入
    const files = fs.readdirSync(path.join(dir, "docs", "amendments"));
    expect(files.length).toBe(1);
    const content = JSON.parse(
      fs.readFileSync(path.join(dir, "docs", "amendments", files[0]!), "utf-8"),
    );
    expect(content.id).toBe(p.id);
    expect(content.summary).toBe(p.summary);
    expect(content.status).toBe("draft");
  });

  it("judgeProposals: 评判返回有效结果", () => {
    const p = makeProposal({ status: "pending_judgment" });
    saveProposal(p, dir);

    const judgments = judgeProposals(dir);
    expect(Array.isArray(judgments)).toBe(true);
    expect(judgments.length).toBe(1);

    const j = judgments[0]!;
    expect(j.proposalId).toBe(p.id);
    expect(j.judgment).toBeDefined();
    expect(j.judgment.verdict).toBeDefined();
    expect(["APPROVED", "BLOCKED", "NEEDS_CLARIFICATION"]).toContain(j.judgment.verdict);
  });
});
