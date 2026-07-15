// ============================================================
// Cyrene-Agent 记忆系统 — 冲突 Resolver（适配版）
//
// 从 Cyrene-Agent src/main/memory/memory-resolver.ts 提取。
// 适配：移除 Electron/IPC/orchestrator 依赖。
// ============================================================

import { memoryStore } from "./memory-store.js"
import { appendMemoryTrace } from "./memory-trace.js"
import { callLLM, loadModelSettingsFromFile, extractJsonObject } from "./llm-adapter.js"
import type { LLMConfig } from "./llm-adapter.js"
import type { ConflictLog, L2Memory, MemoryEvidence, MemoryConflictResolution as TypesMemoryConflictResolution } from "./memory-types.js"
import * as fs from "fs"
import * as path from "path"

export type MemoryConflictResolutionType =
  | "unrelated"
  | "context_difference"
  | "preference_evolution"
  | "direct_conflict"
  | "uncertain"

export interface MemoryConflictResolution {
  resolutionType: MemoryConflictResolutionType
  resolvedSummary?: string
  currentSummary?: string
  historicalSummary?: string
  reason: string
  confidence: number
  actions: {
    createResolvedMemory: boolean
    oldMemoryStatus?: "active" | "aging" | "archived" | "superseded" | "merged"
    newMemoryStatus?: "active" | "aging" | "archived" | "superseded" | "merged"
    shouldUpdateCoreMemory?: boolean
    shouldAskUser?: boolean
    clarificationNeeded?: boolean
  }
}

export interface ResolverPayload {
  conflictLog: ConflictLog
  newMemory: L2Memory
  oldMemory: L2Memory
  newEvidence: MemoryEvidence[]
  oldEvidence: MemoryEvidence[]
  conflictScore: number
  scoringSignals: ConflictLog["scoringSignals"]
}

export interface ResolverDeps {
  callLLM: (messages: Array<{ role: "system" | "user"; content: string }>, maxTokens: number) => Promise<string>
}

export interface ResolverRunResult {
  status: "skip" | "resolved" | "failed" | "rate_limited"
  conflictLogId?: string
  error?: string
}

export interface ResolverRunOptions {
  now?: number
  minIntervalMs?: number
}

const DEFAULT_MODEL_SETTINGS: LLMConfig = {
  provider: "DeepSeek（深度求索）",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  apiKey: "",
}

let modelSettingsPath = ""

export function setResolverModelPath(filePath: string): void {
  modelSettingsPath = filePath
}

function loadResolverModelSettings(): LLMConfig {
  const fpath = modelSettingsPath || path.join(process.cwd(), "data", "model-settings.json")
  return loadModelSettingsFromFile(fpath, { existsSync: (p: string) => fs.existsSync(p), readFileSync: (p: string, enc: BufferEncoding) => fs.readFileSync(p, enc) as string }, DEFAULT_MODEL_SETTINGS)
}

const DEFAULT_RESOLVER_MIN_INTERVAL_MS = 60_000
let lastResolverRunAt: number | null = null

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim()
}

function normalizeMemoryStatus(value: unknown): MemoryConflictResolution["actions"]["oldMemoryStatus"] {
  if (value === "active" || value === "aging" || value === "archived" || value === "superseded" || value === "merged") {
    return value
  }
  return undefined
}

function normalizeResolution(input: Record<string, unknown>): MemoryConflictResolution | null {
  const resolutionType = input.resolutionType
  const reason = input.reason
  const confidence = input.confidence
  const actions = input.actions
  if (
    resolutionType !== "unrelated" &&
    resolutionType !== "context_difference" &&
    resolutionType !== "preference_evolution" &&
    resolutionType !== "direct_conflict" &&
    resolutionType !== "uncertain"
  ) return null
  if (typeof reason !== "string" || !reason.trim()) return null
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null
  if (!actions || typeof actions !== "object") return null
  const actionRecord = actions as Record<string, unknown>
  return {
    resolutionType: resolutionType as MemoryConflictResolutionType,
    resolvedSummary: typeof input.resolvedSummary === "string" ? input.resolvedSummary.trim() : undefined,
    currentSummary: typeof input.currentSummary === "string" ? input.currentSummary.trim() : undefined,
    historicalSummary: typeof input.historicalSummary === "string" ? input.historicalSummary.trim() : undefined,
    reason: (reason as string).trim(),
    confidence: confidence as number,
    actions: {
      createResolvedMemory: actionRecord.createResolvedMemory === true,
      oldMemoryStatus: normalizeMemoryStatus(actionRecord.oldMemoryStatus),
      newMemoryStatus: normalizeMemoryStatus(actionRecord.newMemoryStatus),
      shouldUpdateCoreMemory: actionRecord.shouldUpdateCoreMemory === true,
      shouldAskUser: actionRecord.shouldAskUser === true,
      clarificationNeeded: actionRecord.clarificationNeeded === true,
    },
  }
}

export async function buildResolverPayload(conflictLogId: string): Promise<ResolverPayload> {
  const store = await memoryStore.load()
  const conflictLog = (store.conflictLogs ?? []).find((log: ConflictLog): boolean => log.id === conflictLogId)
  if (!conflictLog) throw new Error(`conflict log not found: ${conflictLogId}`)
  const newMemory = store.l2.find((memory: L2Memory): boolean => memory.id === conflictLog.sourceL2Id)
  const oldMemory = store.l2.find((memory: L2Memory): boolean => memory.id === conflictLog.targetL2Id)
  if (!newMemory) throw new Error(`source memory not found: ${conflictLog.sourceL2Id}`)
  if (!oldMemory) throw new Error(`target memory not found: ${conflictLog.targetL2Id}`)
  return {
    conflictLog,
    newMemory,
    oldMemory,
    newEvidence: await memoryStore.getEvidenceByMemoryId(newMemory.id),
    oldEvidence: await memoryStore.getEvidenceByMemoryId(oldMemory.id),
    conflictScore: conflictLog.conflictScore ?? 0,
    scoringSignals: conflictLog.scoringSignals,
  }
}

export function buildResolverMessages(payload: ResolverPayload): Array<{ role: "system" | "user"; content: string }> {
  const evidenceLines = (items: MemoryEvidence[]) => items.map((item: MemoryEvidence): string => (
    `- quote: ${item.quoteSnippet}\n  conversationId: ${item.conversationId ?? "unknown"}\n  sourceStatus: ${item.sourceStatus}`
  )).join("\n")
  const userPrompt = [
    "请判断以下两条用户记忆的关系，并只输出 JSON。",
    "",
    "旧记忆：",
    `summary: ${payload.oldMemory.content}`,
    "evidence:",
    evidenceLines(payload.oldEvidence) || "- none",
    "",
    "新记忆：",
    `summary: ${payload.newMemory.content}`,
    "evidence:",
    evidenceLines(payload.newEvidence) || "- none",
    "",
    `conflictScore: ${payload.conflictScore}`,
    `scoringSignals: ${JSON.stringify(payload.scoringSignals ?? {})}`,
    "",
    "JSON 格式：",
    '{"resolutionType":"unrelated|context_difference|preference_evolution|direct_conflict|uncertain","resolvedSummary":"可选","currentSummary":"可选","historicalSummary":"可选","reason":"原因","confidence":0.0,"actions":{"createResolvedMemory":false,"oldMemoryStatus":"active|aging|archived|superseded|merged","newMemoryStatus":"active|aging|archived|superseded|merged","shouldUpdateCoreMemory":false,"shouldAskUser":false,"clarificationNeeded":false}}',
  ].join("\n")
  return [
    { role: "system", content: "你是谨慎的用户记忆冲突 Resolver。你只根据 summary 和 evidence 判断，不要编造事实，只输出 JSON。" },
    { role: "user", content: userPrompt },
  ]
}

export async function callResolverLLM(
  settings: LLMConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens = 700,
): Promise<string> {
  if (!settings.apiKey) throw new Error("missing api key")
  const response = await callLLM(messages, settings, maxTokens)
  return response.text
}

export async function resolvePayload(
  payload: ResolverPayload,
  deps: ResolverDeps,
): Promise<MemoryConflictResolution> {
  const raw = await deps.callLLM(buildResolverMessages(payload), 700)
  const parsed = extractJsonObject(raw)
  const resolution = parsed ? normalizeResolution(parsed) : null
  if (!resolution) throw new Error("invalid resolver json")
  return resolution
}

async function markResolverProcessing(conflictLogId: string): Promise<void> {
  const store = await memoryStore.load()
  const log = (store.conflictLogs ?? []).find((entry: ConflictLog): boolean => entry.id === conflictLogId)
  if (!log) return
  log.resolverStatus = "processing"
  log.resolverStartedAt = Date.now()
  log.resolverAttemptCount = (log.resolverAttemptCount ?? 0) + 1
  await memoryStore.save(store)
  appendMemoryTrace({
    op: "resolver.queue.processing", layer: "L2", status: "ok",
    l2Id: log.sourceL2Id, ragId: log.sourceRagId,
    details: { conflictLogId: log.id, resolverAttemptCount: log.resolverAttemptCount },
  })
}

async function markResolverFailed(conflictLogId: string, error: unknown): Promise<void> {
  const store = await memoryStore.load()
  const log = (store.conflictLogs ?? []).find((entry: ConflictLog): boolean => entry.id === conflictLogId)
  if (!log) return
  log.resolverStatus = "failed"
  log.resolverFinishedAt = Date.now()
  await memoryStore.save(store)
  appendMemoryTrace({
    op: "resolver.queue.failed", layer: "L2", status: "error",
    l2Id: log.sourceL2Id, ragId: log.sourceRagId,
    details: { conflictLogId: log.id, resolverAttemptCount: log.resolverAttemptCount ?? 0 },
    error: error instanceof Error ? error.message : String(error),
  })
}

async function syncResolvedMemoryToRag(log: ConflictLog, addMemory?: (text: string, source: string, metadata?: Record<string, unknown>) => Promise<string>): Promise<void> {
  if (!log.resolutionMemoryId || !log.resolutionType) return
  const store = await memoryStore.load()
  const resolvedMemory = store.l2.find((memory: L2Memory): boolean => memory.id === log.resolutionMemoryId)
  if (!resolvedMemory || resolvedMemory.syncStatus === "synced" || !addMemory) return
  try {
    const ragId = await addMemory(resolvedMemory.content, "user_memory", {
      l2Id: resolvedMemory.id,
      source: "memory_resolver",
      conflictLogId: log.id,
      resolutionType: log.resolutionType,
      sourceL2Id: log.sourceL2Id,
      targetL2Id: log.targetL2Id,
    })
    await memoryStore.markL2SyncStatus(resolvedMemory.id, "synced", ragId)
  } catch (err) {
    await memoryStore.markL2SyncStatus(resolvedMemory.id, "sync_failed", undefined, err)
  }
}

export async function runResolverQueueOnce(
  deps?: ResolverDeps,
  options: ResolverRunOptions = {},
  addMemory?: (text: string, source: string, metadata?: Record<string, unknown>) => Promise<string>,
): Promise<ResolverRunResult> {
  const [next] = await memoryStore.getResolverQueue(1)
  if (!next) return { status: "skip" }

  const now = options.now ?? Date.now()
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_RESOLVER_MIN_INTERVAL_MS
  if (lastResolverRunAt !== null && now - lastResolverRunAt < minIntervalMs) {
    appendMemoryTrace({
      op: "resolver.run.rate_limited", layer: "L2", status: "skip",
      l2Id: next.sourceL2Id, ragId: next.sourceRagId,
      details: { conflictLogId: next.id, elapsedMs: now - lastResolverRunAt, minIntervalMs },
    })
    return { status: "rate_limited", conflictLogId: next.id }
  }
  lastResolverRunAt = now

  try {
    appendMemoryTrace({
      op: "resolver.run.start", layer: "L2", status: "ok",
      l2Id: next.sourceL2Id, ragId: next.sourceRagId,
      details: { conflictLogId: next.id, resolverPriority: next.resolverPriority, conflictScore: next.conflictScore, resolverAttemptCount: next.resolverAttemptCount ?? 0 },
    })
    await markResolverProcessing(next.id)
    const payload = await buildResolverPayload(next.id)
    const runner = deps ?? {
      callLLM: (messages: Array<{ role: "system" | "user"; content: string }>, maxTokens: number) =>
        callResolverLLM(loadResolverModelSettings(), messages, maxTokens),
    }
    const resolution = await resolvePayload(payload, runner)
    const appliedLog = await memoryStore.applyResolverResolution(next.id, resolution)
    if (appliedLog) await syncResolvedMemoryToRag(appliedLog, addMemory)
    appendMemoryTrace({
      op: "resolver.run.success", layer: "L2", status: "ok",
      l2Id: next.sourceL2Id, ragId: next.sourceRagId,
      details: { conflictLogId: next.id, resolutionType: resolution.resolutionType, createdResolvedMemory: resolution.actions.createResolvedMemory === true },
    })
    return { status: "resolved", conflictLogId: next.id }
  } catch (err) {
    await markResolverFailed(next.id, err)
    appendMemoryTrace({
      op: "resolver.run.failed", layer: "L2", status: "error",
      l2Id: next.sourceL2Id, ragId: next.sourceRagId,
      details: { conflictLogId: next.id },
      error: err instanceof Error ? err.message : String(err),
    })
    return { status: "failed", conflictLogId: next.id, error: err instanceof Error ? err.message : String(err) }
  }
}
