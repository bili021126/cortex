/**
 * commands/schedule.ts — `cortex schedule` 调度系统命令
 *
 * 任务调度编排——从文件生成计划、执行计划、查看调度状态。
 * 对接 Scheduler + TaskBoard API。
 *
 * @see CLI 设计文档 §4.6
 */
import type { CommandHandler } from "../types.js";
import type { ICortexApi } from "@cortex/shared";
export declare function createScheduleHandler(bridge: ICortexApi): CommandHandler;
//# sourceMappingURL=schedule.d.ts.map