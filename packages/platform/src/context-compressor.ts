/**
 * context-compressor.ts —— 智能上下文压缩器
 *
 * 解决 Cortex 自审视流程中两大上下文膨胀点：
 *   1. Agent 读文件结果累积 → 需分层压缩
 *   2. 共识圆桌报告注入 → 需结构化提取
 *
 * 三层压缩粒度：
 *   Level "headline" — 仅提取所有发现行（带判定标记 + 文件引用）
 *   Level "summary"  — 保留发现 + 证据段落 + 标题结构
 *   Level "full"     — 完整内容（仅当内容短于阈值时返回原样）
 *
 * @layer platform —— 被 scripts/cortex-self-examination.ts 使用
 */

// ─── 类型 ──────────────────────────────────────

export type CompressionLevel = "headline" | "summary" | "full";

export interface CompressedReport {
  agentKey: string;
  label: string;
  emoji: string;
  /** 判定标记统计 */
  stats: ReportStats;
  /** headline: 发现行列表 */
  headlines: string[];
  /** summary: headline + 证据上下文 */
  summary: string;
  /** 原始长度 */
  rawLength: number;
  /** 压缩后长度 */
  compressedLength: number;
}

export interface ReportStats {
  confirmed: number;   // ✅
  warning: number;     // ⚠️
  falsified: number;   // ❌
  runtimeNeeded: number; // 🔧
  insufficient: number; // ❓
  total: number;
}

export interface RoundtableCompressInput {
  agentKey: string;
  label: string;
  emoji: string;
  content: string;
}

// ─── 判定标记识别 ──────────────────────────────

const VERDICT_MARKERS = [
  { re: /✅/, key: "confirmed" as const },
  { re: /⚠️|⚠/, key: "warning" as const },
  { re: /❌/, key: "falsified" as const },
  { re: /🔧/, key: "runtimeNeeded" as const },
  { re: /❓/, key: "insufficient" as const },
  { re: /证伪/, key: "falsified" as const },
  { re: /证据不足/, key: "insufficient" as const },
  { re: /运行时验证/, key: "runtimeNeeded" as const },
  { re: /撤回/, key: "falsified" as const },
];

/** 文件路径引用模式（含行号） */
const FILE_REF_RE = /(?:[a-zA-Z]:[\\/][^\s)]+|(?:\/[\w.-]+)+[\w.-]+\.[a-z]{2,4})(?::\d+)?/g;

/** 标题模式 */
const HEADING_RE = /^#{1,3}\s+.+$/gm;

// ─── 核心压缩函数 ──────────────────────────────

/**
 * 分层压缩报告内容。
 *
 * @param content  原始 Markdown 内容
 * @param maxChars 压缩后的最大字符数
 * @param level    压缩粒度
 * @returns 压缩后字符串
 */
export function compressContent(
  content: string,
  maxChars: number,
  level: CompressionLevel = "summary",
): string {
  if (content.length <= maxChars || level === "full") return content;

  const lines = content.split("\n");

  if (level === "headline") {
    return _compressHeadline(lines, maxChars);
  }

  // level === "summary"
  return _compressSummary(lines, maxChars);
}

/**
 * 从报告中提取结构化发现并统计判定标记。
 */
export function extractFindings(content: string): {
  headlines: string[];
  stats: ReportStats;
  evidenceRefs: string[];
} {
  const lines = content.split("\n");
  const headlines: string[] = [];
  const evidenceRefs: string[] = [];
  const stats: ReportStats = { confirmed: 0, warning: 0, falsified: 0, runtimeNeeded: 0, insufficient: 0, total: 0 };

  const seenUrls = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 提取文件引用
    const refs = trimmed.match(FILE_REF_RE);
    if (refs) {
      for (const ref of refs) {
        const normalized = ref.replace(/^file:\/\/\//, "").replace(/\\/g, "/");
        if (!seenUrls.has(normalized) && /\.(ts|js|json|md|yml|yaml|cjs|mjs|txt)/.test(normalized)) {
          seenUrls.add(normalized);
          evidenceRefs.push(normalized);
        }
      }
    }

    // 匹配判定标记
    for (const marker of VERDICT_MARKERS) {
      if (marker.re.test(trimmed)) {
        headlines.push(trimmed.slice(0, 200));
        stats[marker.key]++;
        stats.total++;
        break; // 一行只归一类
      }
    }
  }

  return { headlines, stats, evidenceRefs };
}

/**
 * 批量压缩报告列表，用于共识圆桌注入。
 *
 * 策略：
 *   1. 每份报告提取 headline（发现行 + 判定标记）
 *   2. 统计各报告的判定分布
 *   3. 按 totalBudget 等分压缩，关键发现优先
 *
 * @param reports 各 Agent 报告列表
 * @param totalBudget 总字符预算（默认 12000）
 * @returns 压缩后的报告数组 + 聚合摘要
 */
export function compressForRoundtable(
  reports: RoundtableCompressInput[],
  totalBudget: number = 12_000,
): {
  compressed: CompressedReport[];
  aggregateSummary: string;
} {
  // 1. 提取
  const compressed: CompressedReport[] = [];
  let totalFindings = 0;

  for (const r of reports) {
    const { headlines, stats, evidenceRefs } = extractFindings(r.content);

    // 构建 summary：标题 + 发现列表 + 关键证据
    const headingMatch = r.content.match(HEADING_RE);
    const heading = headingMatch ? headingMatch.slice(0, 3).join("\n") : `## ${r.emoji}${r.label}`;
    const evidenceSection = evidenceRefs.length > 0
      ? `\n关键文件引用: ${evidenceRefs.slice(0, 5).join(", ")}`
      : "";
    const summaryBody = headlines.length > 0
      ? headlines.map((h) => `- ${h}`).join("\n")
      : "(无标记发现)";
    const summary = `${heading}\n${summaryBody}${evidenceSection}`;

    compressed.push({
      agentKey: r.agentKey,
      label: r.label,
      emoji: r.emoji,
      stats,
      headlines,
      summary,
      rawLength: r.content.length,
      compressedLength: summary.length,
    });

    totalFindings += stats.total;
  }

  // 2. 按重要性排序：确认数多的在前
  compressed.sort((a, b) => (b.stats.confirmed + b.stats.warning) - (a.stats.confirmed + a.stats.warning));

  // 3. 预算分配：优先高价值报告
  const aggregateParts: string[] = [];
  let usedBudget = 0;
  const perAgentBudget = Math.floor(totalBudget / compressed.length);

  aggregateParts.push(`## 圆桌报告摘要（${compressed.length} 位审视委员 · ${totalFindings} 条标记发现）\n`);

  for (const c of compressed) {
    if (usedBudget >= totalBudget * 0.85) break; // 存量警戒

    const statLine = `✅${c.stats.confirmed} ⚠️${c.stats.warning} ❌${c.stats.falsified} 🔧${c.stats.runtimeNeeded} ❓${c.stats.insufficient}`;
    const header = `### ${c.emoji}${c.label} — ${statLine}`;
    const budget = Math.min(perAgentBudget, totalBudget - usedBudget - 200);

    let body: string;
    if (c.summary.length <= budget) {
      body = c.summary;
    } else if (c.headlines.length > 0) {
      body = c.headlines.slice(0, Math.min(c.headlines.length, 10)).map((h) => `- ${h}`).join("\n");
      if (body.length > budget) body = body.slice(0, budget) + "\n…";
    } else {
      body = "(该委员未产出带标记的发现)";
    }

    aggregateParts.push(header);
    aggregateParts.push(body);
    aggregateParts.push("");

    usedBudget += header.length + body.length + 2;
  }

  if (usedBudget < totalBudget) {
    aggregateParts.push(`(剩余预算: ${totalBudget - usedBudget} 字符)`);
  }

  return {
    compressed,
    aggregateSummary: aggregateParts.join("\n"),
  };
}

// ─── 内部辅助 ──────────────────────────────────

/** headline 级压缩：仅提取发现行 + 文件引用 */
function _compressHeadline(lines: string[], maxChars: number): string {
  const headlineLines: string[] = [];
  let used = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let matched = false;
    for (const marker of VERDICT_MARKERS) {
      if (marker.re.test(trimmed)) {
        const snippet = trimmed.slice(0, 180);
        if (used + snippet.length + 1 <= maxChars) {
          headlineLines.push(snippet);
          used += snippet.length + 1;
        }
        matched = true;
        break;
      }
    }
    // 也保留标题行
    if (!matched && /^#{1,3}\s/.test(trimmed)) {
      if (used + trimmed.length + 1 <= maxChars) {
        headlineLines.push(trimmed);
        used += trimmed.length + 1;
      }
    }
    if (used >= maxChars) break;
  }

  return headlineLines.length > 0
    ? headlineLines.join("\n")
    : lines.slice(0, Math.ceil(maxChars / 100)).join("\n").slice(0, maxChars);
}

/** summary 级压缩：保留结构 + 关键段落 */
function _compressSummary(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let used = 0;
  let inEvidenceBlock = false;

  for (let i = 0; i < lines.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const line = lines[i]!;
    const trimmed = line.trim();

    // 标题 → 始终保留
    if (/^#{1,3}\s/.test(trimmed)) {
      if (used + trimmed.length + 1 <= maxChars) {
        kept.push(trimmed);
        used += trimmed.length + 1;
        inEvidenceBlock = true;
      }
      continue;
    }

    // 证据块（判定标记或文件引用）
    let isEvidence = false;
    for (const marker of VERDICT_MARKERS) {
      if (marker.re.test(trimmed)) { isEvidence = true; break; }
    }
    if (!isEvidence && FILE_REF_RE.test(trimmed)) isEvidence = true;

    if (isEvidence) {
      const snippet = trimmed.slice(0, 200);
      if (used + snippet.length + 1 <= maxChars) {
        kept.push(snippet);
        used += snippet.length + 1;
        inEvidenceBlock = true;
      }
    } else if (inEvidenceBlock && trimmed) {
      // 证据块后的紧跟行（上下文）
      const snippet = trimmed.slice(0, 120);
      if (used + snippet.length + 1 <= maxChars) {
        kept.push(snippet);
        used += snippet.length + 1;
      }
      inEvidenceBlock = false;
    }

    if (used >= maxChars) break;
  }

  const result = kept.join("\n");
  return result.length > 0 ? result : _compressHeadline(lines, maxChars);
}
