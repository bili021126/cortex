// ============================================================
// Cyrene-Agent 记忆系统 — 记忆压缩 + Reflection 引擎（适配版）
//
// 从 Cyrene-Agent src/main/memory/memory-compressor.ts 提取。
// 适配：移除 Electron/IPC/orchestrator 依赖。
// ============================================================

import type { ILlmService, ILlmServiceMessage } from "@cortex/shared";
import { memoryStore } from "./memory-store.js"
import type { L0WritableField } from "./memory-store.js"
import { L0_FIELD_DESCRIPTIONS } from "./memory-types.js"
import type { L2Memory } from "./memory-types.js"
import type { LLMConfig } from "./llm-adapter.js";
import { callLLM, loadModelSettingsFromFile } from "./llm-adapter.js"
import * as fs from "fs"
import * as path from "path"

const DEFAULT_MODEL_SETTINGS: LLMConfig = {
  provider: "DeepSeek（深度求索）",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  apiKey: "",
}

let modelSettingsPath = ""

export function setCompressorModelPath(filePath: string): void {
  modelSettingsPath = filePath
}

/** LLM Service 注入——来自主 LLM 栈（熔断/限流/遥测已内置） */
let _compressorLlmService: ILlmService | null = null

/**
 * 注入 ILlmService 实例，使 Compressor 走主 LLM 栈而非直调 callLLM。
 * 传入 null 恢复默认行为（走 callLLM）。
 */
export function setCompressorLlmService(svc: ILlmService | null): void {
  _compressorLlmService = svc
}

function loadSettings(): LLMConfig {
  const fpath = modelSettingsPath || path.join(process.cwd(), "data", "model-settings.json")
  return loadModelSettingsFromFile(fpath, { existsSync: (p: string) => fs.existsSync(p), readFileSync: (p: string, enc: BufferEncoding) => fs.readFileSync(p, enc) as string }, DEFAULT_MODEL_SETTINGS)
}

async function callLLMWrapper(messages: Array<{ role: "system" | "user"; content: string }>, maxTokens = 500): Promise<string> {
  if (_compressorLlmService) {
    const svcRes = await _compressorLlmService.chat(messages as ILlmServiceMessage[], { maxTokens, model: loadSettings().model })
    return svcRes.text
  }
  const settings = loadSettings()
  if (!settings.apiKey) throw new Error("missing api key")
  const response = await callLLM(messages, settings, maxTokens)
  return response.text
}

// ── 工具函数 ──

/** 从文本中提取 JSON 对象数组（容错：截断、markdown 包裹） */
function extractJsonArrayLocal(raw: string): unknown[] | null {
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim()
  const start = text.indexOf("[")
  if (start === -1) return null
  text = text.slice(start)
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed } catch { /* fall through */ }
  const results: unknown[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== "{") { i++; continue }
    let depth = 0, inStr = false, esc = false, j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (esc) { esc = false; continue }
      if (c === "\\") { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === "{") depth++
      else if (c === "}") { depth--; if (depth === 0) break }
    }
    if (depth !== 0) break
    try { const obj = JSON.parse(text.slice(i, j + 1)); if (obj && typeof obj === "object") results.push(obj) } catch { /* skip */ }
    i = j + 1
  }
  return results.length > 0 ? results : null
}

// ── 阶段 A：记忆压缩 ──

const SIMILARITY_THRESHOLD = 0.85
const MIN_GROUP_SIZE = 3

interface GroupedEntry {
  l2: L2Memory
  embedding: number[]
}

/** 简化版余弦相似度 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}

async function compressMemories(getEntriesBySource: (source: string) => Array<{ id: string; text: string; embedding: number[]; createdAt: number; weight: number }>): Promise<number> {
  const allL2 = await memoryStore.getAllL2()
  const activeL2 = allL2.filter((m) => m.status === "active" && !m.isSummary && m.ragId)

  if (activeL2.length < MIN_GROUP_SIZE) {
    // eslint-disable-next-line no-console
    console.log("[MemoryCompressor] 活跃 L2 条目不足，跳过压缩")
    return 0
  }

  const ragEntries = getEntriesBySource("user_memory")
  const embeddingMap = new Map<string, number[]>()
  for (const re of ragEntries) {
    embeddingMap.set(re.id, re.embedding)
  }

  const withEmbedding: GroupedEntry[] = []
  for (const l2 of activeL2) {
    if (l2.ragId) {
      const emb = embeddingMap.get(l2.ragId)
      if (emb) withEmbedding.push({ l2, embedding: emb })
    }
  }

  if (withEmbedding.length < MIN_GROUP_SIZE) {
    // eslint-disable-next-line no-console
    console.log("[MemoryCompressor] 带 embedding 的条目不足，跳过压缩")
    return 0
  }

  const used = new Set<string>()
  const groups: GroupedEntry[][] = []

  for (let i = 0; i < withEmbedding.length; i++) {
     
    if (used.has(withEmbedding[i]!.l2.id)) continue
     
    const group: GroupedEntry[] = [withEmbedding[i]!]
     
    used.add(withEmbedding[i]!.l2.id)
    for (let j = i + 1; j < withEmbedding.length; j++) {
       
      if (used.has(withEmbedding[j]!.l2.id)) continue
       
      const sim = cosineSimilarity(withEmbedding[i]!.embedding, withEmbedding[j]!.embedding)
      if (sim >= SIMILARITY_THRESHOLD) {
         
        group.push(withEmbedding[j]!)
         
        used.add(withEmbedding[j]!.l2.id)
      }
    }
    if (group.length >= MIN_GROUP_SIZE) groups.push(group)
  }

  if (groups.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[MemoryCompressor] 未找到可压缩的条目组")
    return 0
  }

  // eslint-disable-next-line no-console
  console.log(`[MemoryCompressor] 发现 ${groups.length} 个可压缩组`)

  let totalCompressed = 0
  for (const group of groups) {
    try {
      const texts = group.map((g) => `- ${g.l2.content}`)
      const prompt = [
        "你是一个记忆总结助手。以下是一组相似的用户记忆条目，请将它们合并成一条简洁的总结。",
        "要求：",
        "- 保留所有关键信息，去重",
        "- 用中文自然语言",
        "- 控制在 100 字以内",
        "- 直接输出总结文本，不要额外解释",
        "",
        "记忆条目：",
        ...texts,
      ].join("\n")

      const summary = await callLLMWrapper([
        { role: "system", content: "你是一个简洁的记忆总结助手。" },
        { role: "user", content: prompt },
      ], 300)

      const cleanSummary = summary.replace(/^["「『]|["」』]$/g, "").trim()
      if (!cleanSummary || cleanSummary.length < 5) continue

      const subEntryIds = group.map((g) => g.l2.id)
      
      // P1-10: 压缩非事务——先归档原始条目（对用户隐藏），再写入总结；
      // add 失败则回滚 archive（恢复 active），防止部分提交丢数据
      await memoryStore.archiveL2Batch(subEntryIds)
      try {
        await memoryStore.addL2Memory({
          content: cleanSummary,
          triggerText: group[0]!.l2.triggerText,
          sourceConversationId: group[0]!.l2.sourceConversationId,
          ragId: undefined,
          embedding: [],
          isPinned: false,
          isSummary: true,
          subEntryIds,
        })
      } catch (err) {
        // 回滚：恢复已归档的原始条目为 active
        await memoryStore.updateL2Status(subEntryIds, "active").catch(() => {})
        throw err
      }
      
      await memoryStore.appendReflectionLog({
        type: "compression",
        summary: `压缩 ${subEntryIds.length} 条记忆为一条总结`,
        details: `原条目：${texts.join(" | ")}\n总结：${cleanSummary}`,
      })

      totalCompressed += subEntryIds.length
      // eslint-disable-next-line no-console
      console.log(`[MemoryCompressor] 压缩了 ${subEntryIds.length} 条 → "${cleanSummary.slice(0, 40)}"`)
    } catch (err) {
      console.warn("[MemoryCompressor] 组压缩失败:", err)
    }
  }

  return totalCompressed
}

// ── 阶段 B：Reflection（L0/L1 元认知更新） ──

async function runReflection(): Promise<void> {
  try {
    const l0 = await memoryStore.getL0()
    const l1 = await memoryStore.getL1()

    if (l0.isPinned) {
      // eslint-disable-next-line no-console
      console.log("[Reflection] L0 已锁定，跳过更新建议")
    }

    const currentProfile = [
      "当前用户画像：",
      l0.preferredName ? `  称呼：${l0.preferredName}` : "",
      l0.occupation ? `  职业：${l0.occupation}` : "",
      l0.longTermInterests ? `  长期兴趣：${l0.longTermInterests}` : "",
      l0.language ? `  常用语言：${l0.language}` : "",
      l0.permanentNote ? `  备注：${l0.permanentNote}` : "",
      "",
      "当前近期状态：",
      l1.recentGoals ? `  最近目标：${l1.recentGoals}` : "",
      l1.recentPreferences ? `  近期偏好：${l1.recentPreferences}` : "",
      l1.currentProject ? `  当前项目：${l1.currentProject}` : "",
      `  对话轮数：${l1.roundCount}`,
    ].filter(Boolean).join("\n")

    const fieldDescriptions = Object.entries(L0_FIELD_DESCRIPTIONS)
      .map(([field, desc]) => `  ${field}：${desc}`)
      .join("\n")

    const prompt = [
      "你是一个用户画像反思助手。",
      "回顾与用户的长期互动，判断是否需要更新用户画像或近期状态。",
      "",
      currentProfile,
      "",
      "请分析：",
      "1. 是否有信息可以更新 L0 字段（稳定身份信息）？",
      `   可用字段：\n${fieldDescriptions}`,
      "2. 是否有信息可以更新 L1 字段（近期目标/偏好/项目）？",
      "",
      "如果没有需要更新的信息，返回空数组 []。",
      "如果需要更新，以 JSON 数组格式返回，每个元素包含：",
      '{ "layer": "L0"|"L1", "field": "字段名", "content": "新值", "confidence": 0.0~1.0 }',
      "",
      "只输出 JSON，不要额外解释。",
    ].join("\n")

    const raw = await callLLMWrapper([
      { role: "system", content: "你是一个谨慎的用户画像反思助手。只输出 JSON 数组。" },
      { role: "user", content: prompt },
    ], 500)

    const parsed = extractJsonArrayLocal(raw)
    if (!parsed || parsed.length === 0) {
      // eslint-disable-next-line no-console
      console.log("[Reflection] 无 L0/L1 更新建议")
      return
    }

    const validFields = Object.keys(L0_FIELD_DESCRIPTIONS)
    let updateCount = 0

    for (const item of parsed) {
      const rec = item as Record<string, unknown>
      const layer = rec.layer
      const field = rec.field as string | undefined
      const content = rec.content as string | undefined
      const confidence = rec.confidence as number | undefined

      if (!content || !confidence || confidence < 0.6) continue

      if (layer === "L0" && field && validFields.includes(field) && !l0.isPinned) {
        await memoryStore.upsertL0Field(field as L0WritableField, content.trim())
        await memoryStore.appendReflectionLog({
          type: "l0_update",
          summary: `L0.${field} 更新为 "${content.slice(0, 30)}"（置信度 ${confidence.toFixed(2)}）`,
        })
        updateCount++
        // eslint-disable-next-line no-console
        console.log(`[Reflection] L0.${field} 更新: "${content.slice(0, 30)}"`)
      } else if (layer === "L1") {
        const l1Field = /目标|想要|计划|打算/.test(content) ? "recentGoals" : "recentPreferences"
        await memoryStore.replaceL1Field(l1Field, content.trim())
        await memoryStore.appendReflectionLog({
          type: "l1_update",
          summary: `L1.${l1Field} 更新为 "${content.slice(0, 30)}"（置信度 ${confidence.toFixed(2)}）`,
        })
        updateCount++
        // eslint-disable-next-line no-console
        console.log(`[Reflection] L1.${l1Field} 更新: "${content.slice(0, 30)}"`)
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Reflection] 完成，更新了 ${updateCount} 个字段`)
  } catch (err) {
    console.warn("[Reflection] 执行失败:", err)
  }
}

// ── 公开入口 ──

/**
 * 运行记忆压缩 + Reflection。
 * @param getEntriesBySource 外部注入的 RAG 条目获取函数
 */
export async function runReflectionAndCompression(
  getEntriesBySource?: (source: string) => Array<{ id: string; text: string; embedding: number[]; createdAt: number; weight: number }>
): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[Memory] 开始 20 轮 Reflection + 记忆压缩...")

  // 阶段 A：记忆压缩
  const compressed = getEntriesBySource ? await compressMemories(getEntriesBySource) : 0
  // eslint-disable-next-line no-console
  console.log(`[Memory] 压缩完成，共压缩 ${compressed} 条原始记忆`)

  // 阶段 B：Reflection
  await runReflection()

  // eslint-disable-next-line no-console
  console.log("[Memory] Reflection + 压缩流程完成")
}