import { PRESET_CONTEXT_POLICIES } from "./data/context-policies.js";
import type { ConfigDomain } from "./loader.js";
import { CONFIG_DOMAINS } from "./loader.js";

/**
 * @cortex/config — ConfigRegistry
 *
 * Phase 3 基础设施：运行时配置注册表。
 * 支持 domain 注册、类型安全读取、key 列举。
 *
 * Phase 4 扩展：env override、热加载、schema 校验。
 *
 * @layer root — 零外部依赖
 */

// B5：ConfigDomain 单源在 loader.ts（name/fileName/required/dataKey/schema/description + defaults/envPrefix）——
// 本文件不再自建同名接口，registry 与 loader 共用同一域描述类型（registry 的 key 即 name）。

/**
 * ConfigRegistry —— 轻量运行时配置注册表。
 *
 * 用法：
 * ```typescript
 * const registry = new ConfigRegistry();
 * registry.register({ key: 'context-policies', defaults: { ... } });
 * const policies = registry.get('context-policies');
 * ```
 */
export class ConfigRegistry {
  /** 内部存储：key → ConfigDomain */
  private readonly _domains = new Map<string, ConfigDomain>();

  /**
   * 注册一个配置域。
   * 已存在的 key 会被覆盖（最后注册者优先）。
   */
  register(domain: ConfigDomain): void {
    this._domains.set(domain.name, domain);
  }
  
  /**
   * 获取已注册域的默认值。
   * @throws 当 key 尚未注册
   */
  get<T>(key: string): T {
    const domain = this._domains.get(key);
    if (!domain) {
      throw new Error(
        `[ConfigRegistry] Domain "${key}" not registered. ` +
        `Available: [${this.list().join(", ")}]`,
      );
    }
    return (domain.defaults ?? {}) as T;
  }

  /**
   * 返回所有已注册 domain key。
   */
  list(): string[] {
    return Array.from(this._domains.keys());
  }

  /**
   * 检查指定 key 是否已注册。
   */
  has(key: string): boolean {
    return this._domains.has(key);
  }
}

/**
 * 注册全部配置域到 ConfigRegistry（D2：registry 成为域目录）。
 *
 * - 18 个 JSON 数据域：defaults 留空——读取走 loader/resolveConfig 门面（阶段 E）
 * - context-policies：内置常量域
 */
export function registerAllDomains(registry: ConfigRegistry): void {
  for (const domain of CONFIG_DOMAINS) {
    registry.register(domain);
  }
  registry.register({
    name: "context-policies",
    fileName: "context-policies.ts", // 数据为 TS 常量，非 JSON 文件
    required: false,
    description: "上下文策略库",
    defaults: PRESET_CONTEXT_POLICIES as unknown as Record<string, unknown>,
  });
}

/** @deprecated 旧名——请使用 registerAllDomains */
export function registerDefaultDomains(registry: ConfigRegistry): void {
  registerAllDomains(registry);
}
