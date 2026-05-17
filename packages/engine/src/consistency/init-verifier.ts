import type { MemoryEntry } from "@cortex/shared";
import { MemoryState } from "@cortex/shared";
import type { IFileSystemAdapter } from "@cortex/shared";
import type { MemoryStore } from "../memory/memory-store.js";
import * as path from "node:path";

/**
 * InitVerifier —— 启动时文件一致性校验（P1-六层防御）。
 *
 * 在 MemoryStore.init() 之后调用，遍历所有 Active 记忆，
 * 提取其中引用的文件路径，校验文件是否依然存在。
 *
 * Core-1 仅做文件存在性检查（fs.exists）。
 * Hash 校验增强延后至 Core-2。
 *
 * @since P1-六层防御
 */

// ─── 类型 ────────────────────────────────────────

export interface VerificationEntry {
  memoryId: string;
  filePath: string;
  checkType: "exists";
  status: "ok" | "missing" | "unchecked";
}

export interface ConsistencyReport {
  timestamp: number;
  totalMemories: number;
  checkedMemories: number;
  fileChecks: VerificationEntry[];
  summary: {
    ok: number;
    missing: number;
    unchecked: number;
  };
  /** 缺失比例超过 failThreshold 时为 true */
  fatal: boolean;
}

// ─── 文件路径提取 ────────────────────────────────

/** 文件名模式：匹配常见代码/文档文件扩展名 */
const FILE_NAME_RE = /[\w/\\-]+\.(ts|js|json|md|txt|html|css|yaml|yml|xml|env|config|toml|ini|cfg)\b/gi;

/**
 * 从记忆条目中提取引用的文件路径列表。
 * 支持来源：metadata.files, content.filePath, content.path, summary 中的文件名匹配
 */
export function extractFileReferences(entry: MemoryEntry): string[] {
  const paths = new Set<string>();

  // 1. metadata.files: string[]
  const metaFiles = entry.metadata?.["files"];
  if (Array.isArray(metaFiles)) {
    for (const f of metaFiles) {
      if (typeof f === "string" && f.length > 0) paths.add(f);
    }
  }

  // 2. content.filePath / content.path
  const content = entry.content;
  if (content && typeof content === "object") {
    const fp = (content as Record<string, unknown>)["filePath"];
    const p = (content as Record<string, unknown>)["path"];
    if (typeof fp === "string" && fp.length > 0) paths.add(fp);
    if (typeof p === "string" && p.length > 0) paths.add(p);
  }

  // 3. summary 中匹配文件名模式
  // 已知限制：从 summary 提取的短文件名（如 "agent-pool.ts"）存在路径歧义，
  // resolve 到 projectRoot 而非实际子目录，可能导致误报 missing。
  // Core-2 将通过 metadata.files 显式声明完整路径来消除歧义。
  const summaryMatches = entry.summary.match(FILE_NAME_RE);
  if (summaryMatches) {
    for (const m of summaryMatches) {
      // 过滤太短或明显非路径的匹配
      if (m.length >= 4 && m.includes(".")) paths.add(m);
    }
  }

  return Array.from(paths);
}

// ─── 校验器 ──────────────────────────────────────

export class InitVerifier {
  private readonly _memory: MemoryStore;
  private readonly _fs: IFileSystemAdapter;
  private readonly _projectRoot: string;
  private readonly _failThreshold: number;

  constructor(
    memory: MemoryStore,
    fs: IFileSystemAdapter,
    projectRoot: string,
    failThreshold: number = 0.3,
  ) {
    this._memory = memory;
    this._fs = fs;
    this._projectRoot = projectRoot;
    this._failThreshold = failThreshold;
  }

  /**
   * 运行启动校验。
   *
   * 流程：
   * 1. 读取全部 Active 记忆
   * 2. 逐条提取文件引用
   * 3. 对每个文件路径检查存在性
   * 4. 汇总生成 ConsistencyReport
   */
  async run(): Promise<ConsistencyReport> {
    const timestamp = Date.now();

    // 获取全部 Active 记忆（limit=0 不限量，trackAccess=false 避免校验扫描污染访问统计）
    const activeMemories = this._memory.read({
      states: [MemoryState.Active],
      limit: 0,
      includePrivate: true,
      trackAccess: false,
    });

    const totalMemories = activeMemories.length;
    const fileChecks: VerificationEntry[] = [];
    let okCount = 0;
    let missingCount = 0;
    let uncheckedCount = 0;
    const checkedMemoryIds = new Set<string>();

    for (const entry of activeMemories) {
      const refs = extractFileReferences(entry);

      if (refs.length === 0) {
        // 无文件引用——跳过（不算 checked）
        continue;
      }

      checkedMemoryIds.add(entry.id);

      for (const filePath of refs) {
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(this._projectRoot, filePath);

        try {
          const fileExists = await this._fs.exists(absPath);
          if (fileExists) {
            fileChecks.push({
              memoryId: entry.id,
              filePath,
              checkType: "exists",
              status: "ok",
            });
            okCount++;
          } else {
            fileChecks.push({
              memoryId: entry.id,
              filePath,
              checkType: "exists",
              status: "missing",
            });
            missingCount++;
          }
        } catch {
          fileChecks.push({
            memoryId: entry.id,
            filePath,
            checkType: "exists",
            status: "unchecked",
          });
          uncheckedCount++;
        }
      }
    }

    const totalChecked = okCount + missingCount + uncheckedCount;
    const fatal = totalChecked > 0
      ? missingCount / totalChecked > this._failThreshold
      : false;

    return {
      timestamp,
      totalMemories,
      checkedMemories: checkedMemoryIds.size,
      fileChecks,
      summary: {
        ok: okCount,
        missing: missingCount,
        unchecked: uncheckedCount,
      },
      fatal,
    };
  }
}
