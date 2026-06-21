/**
 * commands/confirm.ts — `cortex confirm` 确认门命令
 *
 * 查看和操作待确认的 L2/L3 操作。
 * 对接 ConfirmGate API。
 *
 * @see CLI 设计文档 §4.12
 */
import type { CommandHandler } from "../types.js";
import type { ICortexApi } from "@cortex/shared";
export declare function createConfirmHandler(bridge: ICortexApi): CommandHandler;
//# sourceMappingURL=confirm.d.ts.map