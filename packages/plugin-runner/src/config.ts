/**
 * @cortex/plugin-runner — PluginConfigManager 配置管理器
 *
 * 支持 JSON 配置外部化，插件通过构造函数注入配置。
 *
 * # 核心职责
 *
 * 1. **JSON 文件加载** — 从文件系统加载插件配置（plugin-runner-plugins.json）
 * 2. **环境变量解析** — 将 `ENV:VAR_NAME` 占位符替换为 process.env 值
 * 3. **全局默认值合并** — defaults 段与插件级配置深度合并
 * 4. **构造函数注入** — 为每个插件提供其合并后的配置对象
 * 5. **Schema 校验集成** — 与 PluginValidator 配合，加载后执行配置校验
 *
 * # 配置格式
 *
 * ```json
 * {
 *   "defaults": {
 *     "enabled": true,
 *     "timeout": 30000
 *   },
 *   "plugins": {
 *     "my-plugin": {
 *       "enabled": true,
 *       "apiKey": "ENV:MY_API_KEY",
 *       "maxRetries": 3
 *     }
 *   }
 * }
 * ```
 *
 * # 使用示例
 *
 * ```ts
 * // 从文件加载
 * const config = await PluginConfigManager.fromFile("./plugin-runner-plugins.json");
 *
 * // 获取某个插件的配置（含 defaults 合并 + 环境变量解析）
 * const myPluginCfg = config.getPluginConfig("my-plugin");
 * // → { enabled: true, timeout: 30000, apiKey: "实际值", maxRetries: 3 }
 *
 * // 通过构造函数注入
 * const plugin = new MyPlugin(config.getPluginConfig("my-plugin"));
 * ```
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { PluginConfig as PluginConfigInterface } from "./types.js";

// ── 内部类型 ──

/**
 * 配置文件在磁盘上的原始结构。
 */
export interface PluginConfigFile {
  /** 全局默认配置 */
  defaults?: Record<string, unknown>;
  /** 按插件名称索引的配置映射 */
  plugins?: Record<string, Record<string, unknown>>;
  /** 插件加载顺序（可选） */
  order?: string[];
}

/**
 * PluginConfigManagerOptions —— PluginConfigManager 构造选项。
 */
export interface PluginConfigManagerOptions {
  /** 全局默认配置 */
  defaults?: Record<string, unknown>;
  /** 按插件名称索引的配置映射 */
  plugins?: Record<string, Record<string, unknown>>;
  /** 是否自动解析 ENV: 环境变量占位符（默认 true） */
  resolveEnv?: boolean;
  /** 是否严格模式——遇到缺失 env 变量时抛错而非静默留空（默认 false） */
  strictEnv?: boolean;
}

// ── 常量 ──

/** 默认配置文件名称 */
const DEFAULT_CONFIG_FILE = "plugin-runner-plugins.json";

// ── PluginConfigManager 类 ──

/**
 * PluginConfigManager —— 配置管理器。
 *
 * 负责加载、解析、合并和分发插件配置。
 *
 * ## 设计要点
 *
 * - **不可变**：构造后配置内容不可变，线程安全
 * - **纯数据**：不持有外部资源引用（无文件句柄），可被序列化
 * - **环境变量解析**：支持 `ENV:VAR_NAME` 占位符，自动从 process.env 解析
 * - **浅层合并**：defaults 与插件级配置按「插件级优先」原则顶层合并
 * - **构造函数注入**：通过 `getPluginConfig(name)` 获取单个插件的合并配置
 */
export class PluginConfigManager {
  /** 合并后的插件配置映射（解析后的最终结果） */
  private readonly _resolved: Map<string, Record<string, unknown>>;

  /** 全局默认配置（解析后） */
  private readonly _defaults: Record<string, unknown>;

  /** 原始插件配置（解析前，仅用于 toJSON） */
  private readonly _rawPlugins: Record<string, Record<string, unknown>>;

  /** 配置来源文件路径（如果是从文件加载的，由 fromJson 工厂设置） */
  private _sourcePath: string | undefined;

  /**
   * 构造 PluginConfigManager 实例。
   *
   * @param options — 配置选项
   */
  constructor(options?: PluginConfigManagerOptions) {
    const opts: PluginConfigManagerOptions = {
      resolveEnv: true,
      strictEnv: false,
      ...options,
    };

    this._defaults = opts.defaults ?? {};
    this._rawPlugins = opts.plugins ?? {};
    this._resolved = new Map();

    // 解析每个插件的配置（合并 defaults + 环境变量解析）
    for (const [name, pluginConfig] of Object.entries(this._rawPlugins)) {
      const merged = this._mergeConfigs(this._defaults, pluginConfig);

      if (opts.resolveEnv !== false) {
        this._resolved.set(name, this._resolveEnvVars(merged, opts.strictEnv));
      } else {
        this._resolved.set(name, merged);
      }
    }
  }

  // ── 工厂方法 ──

  /**
   * 从 JSON 文件加载配置。
   *
   * 搜索顺序（按优先级从高到低）：
   * 1. 显式传入的 filePath（绝对路径或相对路径）
   * 2. 当前工作目录下的 `plugin-runner-plugins.json`
   *
   * 如果文件不存在且使用默认文件名，返回空配置（不抛错）。
   * 如果显式传入 filePath 但文件不存在，抛 ENOENT 错误。
   *
   * @param filePath — 配置文件的路径（可选，默认查找 plugin-runner-plugins.json）
   * @param options  — 额外构造选项（可覆盖文件中的 defaults）
   * @returns Promise<PluginConfigManager>
   */
  static async fromFile(
    filePath?: string,
    options?: PluginConfigManagerOptions,
  ): Promise<PluginConfigManager> {
    const targetPath = filePath ?? DEFAULT_CONFIG_FILE;

    // 解析为绝对路径
    const absPath = isAbsolute(targetPath)
      ? targetPath
      : resolve(process.cwd(), targetPath);

    let fileContent: string;
    try {
      fileContent = await readFile(absPath, "utf-8");
    } catch (err: unknown) {
      // 使用默认文件名但文件不存在 → 返回空配置
      if (!filePath && (err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return new PluginConfigManager(options);
      }
      // 显式传入路径但文件不存在 → 抛原始错误
      throw err;
    }

    return PluginConfigManager.fromJson(fileContent, options, absPath);
  }

  /**
   * 从 JSON 字符串加载配置。
   *
   * @param json       — JSON 字符串
   * @param options    — 额外构造选项（可覆盖文件中的 defaults）
   * @param sourcePath — 来源路径（可选，仅用于溯源信息）
   * @returns PluginConfigManager
   * @throws 解析 JSON 失败时抛 SyntaxError
   */
  static fromJson(
    json: string,
    options?: PluginConfigManagerOptions,
    sourcePath?: string,
  ): PluginConfigManager {
    let parsed: PluginConfigFile;
    try {
      parsed = JSON.parse(json) as PluginConfigFile;
    } catch (err) {
      throw new SyntaxError(
        `[PluginConfigManager] JSON 解析失败${sourcePath ? ` (${sourcePath})` : ""}: ${(err as Error).message}`,
        { cause: err },
      );
    }

    // 合并文件中 defaults 与传入选项中的 defaults（传入优先）
    const mergedDefaults = {
      ...(parsed.defaults ?? {}),
      ...(options?.defaults ?? {}),
    };

    const mergedOptions: PluginConfigManagerOptions = {
      ...options,
      defaults: mergedDefaults,
      plugins: {
        ...(parsed.plugins ?? {}),
        ...(options?.plugins ?? {}),
      },
    };

    const config = new PluginConfigManager(mergedOptions);
    config._sourcePath = sourcePath;
    return config;
  }

  /**
   * 从普通对象创建配置。
   *
   * @param obj     — 配置对象（格式同 PluginConfigFile）
   * @param options — 额外构造选项
   * @returns PluginConfigManager
   */
  static fromObject(
    obj: PluginConfigFile,
    options?: PluginConfigManagerOptions,
  ): PluginConfigManager {
    const mergedOptions: PluginConfigManagerOptions = {
      ...options,
      plugins: {
        ...(obj.plugins ?? {}),
        ...(options?.plugins ?? {}),
      },
      defaults: {
        ...(obj.defaults ?? {}),
        ...(options?.defaults ?? {}),
      },
    };
    return new PluginConfigManager(mergedOptions);
  }

  // ── 查询接口 ──

  /**
   * 获取指定插件的合并配置（含 defaults 合并 + 环境变量解析）。
   *
   * 返回的配置对象可直接用于插件的构造函数注入或 init() 调用。
   *
   * @param pluginName — 插件名称
   * @returns 合并后的配置对象（已解析环境变量）
   */
  getPluginConfig(pluginName: string): Record<string, unknown> {
    const resolved = this._resolved.get(pluginName);
    if (resolved) {
      return { ...resolved };
    }

    // 插件没有特定配置 → 使用 defaults
    return { ...this._defaults };
  }

  /**
   * 获取所有已配置的插件名称列表。
   *
   * @returns 插件名称数组
   */
  getPluginNames(): string[] {
    return Array.from(this._resolved.keys());
  }

  /**
   * 获取全局默认配置（已解析环境变量）。
   *
   * @returns 默认配置的浅拷贝
   */
  getDefaults(): Record<string, unknown> {
    return { ...this._defaults };
  }

  /**
   * 检查某个插件是否有独立配置（而非仅使用 defaults）。
   *
   * @param pluginName — 插件名称
   * @returns 是否有独立配置项
   */
  hasPluginConfig(pluginName: string): boolean {
    return this._resolved.has(pluginName);
  }

  /**
   * 获取配置来源文件路径（如果是从文件加载的）。
   */
  get sourcePath(): string | undefined {
    return this._sourcePath;
  }

  /**
   * 配置条目总数（按插件名称计数）。
   */
  get size(): number {
    return this._resolved.size;
  }

  // ── 序列化 ──

  /**
   * 导出为可序列化的普通对象。
   *
   * @returns PluginConfigFile 格式的对象
   */
  toJSON(): PluginConfigFile {
    const plugins: Record<string, Record<string, unknown>> = {};
    for (const [name, config] of this._resolved) {
      plugins[name] = { ...config };
    }

    return {
      defaults: { ...this._defaults },
      plugins,
    };
  }

  /**
   * 导出为格式化的 JSON 字符串。
   *
   * @param indent — 缩进空格数（默认 2）
   * @returns JSON 字符串
   */
  toString(indent = 2): string {
    return JSON.stringify(this.toJSON(), null, indent);
  }

  // ── 工具方法 ──

  /**
   * 创建一个构造注入用的配置对象。
   *
   * 与 `getPluginConfig` 类似，但返回完整的 PluginConfig 接口兼容对象
   *（包含 enabled, timeout, env 等标准字段）。
   *
   * 适用于实现了 PluginConfig 接口的 AbstractPlugin 子类：
   *
   * ```ts
   * class MyPlugin extends AbstractPlugin {
   *   constructor(config: PluginConfigInterface) {
   *     super();
   *     this._config = config;
   *   }
   * }
   *
   * const cfg = config.toPluginConfig("my-plugin");
   * const plugin = new MyPlugin(cfg);
   * ```
   *
   * @param pluginName — 插件名称
   * @returns PluginConfig 接口兼容的对象
   */
  toPluginConfig(pluginName: string): PluginConfigInterface {
    const merged = this.getPluginConfig(pluginName);

    return {
      name: pluginName,
      enabled: (merged.enabled as boolean) ?? true,
      timeout: (merged.timeout as number) ?? undefined,
      env: (merged.env as Record<string, string>) ?? undefined,
      ...merged,
    };
  }

  // ── 内部方法 ──

  /**
   * 合并两个配置对象（浅层合并）。
   *
   * 合并策略：
   * - 插件级配置覆盖 defaults 中的同名属性
   * - defaults 中有的但插件级没有的属性保留
   * - 嵌套对象不做深度合并（顶层键覆盖）
   *
   * @param defaults  — 默认配置
   * @param override  — 插件级配置（优先级更高）
   * @returns 合并后的新对象
   */
  private _mergeConfigs(
    defaults: Record<string, unknown>,
    override: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...defaults, ...override };
  }

  /**
   * 递归解析配置值中的 `ENV:VAR_NAME` 占位符。
   *
   * 支持场景：
   * - 字符串值 `"ENV:MY_API_KEY"` → `process.env.MY_API_KEY`
   * - 不区分大小写前缀匹配（`EnV:`, `env:`, `ENV:` 均有效）
   * - 嵌套对象和数组中的字符串也会被递归处理
   *
   * @param config    — 待解析的配置对象
   * @param strictEnv — 严格模式：缺失环境变量时抛错而非留空
   * @returns 解析后的新对象（不修改原对象）
   */
  private _resolveEnvVars(
    config: Record<string, unknown>,
    strictEnv = false,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(config)) {
      result[key] = this._resolveValue(value, strictEnv);
    }

    return result;
  }

  /**
   * 递归解析单个配置值的环境变量占位符。
   *
   * @param value     — 待解析的值
   * @param strictEnv — 严格模式
   * @returns 解析后的值
   */
  private _resolveValue(
    value: unknown,
    strictEnv: boolean,
  ): unknown {
    if (typeof value === "string") {
      return this._resolveEnvPlaceholder(value, strictEnv);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this._resolveValue(item, strictEnv));
    }

    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        resolved[k] = this._resolveValue(v, strictEnv);
      }
      return resolved;
    }

    // 原始类型（number, boolean, null, undefined）— 直接返回
    return value;
  }

  /**
   * 解析单个字符串中的环境变量占位符。
   *
   * 匹配模式：
   * - 字符串完全等于 `ENV:VAR_NAME` → 替换为 process.env[VAR_NAME]
   * - 字符串中包含 `ENV:VAR_NAME` → 不处理（仅支持完全匹配）
   *
   * @param str       — 待解析的字符串
   * @param strictEnv — 严格模式
   * @returns 解析后的值
   */
  private _resolveEnvPlaceholder(
    str: string,
    strictEnv: boolean,
  ): unknown {
    // 标准化前缀为大写
    const normalized = str.toUpperCase();

    const match = normalized.match(/^ENV:([A-Z_][A-Z0-9_]*)$/);
    if (!match) {
      return str; // 不是环境变量占位符，原样返回
    }

    // 保留原始大小写的变量名
    const varName = str.slice(4); // 去掉 "ENV:" 前缀
    const envValue = process.env[varName];

    if (envValue !== undefined) {
      return envValue;
    }

    // 环境变量未定义
    if (strictEnv) {
      throw new Error(
        `[PluginConfigManager] 环境变量 "${varName}" 未定义 (strictEnv=true)`,
      );
    }

    return undefined; // 非严格模式返回 undefined
  }
}

// ── 便捷工厂函数 ──

/**
 * 加载插件配置的便捷函数。
 *
 * 等价于 `PluginConfigManager.fromFile(filePath, options)`。
 * 适用于快速初始化场景。
 *
 * @param filePath — 配置文件路径（可选）
 * @param options  — 构造选项
 * @returns Promise<PluginConfigManager>
 */
export async function loadPluginConfig(
  filePath?: string,
  options?: PluginConfigManagerOptions,
): Promise<PluginConfigManager> {
  return await PluginConfigManager.fromFile(filePath, options);
}

/**
 * 从内存对象创建插件配置的便捷函数。
 *
 * 等价于 `PluginConfigManager.fromObject(obj, options)`。
 * 适用于测试和程序化配置场景。
 *
 * @param obj     — 配置对象
 * @param options — 构造选项
 * @returns PluginConfigManager
 */
export function createPluginConfig(
  obj: PluginConfigFile,
  options?: PluginConfigManagerOptions,
): PluginConfigManager {
  return PluginConfigManager.fromObject(obj, options);
}
