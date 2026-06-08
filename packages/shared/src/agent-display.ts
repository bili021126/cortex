// ============================================================
// @cortex/shared — Agent 展示/身份域（重导出层）
//
// AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE 的实际定义已迁移至 @cortex/config。
// 本文件保留为向后兼容的重导出层，提供 AgentType 键版本的转换。
//
// @governance 单源原则：编译期常量为 fallback，运行时由
//   cortex-agents.json agents[].display 域 + buildChineseRoleMap() 覆盖。
// ============================================================

import { AgentType } from "./agent.js";
import {
  AGENT_CHINESE_ROLE as CONFIG_CHINESE_ROLE,
  buildChineseRoleMap,
} from "@cortex/config";
export type { AgentDisplayEntry } from "@cortex/config";
export { buildChineseRoleMap };

// ─── 中文角色名映射（AgentType 键版本） ─────────────────

/**
 * AgentType -> 中文角色名映射（编译期 fallback）。
 * 运行时从 cortex-agents.json agents[].display.shortName 构建。
 */
export const AGENT_CHINESE_ROLE: Record<AgentType, string> = {
  [AgentType.Meta]:      CONFIG_CHINESE_ROLE.meta,
  [AgentType.Code]:      CONFIG_CHINESE_ROLE.code,
  [AgentType.Review]:    CONFIG_CHINESE_ROLE.review,
  [AgentType.Analysis]:  CONFIG_CHINESE_ROLE.analysis,
  [AgentType.Ops]:       CONFIG_CHINESE_ROLE.ops,
  [AgentType.Loop]:      CONFIG_CHINESE_ROLE.loop,
  [AgentType.DocGovern]: CONFIG_CHINESE_ROLE["doc-govern"],
  [AgentType.Butler]:    CONFIG_CHINESE_ROLE.butler,
  [AgentType.Inspector]: CONFIG_CHINESE_ROLE.inspector,
  [AgentType.Fix]:       CONFIG_CHINESE_ROLE.fix,
  [AgentType.Api]:       CONFIG_CHINESE_ROLE.api,
  [AgentType.Browser]:   CONFIG_CHINESE_ROLE.browser,
  [AgentType.Data]:      CONFIG_CHINESE_ROLE.data,
  [AgentType.Strategist]: CONFIG_CHINESE_ROLE.strategist,
};

/**
 * 中文名 -> AgentType 反向映射（编译期 fallback）。
 */
export const CHINESE_NAME_TO_TYPE: Record<string, AgentType> = {
  "甘雨":   AgentType.Meta,
  "阿贝多": AgentType.Code,
  "刻晴":   AgentType.Review,
  "纳西妲": AgentType.Analysis,
  "北斗":   AgentType.Ops,
  "莫娜":   AgentType.Loop,
  "凝光":   AgentType.DocGovern,
  "昔涟":   AgentType.Butler,
  "安柏":   AgentType.Inspector,
  "希格雯": AgentType.Fix,
  "久岐忍": AgentType.Api,
  "宵宫":   AgentType.Browser,
  "艾尔海森": AgentType.Data,
  "钟离":   AgentType.Strategist,
  "霜凝":   AgentType.Strategist,
};

/** Agent display 信息的最小接口（用于从配置构建映射） */
export interface AgentDisplayInfo {
  type: string;
  shortName: string;
}
