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

const DEFAULT_CONFIG: CliConfig = {
  version: "0.2",
  cli: {
    defaultFormat: "text",
    historyFile: "~/.cortex/repl-history",
    aliases: {},
  },
  engine: {
    dbPath: ".cortex/engine.db",
    maxAgents: { default: 2, code: 4 },
  },
  llm: {
    chatModel: "deepseek-v4-flash",
    reasoningEffort: "high",
  },
};

export class ConfigManager {
  private config: CliConfig;

  constructor(configPath?: string) {
    this.config = this._loadConfig(configPath);
  }

  get<K extends keyof CliConfig>(key: K): CliConfig[K] {
    return this.config[key];
  }

  getNested<T>(keyPath: string): T | undefined {
    const parts = keyPath.split(".");
    let current: unknown = this.config;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current as T;
  }

  set(keyPath: string, value: unknown): void {
    const parts = keyPath.split(".");
    let current: unknown = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current == null || typeof current !== "object") return;
      const next = (current as Record<string, unknown>)[parts[i]];
      if (next == null || typeof next !== "object") {
        (current as Record<string, unknown>)[parts[i]] = {};
      }
      current = (current as Record<string, unknown>)[parts[i]];
    }
    if (current != null && typeof current === "object") {
      (current as Record<string, unknown>)[parts[parts.length - 1]] = value;
    }
  }

  getAll(): CliConfig {
    return { ...this.config };
  }

  validate(strict = false): string[] {
    const errors: string[] = [];
    if (!this.config.cli.defaultFormat) {
      errors.push("cli.defaultFormat 未设置");
    }
    if (!this.config.llm.chatModel && strict) {
      errors.push("llm.chatModel 未设置（严格模式）");
    }
    return errors;
  }

  /** 初始化配置文件 */
  initConfig(filePath: string, force = false): boolean {
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

  private _loadConfig(configPath?: string): CliConfig {
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
    } else {
      // 向上搜索 .cortex/config
      const localConfig = this._searchUp(".cortex/config");
      if (localConfig) this._mergeFromFile(config, localConfig);

      // 全局配置
      const globalConfig = path.join(os.homedir(), ".cortex", "config");
      if (fs.existsSync(globalConfig)) {
        this._mergeFromFile(config, globalConfig);
      }
    }

    return config;
  }

  private _mergeFromFile(config: CliConfig, filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<CliConfig>;
      Object.assign(config, parsed);
    } catch {
      // 文件不存在或格式错误 — 静默忽略
    }
  }

  private _searchUp(filename: string): string | null {
    let dir = process.cwd();
    while (true) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) return null; // 到根了
      dir = parent;
    }
  }
}
