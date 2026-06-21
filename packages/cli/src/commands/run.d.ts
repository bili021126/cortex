/**
 * commands/run.ts — `cortex run` 单次执行命令
 *
 * 最常用的顶级命令——接受输入文件，调度 Agent 执行，输出结果。
 * 对接 Scheduler + TaskBoard + AgentPool。
 *
 * @see CLI 设计文档 §4.3
 */
import type { CommandHandler } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
export declare function createRunHandler(bridge: EngineBridge): CommandHandler;
//# sourceMappingURL=run.d.ts.map