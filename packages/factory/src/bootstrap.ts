// ============================================================
// @cortex/factory — Bootstrap 主流程
//
// 唯一对外入口：bootstrap(projectRoot)
//
// 流水线：
//   loadAll() → validateAll() → assembleAll() → start()
//
// 启动失败即报错退出，不留半启动状态。
// ============================================================

import { loadAgentsConfig } from "./loaders/agents.loader.js";
import { loadCognitionConfig } from "./loaders/cognition.loader.js";
import { loadDocsConfig } from "./loaders/docs.loader.js";
import { validateCrossField } from "./schemas/cross-field.validator.js";
import {
  assembleAgents,
  assembleEventRouter,
  assembleCommittee,
  assembleTelescope,
} from "./assemblers/index.js";
import type { BootstrapResult } from "./types.js";
import type { AgentDefinition } from "./types.js";

/**
 * Bootstrap —— 从配置文件到运行时对象的完整流水线。
 *
 * @param projectRoot 项目根目录（包含 cortex-agents.json 等配置文件）
 * @returns BootstrapResult —— 所有组装好的配置对象
 * @throws 若校验失败（编译期报错，拒绝启动）
 *
 * @example
 * ```typescript
 * import { bootstrap } from "@cortex/factory";
 * const result = bootstrap("/path/to/project");
 * // result.agentDefinitions → 供 Scheduler 注册
 * // result.eventRouting → 供 NotificationPipe 加载
 * ```
 */
export function bootstrap(projectRoot: string): BootstrapResult {
  const warnings: string[] = [];

  // ── 第一阶段：loadAll ───────────────────────────
  let agentsConfig;
  let cognitionConfig;
  let docsConfig;

  try {
    agentsConfig = loadAgentsConfig(projectRoot);
  } catch (e) {
    throw new Error(`[factory bootstrap] 加载 cortex-agents.json 失败: ${String(e)}`, { cause: e });
  }

  try {
    cognitionConfig = loadCognitionConfig(projectRoot);
  } catch (e) {
    throw new Error(`[factory bootstrap] 加载 cortex-cognition.json 失败: ${String(e)}`, { cause: e });
  }

  try {
    docsConfig = loadDocsConfig(projectRoot);
  } catch (e) {
    throw new Error(`[factory bootstrap] 加载 cortex-docs.json 失败: ${String(e)}`, { cause: e });
  }

  // ── 第二阶段：validateAll ────────────────────────

  // 跨字段三合一校验
  const crossFieldResult = validateCrossField(agentsConfig);
  if (!crossFieldResult.valid) {
    const errorMsg = crossFieldResult.errors.join("\n  ");
    throw new Error(
      `[factory bootstrap] 跨字段校验失败——拒绝启动:\n  ${errorMsg}`,
    );
  }
  warnings.push(...crossFieldResult.warnings);

  // ── 第三阶段：assembleAll ───────────────────────

  // @fix N-06 — assemble 返回值当前未被 BootstrapResult 直接使用，
  // 原因：assemble 输出类型（AgentConfig[] / AssembledEventRouter / etc.）与
  // BootstrapResult 字段类型（AgentDefinition[] / EventRoutingConfig / etc.）不匹配。
  // 调用保留作为扩展预留——未来若 BootstrapResult 引入新字段可接入。
  const agentDefs: AgentDefinition[] = Object.values(agentsConfig.agents);
  void assembleAgents(agentDefs);
  void assembleEventRouter(agentsConfig);
  void assembleCommittee(agentsConfig.eventRouting.committeeRules ?? []);
  void assembleTelescope();

  // ── 第四阶段：返回结果（start 由调用方执行） ──

  const result: BootstrapResult = {
    agentDefinitions: agentDefs,
    eventRouting: agentsConfig.eventRouting,
    cognition: cognitionConfig,
    docs: docsConfig,
    roundtableTemplates: agentsConfig.roundtableTemplates ?? [],
    tools: agentsConfig.tools,
    warnings,
  };

  return result;
}
