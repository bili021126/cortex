/**
 * commands/task.ts — `cortex task` 任务管理命令
 *
 * 任务的生命周期管理——提交、查询、取消、重跑。
 * 对接 TaskBoard + Scheduler API。
 *
 * @see CLI 设计文档 §4.2
 */
import type { CommandHandler } from "../types.js";
import type { ICortexApi } from "@cortex/shared";
export declare function createTaskHandler(bridge: ICortexApi): CommandHandler;
//# sourceMappingURL=task.d.ts.map