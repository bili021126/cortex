/**
 * 修宪执行器。
 *
 * 裁决权二分——仅开拓者裁决通过后调用。
 * 读取宪法全文 → 执行 before→after 替换 → 更新版本号 → 追加变更历史 → 写入文件。
 *
 * @module amendment-applier
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AmendmentProposal, AmendmentApplyResult } from "@cortex/shared";

/** 宪法文件名——以项目中实际的宪法文件名为准 */
const CONSTITUTION_FILENAME = "Cortex 概念顶层设计 v2.5.md";

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
    if (match && match.index !== undefined) {
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

/**
 * 修宪写入。
 *
 * @param proposal 已裁决通过的修宪提案
 * @param constitutionPath 宪法文件所在目录（不含文件名）。如不提供则使用默认路径。
 * @returns 写入结果
 */
export function applyAmendment(
  proposal: AmendmentProposal,
  constitutionPath?: string,
): AmendmentApplyResult {
  const dir = constitutionPath
    ? path.resolve(constitutionPath)
    : path.resolve(process.cwd(), "docs", "constitution");

  const filePath = path.join(dir, CONSTITUTION_FILENAME);

  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        appliedVersion: proposal.version,
        error: `宪法文件不存在：${filePath}`,
        filePath,
      };
    }

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

    return {
      success: true,
      appliedVersion: proposal.version,
      filePath,
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
