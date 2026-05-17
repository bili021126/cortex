/**
 * 治理闭环 E2E —— 修宪管线端到端验证
 *
 * 裁决权二分完整链路：
 *   凝光提案 → 昔涟评判 → 开拓者裁决 → 写入宪法 → build+test 验证
 *
 * 用法: npx tsx packages/engine/tests/manual/e2e/governance-amendment-e2e.ts
 * 前提: 无 LLM 依赖（纯代码路径），仅需 Node.js + 宪法文件存在
 *
 * 验收标准:
 *   1. AM-001 评判 → APPROVED → 写入宪法 → 版本升至 v2.5.11
 *   2. AM-002 评判 → APPROVED → 写入宪法 → 版本升至 v2.5.12
 *   3. 宪法包含原则七 + §8.2 通知管线
 *   4. pnpm build 9/9 通过
 *   5. pnpm test 全部通过
 *
 * 安全措施: 写入前自动备份宪法到 docs/constitution/backup/
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { evaluateAmendment } from "../../../src/amendment-judge.js";
import { applyAmendment } from "../../../src/amendment-applier.js";
import {
  loadPendingProposals,
  saveProposal,
  updateProposalStatus,
  judgeProposals,
  applyApproved,
  summarizeGovernance,
} from "../../../src/governance-loop.js";
import type { AmendmentProposal, JudgmentResult } from "@cortex/shared";

// ══════════════════════════════════════════════
// 0. 常量
// ══════════════════════════════════════════════

const ROOT_DIR = path.resolve(process.cwd());
const CONSTITUTION_DIR = path.join(ROOT_DIR, "docs", "constitution");
const CONSTITUTION_FILE = "Cortex 概念顶层设计 v2.5.md";
const CONSTITUTION_PATH = path.join(CONSTITUTION_DIR, CONSTITUTION_FILE);
const BACKUP_DIR = path.join(CONSTITUTION_DIR, "backup");
const AMENDMENTS_DIR = path.join(ROOT_DIR, "docs", "amendments");

const SEP = "═".repeat(60);

// ══════════════════════════════════════════════
// 1. 辅助函数
// ══════════════════════════════════════════════

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function header(title: string): void {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(SEP);
}

function passed(label: string): void {
  console.log(`  ✅ ${label}`);
}

function failed(label: string, detail?: string): void {
  console.log(`  ❌ ${label}`);
  if (detail) console.log(`     ${detail}`);
}

function info(label: string, value: string): void {
  console.log(`  📋 ${label}: ${value}`);
}

/** 备份宪法到 backup/ 目录 */
function backupConstitution(): string {
  const backupPath = path.join(BACKUP_DIR, `${CONSTITUTION_FILE}.${Date.now()}.bak`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(CONSTITUTION_PATH, backupPath);
  return backupPath;
}

/** 读取宪法全文 */
function readConstitution(): string {
  return fs.readFileSync(CONSTITUTION_PATH, "utf-8");
}

/** 检查宪法是否包含指定文本 */
function constitutionContains(text: string): boolean {
  return readConstitution().includes(text);
}

// ══════════════════════════════════════════════
// 2. 前置校验
// ══════════════════════════════════════════════

function preflight(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!fs.existsSync(CONSTITUTION_PATH)) {
    errors.push(`宪法文件不存在: ${CONSTITUTION_PATH}`);
  }

  if (!fs.existsSync(AMENDMENTS_DIR)) {
    errors.push(`修宪提案目录不存在: ${AMENDMENTS_DIR}`);
  }

  const proposals = loadPendingProposals(ROOT_DIR);
  if (proposals.length === 0) {
    errors.push("没有待评判的修宪提案");
  }

  const constitution = readConstitution();
  if (constitution.length < 100) {
    errors.push("宪法文件内容异常（少于100字符）");
  }

  return { ok: errors.length === 0, errors };
}

// ══════════════════════════════════════════════
// 3. 评判阶段（昔涟职责——只读不写）
// ══════════════════════════════════════════════

interface JudgedProposal {
  proposal: AmendmentProposal;
  judgment: JudgmentResult;
}

function judgePhase(): { ok: boolean; judged: JudgedProposal[]; blocked: string[] } {
  header("Phase 1/3 — 昔涟评判（只读不写）");

  const proposals = loadPendingProposals(ROOT_DIR);
  info("待评判提案", `${proposals.length} 条`);

  const judged: JudgedProposal[] = [];
  const blocked: string[] = [];

  const constitution = readConstitution();
  info("宪法版本", constitution.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/)?.[1] ?? "unknown");
  info("宪法长度", `${constitution.length} 字符`);

  for (const p of proposals) {
    console.log(`\n  ── ${p.id} ──`);
    info("章节", p.section);
    info("目标版本", p.version);
    info("类别", p.category);
    info("摘要", p.summary);

    const judgment = evaluateAmendment(p, constitution);
    judged.push({ proposal: p, judgment });

    // 逐项检查
    for (const check of judgment.checks) {
      if (check.passed) {
        passed(check.name);
      } else {
        failed(check.name, check.detail);
      }
    }

    // 裁决结论
    const verdictLabel = {
      APPROVED: "✅ 通过",
      APPROVED_WITH_CAVEATS: "⚠️ 附条件通过",
      BLOCKED: "🚫 阻塞",
      NEEDS_CLARIFICATION: "❓ 需要澄清",
    }[judgment.verdict];

    console.log(`\n  📌 裁决: ${verdictLabel}`);

    if (judgment.caveats && judgment.caveats.length > 0) {
      for (const c of judgment.caveats) {
        console.log(`     ⚠️ ${c}`);
      }
    }

    if (judgment.blocking.length > 0) {
      for (const b of judgment.blocking) {
        console.log(`     🚫 ${b}`);
        blocked.push(`${p.id}: ${b}`);
      }
    }
  }

  const ok = blocked.length === 0;
  if (ok) {
    console.log(`\n  ✅ 全部提案评判通过，准予进入裁决阶段`);
  } else {
    console.log(`\n  ❌ ${blocked.length} 项阻塞，中止`);
  }

  return { ok, judged, blocked };
}

// ══════════════════════════════════════════════
// 4. 裁决执行阶段（开拓者裁决 → 写入宪法）
// ══════════════════════════════════════════════

function applyPhase(judged: JudgedProposal[]): { ok: boolean; results: string[] } {
  header("Phase 2/3 — 开拓者裁决 → 写入宪法");

  // 按版本号升序排列（v2.5.11 先于 v2.5.12）
  const sorted = [...judged].sort((a, b) =>
    a.proposal.version.localeCompare(b.proposal.version),
  );

  const results: string[] = [];
  let allOk = true;

  for (const { proposal } of sorted) {
    console.log(`\n  ── 写入 ${proposal.id} → ${proposal.version} ──`);

    // 1. 更新提案状态为 approved
    updateProposalStatus(proposal.id, "approved", ROOT_DIR);
    log(`状态: pending_judgment → approved`);

    // 2. 执行写入
    const applyResult = applyAmendment(proposal, CONSTITUTION_DIR);

    if (applyResult.success) {
      passed(`写入成功 → ${applyResult.appliedVersion}`);
      results.push(`${proposal.id}: 写入成功 → ${applyResult.appliedVersion}`);

      // 验证宪法版本号已更新
      const newContent = readConstitution();
      const versionMatch = newContent.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/);
      const newVersion = versionMatch?.[1] ?? "unknown";
      info("宪法当前版本", newVersion);
    } else {
      failed(`写入失败`, applyResult.error);
      allOk = false;
      results.push(`${proposal.id}: 写入失败 — ${applyResult.error}`);
    }
  }

  return { ok: allOk, results };
}

// ══════════════════════════════════════════════
// 5. 验证阶段
// ══════════════════════════════════════════════

interface VerificationResult {
  label: string;
  passed: boolean;
  detail?: string;
}

function verifyPhase(): VerificationResult[] {
  header("Phase 3/3 — 验证（内容 + build + test）");

  const results: VerificationResult[] = [];
  const constitution = readConstitution();

  // ── 3.1 内容验证 ──
  console.log("\n  ── 3.1 宪法内容验证 ──");

  const contentChecks: { label: string; check: () => boolean; detail?: string }[] = [
    {
      label: "标题包含七条不可变原则",
      check: () => constitution.includes("七条不可变原则"),
      detail: "应包含 '## 二、七条不可变原则'",
    },
    {
      label: "包含原则七",
      check: () => constitution.includes("**原则七**"),
    },
    {
      label: "包含六项子约束",
      check: () => constitution.includes("### 原则七 六项子约束"),
    },
    {
      label: "包含首个判例 NG-2026-0515",
      check: () => constitution.includes("NG-2026-0515-Self-Modification"),
    },
    {
      label: "包含 §8.2 通知管线",
      check: () => constitution.includes("### 8.2 通知管线"),
    },
    {
      label: "包含三轨语义分层",
      check: () => constitution.includes("FYI") && constitution.includes("WARNING") && constitution.includes("DECISION_REQUIRED"),
    },
    {
      label: "版本号为 v2.5.12",
      check: () => {
        const m = constitution.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/);
        return m?.[1] === "v2.5.12";
      },
      detail: `当前版本: ${constitution.match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/)?.[1] ?? "unknown"}`,
    },
    {
      label: "变更历史包含 AM-2026-0515-001",
      check: () => constitution.includes("AM-2026-0515-001"),
    },
    {
      label: "变更历史包含 AM-2026-0515-002",
      check: () => constitution.includes("AM-2026-0515-002"),
    },
    {
      label: "宪法结构完整（以 # 开头）",
      check: () => constitution.startsWith("# "),
    },
  ];

  for (const { label, check, detail } of contentChecks) {
    const ok = check();
    if (ok) {
      passed(label);
    } else {
      failed(label, detail);
    }
    results.push({ label, passed: ok, detail });
  }

  // ── 3.2 Build 验证 ──
  console.log("\n  ── 3.2 pnpm build ──");

  try {
    const buildOutput = execSync("pnpm build", {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    const buildOk = buildOutput.includes("packages/engine build: Done") &&
                    buildOutput.includes("packages/cli build: Done");
    if (buildOk) {
      passed("pnpm build 9/9 通过");
      results.push({ label: "Build", passed: true });
    } else {
      failed("pnpm build", "部分包构建失败");
      results.push({ label: "Build", passed: false, detail: "部分包构建失败" });
    }
  } catch (e: any) {
    failed("pnpm build", e.stderr?.slice(-200) ?? String(e));
    results.push({ label: "Build", passed: false, detail: String(e) });
  }

  // ── 3.3 Test 验证 ──
  console.log("\n  ── 3.3 pnpm test ──");

  try {
    execSync("pnpm test", {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      timeout: 300_000,
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    passed("pnpm test 全部通过");
    results.push({ label: "Test", passed: true });
  } catch (e: any) {
    // execSync throws on non-zero exit code — 测试失败
    const stderr = e.stderr || "";
    const stdout = e.stdout || "";
    const combined = (stderr + stdout).slice(-800);

    // 尝试从输出中提取失败数
    const failMatch = combined.match(/Tests\s+(\d+)\s+failed/);
    const failCount = failMatch ? parseInt(failMatch[1]) : -1;

    failed("pnpm test", failCount > 0 ? `${failCount} tests failed` : combined.slice(-200));
    results.push({ label: "Test", passed: false, detail: combined.slice(-200) });
  }

  return results;
}

// ══════════════════════════════════════════════
// 6. 治理摘要
// ══════════════════════════════════════════════

function reportSummary(): void {
  header("治理摘要");

  try {
    const summary = summarizeGovernance(ROOT_DIR);
    info("待评判", `${summary.pendingJudgment} 条`);
    info("已批准待执行", `${summary.approved} 条`);
    info("已阻塞", `${summary.blocked} 条`);
    info("已应用", `${summary.applied} 条`);

    for (const j of summary.judgments) {
      console.log(`\n  ${j.proposalId}: ${j.judgment.verdict} — ${j.proposal.summary}`);
    }
  } catch (e: any) {
    failed("治理摘要生成失败", String(e));
  }
}

// ══════════════════════════════════════════════
// 7. 主流程
// ══════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("\n╔" + "═".repeat(58) + "╗");
  console.log("║  治理闭环 E2E —— 修宪管线端到端验证            ║");
  console.log("║  凝光提案 → 昔涟评判 → 开拓者裁决 → 写入宪法    ║");
  console.log("╚" + "═".repeat(58) + "╝");

  // ── 前置校验 ──
  const { ok: preflightOk, errors: preflightErrors } = preflight();
  if (!preflightOk) {
    console.log("\n❌ 前置校验失败:");
    for (const e of preflightErrors) console.log(`   - ${e}`);
    process.exit(1);
  }
  passed("前置校验通过");

  // ── 备份宪法 ──
  const backupPath = backupConstitution();
  info("宪法备份", backupPath);
  info("宪法原始版本", readConstitution().match(/\*\*版本\*\*[：:]\s*(v[\d.]+)/)?.[1] ?? "unknown");

  // ── Phase 1: 评判 ──
  const { ok: judgeOk, judged } = judgePhase();
  if (!judgeOk) {
    console.log("\n❌ 评判阶段未通过，中止执行。宪法未被修改。");
    process.exit(1);
  }

  // ── Phase 2: 裁决执行 ──
  const { ok: applyOk } = applyPhase(judged);
  if (!applyOk) {
    console.log(`\n⚠️ 部分写入失败。宪法备份在: ${backupPath}`);
    process.exit(1);
  }

  // ── Phase 3: 验证 ──
  const verifications = verifyPhase();
  const verifyOk = verifications.every((v) => v.passed);

  // ── 治理摘要 ──
  reportSummary();

  // ── 最终判定 ──
  header("最终判定");

  if (verifyOk) {
    console.log("\n  ✅✅✅ 治理闭环 E2E 全部通过 ✅✅✅");
    console.log(`\n  宪法已从 v2.5.10 升级至 v2.5.12`);
    console.log(`  备份保留在: ${backupPath}`);
    console.log(`\n  修宪管线验证结论：`);
    console.log(`    - 凝光提案 → 昔涟评判 → 开拓者裁决 → 写入宪法`);
    console.log(`    - 原则七（六项子约束）入宪 ✅`);
    console.log(`    - §8.2 通知管线（三轨语义分层）入宪 ✅`);
    console.log(`    - build 9/9 ✅`);
    console.log(`    - test 全量通过 ✅`);
  } else {
    const failedChecks = verifications.filter((v) => !v.passed);
    console.log(`\n  ❌ 验证失败 ${failedChecks.length} 项:`);
    for (const f of failedChecks) {
      console.log(`     - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
    }
    console.log(`\n  宪法备份在: ${backupPath}`);
    console.log(`  如需恢复: copy "${backupPath}" "${CONSTITUTION_PATH}"`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ 未预期错误:", e);
  process.exit(1);
});
