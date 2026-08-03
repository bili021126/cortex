// ============================================================
// Cyrene-Agent RAG 系统 — Embedding Provider（适配版）
//
// 从 Cyrene-Agent src/main/rag/embedding.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径改为参数注入。
// @xenova/transformers 保持 ESM 动态导入。
// ============================================================

import * as path from "path"
import * as os from "os"

// ── 类型 ──
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  readonly dims: number
  readonly name: string
}

// ── 模型注册表 ──
interface ModelConfig {
  key: string
  hfName: string
  dims: number
}

const LOCAL_MODELS: Record<string, ModelConfig> = {
  minilm: { key: "minilm", hfName: "Xenova/all-MiniLM-L6-v2", dims: 384 },
  bgem3:  { key: "bgem3",  hfName: "Xenova/bge-m3",          dims: 1024 },
}

const DEFAULT_MODEL_KEY = "minilm"

 
const localPipelines: Map<string, any> = new Map()
let currentModelKey: string = DEFAULT_MODEL_KEY

 
const importEsm = new Function("moduleName", "return import(moduleName)") as (moduleName: string) => Promise<any>

let localModelPath = ""

/** 设置本地模型路径（替代 app.getAppPath()） */
export function setLocalModelPath(modelPath: string): void {
  localModelPath = modelPath
}

 
async function getLocalPipeline(modelKey?: string): Promise<any> {
  const key = modelKey || currentModelKey
  const config = LOCAL_MODELS[key]
  if (!config) throw new Error("Unknown embedding model: " + key)

  let pipe = localPipelines.get(key)
  if (!pipe) {
    const { pipeline, env } = await importEsm("@xenova/transformers")
    env.allowLocalModels = true
    env.allowRemoteModels = false
    env.useBrowserCache = false
    env.localModelPath = localModelPath || path.join(process.cwd(), "models")
    pipe = await pipeline("feature-extraction", config.hfName, {
      cache_dir: path.join(os.homedir(), ".cache", "huggingface"),
    })
    localPipelines.set(key, pipe)
  }
  return pipe
}

export function createLocalEmbeddingProvider(modelKey?: string): EmbeddingProvider | null {
  const key = modelKey || DEFAULT_MODEL_KEY
  const config = LOCAL_MODELS[key]
  if (!config) throw new Error("Unknown embedding model: " + key)

  return {
    name: "local-" + config.hfName.split("/").pop(),
    dims: config.dims,

    async embed(text: string): Promise<number[]> {
      const pipe = await getLocalPipeline(key)
       
      const result: any = await pipe(text, { pooling: "mean", normalize: true })
      return Array.from(result.data as Float32Array)
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const pipe = await getLocalPipeline(key)
      const results: number[][] = []
      for (const text of texts) {
         
        const result: any = await pipe(text, { pooling: "mean", normalize: true })
        results.push(Array.from(result.data as Float32Array))
      }
      return results
    },
  }
}

// ── OpenAI 兼容 Provider ──
export function createOpenAIEmbeddingProvider(
  baseUrl: string,
  apiKey: string,
  model = "text-embedding-ada-002"
): EmbeddingProvider {
  const endpoint = baseUrl.replace(/\/+$/, "") + "/embeddings"

  return {
    name: "openai-compat-" + model,
    dims: 1536,

    async embed(text: string): Promise<number[]> {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model, input: text }),
      })
      if (!res.ok) throw new Error("Embedding API error: " + res.status + " " + await res.text())
      const data = await res.json() as { data: Array<{ embedding: number[] }> }
      return data.data[0]?.embedding ?? []
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!res.ok) throw new Error("Embedding API error: " + res.status + " " + await res.text())
      const data = await res.json() as { data: Array<{ embedding: number[] }> }
      return data.data.map((d) => d.embedding)
    },
  }
}

// ── 自动选择 Provider ──
let cachedProvider: EmbeddingProvider | null = null

export function getEmbeddingProvider(
  mode: "auto" | "local" | "cloud" = "auto",
  cloudBaseUrl?: string,
  cloudApiKey?: string,
  modelKey?: string
): EmbeddingProvider | null {
  if (cachedProvider) return cachedProvider

  if (mode === "local") {
    cachedProvider = createLocalEmbeddingProvider(modelKey)
  } else if (mode === "cloud" && cloudBaseUrl && cloudApiKey) {
    cachedProvider = createOpenAIEmbeddingProvider(cloudBaseUrl, cloudApiKey)
  } else {
    const local = createLocalEmbeddingProvider(modelKey)
    if (local) {
      cachedProvider = local
    } else if (cloudBaseUrl && cloudApiKey) {
      cachedProvider = createOpenAIEmbeddingProvider(cloudBaseUrl, cloudApiKey)
    } else {
      cachedProvider = null
    }
  }
  return cachedProvider
}

export function resetEmbeddingProvider(): void {
  // R11-24：真正释放 onnxruntime 会话（此前仅清 Map 引用——模型占用不释放）
  for (const pipe of localPipelines.values()) {
    try { (pipe as any)?.dispose?.() } catch { /* 释放失败不阻断 */ }
  }
  cachedProvider = null
  localPipelines.clear()
  currentModelKey = DEFAULT_MODEL_KEY
}
