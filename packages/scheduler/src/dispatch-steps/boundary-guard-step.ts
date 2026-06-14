/**
 * BoundaryGuardStep —— Agent 边界守卫。
 *
 * 在节点执行成功后，扫描该节点执行期间新创建/修改的文件，
 * 对照 Agent 类型的边界规则，检测越界行为。
 *
 * 越界检测 → 通过 PipelineObserver 四路事件管线发射
 * AgentBoundaryViolation 事件 → Scheduler 消费 → replanManager 入队 → MetaAgent 重规划
 *
 * @since Boundary Guard
 */

import { PipelineEventType, PipelinePriority, type AgentType } from "@cortex/shared";
import type { DispatchCtx, IDispatchStep } from "./types.js";
import { readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

/** 时钟偏差容忍窗口（ms）。节点创建时间与文件 mtime 之间允许的微小偏差。 */
const CLOCK_SKEW_TOLERANCE = 1000;

// ============================================================
// Agent 边界规则注册表 —— 可插拔
// ============================================================

/** Agent 边界规则：定义每种 Agent 类型的文件操作许可域 */
export interface AgentBoundaryRule {
  /** Agent 类型标识 */
  agentType: string;
  /** 允许创建/修改的文件 glob（正向许可） */
  allowed: string[];
  /** 禁止触碰的文件 glob（反向禁止——命中即违规） */
  forbidden: string[];
}

/**
 * 边界规则注册表 —— 组件式可扩展。
 * 新增 Agent 类型只需追加一条规则，无需修改核心逻辑。
 */
export const BOUNDARY_RULES: ReadonlyArray<AgentBoundaryRule> = [
  {
    agentType: "analysis",
    allowed: [
      "**/DESIGN.md",
      "**/*.md",
      "packages/*/DESIGN.md",
    ],
    forbidden: [
      "**/package.json",
      "**/tsconfig.json",
      "**/eslint.config.*",
      "**/src/**",
      "**/tests/**",
      "**/__tests__/**",
    ],
  },
  {
    agentType: "code",
    allowed: [
      "**/package.json",
      "**/tsconfig.json",
      "**/eslint.config.*",
      "**/src/**",
      "**/tests/**",
      "**/__tests__/**",
    ],
    forbidden: [],
  },
  {
    agentType: "review",
    allowed: [
      "**/REVIEW.md",
      "**/*.md",
    ],
    forbidden: [
      "**/package.json",
      "**/tsconfig.json",
      "**/eslint.config.*",
      "**/src/**",
      "**/tests/**",
    ],
  },
  {
    agentType: "doc-govern",
    allowed: [
      "**/*.md",
      "docs/**",
      "doc-govern/**",
    ],
    forbidden: [
      "**/package.json",
      "**/tsconfig.json",
      "**/eslint.config.*",
      "**/src/**",
      "**/tests/**",
    ],
  },
];

// ============================================================
// 文件扫描工具
// ============================================================

/** 异步递归遍历目录，收集所有文件的 [路径, mtimeMs] */
async function walkDir(dirPath: string): Promise<Array<[string, number]>> {
  const results: Array<[string, number]> = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === ".pnpm-store" ||
          entry.name.startsWith(".")
        ) continue;
        const sub = await walkDir(fullPath);
        results.push(...sub);
      } else if (entry.isFile()) {
        try {
          const fileStat = await stat(fullPath);
          results.push([fullPath, fileStat.mtimeMs]);
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return results;
}

/** walkDir 结果缓存 TTL（ms）——同一波节点共享扫描结果 */
const WALK_CACHE_TTL = 5000;
let _walkCache: { files: Array<[string, number]>; timestamp: number } | null = null;

/** 带 TTL 缓存的 walkDir——避免高频扫描同一工作区 */
async function walkDirCached(dirPath: string): Promise<Array<[string, number]>> {
  const now = Date.now();
  if (_walkCache && (now - _walkCache.timestamp) < WALK_CACHE_TTL) {
    return _walkCache.files;
  }
  const files = await walkDir(dirPath);
  _walkCache = { files, timestamp: now };
  return files;
}

/** 清除 walkDir 缓存（测试用） */
export function clearWalkCache(): void {
  _walkCache = null;
}

/** glob 匹配：将简单 glob 转为正则 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*" && (pattern[i + 2] === "/" || pattern[i + 2] === undefined)) {
      regexStr += ".*";
      i += pattern[i + 2] === "/" ? 3 : 2;
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (ch === "." || ch === "/") {
      regexStr += ch === "." ? "\\." : "/";
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

/** 检查规范化后的路径是否匹配任一 glob */
function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegex(p).test(filePath));
}

// ============================================================
// BoundaryGuardStep
// ============================================================

/**
 * BoundaryGuardStep —— Agent 边界守卫。
 *
 * 在 Execute/RlmExecute 成功后、Cleanup 之前运行。
 * 检测 Agent 是否在其许可域之外创建/修改了文件。
 */
export class BoundaryGuardStep implements IDispatchStep {
  readonly name = "BoundaryGuard";

  private readonly _workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this._workspaceRoot = workspaceRoot;
  }

  async run(ctx: DispatchCtx): Promise<DispatchCtx> {
    if (!ctx.result?.success) return ctx;

    const agentType = ctx.agentType;
    if (!agentType) return ctx;

    const rule = BOUNDARY_RULES.find((r) => r.agentType === agentType);
    if (!rule || rule.forbidden.length === 0) return ctx;

    const threshold = ctx.node.createdAt;
    const violatingFiles = await this._scanViolations(rule, threshold);

    if (violatingFiles.length === 0) return ctx;

    const reason = `${agentType} 越界写入了实现层文件：${violatingFiles.map((f) => f.file).join(", ")}`;

    ctx.observer.emit({
      type: PipelineEventType.AgentBoundaryViolation,
      priority: PipelinePriority.HIGH,
      payload: {
        nodeId: ctx.node.id,
        agentType: agentType as AgentType,
        violatingFiles: violatingFiles.map((v) => v.file),
        reason,
        expectedScope: `允许: [${rule.allowed.join(", ")}]; 禁止: [${rule.forbidden.join(", ")}]`,
      },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });

    ctx.boundaryViolation = {
      agentType,
      files: violatingFiles.map((v) => v.file),
    };

    return ctx;
  }

  /** 扫描 mtime >= threshold - CLOCK_SKEW_TOLERANCE 的文件，筛查 forbidden 命中 */
  private async _scanViolations(
    rule: AgentBoundaryRule,
    threshold: number,
  ): Promise<Array<{ file: string; matchedRule: string }>> {
    const violations: Array<{ file: string; matchedRule: string }> = [];

    try {
      const allFiles = await walkDirCached(this._workspaceRoot);

      for (const [absPath, mtime] of allFiles) {
        if (mtime < threshold - CLOCK_SKEW_TOLERANCE) continue;

        const relPath = relative(this._workspaceRoot, absPath).split(sep).join("/");

        for (const forbidden of rule.forbidden) {
          if (matchesAny(relPath, [forbidden])) {
            if (matchesAny(relPath, rule.allowed)) continue;
            violations.push({ file: relPath, matchedRule: forbidden });
            break;
          }
        }
      }
    } catch {
      // 文件扫描失败不阻塞管线
    }

    return violations;
  }
}
