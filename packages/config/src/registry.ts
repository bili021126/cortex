import { PRESET_CONTEXT_POLICIES } from "./data/context-policies.js";

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

/**
 * 注册域描述符——向 ConfigRegistry 注册一个配置域所需的元信息。
 */
export interface ConfigDomain {
  /** 域唯一标识（如 "context-policies"） */
  key: string;
  /** JSON Schema（Phase 3 预留 —— 不引入 Zod 依赖） */
  schema?: unknown;
  /** 默认值 */
  defaults: Record<string, unknown>;
  /** 环境变量前缀（Phase 4 启用 env override） */
  envPrefix?: string;
}

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
    this._domains.set(domain.key, domain);
  }

  /**
   * 获取已注册域的默认值。
   * @throws 若 key 尚未注册
   */
  get<T>(key: string): T {
    const domain = this._domains.get(key);
    if (!domain) {
      throw new Error(
        `[ConfigRegistry] Domain "${key}" not registered. ` +
        `Available: [${this.list().join(", ")}]`,
      );
    }
    return domain.defaults as T;
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
 * 注册内置默认域到 ConfigRegistry。
 *
 * Phase 3 预设域：
 *   - context-policies：上下文策略库
 *
 * @param registry 目标注册表实例
 */
export function registerDefaultDomains(registry: ConfigRegistry): void {
  registry.register({
    key: "context-policies",
    defaults: PRESET_CONTEXT_POLICIES as unknown as Record<string, unknown>,
  });
}
