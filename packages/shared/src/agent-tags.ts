// ============================================================
// @cortex/shared — Agent 标签域（重导出层）
//
// TAG_VOCABULARY + AGENT_TAGS 的实际定义已迁移至 @cortex/config。
// 本文件保留为向后兼容的重导出层，并提供运行时覆写 API。
// ============================================================

import { TAG_VOCABULARY, AGENT_TAGS as CONFIG_AGENT_TAGS, type Tag } from "@cortex/config";
import { AgentType } from "./agent-enums.js";

export { TAG_VOCABULARY };
export type { Tag };

/**
 * Agent 类型 → 认领标签（AgentType 键版本）。
 * 从 config 的 string-key 版本经 AgentType 映射转换生成。
 */
export const AGENT_TAGS: Record<AgentType, readonly Tag[]> = {
  [AgentType.Meta]:      CONFIG_AGENT_TAGS.Meta,
  [AgentType.Code]:      CONFIG_AGENT_TAGS.Code,
  [AgentType.Review]:    CONFIG_AGENT_TAGS.Review,
  [AgentType.Analysis]:  CONFIG_AGENT_TAGS.Analysis,
  [AgentType.Ops]:       CONFIG_AGENT_TAGS.Ops,
  [AgentType.Loop]:      CONFIG_AGENT_TAGS.Loop,
  [AgentType.DocGovern]: CONFIG_AGENT_TAGS.DocGovern,
  [AgentType.Butler]:    CONFIG_AGENT_TAGS.Butler,
  [AgentType.Inspector]: CONFIG_AGENT_TAGS.Inspector,
  [AgentType.Browser]:   CONFIG_AGENT_TAGS.Browser,
  [AgentType.Fix]:       CONFIG_AGENT_TAGS.Fix,
  [AgentType.Api]:       CONFIG_AGENT_TAGS.Api,
  [AgentType.Data]:      CONFIG_AGENT_TAGS.Data,
  [AgentType.Strategist]: CONFIG_AGENT_TAGS.Strategist,
};

// ─── 运行时标签覆写表 ──────────────────────────────

let _runtimeTags: Record<string, readonly string[]> = { ...AGENT_TAGS as unknown as Record<string, readonly string[]> };

/** 获取 Agent 标签（优先运行时覆写，回退编译期常量） */
export function getAgentTags(): Record<string, readonly string[]> {
  return _runtimeTags;
}

/** 获取标签词汇表（封闭集合） */
export function getTagVocabulary(): readonly string[] {
  return TAG_VOCABULARY;
}

/** 注入运行时标签覆写 */
export function setAgentTags(tags: Record<string, readonly string[]>): void {
  _runtimeTags = { ...AGENT_TAGS as unknown as Record<string, readonly string[]>, ...tags };
}
