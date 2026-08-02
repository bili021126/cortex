// @layer 治理层
// ============================================================
// @cortex/engine/bootstrap/load-config —— 配置加载 & 工具函数
// ============================================================

import { bootstrap, type AgentManifest, type BootstrapResult } from "./factory/index.js";
import { setAgentRegistry, type MemoryQuery, type TaskNode } from "@cortex/shared";
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "@cortex/llm";
import { DEFAULT_ENGINE_CONFIG, loadConfigDomain, loadEngineDefaults, resolveConfigDataDir, type ConfigFileReader, type EngineConfig } from "@cortex/config";
import {
  codeMemoryQuery,
  reviewMemoryQuery,
  analysisMemoryQuery,
  opsMemoryQuery,
  loopMemoryQuery,
  docGovernMemoryQuery,
  apiMemoryQuery,
  dataMemoryQuery,
  fixMemoryQuery,
} from "../agents/index.js";

// ─── 引擎配置解析（ENG-5：engine.json 域接线 + tuning 覆盖链） ───

/**
 * 组装最终 EngineConfig——覆盖链：options（调用方显式）> engine.json（ENGINE_SCHEMA 校验）> tuning > DEFAULT_ENGINE_CONFIG。
 * R11-08 修复：defaultMaxLoops 尊重 fileConfig（engine.json）——tuning 的 reactMaxLoops 仅当文件未显式声明时兜底。
 */
export function resolveEngineConfig(override?: EngineConfig): EngineConfig {
  let fileConfig: EngineConfig | undefined;
  try {
    const readFileNode: ConfigFileReader = (fp: string) => readFileSync(fp, "utf-8");
    fileConfig = loadConfigDomain<EngineConfig>("engine", readFileNode, resolveConfigDataDir()) ?? undefined;
  } catch {
    fileConfig = undefined;
  }
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...(fileConfig ?? {}),
    ...(override ?? {}),
    defaultMaxLoops:
      override?.defaultMaxLoops
      ?? fileConfig?.defaultMaxLoops
      ?? loadEngineDefaults().reactMaxLoops
      ?? DEFAULT_ENGINE_CONFIG.defaultMaxLoops,
  };
}

// ─── 编码规范注入 ────────────────────────────────────

let _codingStandardsCache: string | undefined;

export function resolveCodingStandards(projectRoot: string): string {
  if (_codingStandardsCache !== undefined) return _codingStandardsCache;
  const codingStandardsPath = DEFAULT_ENGINE_CONFIG.filePaths.codingStandards;
  if (!codingStandardsPath) return "";
  const path = join(projectRoot, codingStandardsPath);
  if (existsSync(path)) {
    // 文件大小限制 10MB（代码文件上限）
    const MAX_SIZE = 10 * 1024 * 1024;
    const stats = statSync(path);
    if (stats.size > MAX_SIZE) {
      throw new Error(`编码规范文件过大: ${path} (${stats.size} bytes, max ${MAX_SIZE})`);
    }
    _codingStandardsCache = readFileSync(path, "utf-8");
  } else {
    _codingStandardsCache = "";
  }
  return _codingStandardsCache;
}

export function injectStandards(systemPrompt: string | undefined, standards: string): string {
  if (!standards) return systemPrompt ?? "";
  const base = systemPrompt ?? "";
  if (base.startsWith(standards)) return base;
  return standards + "\n\n---\n\n" + base;
}

// ─── LLM 解析 ──────────────────────────────────────

export function resolveLlm(llms: Map<string, LlmAdapter>, key?: string): LlmAdapter {
  if (key) {
    const result = llms.get(key);
    if (result) return result;
  }
  const first = llms.values().next().value;
  if (!first) throw new Error("[bootstrapEngine] llms 映射为空，无法创建 Agent");
  return first;
}

// ─── 记忆查询策略注册表 ──────────────────────────────

type MemoryQueryFn = (node: TaskNode) => MemoryQuery;

export const MEMORY_QUERY_REGISTRY: Map<string, MemoryQueryFn> = new Map([
  ["code", codeMemoryQuery],
  ["review", reviewMemoryQuery],
  ["analysis", analysisMemoryQuery],
  ["ops", opsMemoryQuery],
  ["loop", loopMemoryQuery],
  ["doc-govern", docGovernMemoryQuery],
  ["api", apiMemoryQuery],
  ["data", dataMemoryQuery],
  ["fix", fixMemoryQuery],
]);

// ─── 注册表注入 ────────────────────────────────────

export function injectRegistryFromConfig(definitions: AgentManifest[]): void {
  const tags: Record<string, readonly string[]> = {};
  const toolPermissions: Record<string, readonly string[]> = {};
  const allTags: string[] = [];
  for (const def of definitions) {
    if (def.tags) { tags[def.type] = [...def.tags]; for (const t of def.tags) { if (!allTags.includes(t)) allTags.push(t); } }
    if (def.toolPermissions) { toolPermissions[def.type] = [...def.toolPermissions]; }
  }
  setAgentRegistry(tags, toolPermissions);
}

// ─── 主入口：加载配置 ────────────────────────────────

export function loadConfig(projectRoot: string): BootstrapResult {
  const config = bootstrap(projectRoot);
  if (config.warnings.length > 0) {
    console.warn(`[bootstrapEngine] 配置警告:\n  ${config.warnings.join("\n  ")}`);
  }
  return config;
}
