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
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_AGENT_QUOTA, DEFAULT_CLI_CHAT_MODEL, DIR_CORTEX, DIR_GLOBAL_CONFIG, FILE_LOCAL_CONFIG, FILE_ENGINE_DB, FILE_REPL_HISTORY } from "@cortex/config";
// ── 深度合并工具 ────────────────────────────────────────
/** 递归深度合并 source 到 target（原地修改 target）。
 *  仅处理普通对象；数组和原始值直接覆盖。 */
function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        const tgtVal = target[key];
        if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
            deepMerge(tgtVal, srcVal);
        }
        else if (srcVal !== undefined) {
            target[key] = srcVal;
        }
    }
}
function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
const DEFAULT_CONFIG = {
    version: "0.2",
    cli: {
        defaultFormat: DEFAULT_OUTPUT_FORMAT,
        historyFile: `~/${DIR_GLOBAL_CONFIG}/${FILE_REPL_HISTORY}`,
        aliases: {},
    },
    engine: {
        dbPath: `${DIR_CORTEX}/${FILE_ENGINE_DB}`,
        maxAgents: DEFAULT_AGENT_QUOTA,
    },
    llm: {
        chatModel: DEFAULT_CLI_CHAT_MODEL,
        reasoningEffort: "max",
    },
};
export class ConfigManager {
    config;
    constructor(configPath) {
        this.config = this._loadConfig(configPath);
    }
    get(key) {
        return this.config[key];
    }
    getNested(keyPath) {
        const parts = keyPath.split(".");
        let current = this.config;
        for (const part of parts) {
            if (current == null || typeof current !== "object")
                return undefined;
            current = current[part];
        }
        return current;
    }
    set(keyPath, value) {
        const parts = keyPath.split(".");
        let current = this.config;
        for (let i = 0; i < parts.length - 1; i++) {
            if (current == null || typeof current !== "object")
                return;
            const next = current[parts[i]];
            if (next == null || typeof next !== "object") {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        if (current != null && typeof current === "object") {
            current[parts[parts.length - 1]] = value;
        }
    }
    getAll() {
        return { ...this.config };
    }
    validate(strict = false) {
        const errors = [];
        if (!this.config.cli.defaultFormat) {
            errors.push("cli.defaultFormat 未设置");
        }
        if (!this.config.llm.chatModel && strict) {
            errors.push("llm.chatModel 未设置（严格模式）");
        }
        return errors;
    }
    /** 初始化配置文件 */
    initConfig(filePath, force = false) {
        if (fs.existsSync(filePath) && !force) {
            return false;
        }
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
        return true;
    }
    // ── 内部 ──────────────────────────────────────────────
    _loadConfig(configPath) {
        // 从环境变量读取覆盖
        const envFormat = process.env["CORTEX_CLI_DEFAULT_FORMAT"];
        const envModel = process.env["CORTEX_LLM_CHAT_MODEL"];
        const config = { ...DEFAULT_CONFIG };
        if (envFormat && (envFormat === "text" || envFormat === "json" || envFormat === "color")) {
            config.cli.defaultFormat = envFormat;
        }
        if (envModel) {
            config.llm.chatModel = envModel;
        }
        // 尝试从文件加载
        if (configPath) {
            this._mergeFromFile(config, configPath);
        }
        else {
            // 向上搜索 .cortex/config
            const localConfig = this._searchUp(FILE_LOCAL_CONFIG);
            if (localConfig)
                this._mergeFromFile(config, localConfig);
            // 全局配置
            const globalConfig = path.join(os.homedir(), DIR_GLOBAL_CONFIG, "config");
            if (fs.existsSync(globalConfig)) {
                this._mergeFromFile(config, globalConfig);
            }
        }
        return config;
    }
    _mergeFromFile(config, filePath) {
        try {
            const content = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(content);
            deepMerge(config, parsed);
        }
        catch {
            // 文件不存在或格式错误 — 静默忽略
        }
    }
    _searchUp(filename) {
        let dir = process.cwd();
        while (true) {
            const candidate = path.join(dir, filename);
            if (fs.existsSync(candidate))
                return candidate;
            const parent = path.dirname(dir);
            if (parent === dir)
                return null; // 到根了
            dir = parent;
        }
    }
}
//# sourceMappingURL=config-manager.js.map