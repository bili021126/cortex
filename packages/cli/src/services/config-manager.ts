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
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      deepMerge(tgtVal, srcVal);
    } else if (srcVal !== undefined) {
      target[key] = srcVal;
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const next = (current as Record<string, unknown>)[parts[i]!];
      if (next == null || typeof next !== "object") {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (current as Record<string, unknown>)[parts[i]!] = {};
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      current = (current as Record<string, unknown>)[parts[i]!];
    }
    if (current != null && typeof current === "object") {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (current as Record<string, unknown>)[parts[parts.length - 1]!] = value;
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

  /**
   * R11-07：持久化当前合并配置到指定文件（原子写 tmp+rename，防写中崩溃损坏）。
   * cortex config set 后调用——此前只改内存、下次进程读旧值。
   */
  persist(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  }

  // ── 内部 ──────────────────────────────────────────────

  private _loadConfig(configPath?: string): CliConfig {
    // 文档优先级：CLI args > env (CORTEX_*) > local .cortex/config > global ~/.cortex/config > defaults
    // R11-06 修复：按此顺序合并——此前 global > local > env > defaults 与文档相反
    const config = { ...DEFAULT_CONFIG };

    // 1) 全局配置（最低文件层）
    const globalConfig = path.join(os.homedir(), DIR_GLOBAL_CONFIG, "config");
    if (configPath) {
      // 显式路径（config --file）——只加载该文件
      this._mergeFromFile(config, configPath);
    } else {
      if (fs.existsSync(globalConfig)) {
        this._mergeFromFile(config, globalConfig);
      }

      // 2) 本地配置（向上搜索 .cortex/config）——覆盖全局
      const localConfig = this._searchUp(FILE_LOCAL_CONFIG);
      if (localConfig) this._mergeFromFile(config, localConfig);
    }

    // 3) 环境变量（覆盖文件）
    const envFormat = process.env["CORTEX_CLI_DEFAULT_FORMAT"];
    const envModel = process.env["CORTEX_LLM_CHAT_MODEL"];
    if (envFormat && (envFormat === "text" || envFormat === "json" || envFormat === "color")) {
      config.cli.defaultFormat = envFormat;
    }
    if (envModel) {
      config.llm.chatModel = envModel;
    }

    return config;
  }

  private _mergeFromFile(config: CliConfig, filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<CliConfig>;
       
      // Core-3: 泛型擦除——待接口泛型化
      deepMerge(config as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
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
