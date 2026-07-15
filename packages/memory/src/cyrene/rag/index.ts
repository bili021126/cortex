// ============================================================
// Cyrene-Agent RAG 系统 — 统一导出（适配版）
//
// 从 Cyrene-Agent src/main/rag/index.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径参数化。
// ============================================================

import * as path from "path"
import { getEmbeddingProvider, resetEmbeddingProvider, setLocalModelPath } from "./embedding.js"
import type { EmbeddingProvider } from "./embedding.js"
import { JsonVectorStore } from "./vectorstore.js"
import type { RagMemoryEntry } from "./vectorstore.js"
import { HybridRetriever } from "./retriever.js"
import { WorldbookManager } from "./worldbook.js"
export { INJECTION_HEADER, INJECTION_PREAMBLE } from "./worldbook-constants.js"
import { chunkText } from "./chunk.js"
import { setRerankerModelsDir, initReranker, resetReranker } from "./reranker.js"

let store: JsonVectorStore | null = null
let retriever: HybridRetriever | null = null
let worldbook: WorldbookManager | null = null
let provider: EmbeddingProvider | null = null
let dataDir = ""

export function setRagDataDir(dir: string): void { dataDir = dir }
function getDataDir(): string { return dataDir || path.join(process.cwd(), "data", "rag-data") }

export function setRagModelsDir(dir: string): void {
  setLocalModelPath(dir); setRerankerModelsDir(dir)
}

export async function initRAG(
  ragMode: "auto" | "local" | "cloud" = "auto", cloudBaseUrl?: string, cloudApiKey?: string,
  embeddingModel?: string, rerankerMode?: string, worldbookDir?: string,
): Promise<void> {
  const dir = getDataDir()
  provider = getEmbeddingProvider(ragMode, cloudBaseUrl, cloudApiKey, embeddingModel)
  store = new JsonVectorStore(dir)
  if (provider) retriever = new HybridRetriever(store, provider)
  if (worldbookDir) { worldbook = new WorldbookManager(worldbookDir, { stateFile: path.join(dir, "worldbook-state.json") }); await worldbook.loadFromDirectory() }
  if (rerankerMode && rerankerMode !== "none") await initReranker(rerankerMode as "light" | "standard")
}

export async function addMemory(text: string, source = "user_memory", metadata?: Record<string, unknown>): Promise<string> {
  if (!store || !provider) throw new Error("RAG not initialized")
  const entry = await store.add(text, source, provider, metadata)
  return entry.id
}

export async function searchMemory(query: string, source?: string, topK = 5): Promise<string[]> {
  const results = await searchMemoryEntries(query, source, topK)
  return results.map((r) => r.text)
}

export async function searchMemoryEntries(
  query: string, source?: string, topK = 5, options?: { recordRecall?: boolean },
): Promise<Array<{ id: string; text: string; createdAt: number; score: number; metadata?: Record<string, unknown> }>> {
  if (!retriever) return []
  const results = await retriever.retrieve(query, source, topK)
  if (options?.recordRecall !== false) await recordUserMemoryRecalls(results)
  return results.map((r: { entry: RagMemoryEntry; score: number }) => ({
    id: r.entry.id, text: r.entry.text, createdAt: r.entry.createdAt, score: r.score, metadata: r.entry.metadata,
  }))
}

async function recordUserMemoryRecalls(results: Array<{ entry: RagMemoryEntry }>): Promise<void> {
  const l2Ids = results.filter((r) => r.entry.source === "user_memory").map((r) => r.entry.metadata?.l2Id).filter((id): id is string => typeof id === "string" && id.length > 0)
  if (l2Ids.length === 0) return
  try { const { memoryStore } = await import("../memory-store.js"); for (const l2Id of new Set(l2Ids)) { await memoryStore.updateL2RecallStats(l2Id, 1) } } catch (err) { console.warn("[RAG] failed to record user memory recall:", err) }
}

export async function searchHistoryEntries(query: string, topK = 5): Promise<Array<{ text: string; createdAt: number; score: number; metadata?: Record<string, unknown> }>> {
  if (!retriever) return []
  const results = await retriever.retrieve(query, "chat_history", topK)
  return results.map((r: { entry: RagMemoryEntry; score: number }) => ({ text: r.entry.text, createdAt: r.entry.createdAt, score: r.score, metadata: r.entry.metadata }))
}

export function updateWorldbookActivation(userText: string, modelText: string): void { if (!worldbook) return; worldbook.updateActivation(userText, modelText) }
export function getActiveWorldbookEntries() { if (!worldbook) return []; return worldbook.getActiveEntries() }
export function getCascadeWorldbookEntries() { if (!worldbook) return []; return worldbook.getCascadeEntries().map((e: { id: string; content: string }) => { const title = e.id.replace(/^wb_[^_]+_/, "").replace(/_/g, " "); return `【${title}】\n${e.content}` }) }
export function getPermanentWorldbookEntries() { if (!worldbook) return []; return worldbook.getPermanentEntries() }

export async function importDocument(text: string, fileName: string): Promise<number> {
  if (!store || !provider) throw new Error("RAG not initialized")
  const chunks = chunkText(text, "doc_" + fileName)
  const importId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "import_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)
  await store.addBatch(chunks.map((c) => ({ text: c.text, source: "imported_doc", metadata: { fileName, chunkIndex: c.index, importId } })), provider)
  return chunks.length
}

export function resetRAG(): void { store = null; retriever = null; worldbook = null; provider = null; resetEmbeddingProvider(); resetReranker() }
export function getRAGStats(): { total: number; sources: Record<string, number> } { return store?.stats ?? { total: 0, sources: {} } }

export function getEntriesBySource(source: string): RagMemoryEntry[] {
  if (!store) return []
  return (store.entriesList as RagMemoryEntry[]).filter((e) => e.source === source)
}

export function deleteImportedDoc(importId: string, fileName: string): number {
  if (!store) throw new Error("RAG not initialized")
  return store.deleteImportedDoc(importId, fileName)
}
