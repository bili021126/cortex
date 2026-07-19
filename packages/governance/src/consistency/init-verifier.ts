import type { IFileSystemAdapter, MemoryEntry, MemoryQuery } from "@cortex/shared";
import type { MemoryStore } from "@cortex/memory-store";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { DEFAULT_ENGINE_CONFIG, DIR_CORTEX } from "@cortex/config";

/**
 * InitVerifier —— 启动时文件一致性校验（P1-六层防御）。
 *
 * 在 MemoryStore.init() 之后调用，遍历所有 Active 记忆，
 * 提取其中引用的文件路径，校验文件是否依然存在。
 *
 * Core-1 实现：文件存在性检查 + SHA256 哈希校验。
 * 哈希缓存持久化至 .cortex/file-hashes.json，跨会话比对。
 *
 * @since P1-六层防御
 */

// ─── 哈希缓存路径 ───────────────────────────────

const HASH_CACHE_FILENAME = DEFAULT_ENGINE_CONFIG.filePaths.hashCache ?? ".cache/hash-cache.json";

// ─── 类型 ────────────────────────────────────────

export interface VerificationEntry {
  memoryId: string;
  filePath: string;
  checkType: "exists" | "hash";
  status: "ok" | "missing" | "unchecked" | "changed";
  /** SHA256 hash（仅 checkType=hash 且 status=ok/changed 时有值） */
  hash?: string;
  /** 上次记录的哈希值（仅 status=changed 时有值） */
  previousHash?: string;
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
    changed: number;
  };
  /** 缺失比例超过 failThreshold 时为 true */
  fatal: boolean;
}

/**
 * 文件→记忆覆盖度报告。
 *
 * 反向校验：给定文件列表，检查每个文件是否有至少一条 Active 记忆引用它。
 * 用于 CI 流水线中检测"修改了文件但忘记写 TaskLog"的情况。
 */
export interface FileCoverageReport {
  timestamp: number;
  totalFiles: number;
  covered: number;
  uncovered: number;
  /** 无记忆覆盖的文件路径列表 */
  uncoveredFiles: string[];
  /** 有覆盖的文件及其关联的记忆 ID */
  coveredFiles: Array<{ filePath: string; memoryIds: string[] }>;
}

// ─── 文件路径提取 ────────────────────────────────

/**
 * 从记忆条目中提取引用的文件路径列表。
 *
 * 仅使用显式声明的路径来源：metadata.files, content_blob.filePath, content_blob.path。
 *
 * 不再从 summary 文本中通过正则提取文件名——该来源存在路径歧义且随 Agent
 * 命名风格漂移持续产生假阳性（不同运行中同一语义的文件被命名为不同名称）。
 */
export function extractFileReferences(entry: MemoryEntry): string[] {
  const paths = new Set<string>();

  // 1. metadata.files: string[]
  const metaFiles = entry.content_blob?.["files"];
  if (Array.isArray(metaFiles)) {
    for (const f of metaFiles) {
      if (typeof f === "string" && f.length > 0) paths.add(f);
    }
  }

  // 2. content_blob.filePath / content_blob.path
  const content = entry.content_blob;
  if (content && typeof content === "object") {
    const fp = (content as Record<string, unknown>)["filePath"];
    const p = (content as Record<string, unknown>)["path"];
    if (typeof fp === "string" && fp.length > 0) paths.add(fp);
    if (typeof p === "string" && p.length > 0) paths.add(p);
  }

  return Array.from(paths);
}

// ─── 校验器 ──────────────────────────────────────

export class InitVerifier {
  private readonly _memory: MemoryStore;
  private readonly _fs: IFileSystemAdapter;
  private readonly _projectRoot: string;
  private readonly _failThreshold: number;
  /** 当短文件名在 projectRoot 下找不到时，尝试在这些子目录中查找 */
  private readonly _searchPaths: string[];

  constructor(
    memory: MemoryStore,
    fs: IFileSystemAdapter,
    projectRoot: string,
    failThreshold: number = 0.3,
    searchPaths?: string[],
  ) {
    this._memory = memory;
    this._fs = fs;
    this._projectRoot = projectRoot;
    this._failThreshold = failThreshold;
    this._searchPaths = searchPaths ?? [];
  }

  /**
   * 运行启动校验。
   *
   * 流程：
   * 1. 读取全部 Active 记忆
   * 2. 逐条提取文件引用
   * 3. 对每个文件路径检查存在性 + SHA256 哈希比对
   * 4. 持久化当前哈希缓存
   * 5. 汇总生成 ConsistencyReport
   */
  async run(): Promise<ConsistencyReport> {
    const timestamp = Date.now();

    // 加载上次哈希缓存
    const prevHashes = this._loadHashCache();
    const currHashes = new Map<string, string>();

    // 获取全部 Active 记忆（limit=0 不限量，trackAccess=false 避免校验扫描污染访问统计）
    const activeMemories = await this._memory.read({
      limit: 0,
    });

    const totalMemories = activeMemories.length;
    const fileChecks: VerificationEntry[] = [];
    let okCount = 0;
    let missingCount = 0;
    let uncheckedCount = 0;
    let changedCount = 0;
    const checkedMemoryIds = new Set<string>();

    for (const entry of activeMemories) {
      const refs = extractFileReferences(entry);

      if (refs.length === 0) {
        // 无文件引用——跳过（不算 checked）
        continue;
      }

      checkedMemoryIds.add(entry.id);

      for (const filePath of refs) {
        let absPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(this._projectRoot, filePath);

        try {
          let fileExists = await this._fs.exists(absPath);

          // 直接路径不存在时，尝试在 searchPaths 中递归查找
          if (!fileExists && this._searchPaths.length > 0) {
            const fileName = path.basename(filePath);
            for (const searchDir of this._searchPaths) {
              const found = await this._findFile(fileName, searchDir);
              if (found) {
                absPath = found;
                fileExists = true;
                break;
              }
            }
          }

          if (!fileExists) {
            fileChecks.push({
              memoryId: entry.id,
              filePath,
              checkType: "exists",
              status: "missing",
            });
            missingCount++;
            continue;
          }

          // 文件存在——计算 SHA256 哈希
          try {
            const hash = await this._computeHash(absPath);
            currHashes.set(filePath, hash);

            const prevHash = prevHashes.get(filePath);
            if (prevHash && prevHash !== hash) {
              // 哈希变更：文件内容已修改
              fileChecks.push({
                memoryId: entry.id,
                filePath,
                checkType: "hash",
                status: "changed",
                hash,
                previousHash: prevHash,
              });
              changedCount++;
            } else {
              fileChecks.push({
                memoryId: entry.id,
                filePath,
                checkType: "hash",
                status: "ok",
                hash,
              });
              okCount++;
            }
          } catch {
            // 哈希计算失败（如权限不足）——降级为存在性检查
            fileChecks.push({
              memoryId: entry.id,
              filePath,
              checkType: "exists",
              status: "ok",
            });
            okCount++;
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

    // 持久化当前哈希缓存
    this._saveHashCache(currHashes);

    const totalChecked = okCount + missingCount + uncheckedCount + changedCount;
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
        changed: changedCount,
      },
      fatal,
    };
  }

  /**
   * 反向文件覆盖度校验（文件→记忆方向）。
   *
   * 给定一组文件路径，检查每条路径是否至少被一条 Active 记忆引用。
   * 用于 CI 流水线中检测"修改了文件但忘记写 TaskLog"的情况。
   *
   * @param filePaths 待检查的文件路径列表（相对于 projectRoot 或绝对路径）
   * @returns FileCoverageReport —— 哪些文件有记忆覆盖、哪些没有
   */
  async checkCoverage(filePaths: string[]): Promise<FileCoverageReport> {
    const timestamp = Date.now();

    // 获取全部 Active 记忆
    const activeMemories = await this._memory.read({
      limit: 0,
    });

    // 构建 文件路径 → 记忆 ID 集合 的索引
    const fileToMemories = new Map<string, Set<string>>();
    for (const entry of activeMemories) {
      const refs = extractFileReferences(entry);
      for (const ref of refs) {
        // 规范化路径：相对路径转为绝对路径
        const normalized = path.isAbsolute(ref)
          ? ref
          : path.resolve(this._projectRoot, ref);
        let ids = fileToMemories.get(normalized);
        if (!ids) {
          ids = new Set();
          fileToMemories.set(normalized, ids);
        }
        ids.add(entry.id);
      }
    }

    const coveredFiles: FileCoverageReport["coveredFiles"] = [];
    const uncoveredFiles: string[] = [];

    for (const fp of filePaths) {
      const normalized = path.isAbsolute(fp)
        ? fp
        : path.resolve(this._projectRoot, fp);

      const memoryIds = fileToMemories.get(normalized);
      if (memoryIds && memoryIds.size > 0) {
        coveredFiles.push({
          filePath: fp,
          memoryIds: Array.from(memoryIds),
        });
      } else {
        uncoveredFiles.push(fp);
      }
    }

    return {
      timestamp,
      totalFiles: filePaths.length,
      covered: coveredFiles.length,
      uncovered: uncoveredFiles.length,
      uncoveredFiles,
      coveredFiles,
    };
  }

  // ── 哈希缓存持久化 ────────────────────────────

  /** 哈希缓存文件路径 */
  private get _hashCachePath(): string {
    return path.join(this._projectRoot, DIR_CORTEX, HASH_CACHE_FILENAME);
  }

  private _loadHashCache(): Map<string, string> {
    try {
      const cachePath = this._hashCachePath;
      if (fs.existsSync(cachePath)) {
        // 文件大小限制 50MB（哈希缓存可能随项目增长）
        const MAX_SIZE = 50 * 1024 * 1024;
        const stats = fs.statSync(cachePath);
        if (stats.size > MAX_SIZE) {
          throw new Error(`哈希缓存文件过大: ${cachePath} (${stats.size} bytes, max ${MAX_SIZE})`);
        }
        const raw = fs.readFileSync(cachePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, string>;
        return new Map(Object.entries(data));
      }
    } catch { /* 缓存损坏或首次运行——返回空映射 */ }
    return new Map();
  }

  private _saveHashCache(hashes: Map<string, string>): void {
    try {
      const cachePath = this._hashCachePath;
      const dir = path.dirname(cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: Record<string, string> = {};
      for (const [k, v] of hashes) {
        data[k] = v;
      }
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
    } catch { /* 缓存写入失败——非致命 */ }
  }

  /**
   * 在给定子目录中递归查找指定文件名的文件。
   * 最大深度 3 层，避免在 node_modules 等巨型目录中浪费性能。
   * @returns 找到的绝对路径，未找到返回 null
   */
  private async _findFile(fileName: string, searchDir: string): Promise<string | null> {
    const baseDir = path.resolve(this._projectRoot, searchDir);
    return await this._searchFile(fileName, baseDir, 3);
  }

  private async _searchFile(
    fileName: string,
    dir: string,
    maxDepth: number,
  ): Promise<string | null> {
    if (maxDepth <= 0) return null;
    try {
      const exists = await this._fs.exists(dir);
      if (!exists) return null;
      const entries = await this._fs.listDirectory(dir);
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory) {
          // 跳过隐藏目录和 node_modules
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const found = await this._searchFile(fileName, entryPath, maxDepth - 1);
          if (found) return found;
        } else if (entry.name === fileName) {
          return entryPath;
        }
      }
    } catch {
      // 目录不存在或无权限
    }
    return null;
  }

  /**
   * 计算文件 SHA256 哈希。
   * 对大文件使用流式读取，避免 OOM。
   */
  private async _computeHash(absPath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(absPath, { highWaterMark: 64 * 1024 });
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
}
