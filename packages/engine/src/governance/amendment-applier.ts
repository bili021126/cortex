/**
 * 修宪执行器。
 *
 * 裁决权二分——仅开拓者裁决通过后调用。
 * 读取宪法全文 → 备份 → 执行 before→after 替换 → 更新版本号
 * → 追加变更历史 → 写入文件 → 同步文件名版本号。
 *
 * @module amendment-applier
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AmendmentProposal, AmendmentApplyResult } from "@cortex/shared";

/** 宪法文件名模式——匹配所有 Cortex 概念顶层设计 md 文件 */
const CONSTITUTION_PATTERN = /^Cortex 概念顶层设计 v[\d.]+.md$/;

/** 宪法文件所在目录（相对于项目根） */
const CONSTITUTION_DIR = "docs/constitution";

// ─── 宪法文件定位 ──────────────────────────────

/**
 * 在项目根目录下扫描宪法文件。
 * 按版本号降序排列，取最新者。
 *
 * @param rootDir 项目根目录
 * @returns 宪法文件的完整路径
 * @throws 找不到宪法文件时抛出
 */
export function findConstitutionPath(rootDir: string): string {
  const dir = path.resolve(rootDir, CONSTITUTION_DIR);
  if (!fs.existsSync(dir)) {
    throw new Error(`宪法目录不存在：${dir}`);
  }

  const files = fs.readdirSync(dir).filter((f) => CONSTITUTION_PATTERN.test(f));
  if (files.length === 0) {
    throw new Error(`在 ${dir} 中找不到匹配 "Cortex 概念顶层设计 v*.md" 的宪法文件`);
  }

  // 按版本号降序——取最新的
  files.sort((a, b) => {
    const va = (a.match(/v([\d.]+)/)?.[1] ?? "0").split(".").map(Number);
    const vb = (b.match(/v([\d.]+)/)?.[1] ?? "0").split(".").map(Number);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      if ((vb[i] ?? 0) !== (va[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
    }
    return 0;
  });

  return path.join(dir, files[0]);
}

/**
 * 在宪法版本号行下方追加本次变更的历史条目。
 * 版本号行格式：`**版本**：vX.Y.Z`
 */
function appendChangelogEntry(content: string, proposal: AmendmentProposal): string {
  const versionLineRe = /^(\*\*版本\*\*[：:]\s*v[\d.]+.*)$/m;
  const match = content.match(versionLineRe);
  if (!match) return content;

  const fullLine = match[0];
  const insertionIndex = match.index! + fullLine.length;
  const before = content.slice(0, insertionIndex);
  const after = content.slice(insertionIndex);

  const date = new Date().toISOString().slice(0, 10);
  const entry = ` → ${proposal.version}（${proposal.id}：${proposal.summary}；${date}；来源：${proposal.source.agent}——${proposal.source.trace}）`;

  return before + entry + after;
}

/**
 * 执行修宪提案的文本替换。
 *
 * - modify/remove: 用 after 替换 before
 * - add: before 为空时不做替换（仅更新版本号 + 追加变更历史）
 * - restructure: 同 modify
 *
 * 安全约束：仅在提案状态为 "approved" 且开拓者明确确认后调用。
 */
function applyTextChanges(content: string, proposal: AmendmentProposal): string {
  if (proposal.category === "add" && !proposal.before.trim()) {
    // 纯新增——将 after 文本插入宪法体末尾（文档状态行之前）
    const docStatusRe = /^\*\*文档状态\*\*[：:]/m;
    const match = content.match(docStatusRe);
    if (match?.index !== undefined) {
      // 在文档状态行之前插入，前后各加空行保持格式
      const before = content.slice(0, match.index);
      const after = content.slice(match.index);
      return before.trimEnd() + "\n\n" + proposal.after.trim() + "\n\n" + after;
    }
    // 没有找到文档状态行，追加到末尾
    return content.trimEnd() + "\n\n" + proposal.after.trim() + "\n";
  }

  // modify / remove / restructure：执行文本替换
  // 逐个替换所有出现（通常只有一处，但保守处理）
  const result = content;
  let replaced = false;

  // 标准化空白字符后做精确匹配，然后做原始替换
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

  const lines = result.split("\n");
  const searchNormalized = normalize(proposal.before);

  // 滑动窗口匹配
  const beforeLines = proposal.before.split("\n");
  const windowSize = beforeLines.length;

  for (let i = 0; i <= lines.length - windowSize; i++) {
    const windowText = lines.slice(i, i + windowSize).join("\n");
    if (normalize(windowText) === searchNormalized) {
      const afterLines = proposal.after.split("\n");
      lines.splice(i, windowSize, ...afterLines);
      replaced = true;
      break; // 仅替换第一处匹配
    }
  }

  if (!replaced) {
    throw new Error(
      `无法在宪法中找到 before 段落。提案 ID: ${proposal.id}，section: ${proposal.section}`,
    );
  }

  return lines.join("\n");
}

// ─── 备份 ───────────────────────────────────────

/**
 * 在写入前将当前宪法内容备份到 archive 目录。
 * 文件名格式：Cortex 概念顶层设计 v2.5.10-backup-2026-05-19T23-50-00.md
 */
function backupConstitution(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, ".md");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const archiveDir = path.resolve(dir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const backupName = path.join(archiveDir, `${baseName}-backup-${ts}.md`);
    fs.copyFileSync(filePath, backupName);
    return backupName;
  } catch {
    return null; // 备份失败不阻塞修宪
  }
}

/**
 * 将宪法文件重命名为包含新版本号的文件名。
 * 例如：Cortex 概念顶层设计 v2.5.md → Cortex 概念顶层设计 v2.5.11.md
 */
function renameToVersion(filePath: string, newVersion: string): string {
  const dir = path.dirname(filePath);
  const oldBase = path.basename(filePath);
  const newName = oldBase.replace(/v\d+(?:\.\d+)*(?=\.md$)/, newVersion);
  if (newName === oldBase) return filePath; // 没变

  const newPath = path.join(dir, newName);
  try {
    fs.renameSync(filePath, newPath);
    return newPath;
  } catch {
    return filePath; // 重命名失败不阻塞，保留旧文件名
  }
}

// ─── 修宪写入 ───────────────────────────────────

/**
 * 修宪写入。
 *
 * @param proposal 已裁决通过的修宪提案
 * @param constitutionPath 宪法文件的完整路径（含文件名）。如不提供则自动扫描。
 * @returns 写入结果
 */
export function applyAmendment(
  proposal: AmendmentProposal,
  constitutionPath?: string,
): AmendmentApplyResult {
  const filePath = constitutionPath
    ? path.resolve(constitutionPath)
    : findConstitutionPath(process.cwd());

  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        appliedVersion: proposal.version,
        error: `宪法文件不存在：${filePath}`,
        filePath,
      };
    }

    // 0. 备份当前宪法
    backupConstitution(filePath);

    let content = fs.readFileSync(filePath, "utf-8");

    // 1. 执行文本替换
    content = applyTextChanges(content, proposal);

    // 2. 更新版本号行
    const versionLineRe = /^(\*\*版本\*\*[：:]\s*)v[\d.]+(.*)$/m;
    if (versionLineRe.test(content)) {
      content = content.replace(versionLineRe, `$1${proposal.version}$2`);
    }

    // 3. 追加变更历史条目
    content = appendChangelogEntry(content, proposal);

    // 4. 写入文件
    fs.writeFileSync(filePath, content, "utf-8");

    // 5. 文件名同步版本号
    const finalPath = renameToVersion(filePath, proposal.version);

    return {
      success: true,
      appliedVersion: proposal.version,
      filePath: finalPath,
    };
  } catch (e) {
    return {
      success: false,
      appliedVersion: proposal.version,
      error: String(e),
      filePath,
    };
  }
}
