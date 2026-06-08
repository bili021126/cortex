// ============================================================
// @cortex/engine/bootstrap/load-config —— 配置加载 & 工具函数
// ============================================================

import { bootstrap, type AgentDefinition, type BootstrapResult } from "@cortex/factory";
import { setAgentRegistry, type MemoryQuery, type TaskNode } from "@cortex/shared";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LlmAdapter } from "@cortex/llm";
import { DEFAULT_ENGINE_CONFIG } from "@cortex/config";
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

// ─── 编码规范注入 ────────────────────────────────────

let _codingStandardsCache: string | undefined;

export function resolveCodingStandards(projectRoot: string): string {
  if (_codingStandardsCache !== undefined) return _codingStandardsCache;
  const codingStandardsPath = DEFAULT_ENGINE_CONFIG.filePaths.codingStandards;
  if (!codingStandardsPath) return "";
  const path = join(projectRoot, codingStandardsPath);
  if (existsSync(path)) {
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

export function injectRegistryFromConfig(definitions: AgentDefinition[]): void {
  const tags: Record<string, readonly string[]> = {};
  const toolPermissions: Record<string, readonly string[]> = {};
  const allTags: string[] = [];
  for (const def of definitions) {
    if (def.tags) { tags[def.type] = [...def.tags]; for (const t of def.tags) { if (!allTags.includes(t)) allTags.push(t); } }
    if (def.toolPermissions) { toolPermissions[def.type] = [...def.toolPermissions]; }
  }
  setAgentRegistry(tags, toolPermissions, allTags);
}

// ─── 主入口：加载配置 ────────────────────────────────

export function loadConfig(projectRoot: string): BootstrapResult {
  const config = bootstrap(projectRoot);
  if (config.warnings.length > 0) {
    console.warn(`[bootstrapEngine] 配置警告:\n  ${config.warnings.join("\n  ")}`);
  }
  return config;
}
