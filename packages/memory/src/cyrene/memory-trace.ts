// ============================================================
// Cyrene-Agent 记忆系统 — 记忆追踪（适配版）
//
// 从 Cyrene-Agent src/main/memory/memory-trace.ts 提取。
// 适配：移除 Electron/IPC 依赖。路径改为构造注入或环境变量。
// ============================================================

import * as fs from "fs"
import * as path from "path"

/** 诊断输出——统一走 stderr（错误友好序列化：Error 取 message） */
function diag(...args: unknown[]): void {
  process.stderr.write(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ") + "\n");
}

export interface MemoryTraceEvent {
  ts?: number
  op: string
  layer?: "L0" | "L1" | "L2" | "store" | "reflection" | "migration"
  status: "ok" | "error" | "skip"
  l2Id?: string
  ragId?: string
  details?: Record<string, unknown>
  error?: string | null
}

let tracePath = ""

/** 设置 trace 文件路径（替代 app.getPath("userData")） */
export function setTracePath(filePath: string): void {
  tracePath = filePath
}

function getTracePath(): string {
  return tracePath || path.join(process.cwd(), "memory-trace.log")
}

export function appendMemoryTrace(event: MemoryTraceEvent): void {
  try {
    const filePath = getTracePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const entry = {
      ts: event.ts ?? Date.now(),
      ...event,
      error: event.error ?? null,
    }
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8")
  } catch (err) {
    diag("[MemoryTrace] 写入失败:", err)
  }
}
