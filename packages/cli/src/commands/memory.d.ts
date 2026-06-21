/**
 * commands/memory.ts — `cortex memory` 记忆系统命令
 *
 * 直接与 MemoryStore 交互——读写记忆、建立关联、管理生命周期。
 *
 * @see CLI 设计文档 §4.5
 */
import type { CommandHandler } from "../types.js";
import { type ICortexApi } from "@cortex/shared";
export declare function createMemoryHandler(bridge: ICortexApi): CommandHandler;
//# sourceMappingURL=memory.d.ts.map