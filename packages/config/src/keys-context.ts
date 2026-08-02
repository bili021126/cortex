/**
 * keys-context.ts —— 密钥上下文解析（R11-09/10）
 *
 * 从 keys-context.json 装载密钥条目，并实现 modelFallback 链式回退：
 * 当前密钥 env 缺失时沿 modelFallback 链查找（带环守卫）。
 * CLI 与 daemon 两个 bootstrap 共用此解析——此前 daemon 不读 keys-context（R11-09）、
 * modelFallback 声明但无运行时代码（R11-10）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveConfigDataDir } from "./loader.js";

/** keys-context.json 的单个密钥条目 */
export interface KeyContextEntry {
  label?: string;
  envVar: string;
  modelFallback?: string;
  agents?: string[];
}

/** 装载 keys-context.json 条目（运行时数据目录优先，包数据兜底） */
export function loadKeyContextEntries(): Record<string, KeyContextEntry> {
  const candidates = [
    path.join(resolveConfigDataDir(), "keys-context.json"),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (raw && typeof raw === "object" && raw.keys) return raw.keys as Record<string, KeyContextEntry>;
      }
    } catch {
      // 损坏时尝试下一个候选
    }
  }
  return {};
}

/**
 * 沿 modelFallback 链解析密钥 env 值（R11-10）。
 * 当前条目 envVar 缺失时递归到 modelFallback 指向的条目；visited 防环。
 */
export function resolveKeyChain(
  keyName: string,
  entries: Record<string, KeyContextEntry>,
  visited: Set<string> = new Set(),
): string | undefined {
  const entry = entries[keyName];
  if (!entry || visited.has(keyName)) return undefined;
  visited.add(keyName);
  const direct = process.env[entry.envVar];
  if (direct) return direct;
  if (entry.modelFallback) return resolveKeyChain(entry.modelFallback, entries, visited);
  return undefined;
}
