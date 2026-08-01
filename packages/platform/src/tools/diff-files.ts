// ============================================================
// @cortex/engine/platform/tools/diff-files —— diff_files 工具
//
// 对比两个文件的内容，返回 unified diff 格式的行级差异。
// 纯内存计算，不依赖外部 diff/git 命令。
//
// 算法：经典 LCS（最长公共子序列）→ unified diff。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================

import type { Tool } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
import type { ToolContext } from "./types.js";
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/config";

const MAX_FILE_SIZE = 500_000; // 500KB
const MAX_DIFF_LINES = 1_000;

export function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "diff_files",
    ToolCategory.Read,
    "Compare two files and return a unified diff. Useful for reviewing changes, verifying edits, or comparing outputs. Pure in-memory LCS algorithm—no external diff dependency.",
    {
      type: "object",
      properties: {
        file_a: {
          type: "string",
          description: "Absolute path to the first file (baseline)",
        },
        file_b: {
          type: "string",
          description: "Absolute path to the second file (changed)",
        },
        context_lines: {
          type: "number",
          description: "Number of context lines around each diff hunk (default: 3)",
        },
      },
      required: ["file_a", "file_b"],
    },
    RL.L0,
    async (params) => {
      const pathA = ctx.resolvePath(params.file_a as string);
      const pathB = ctx.resolvePath(params.file_b as string);
      const contextLines = (params.context_lines as number) || 3;

      try {
        const [existsA, existsB] = await Promise.all([
          ctx.fs.exists(pathA),
          ctx.fs.exists(pathB),
        ]);

        if (!existsA) {
          return { success: false, error: `文件 A 不存在: ${pathA}` };
        }
        if (!existsB) {
          return { success: false, error: `文件 B 不存在: ${pathB}` };
        }

        const [contentA, contentB] = await Promise.all([
          ctx.fs.readFile(pathA),
          ctx.fs.readFile(pathB),
        ]);

        if (contentA.length > MAX_FILE_SIZE || contentB.length > MAX_FILE_SIZE) {
          return {
            success: false,
            error: `文件过大 (A: ${contentA.length} bytes, B: ${contentB.length} bytes, max: ${MAX_FILE_SIZE})`,
          };
        }

        const linesA = contentA.split("\n");
        const linesB = contentB.split("\n");

        const diff = computeUnifiedDiff(linesA, linesB, pathA, pathB, contextLines);

        return {
          success: true,
          output: diff.slice(0, 30_000),
        };
      } catch (e) {
        return { success: false, error: `diff_files 失败: ${String(e)}` };
      }
    },
  );
}

// ── Unified Diff 生成器 ───────────────────────────

interface DiffHunk {
  startA: number;
  countA: number;
  startB: number;
  countB: number;
  lines: string[];
}

function computeUnifiedDiff(
  linesA: string[],
  linesB: string[],
  pathA: string,
  pathB: string,
  context: number,
): string {
  if (linesA.length === 0 && linesB.length === 0) {
    return `--- ${pathA}\n+++ ${pathB}\n@@ -0,0 +0,0 @@\n(empty files)`;
  }

  // 计算 LCS 编辑序列
  const edits = computeEdits(linesA, linesB);
  const hunks = buildHunks(edits, context, linesA, linesB);

  if (hunks.length === 0) {
    return `--- ${pathA}\n+++ ${pathB}\n(no changes)`;
  }

  const header = `--- ${pathA}\n+++ ${pathB}\n`;
  return (
    header +
    hunks
      .map((h) => {
        const range = `@@ -${h.startA + 1},${h.countA} +${h.startB + 1},${h.countB} @@`;
        return [range, ...h.lines].join("\n");
      })
      .join("\n")
  );
}

interface Edit {
  type: "equal" | "delete" | "insert";
  aLine?: number;
  bLine?: number;
}

function computeEdits(linesA: string[], linesB: string[]): Edit[] {
  // Myers 差量骨架 (简化版——用 LCS 回溯)
  const m = linesA.length;
  const n = linesB.length;

  // dp[i][j] = LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // 回溯 LCS 生成编辑序列
  const edits: Edit[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      edits.unshift({ type: "equal", aLine: i - 1, bLine: j - 1 });
      i--;
      j--;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      edits.unshift({ type: "insert", bLine: j - 1 });
      j--;
    } else {
      edits.unshift({ type: "delete", aLine: i - 1 });
      i--;
    }
  }

  return edits;
}

function buildHunks(edits: Edit[], context: number, linesA: string[], linesB: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let i = 0;

  while (i < edits.length) {
    // 跳过前面的相等部分（留 context 行）
    let equalBefore = 0;
    let scan = i;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (scan < edits.length && edits[scan]!.type === "equal" && equalBefore < context) {
      equalBefore++;
      scan++;
    }

    // 找到变更开始
    scan = i + equalBefore;
    if (scan >= edits.length) break;

    // 收集变更块
    const hunkStart = Math.max(0, i - context);
    let changeEnd = scan;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (changeEnd < edits.length && edits[changeEnd]!.type !== "equal") {
      changeEnd++;
    }

    // 扩展 equal 上下文（后面）
    let equalAfter = 0;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (changeEnd + equalAfter < edits.length && edits[changeEnd + equalAfter]!.type === "equal" && equalAfter < context) {
      equalAfter++;
    }

    const hunkEnd = Math.min(edits.length, changeEnd + equalAfter);

    // 构建 hunk 行
    const lines: string[] = [];
    let aLine = 0;
    let bLine = 0;

    for (let k = hunkStart; k < hunkEnd; k++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const edit = edits[k]!;
      switch (edit.type) {
        case "equal":
          if (edit.aLine !== undefined) {
            aLine = edit.aLine;
          }
          bLine = edit.bLine ?? bLine;
          lines.push(` ${linesA[aLine]}`);
          break;
        case "delete":
          if (edit.aLine !== undefined) aLine = edit.aLine;
          lines.push(`-${linesA[aLine]}`);
          break;
        case "insert":
          if (edit.bLine !== undefined) bLine = edit.bLine;
          lines.push(`+${linesB[bLine]}`);
          break;
      }
    }

    // 计算范围
    let startA = -1;
    let endA = -1;
    let startB = -1;
    let endB = -1;

    for (let k = hunkStart; k < hunkEnd; k++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const e = edits[k]!;
      if (e.aLine !== undefined) {
        if (startA === -1) startA = e.aLine;
        endA = e.aLine;
      }
      if (e.bLine !== undefined) {
        if (startB === -1) startB = e.bLine;
        endB = e.bLine;
      }
    }

    hunks.push({
      startA: startA === -1 ? 0 : startA,
      countA: startA === -1 ? 0 : endA - startA + 1,
      startB: startB === -1 ? 0 : startB,
      countB: startB === -1 ? 0 : endB - startB + 1,
      lines: lines.slice(0, MAX_DIFF_LINES),
    });

    i = hunkEnd;
  }

  return hunks;
}
