// ============================================================
// @cortex/shared — Agent 展示/身份域
//
// @depends agent.ts (AgentType 枚举)
// @usedBy  cli/repl.ts, engine/bootstrap 等需要 Agent 中文名映射的模块
// @dataflow 单向导出：类型/常量由本文件定义，所有消费方只读引用
//
// 从 agent.ts 提取：此前所有展示相关类型/常量/函数与 AgentType 枚举
// 共处 agent.ts，导致该文件成为上帝类。提取后 agent.ts 仅保留
// 类型脊梁（AgentType/AgentStatus/TAG_VOCABULARY/AGENT_TAGS 等），
// 展示域独立为本文件，遵循单一职责原则。
//
// @governance 单源原则：编译期常量为 fallback，运行时由
//   cortex-agents.json agents[].display 域 + buildChineseRoleMap() 覆盖。
// ============================================================

import { AgentType } from "./agent.js";

// ─── 中文角色名映射（编译期 fallback） ─────────────────

/**
 * AgentType -> 中文角色名映射（编译期 fallback）。
 * 运行时从 cortex-agents.json agents[].display.shortName 构建。
 *
 * 注意：strategist 类型映射到两个 Agents（钟离+霜凝），
 * 此处只映射 return 值，CLI 层需从 bootstrapResult.strategists 分别查询。
 */
export const AGENT_CHINESE_ROLE: Record<AgentType, string> = {
  [AgentType.Meta]:      "甘雨",
  [AgentType.Code]:      "阿贝多",
  [AgentType.Review]:    "刻晴",
  [AgentType.Analysis]:  "纳西妲",
  [AgentType.Ops]:       "北斗",
  [AgentType.Loop]:      "莫娜",
  [AgentType.DocGovern]: "凝光",
  [AgentType.Butler]:    "昔涟",
  [AgentType.Inspector]: "安柏",
  [AgentType.Fix]:       "希格雯",
  [AgentType.Api]:       "久岐忍",
  [AgentType.Browser]:   "宵宫",
  [AgentType.Data]:      "艾尔海森",
  [AgentType.Strategist]: "钟离",
};

/**
 * 中文名 -> AgentType 反向映射（编译期 fallback）。
 * 运行时从 cortex-agents.json 动态构建。
 *
 * 注意：钟离和霜凝共享 AgentType.Strategist，反向映射返回同一个 type。
 * CLI 层的 inspect 需额外查 bootstrapResult.strategists 区分实例。
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

/**
 * 从 Agent 定义列表构建中文名映射（运行时期望入口）。
 * 覆盖编译期 AGENT_CHINESE_ROLE / CHINESE_NAME_TO_TYPE。
 */
export function buildChineseRoleMap(
  defs: AgentDisplayInfo[],
): { role: Record<string, string>; nameToType: Record<string, string> } {
  const role: Record<string, string> = {};
  const nameToType: Record<string, string> = {};
  for (const d of defs) {
    role[d.type] = d.shortName;
    if (!nameToType[d.shortName]) {
      nameToType[d.shortName] = d.type;
    }
  }
  return { role, nameToType };
}
