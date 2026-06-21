/**
 * commands/roundtable.ts — `cortex roundtable` 圆桌辩论命令
 *
 * 多 Agent 圆桌共识会议——Cortex 的核心元能力。
 * 启动一轮由多位 Agent Persona 参与的讨论，产出共识修复清单或决策结论。
 *
 * @see CLI 设计文档 §4.4
 */
import type { CommandHandler } from "../types.js";
import type { EngineBridge } from "../services/engine-bridge.js";
import type { DocRegistry } from "@cortex/governance";
/** 圆桌服务依赖聚合——解耦 docRegistry/bridge 双参传递 */
export interface RoundtableServices {
    docRegistry: DocRegistry;
    bridge: EngineBridge;
}
export declare function createRoundtableHandler(services: RoundtableServices): CommandHandler;
//# sourceMappingURL=roundtable.d.ts.map