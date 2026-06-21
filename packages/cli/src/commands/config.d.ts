/**
 * commands/config.ts — `cortex config` 配置管理命令
 *
 * 管理系统配置——环境变量、配置文件、运行参数。
 * 直接对接 ConfigManager 服务。
 *
 * @see CLI 设计文档 §4.7
 */
import type { CommandHandler } from "../types.js";
import { ConfigManager } from "../services/config-manager.js";
export declare function createConfigHandler(configManager: ConfigManager): CommandHandler;
//# sourceMappingURL=config.d.ts.map