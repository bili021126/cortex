/**
 * config-manager.ts — 配置管理服务
 *
 * 管理 Cortex 配置层级：
 * 1. 命令行参数（最高）
 * 2. 环境变量（CORTEX_* 前缀）
 * 3. 本地配置（.cortex/config, cwd 向上递归搜索）
 * 4. 全局配置（~/.cortex/config）
 * 5. 内置默认值（最低）
 *
 * @see CLI 设计文档 §4.7
 */
export interface CliConfig {
    version: string;
    cli: {
        defaultFormat: "text" | "json" | "color";
        historyFile: string;
        aliases: Record<string, string>;
    };
    engine: {
        dbPath: string;
        maxAgents: Record<string, number>;
    };
    llm: {
        chatModel: string;
        reasoningEffort: "high" | "max";
    };
}
export declare class ConfigManager {
    private config;
    constructor(configPath?: string);
    get<K extends keyof CliConfig>(key: K): CliConfig[K];
    getNested<T>(keyPath: string): T | undefined;
    set(keyPath: string, value: unknown): void;
    getAll(): CliConfig;
    validate(strict?: boolean): string[];
    /** 初始化配置文件 */
    initConfig(filePath: string, force?: boolean): boolean;
    private _loadConfig;
    private _mergeFromFile;
    private _searchUp;
}
//# sourceMappingURL=config-manager.d.ts.map