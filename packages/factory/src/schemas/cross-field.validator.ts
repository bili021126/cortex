// ============================================================
// @cortex/factory — 跨字段校验器
//
// 三合一联验：produces ↔ routeTable ↔ channels
// 在 validateAll() 阶段执行，编译期堵死配置漂移。
//
// 校验维度：
//   1. 生产端：Agent.produces 声明了但 routeTable 无对应路由 → 报错
//   2. 消费端：routeTable 指了但 channels 无对应通道定义 → 报错
//   3. 冲突检测：同一事件被多个 Agent 声明 produces 但无 mergeRule → 警告
// ============================================================

import { NotificationChannel } from "@cortex/notification";
import type { CortexAgentsConfig } from "../types.js";

/** 跨字段校验结果 */
export interface CrossFieldValidationResult {
  /** 是否通过 */
  valid: boolean;
  /** 错误列表 */
  errors: string[];
  /** 警告列表 */
  warnings: string[];
}

/**
 * 执行跨字段校验。
 * @param config 已加载的 cortex-agents.json 配置
 */
export function validateCrossField(config: CortexAgentsConfig): CrossFieldValidationResult {
  const result: CrossFieldValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // 收集所有 produces 声明
  const allProduces = new Map<string, string[]>(); // eventType → agentIds[]
  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (!Array.isArray(agent.produces)) continue;
    for (const eventType of agent.produces) {
      if (!allProduces.has(eventType)) {
        allProduces.set(eventType, []);
      }
      const producers = allProduces.get(eventType);
      if (producers) producers.push(agentId);
    }
  }

  const routeTable = config.eventRouting.routeTable;
  const mergeRules = config.eventRouting.mergeRules ?? [];

  // ── 维度一：生产端校验 ──
  for (const [eventType, agentIds] of allProduces) {
    if (!routeTable[eventType]) {
      result.valid = false;
      result.errors.push(
        `跨字段校验失败: 事件 "${eventType}" 被 ${agentIds.join(", ")} 声明为 produces，但 routeTable 中无对应路由`,
      );
    }
  }

  // ── 维度二：消费端校验 ──
  for (const [eventType, entry] of Object.entries(routeTable)) {
    // 校验 channel 值是否合法
    const validChannels = Object.values(NotificationChannel) as string[];
    if (!validChannels.includes(entry.channel)) {
      result.valid = false;
      result.errors.push(
        `跨字段校验失败: routeTable["${eventType}"].channel = "${entry.channel}" 不是合法的通道值。有效值: ${validChannels.join(", ")}`,
      );
    }

    // 检查是否有 Agent 声明了 produces 但路由指向不存在的通道
    if (!allProduces.has(eventType) && eventType !== "MERGED:") {
      // 路由表中定义了但无 Agent 生产——可能是配置残留
      result.warnings.push(
        `跨字段校验警告: routeTable 中定义了 "${eventType}" 的路由，但没有 Agent 声明 produces 该事件`,
      );
    }
  }

  // ── 维度三：冲突检测 ──
  for (const [eventType, agentIds] of allProduces) {
    if (agentIds.length > 1) {
      const hasMergeRule = mergeRules.some((r) => r.groupBy === "mergeKey");
      if (!hasMergeRule) {
        result.warnings.push(
          `跨字段校验警告: 事件 "${eventType}" 被 ${agentIds.length} 个 Agent (${agentIds.join(", ")}) 声明 produces，但未配置 mergeRule。建议添加归并规则`,
        );
      }
    }
  }

  // ── 维度四：tag / toolPermissions 交叉校验 ──
  for (const [agentId, agent] of Object.entries(config.agents)) {
    // tags 内的值必须存在
    if (agent.tags) {
      for (const tag of agent.tags) {
        if (typeof tag !== "string" || !tag.trim()) {
          result.valid = false;
          result.errors.push(
            `跨字段校验失败: agents.${agentId}.tags 包含无效标签: "${tag}"`,
          );
        }
      }
    }
    // toolPermissions 内的值必须有效
    if (agent.toolPermissions) {
      const validTools = ["read_file", "write_file", "search_code", "web_search", "run_shell", "list_files", "delete_file", "parse_ast", "browser_do"];
      for (const tool of agent.toolPermissions) {
        if (!validTools.includes(tool)) {
          result.warnings.push(
            `跨字段校验警告: agents.${agentId}.toolPermissions 包含未知工具: "${tool}"。有效工具: ${validTools.join(", ")}`,
          );
        }
      }
    }
  }

  // ── 维度五：roundtableTemplates 交叉校验 ──
  if (config.roundtableTemplates) {
    for (const tmpl of config.roundtableTemplates) {
      if (!tmpl.name || typeof tmpl.name !== "string") {
        result.valid = false;
        result.errors.push("跨字段校验失败: roundtableTemplates 中存在缺少 name 的模板");
      }
      if (!Array.isArray(tmpl.agents)) {
        result.valid = false;
        result.errors.push(`跨字段校验失败: roundtableTemplates["${tmpl.name}"].agents 必须为数组`);
      }
    }
  }

  return result;
}
