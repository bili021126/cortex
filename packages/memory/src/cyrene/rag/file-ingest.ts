// ============================================================
// Cyrene-Agent RAG 系统 — 文件摄入（适配版）
//
// 从 Cyrene-Agent src/main/rag/file-ingest.ts 提取。
// 纯函数，无 Electron/IPC 依赖。
// ============================================================

import * as fs from "fs"
import * as path from "path"

export type AttachmentKind = "text" | "indexed" | "empty" | "unsupported"

export interface Attachment {
  name: string
  kind: AttachmentKind
  text?: string
  chunks?: number
  reason?: string
}

export type ImportFn = (text: string, fileName: string) => Promise<number>

export const SMALL_THRESHOLD = 30_000

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log",
  ".xml", ".yaml", ".yml",
  ".js", ".mjs", ".ts", ".tsx", ".jsx",
  ".py", ".java", ".c", ".cpp", ".cc", ".h", ".hpp",
  ".rs", ".go", ".rb", ".php", ".sh", ".bash",
  ".css", ".scss", ".sql",
  ".ini", ".conf", ".toml", ".env",
  ".svg", ".html", ".htm",
])

const UNSUPPORTED_EXTS = new Set([
  ".zip", ".7z", ".rar", ".tar", ".gz",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".class", ".jar", ".pyc",
  ".o", ".a", ".wasm",
])

export function isTextExt(ext: string): boolean {
  return TEXT_EXTS.has(ext.toLowerCase())
}

export function isUnsupportedExt(ext: string): boolean {
  return UNSUPPORTED_EXTS.has(ext.toLowerCase())
}

const BINARY_SCAN_BYTES = 8192

export function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SCAN_BYTES)
  for (let i = 0; i < len; i++) { if (buf[i] === 0) return true }
  return false
}

export async function ingestOneFile(filePath: string, importFn: ImportFn): Promise<Attachment> {
  let stat: fs.Stats
  try { stat = fs.statSync(filePath) }
  catch (err: unknown) { return { name: path.basename(filePath), kind: "unsupported", reason: (err as NodeJS.ErrnoException)?.code || String(err) } }
  if (!stat.isFile()) return { name: path.basename(filePath), kind: "unsupported", reason: "不是文件" }

  const name = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()

  if (isUnsupportedExt(ext)) return { name, kind: "unsupported", reason: `暂不支持的文件格式 ${ext}` }

  let buf: Buffer
  try { buf = fs.readFileSync(filePath) }
  catch (err: unknown) { return { name, kind: "unsupported", reason: (err as NodeJS.ErrnoException)?.code || String(err) } }

  if (isTextExt(ext)) {
    if (isBinary(buf)) return { name, kind: "unsupported", reason: `文件 ${ext} 含二进制数据` }
    const text = buf.toString("utf-8")
    if (!text.trim()) return { name, kind: "empty" }
    if (text.length > SMALL_THRESHOLD) {
      try { const chunks = await importFn(text, name); return { name, kind: "indexed", chunks } }
      catch (err: unknown) { return { name, kind: "indexed", chunks: 0, reason: (err as Error)?.message || String(err) } }
    }
    return { name, kind: "text", text }
  }

  if (isBinary(buf)) return { name, kind: "unsupported", reason: "二进制文件" }
  const text = buf.toString("utf-8")
  if (!text.trim()) return { name, kind: "empty" }
  if (text.length > SMALL_THRESHOLD) {
    try { const chunks = await importFn(text, name); return { name, kind: "indexed", chunks } }
    catch (err: unknown) { return { name, kind: "indexed", chunks: 0, reason: (err as Error)?.message || String(err) } }
  }
  return { name, kind: "text", text }
}

export function walkDir(dirPath: string): string[] {
  const result: string[] = []
  try {
    const items = fs.readdirSync(dirPath)
    for (const item of items) {
      if (item.startsWith(".")) continue
      const fullPath = path.join(dirPath, item)
      try {
        const s = fs.statSync(fullPath)
        if (s.isDirectory()) result.push(...walkDir(fullPath))
        else if (s.isFile()) result.push(fullPath)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return result
}

export async function ingestPaths(paths: string[], importFn: ImportFn): Promise<Attachment[]> {
  const filesWithPaths: Array<{ absPath: string; displayName: string }> = []
  for (const p of paths) {
    try {
      const s = fs.statSync(p)
      if (s.isDirectory()) {
        const children = walkDir(p)
        for (const child of children) filesWithPaths.push({ absPath: child, displayName: path.relative(p, child) })
      } else if (s.isFile()) filesWithPaths.push({ absPath: p, displayName: path.basename(p) })
    } catch { /* skip */ }
  }

  const seen = new Set<string>()
  const unique: Array<{ absPath: string; displayName: string }> = []
  for (const entry of filesWithPaths) {
    try { const real = fs.realpathSync(entry.absPath); if (!seen.has(real)) { seen.add(real); unique.push({ ...entry, absPath: real }) } }
    catch { /* skip */ }
  }

  const results: Attachment[] = []
  for (const { absPath, displayName } of unique) {
    const att = await ingestOneFile(absPath, importFn)
    results.push({ ...att, name: displayName })
  }
  return results
}
