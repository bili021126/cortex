// ============================================================
// Cyrene-Agent RAG 系统 — 滑动窗口 Chunk 切分（适配版）
//
// 从 Cyrene-Agent src/main/rag/chunk.ts 提取。
// 纯函数，无 Electron/IPC 依赖。
// ============================================================

export interface Chunk {
  id: string
  text: string
  source: string
  index: number
  metadata?: Record<string, unknown>
}

function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherTokens = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).length
  return chineseChars + otherTokens
}

interface CharSpan {
  start: number
  end: number
  text: string
}

function findNextSentenceBoundary(text: string, pos: number): number {
  for (let i = pos; i < text.length; i++) {
    const c = text[i]!
    if (c === "\u3002" || c === "\uff01" || c === "\uff1f" || c === "\n" || c === "." || c === "!" || c === "?") {
      let j = i + 1
      while (j < text.length && "\u3002\uff01\uff1f\n.!?".includes(text[j]!)) j++
      return j
    }
  }
  return -1
}

function slidingWindowChars(text: string, chunkSize: number, overlap: number): CharSpan[] {
  if (!text || !text.trim()) return []
  const totalChars = text.length
  if (estimateTokens(text) <= chunkSize) return [{ start: 0, end: totalChars, text }]

  const spans: CharSpan[] = []
  const step = chunkSize - overlap
  const totalTokens = estimateTokens(text)
  const tokensPerChar = totalTokens / totalChars

  let posStart = 0
  let chunkIndex = 0

  while (posStart < totalChars) {
    const startToken = Math.round(posStart * tokensPerChar)
    const endToken = startToken + chunkSize
    let posEndChar = Math.min(totalChars, Math.round(endToken / tokensPerChar))

    if (chunkIndex > 0 && (totalChars - posStart) < chunkSize * tokensPerChar * 0.33) {
      const lastSpan = spans[spans.length - 1]!
      lastSpan.text = text.slice(lastSpan.start)
      lastSpan.end = totalChars
      break
    }

    const maxExtend = posEndChar + Math.round(chunkSize * 0.2 * tokensPerChar)
    const boundary = findNextSentenceBoundary(text, posEndChar)
    if (boundary !== -1 && boundary <= Math.min(maxExtend, totalChars)) posEndChar = boundary

    spans.push({ start: Math.round(posStart), end: posEndChar, text: text.slice(Math.round(posStart), posEndChar) })
    chunkIndex++
    posStart += step / tokensPerChar
  }

  return spans
}

interface TitleRecord {
  level: number
  title: string
  tokenPos: number
}

function extractTitles(text: string): TitleRecord[] {
  const titles: TitleRecord[] = []
  const lines = text.split("\n")
  let tokenPos = 0
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) titles.push({ level: match[1]!.length, title: match[2]!.trim(), tokenPos })
    tokenPos += estimateTokens(line + "\n")
  }
  return titles
}

function getTitlePrefix(tokenPos: number, titles: TitleRecord[]): string {
  const active: TitleRecord[] = []
  for (const t of titles) {
    if (t.tokenPos > tokenPos) break
    while (active.length > 0 && active[active.length - 1]!.level >= t.level) active.pop()
    active.push(t)
  }
  if (active.length === 0) return ""
  return active.map((t) => t.title).join(" > ")
}

export function chunkText(text: string, source: string, chunkSize = 512, overlap = 128): Chunk[] {
  const titles = extractTitles(text)
  const hasTitles = titles.length > 0
  const spans = slidingWindowChars(text, chunkSize, overlap)
  const result: Chunk[] = []

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!
    let chunkTextContent = span.text.trim()
    if (!chunkTextContent) continue

    if (hasTitles) {
      const startTokenPos = Math.round(estimateTokens(text.slice(0, span.start)))
      const prefix = getTitlePrefix(startTokenPos, titles)
      if (prefix) chunkTextContent = `【${prefix}】${chunkTextContent}`
    }

    result.push({ id: `${source}_${i}`, text: chunkTextContent, source, index: i })
  }

  return result
}
