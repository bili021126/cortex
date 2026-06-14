// ============================================================
// conflict-detector.ts —— 记忆冲突检测
//
// 检测两条或多条记忆之间的语义冲突，标记需要裁决的不一致。
//
// 检测规则:
//   (a) 同 taskId 下的矛盾结论（confidence 相近但 opposite）
//   (b) 同 kind + 相似 summary 但 content 矛盾的记忆
//   (c) 低置信度记忆与高置信度记忆相互否定
//
// @design 基于 Jaccard 相似度 + 否定关键词检测
// @since Core-3 — 精英团队协作协议
// ============================================================

import type { MemoryEntry } from "@cortex/shared";

// ── 类型 ──────────────────────────────────────

/** 冲突报告 */
export interface ConflictReport {
  /** 冲突摘要 */
  summary: string;
  /** 冲突的记忆 ID 列表 */
  conflictingIds: string[];
  /** 冲突类型 */
  type: "contradiction" | "ambiguity" | "low_confidence_dispute";
  /** 建议的升级级别 */
  escalationLevel: "peer_confirm" | "strategist" | "user";
}

/** 冲突检测器接口 */
export interface ConflictDetector {
  /** 在一批记忆中检测冲突，返回第一条发现的冲突或 null */
  detect(entries: MemoryEntry[]): ConflictReport | null;
}

// ── 否定关键词 ──────────────────────────────

const NEGATION_PATTERNS = [
  /不是|不对|不行|错误|fail|invalid|incorrect|wrong|bug|defect|缺陷|问题/,
  /should\s+not|must\s+not|do\s+not|can't|cannot|don't/,
];

const AFFIRMATION_PATTERNS = [
  /正确|是对的|通过|passed|correct|valid|ok|good|正常/,
];

// ── 相似度 ──────────────────────────────────

/** Jaccard 相似度（基于字符 bigram） */
function jaccardSimilarity(a: string, b: string): number {
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));
  const intersection = new Set([...bigramsA].filter((x) => bigramsB.has(x)));
  const union = new Set([...bigramsA, ...bigramsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ── 冲突检测实现 ────────────────────────────

export class DefaultConflictDetector implements ConflictDetector {
  private readonly _similarityThreshold: number;
  private readonly _weightGapThreshold: number;

  constructor(similarityThreshold = 0.4, weightGapThreshold = 0.3) {
    this._similarityThreshold = similarityThreshold;
    this._weightGapThreshold = weightGapThreshold;
  }

  detect(entries: MemoryEntry[]): ConflictReport | null {
    // 同类记忆按 taskId 分组
    const groups = this._groupByKind(entries);

    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const conflict = this._checkPair(group[i], group[j]);
          if (conflict) return conflict;
        }
      }
    }

    return null;
  }

  // ── 内部 ──────────────────────────────────

  private _groupByKind(entries: MemoryEntry[]): MemoryEntry[][] {
    const map = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const list = map.get(e.kind) ?? [];
      list.push(e);
      map.set(e.kind, list);
    }
    return [...map.values()];
  }

  private _checkPair(a: MemoryEntry, b: MemoryEntry): ConflictReport | null {
    const sim = jaccardSimilarity(a.summary, b.summary);

    // 相似度不够高，不是同一主题
    if (sim < this._similarityThreshold) return null;

    // 检查是否有否定/肯定对立
    const aHasNeg = NEGATION_PATTERNS.some((p) => p.test(a.summary));
    const bHasNeg = NEGATION_PATTERNS.some((p) => p.test(b.summary));
    const aHasAff = AFFIRMATION_PATTERNS.some((p) => p.test(a.summary));
    const bHasAff = AFFIRMATION_PATTERNS.some((p) => p.test(b.summary));

    const opposite = (aHasNeg && bHasAff) || (aHasAff && bHasNeg);

    if (opposite) {
      const escalation = this._determineEscalation(a, b);
      return {
        summary: `冲突: "${a.summary.slice(0, 50)}" 与 "${b.summary.slice(0, 50)}" 可能矛盾`,
        conflictingIds: [a.id, b.id],
        type: "contradiction",
        escalationLevel: escalation,
      };
    }

    // 低置信度争议
    const weightGap = Math.abs(a.weight - b.weight);
    if (sim > 0.6 && weightGap > this._weightGapThreshold) {
      const escalation = this._determineEscalation(a, b);
      return {
        summary: `低置信争议: "${a.summary.slice(0, 50)}" (置信 ${a.weight.toFixed(2)}) vs ${b.weight.toFixed(2)}`,
        conflictingIds: [a.id, b.id],
        type: "low_confidence_dispute",
        escalationLevel: escalation,
      };
    }

    return null;
  }

  private _determineEscalation(a: MemoryEntry, b: MemoryEntry): "peer_confirm" | "strategist" | "user" {
    const avgWeight = (a.weight + b.weight) / 20; // normalize from 0-10 to 0-0.5
    if (avgWeight < 0.3) return "peer_confirm";
    if (avgWeight < 0.5) return "strategist";
    return "user";
  }
}

/** 工厂函数：创建默认冲突检测器 */
export function createDefaultConflictDetector(): ConflictDetector {
  return new DefaultConflictDetector();
}
