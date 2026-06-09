/**
 * index.ts — @cortex/cli 公开 API
 *
 * 导出 Cortex CLI 的统一前端 API。
 * 保留向后兼容的文档转换功能。
 *
 * @module-convention 模块化铁律（昔涟 v2.6 入宪）
 * 1. 凡 src/ 下新增公开符号，必须在本文件追加对应的 export 语句。
 * 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/cli 包名导入。
 * 3. 新增子模块（如 commands/xxx.ts、services/xxx.ts）同步更新。
 * 4. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
 * 违反者：导入路径越写越长，终至不可维护。
 */

// ── 文档转换（向后兼容） ────────────────────────────
export { convert, convertToDocument } from "@cortex/parser";

// ── CLI 入口 ───────────────────────────────────────
export { main as runCli } from "./main.js";
export type { CommandContext, CommandResult, OutputFormat } from "./types.js";

// ── 引导模块 ───────────────────────────────────────
export { bootstrapLlm, hasAnyLlmKey, enableLlmAudit } from "./bootstrap/llm.js";
export type { LlmBootstrapResult } from "./bootstrap/llm.js";
export { bootstrapMcp } from "./bootstrap/mcp.js";
export type { McpBootstrapResult } from "./bootstrap/mcp.js";

// ── 命令注册 ─────────────────────────────────────
export { CommandRegistry } from "./commands/index.js";
export { COMMAND_DEFS, registerCommands } from "./commands/command-list.js";
export { CORTEX_VERSION } from "@cortex/config";
export type { CommandDefinition, CommandHandler } from "./types.js";

// ── 服务 ───────────────────────────────────────────
export { ConfigManager } from "./services/config-manager.js";
export type { CliConfig } from "./services/config-manager.js";
export { EngineBridge } from "./services/engine-bridge.js";
export type { BridgeContext } from "./services/engine-bridge.js";

// ── 命令处理器工厂（集成测试用） ──────────────────
export { createRunHandler } from "./commands/run.js";
export { createAgentHandler } from "./commands/agent.js";
export { createTaskHandler } from "./commands/task.js";
export { createMemoryHandler } from "./commands/memory.js";
export { createConfirmHandler } from "./commands/confirm.js";
export { createScheduleHandler } from "./commands/schedule.js";
export { createSetupHandler } from "./commands/setup.js";
export { createHelpHandler } from "./commands/help.js";
export { createVersionHandler } from "./commands/version.js";
export { createConfigHandler } from "./commands/config.js";
export { createDocHandler } from "./commands/doc.js";
export { createSkillHandler } from "./commands/skill.js";
export { createInspectHandler } from "./commands/inspect.js";
export { createDoctorHandler } from "./commands/doctor.js";
export { createRoundtableHandler } from "./commands/roundtable.js";

// ── 格式器 ─────────────────────────────────────────
export { getFormatter, detectDefaultFormat } from "./formatters/index.js";
export type { Formatter } from "./formatters/index.js";

// ── 工具函数 ───────────────────────────────────────
export { parseGlobalFormat, createDefaultContext, outputResult, stripGlobalOptions, isDirectRun } from "./utils.js";

// ── Plan 工具函数 ────────────────────────────────
export { extractWorkspacePath, formatPlanTree, displayClarification, clarifyAndConfirm } from "./tui/modes/plan-utils.js";

// ── Platform ───────────────────────────────────────
export { getPlatformBridge, closePlatformBridge } from "./platform.js";
