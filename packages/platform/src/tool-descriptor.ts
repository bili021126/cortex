// ============================================================
// @cortex/platform — ToolDescriptor 三阶段解耦包装层
//
// 适配 Cortex:
//   - Cortex 的 Tool 接口有 execute() / level / category
//   - ToolDescriptor 包装层——不改 Tool 接口
//   - buildToolPlan() 按 AgentType 分群 visible[] + hidden[]
//
// owner 标记工具来源（core / plugin / mcp），
// availableFor 声明哪些 Agent 可用，
// requiresGate 标记是否需要 ConfirmGate 拦截。
// ============================================================

import type { Tool, ReversibilityLevel, AgentType } from "@cortex/shared";

export interface ToolDescriptor {
  tool: Tool;
  owner: "core" | "plugin" | "mcp";
  availableFor: AgentType[];  // 哪些 Agent 可用
  requiresGate: boolean;       // 是否需要 ConfirmGate
}

export interface ToolPlan {
  visible: ToolDescriptor[];
  hidden: ToolDescriptor[];
}

export function buildToolPlan(
  descriptors: ToolDescriptor[],
  agentType: AgentType,
): ToolPlan {
  const visible = descriptors.filter(d => d.availableFor.includes(agentType));
  const hidden = descriptors.filter(d => !d.availableFor.includes(agentType));
  return { visible, hidden };
}
