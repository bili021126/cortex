// ============================================================
// Cyrene-Agent 记忆系统 — 冲突评分（适配版）
//
// 从 Cyrene-Agent src/main/memory/memory-conflict-score.ts 提取。
// 纯函数，无 Electron/IPC 依赖。
// ============================================================

import type { ConflictResolverPriority, ConflictScoringSignals } from "./memory-types.js"

export type ConflictCandidateSource = "local" | "rag" | "recent_injection"

export type ConflictEvidenceLevel = "none" | "one_side" | "both"

export interface ConflictScoreInput {
  candidateSource: ConflictCandidateSource
  ragScore?: number
  correctionIntent: boolean
  recentInjection: boolean
  localContradiction: boolean
  evidence: ConflictEvidenceLevel
  activeTarget: boolean
  impactScope: "low" | "medium" | "high"
}

export interface ConflictScoreResult {
  conflictScore: number
  resolverPriority: ConflictResolverPriority
  scoringSignals: ConflictScoringSignals
}

const CORRECTION_WEIGHT = 0.35
const EVIDENCE_WEIGHT = 0.20
const IMPACT_WEIGHT = 0.15
const ACTIVE_WEIGHT = 0.10
const BASE_SCORE_REJECT = 5

function computeBaseScore(input: ConflictScoreInput): number {
  let score = BASE_SCORE_REJECT

  if (input.correctionIntent) score += 30
  if (input.localContradiction) score += 20
  if (input.recentInjection) score += 15
  if (input.activeTarget) score += 10
  if (input.ragScore !== undefined && input.ragScore > 0.7) score += 10

  switch (input.evidence) {
    case "both": score += 20; break
    case "one_side": score += 10; break
    case "none": score += 0; break
  }

  switch (input.impactScope) {
    case "high": score += 20; break
    case "medium": score += 10; break
    case "low": score += 0; break
  }

  return score
}

function computeResolverPriority(score: number, input: ConflictScoreInput): ConflictResolverPriority {
  if (score >= 90) return "high"
  if (score >= 60) return "normal"
  if (score >= 30 || input.candidateSource === "recent_injection") return "idle"
  return "none"
}

export function scoreMemoryConflict(input: ConflictScoreInput): ConflictScoreResult {
  let conflictScore = computeBaseScore(input)

  if (input.correctionIntent) conflictScore += conflictScore * CORRECTION_WEIGHT
  if (input.evidence === "both") conflictScore += conflictScore * EVIDENCE_WEIGHT
  if (input.activeTarget) conflictScore += conflictScore * ACTIVE_WEIGHT
  if (input.impactScope === "high") conflictScore += conflictScore * IMPACT_WEIGHT

  conflictScore = Math.round(Math.min(conflictScore, 100))

  const resolverPriority = computeResolverPriority(conflictScore, input)

  return {
    conflictScore,
    resolverPriority,
    scoringSignals: {
      correctionIntent: Boolean(input.correctionIntent),
      ragCandidate: input.candidateSource === "rag" || (input.ragScore !== undefined),
      recentInjection: Boolean(input.recentInjection),
      evidenceAvailable: input.evidence !== "none",
      localContradiction: Boolean(input.localContradiction),
      impactScope: input.impactScope,
      penalties: [],
    },
  }
}
