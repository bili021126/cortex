// ============================================================
// @cortex/cache —— 文件哈希缓存
//
// @file-overview
// 为项目源文件建立 SHA256 哈希快照，供 LLM 缓存做确定性失效判断。
// 文件内容变更 → 哈希变更 → 所有依赖该文件的 LLM 缓存条目自动失效。
//
// @design
// - 索引：filePath → { hash, size, mtimeMs }
// - diff(old, new)：返回变更/新增/删除的文件列表
// - 与 LlmCache.setFileHashes() 联动：diff 有变更 → llmCache 自动清除
//
// @contract
// - scan(globs, ignoreGlobs): Promise<Map<string, string>>
// - diff(old, new): { added, removed, changed }
// ============================================================

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileHashCacheConfig, FileHashEntry } from "./types.js";

/** 默认配置 */
const DEFAULTS: Required<FileHashCacheConfig> = {
  maxEntries: 2000,
  globs: ["**/*.ts", "**/*.json"],
  ignoreGlobs: ["node_modules/**", "dist/**", ".cortex/**"],
};

/** 文件差异结果 */
export interface FileHashDiff {
  /** 新增文件 */
  added: string[];
  /** 删除文件 */
  removed: string[];
  /** 变更文件（哈希不同） */
  changed: string[];
  /** 文件大小变更（哈希相同但大小不同——理论不可能，防御性保留） */
  sizeChanged: string[];
}

export class FileHashCache {
  private _entries = new Map<string, FileHashEntry>();
  private _config: Required<FileHashCacheConfig>;

  constructor(config?: FileHashCacheConfig) {
    this._config = { ...DEFAULTS, ...config };
  }

  // ── 公开 API ──

  /**
   * 扫描指定目录，建立文件哈希索引。
   * @param rootDir 扫描根目录
   * @returns 文件路径 → 哈希 Map
   */
  async scan(rootDir: string): Promise<Map<string, string>> {
    const files = this._collectFiles(rootDir);
    const result = new Map<string, string>();

    for (const filePath of files) {
      try {
        const entry = await this._hashFile(filePath);
        this._entries.set(filePath, entry);
        result.set(filePath, entry.hash);
      } catch {
        // 文件无法读取（权限、已删除等），跳过
      }
    }

    // 清理已不存在的文件
    for (const key of this._entries.keys()) {
      if (!result.has(key)) {
        this._entries.delete(key);
      }
    }

    // LRU 上限
    if (this._entries.size > this._config.maxEntries) {
      const sorted = [...this._entries.entries()]
        .sort(([, a], [, b]) => a.checkedAt - b.checkedAt);
      const toRemove = sorted.slice(0, this._entries.size - this._config.maxEntries);
      for (const [key] of toRemove) {
        this._entries.delete(key);
      }
    }

    return result;
  }

  /**
   * 增量更新：仅检查 mtime 变化的文件。
   * 比全量 scan 快 10-100 倍。
   */
  async incrementalScan(rootDir: string): Promise<Map<string, string>> {
    const files = this._collectFiles(rootDir);
    const result = new Map<string, string>();

    for (const filePath of files) {
      const existing = this._entries.get(filePath);
      try {
        const stat = fs.statSync(filePath);
        // mtime 未变 → 复用旧哈希
        if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
          existing.checkedAt = Date.now();
          result.set(filePath, existing.hash);
          continue;
        }
      } catch {
        // stat 失败，跳过
        continue;
      }

      // mtime 变化 → 重新哈希
      try {
        const entry = await this._hashFile(filePath);
        this._entries.set(filePath, entry);
        result.set(filePath, entry.hash);
      } catch {
        // 无法读取
      }
    }

    // 清理已删除
    for (const key of this._entries.keys()) {
      if (!result.has(key)) {
        this._entries.delete(key);
      }
    }

    return result;
  }

  /**
   * 计算两次扫描之间的差异。
   */
  diff(oldHashes: Map<string, string>, newHashes: Map<string, string>): FileHashDiff {
    const diff: FileHashDiff = { added: [], removed: [], changed: [], sizeChanged: [] };

    for (const [file, newHash] of newHashes) {
      const oldHash = oldHashes.get(file);
      if (oldHash === undefined) {
        diff.added.push(file);
      } else if (oldHash !== newHash) {
        diff.changed.push(file);
      }
    }

    for (const file of oldHashes.keys()) {
      if (!newHashes.has(file)) {
        diff.removed.push(file);
      }
    }

    return diff;
  }

  /** 获取指定文件的哈希 */
  getHash(filePath: string): string | null {
    return this._entries.get(filePath)?.hash ?? null;
  }

  /** 获取全部哈希快照 */
  get snapshot(): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const [k, v] of this._entries) {
      map.set(k, v.hash);
    }
    return map;
  }

  /** 条目数 */
  get size(): number {
    return this._entries.size;
  }

  /** 清空 */
  clear(): void {
    this._entries.clear();
  }

  // ── 内部方法 ──

  /** 收集符合 glob 的文件列表 */
  private _collectFiles(rootDir: string): string[] {
    const results: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

        // 忽略目录检查
        if (this._isIgnored(relPath, entry.isDirectory())) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (this._matchesGlob(relPath)) {
          results.push(fullPath);
        }
      }
    };

    walk(rootDir);
    return results.slice(0, this._config.maxEntries * 2); // 安全上限
  }

  /** 检查路径是否应忽略 */
  private _isIgnored(relPath: string, isDir: boolean): boolean {
    for (const pattern of this._config.ignoreGlobs) {
      const clean = pattern.replace(/\/$/, "");
      if (isDir) {
        // 目录匹配：精确路径 或 前缀匹配
        if (relPath === clean) return true;
        if (relPath.startsWith(clean + "/")) return true;
      }
      // 文件匹配：glob 简化匹配（支持 ** 和 * 通配符）
      if (this._simpleGlobMatch(relPath, clean)) return true;
    }
    return false;
  }

  /** 简化 glob 匹配 */
  private _simpleGlobMatch(str: string, pattern: string): boolean {
    // 转换 glob 为 regex
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, "<<<GLOBSTAR>>>")
          .replace(/\*/g, "[^/]*")
          .replace(/<<<GLOBSTAR>>>/g, ".*") +
        "$",
    );
    return regex.test(str);
  }

  /** 检查文件是否匹配 glob */
  private _matchesGlob(relPath: string): boolean {
    if (this._config.globs.length === 0) return true;
    for (const pattern of this._config.globs) {
      if (this._simpleGlobMatch(relPath, pattern)) return true;
    }
    return false;
  }

  /** 计算文件哈希 */
  private async _hashFile(filePath: string): Promise<FileHashEntry> {
    const content = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    return {
      filePath,
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      checkedAt: Date.now(),
    };
  }
}
