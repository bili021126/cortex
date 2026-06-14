/**
 * rate-limiter.ts — API Key 准入控制层
 *
 * 双层限流：
 *   1. 滑动窗口 — 每分钟最大请求数（令牌桶变体，拒绝即抛错）
 *   2. 每日配额 — 每日最大 token 消耗（持久化到 .cortex/logs/quotas.json）
 *
 * 配置（环境变量，可选，不设则不限）：
 *   CORTEX_LIMIT_CYRENE_RPM=30       昔涟每分钟上限
 *   CORTEX_LIMIT_CHAT_RPM=60          Chat池每分钟上限
 *   CORTEX_LIMIT_REASONER_RPM=10      Reasoner每分钟上限
 *   CORTEX_QUOTA_CYRENE_DAY_TOKENS=1000000   昔涟日配额(1M)
 *   CORTEX_QUOTA_CHAT_DAY_TOKENS=5000000      Chat池日配额(5M)
 *   CORTEX_QUOTA_REASONER_DAY_TOKENS=500000   Reasoner日配额(500K)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── 类型 ──────────────────────────────────────────────────

interface DailyQuota {
  date: string;
  tokens: number;
}

interface QuotaStore {
  [keyFingerprint: string]: DailyQuota;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

// ── 配置 ──────────────────────────────────────────────────

/** key 标识 → 每分钟请求上限 */
function loadRpmLimit(keyLabel: string): number | undefined {
  const map: Record<string, string> = {
    cyrene: "CORTEX_LIMIT_CYRENE_RPM",
    chat: "CORTEX_LIMIT_CHAT_RPM",
    reasoner: "CORTEX_LIMIT_REASONER_RPM",
  };
  const k = keyLabel.toLowerCase();
  const env = map[k];
  if (!env) return undefined;
  const v = process.env[env];
  return v ? parseInt(v) : undefined;
}

/** key 标识 → 每日 token 配额 */
function loadDayQuota(keyLabel: string): number | undefined {
  const map: Record<string, string> = {
    cyrene: "CORTEX_QUOTA_CYRENE_DAY_TOKENS",
    chat: "CORTEX_QUOTA_CHAT_DAY_TOKENS",
    reasoner: "CORTEX_QUOTA_REASONER_DAY_TOKENS",
  };
  const k = keyLabel.toLowerCase();
  const env = map[k];
  if (!env) return undefined;
  const v = process.env[env];
  return v ? parseInt(v) : undefined;
}

// ── RateLimiter ──────────────────────────────────────────

export class RateLimiter {
  // 滑动窗口：存储每次请求的时间戳
  private _windows = new Map<string, number[]>();
  // 每个 key 的准入锁串行化，防止并发绕过 RPM 限制
  private _locks = new Map<string, Promise<void>>();
  // 每日配额缓存
  private _dayQuotas = new Map<string, DailyQuota>();
  private _quotaPath: string;

  constructor() {
    const logDir = path.resolve(process.cwd(), ".cortex", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this._quotaPath = path.join(logDir, "quotas.json");
    this._loadQuotas();
  }

  /** 准入检查。返回 { allowed, reason }（同一 key 串行化防竞态）*/
  async check(keyLabel: string, keyFingerprint: string, estimatedTokens: number = 0): Promise<RateLimitResult> {
    // 串行化同一 key 的准入检查，防止并发绕过 RPM
    const prev = this._locks.get(keyFingerprint) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this._locks.set(keyFingerprint, next);
    try {
      await prev;
      return this._checkInner(keyLabel, keyFingerprint, estimatedTokens);
    } finally {
      resolve();
      if (this._locks.get(keyFingerprint) === next) {
        this._locks.delete(keyFingerprint);
      }
    }
  }

  /** 内部准入逻辑（无锁） */
  private _checkInner(keyLabel: string, keyFingerprint: string, estimatedTokens: number): RateLimitResult {
    // 1. 每分钟限流
    const rpmLimit = loadRpmLimit(keyLabel);
    if (rpmLimit) {
      const now = Date.now();
      const window = this._windows.get(keyFingerprint) ?? [];
      // 清理 60 秒外的记录
      const cutoff = now - 60_000;
      const active = window.filter((t) => t > cutoff);
      if (active.length >= rpmLimit) {
        return {
          allowed: false,
          reason: `${keyLabel} 超过每分钟 ${rpmLimit} 次限制（当前窗口 ${active.length} 次）`,
        };
      }
      active.push(now);
      this._windows.set(keyFingerprint, active);
    }

    // 2. 每日 token 配额
    const dayQuota = loadDayQuota(keyLabel);
    if (dayQuota) {
      const today = new Date().toISOString().slice(0, 10);
      let quota = this._dayQuotas.get(keyFingerprint);
      if (quota?.date !== today) {
        quota = { date: today, tokens: 0 };
        this._dayQuotas.set(keyFingerprint, quota);
      }
      if (quota.tokens + estimatedTokens > dayQuota) {
        return {
          allowed: false,
          reason: `${keyLabel} 超过每日 ${(dayQuota / 1_000_000).toFixed(1)}M token 配额（已用 ${(quota.tokens / 1_000_000).toFixed(2)}M）`,
        };
      }
    }

    return { allowed: true };
  }

  /** 记录实际消耗的 token（并发安全：与 check 共享同一锁串行化） */
  async recordTokens(keyFingerprint: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    // 复用 check 的串行化锁，防止 read-modify-write 竞态
    const prev = this._locks.get(keyFingerprint) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this._locks.set(keyFingerprint, next);
    try {
      await prev;
      const today = new Date().toISOString().slice(0, 10);
      let quota = this._dayQuotas.get(keyFingerprint);
      if (quota?.date !== today) {
        quota = { date: today, tokens: 0 };
      }
      quota.tokens += tokens;
      this._dayQuotas.set(keyFingerprint, quota);
      this._scheduleSaveQuotas();
    } finally {
      resolve();
      if (this._locks.get(keyFingerprint) === next) {
        this._locks.delete(keyFingerprint);
      }
    }
  }

  /** 标记需要持久化，防抖批量写入（异步，不阻塞事件循环） */
  private _savePending = false;
  private _scheduleSaveQuotas(): void {
    if (this._savePending) return;
    this._savePending = true;
    setImmediate(async () => {
      this._savePending = false;
      try {
        const obj: QuotaStore = {};
        for (const [k, v] of this._dayQuotas) { obj[k] = v; }
        await fs.promises.writeFile(this._quotaPath, JSON.stringify(obj, null, 2), "utf-8");
      } catch {
        // 写入失败不阻塞主流程
      }
    });
  }

  /** 获取今日用量 */
  getTodayUsage(keyFingerprint: string): number {
    const quota = this._dayQuotas.get(keyFingerprint);
    const today = new Date().toISOString().slice(0, 10);
    if (quota?.date === today) return quota.tokens;
    return 0;
  }

  private _loadQuotas(): void {
    try {
      if (fs.existsSync(this._quotaPath)) {
        const raw = JSON.parse(fs.readFileSync(this._quotaPath, "utf-8")) as QuotaStore;
        for (const [k, v] of Object.entries(raw)) {
          this._dayQuotas.set(k, v);
        }
      }
    } catch {
      // 文件损坏，忽略
    }
  }
}

// ── 全局单例 ────────────────────────────────────────────

let _instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_instance) _instance = new RateLimiter();
  return _instance;
}
