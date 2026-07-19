// ============================================================
// Cyrene-Agent RAG 系统 — 混合检索器（适配版）
//
// 从 Cyrene-Agent src/main/rag/retriever.ts 提取。
// 适配：移除 @node-rs/jieba 依赖。BM25 改用简易中文/英文分词。
// ============================================================

import type { RagMemoryEntry, SearchResult } from "./vectorstore.js"
import type { JsonVectorStore } from "./vectorstore.js"
import type { EmbeddingProvider } from "./embedding.js"

interface TokenInfo {
  word: string
  isStop: boolean
  isNoun: boolean
}

const STOP_WORDS = new Set([
  "的","了","是","在","我","你","他","她","它",
  "有","不","也","就","都","这","那","还","要",
  "和","与","或","但","而","且","及","之","为",
  "上","下","中","里","外","前","后",
  "到","去","来","从","把","被","让","给","对",
  "吗","呢","吧","啊","嘛","哦","嗯","呀","哇",
  "很","太","更","最","非","没","将","已","能",
  "会","可","以","好","多","少","大","小","真",
  "个","些","点","样","种",
  "做","当","看","听","说","想","觉","知","道",
  "过","完","着","住","得","地","于","其","该",
  "我们","你们","他们","她们","它们",
  "自己","什么","怎么","为什么","因为","所以",
  "这个","那个","这些","那些","这里","那里",
  "一个","一种","一些","的话","时候","地方",
  "东西","事情","问题","就是","可以","但是",
  "没有","不要","不是","不会","不能","应该",
  "已经","可能","觉得","知道","告诉",
  "the","a","an","is","are","was","were","be","been",
  "i","you","he","she","it","we","they",
  "this","that","these","those","and","or","but",
  "in","on","at","to","for","of","with","by",
  "from","as","into","through","during","before","after",
])
const STOP_WEIGHT = 0.3
const NOUN_WEIGHT = 1.3

function tokenize(text: string): TokenInfo[] {
  const result: TokenInfo[] = []
  if (/^[a-zA-Z0-9\s]+$/.test(text)) {
    return text.split(/\s+/).filter(Boolean).map((word) => ({
      word: word.toLowerCase(), isStop: STOP_WORDS.has(word.toLowerCase()), isNoun: false,
    }))
  }
  const segments = text.split(/([\u4e00-\u9fff]+|[a-zA-Z0-9]+)/).filter(Boolean)
  for (const seg of segments) {
    if (/^[\u4e00-\u9fff]+$/.test(seg)) {
      for (let i = 0; i <= seg.length - 2; i++) {
        const word = seg.slice(i, i + 2)
        result.push({ word, isStop: STOP_WORDS.has(word), isNoun: true })
      }
      if (seg.length === 1) {
        result.push({ word: seg, isStop: STOP_WORDS.has(seg), isNoun: false })
      }
    } else {
      const word = seg.toLowerCase()
      result.push({ word, isStop: STOP_WORDS.has(word), isNoun: false })
    }
  }
  return result
}

function bm25Score(
  queryTokens: TokenInfo[], docTokens: TokenInfo[],
  docFreq: Map<string, number>, totalDocs: number, avgDocLen: number,
): number {
  const k1 = 1.2; const b = 0.75
  let score = 0
  const tf = new Map<string, number>()
  for (const t of docTokens) tf.set(t.word, (tf.get(t.word) || 0) + 1)
  for (const qt of queryTokens) {
    const df = docFreq.get(qt.word) || 0
    if (df === 0) continue
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1)
    const termFreq = tf.get(qt.word) || 0
    const numerator = termFreq * (k1 + 1)
    const denominator = termFreq + k1 * (1 - b + b * (avgDocLen ? docTokens.length / avgDocLen : 1))
    let termScore = idf * (numerator / denominator)
    if (qt.isNoun) termScore *= NOUN_WEIGHT
    if (qt.isStop) termScore *= STOP_WEIGHT
    score += termScore
  }
  return score
}

export class HybridRetriever {
  private store: JsonVectorStore
  private provider: EmbeddingProvider | null

  constructor(store: JsonVectorStore, provider: EmbeddingProvider | null) {
    this.store = store; this.provider = provider ?? null
  }

  async retrieve(query: string, source?: string, topK = 5, vectorWeight = 0.7, bm25Weight = 0.3): Promise<SearchResult[]> {
    const stats = this.store.stats
    if (stats.total === 0) return []
    if (!this.provider) return this.bm25Search(query, source, topK)

    const vectorResults = await this.store.search(query, source, this.provider, topK * 3)
    const bm25Results = this.bm25Search(query, source, topK * 3)

    const merged = new Map<string, { result: SearchResult; vectorScore: number; bm25Score: number }>()
    for (const r of vectorResults) merged.set(r.entry.id, { result: r, vectorScore: r.score, bm25Score: 0 })
    for (const r of bm25Results) {
      const existing = merged.get(r.entry.id)
      if (existing) existing.bm25Score = r.score
      else merged.set(r.entry.id, { result: r, vectorScore: 0, bm25Score: r.score })
    }
    const all = Array.from(merged.values())
    const maxV = Math.max(...all.map((m) => m.vectorScore), 1)
    const maxB = Math.max(...all.map((m) => m.bm25Score), 1)
    const scored = all.map((m) => ({ ...m.result, score: (m.vectorScore / maxV) * vectorWeight + (m.bm25Score / maxB) * bm25Weight }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  bm25Search(query: string, source?: string, topK = 15): SearchResult[] {
    const entries = this.store.entriesList as RagMemoryEntry[]
    const docs = source ? entries.filter((e) => e.source === source) : entries
    if (docs.length === 0) return []

    const queryTokenInfo = tokenize(query)
    const docTokensList = docs.map((d) => tokenize(d.text))
    const totalDocs = docs.length
    const avgDocLen = docTokensList.reduce((sum, t) => sum + t.length, 0) / totalDocs
    const docFreq = new Map<string, number>()
    for (const tokens of docTokensList) {
      const seen = new Set<string>()
      for (const t of tokens) { if (!seen.has(t.word)) { docFreq.set(t.word, (docFreq.get(t.word) || 0) + 1); seen.add(t.word) } }
    }
    const scored = docs.map((doc, i) => {
      const queryWordsSet = new Set(queryTokenInfo.map((t) => t.word))
       
      const relevantDocTokens = docTokensList[i]!.filter((t) => queryWordsSet.has(t.word))
      if (relevantDocTokens.length === 0) return { entry: doc, score: 0 }
       
      return { entry: doc, score: bm25Score(queryTokenInfo, docTokensList[i]!, docFreq, totalDocs, avgDocLen) }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }
}
