/**
 * commands/agent.ts — `cortex agent` Agent 管理命令
 *
 * 管理 Agent 类型的注册、实例的生命周期、查看运行时状态。
 * 对接 AgentPool API（通过引擎桥接器）。
 *
 * @see CLI 设计文档 §4.1
 */
import type { CommandHandler } from "../types.js";
import { type ICortexApi } from "@cortex/shared";
export declare function createAgentHandler(bridge: ICortexApi): CommandHandler;
//# sourceMappingURL=agent.d.ts.map