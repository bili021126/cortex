// ============================================================
// Cyrene-Agent RAG 系统 — Reranker（适配版）
//
// 从 Cyrene-Agent src/main/rag/reranker.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径改为参数注入。
// @xenova/transformers 保持 ESM 动态导入。
// ============================================================

import * as path from "path"
import * as os from "os"

// ── Types ──
export interface RerankerProvider {
  rerank(query: string, documents: string[]): Promise<Array<{ text: string; score: number }>>
  readonly name: string
}

const importEsm = new Function("moduleName", "return import(moduleName)") as (moduleName: string) => Promise<any>

let lightPipeline: any = null
let standardPipeline: any = null

let modelsDir = ""

export function setRerankerModelsDir(dir: string): void {
  modelsDir = dir
}

function getModelsDir(): string {
  return modelsDir || path.join(process.cwd(), "models")
}

async function loadRerankerPipeline(modelDir: string): Promise<any> {
  const { pipeline, env } = await importEsm("@xenova/transformers")
  const originalPath = env.localModelPath
  env.localModelPath = getModelsDir()
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.useBrowserCache = false
  try {
    const pipe = await pipeline("text-classification", modelDir, {
      quantized: true,
      cache_dir: path.join(os.homedir(), ".cache", "huggingface"),
    })
    console.log(`[Reranker] pipeline "${modelDir}" loaded OK`)
    return pipe
  } finally {
    env.localModelPath = originalPath
  }
}

export async function createLightReranker(): Promise<RerankerProvider> {
  if (!lightPipeline) lightPipeline = await loadRerankerPipeline("ms-marco-MiniLM-L-6-v2")
  return {
    name: "ms-marco-MiniLM-L6-v2",
    async rerank(query: string, documents: string[]): Promise<Array<{ text: string; score: number }>> {
      if (documents.length === 0 || !lightPipeline) return []
      const start = Date.now()
      const inputs = documents.map((doc) => [query, doc])
      const outputs = await lightPipeline(inputs)
      const results = documents.map((text, i) => ({ text, score: outputs[i]?.score ?? 0 }))
      results.sort((a, b) => b.score - a.score)
      console.log(`[Reranker] light: ${documents.length} docs reranked in ${Date.now() - start}ms`)
      return results
    },
  }
}

export async function createStandardReranker(): Promise<RerankerProvider> {
  if (!standardPipeline) standardPipeline = await loadRerankerPipeline("bge-reranker-base")
  return {
    name: "bge-reranker-base",
    async rerank(query: string, documents: string[]): Promise<Array<{ text: string; score: number }>> {
      if (documents.length === 0 || !standardPipeline) return []
      const start = Date.now()
      const inputs = documents.map((doc) => [query, doc])
      const outputs = await standardPipeline(inputs)
      const results = documents.map((text, i) => ({ text, score: outputs[i]?.score ?? 0 }))
      results.sort((a, b) => b.score - a.score)
      console.log(`[Reranker] standard: ${documents.length} docs reranked in ${Date.now() - start}ms`)
      return results
    },
  }
}

let currentReranker: RerankerProvider | null = null
let currentRerankerMode: "light" | "standard" | "none" = "none"

function checkRerankerModelInstalled(mode: "light" | "standard"): boolean {
  const modelDir = mode === "light" ? "ms-marco-MiniLM-L-6-v2" : "bge-reranker-base"
  const onnxPath = path.join(getModelsDir(), modelDir, "onnx", "model_quantized.onnx")
  try {
    const fs = require("fs")
    return fs.existsSync(onnxPath)
  } catch { return false }
}

export function getRerankerInstallStatus(): { light: boolean; standard: boolean } {
  return {
    light: checkRerankerModelInstalled("light"),
    standard: checkRerankerModelInstalled("standard"),
  }
}

export async function initReranker(mode: "light" | "standard" | "none"): Promise<void> {
  currentRerankerMode = mode
  if (mode === "none") { currentReranker = null; console.log("[Reranker] disabled"); return }

  if (!checkRerankerModelInstalled(mode)) {
    const modelDir = mode === "light" ? "ms-marco-MiniLM-L-6-v2" : "bge-reranker-base"
    console.warn(`[Reranker] 模型未找到 (models/${modelDir}/onnx/model_quantized.onnx)，自动降级为 none。`)
    currentRerankerMode = "none"
    currentReranker = null
    return
  }

  console.log(`[Reranker] initializing ${mode} mode...`)
  if (mode === "light") currentReranker = await createLightReranker()
  else currentReranker = await createStandardReranker()
  console.log(`[Reranker] ${mode} mode ready: ${currentReranker.name}`)
}

export function getReranker(): RerankerProvider | null {
  return currentReranker
}

export function getRerankerMode(): "light" | "standard" | "none" {
  return currentRerankerMode
}

export function resetReranker(): void {
  currentReranker = null
  currentRerankerMode = "none"
  lightPipeline = null
  standardPipeline = null
}
