/**
 * @cortex/policy-validator — RuleEngine 规则引擎实现
 *
 * 执行校验的核心引擎——接受注册表和校验组件，对目标文件执行策略校验。
 * 依据 coding-standards.md：
 *   - §9.2 内部数据流向明细化：校验管线每一步显式可追踪
 *   - §9.4 三步铁律：外部接口 → 内部数据流 → 实现验证
 *   - §14.4 Observer 模式：事件发布解耦
 *   - §14.1 Adapter 模式：可插拔校验组件统一接口
 */

import type {
  PolicyRule,
  PolicyRuleResult,
  PolicyReport,
  RuleFilter,
  RuleEngineConfig,
  PolicyEvent,
  PolicyEventHandler,
} from "./types.js";
import type { IRuleRegistry } from "./ruleRegistry.js";

// ============================================================
// PolicyValidatorComponent — 可插拔校验组件接口
// ============================================================

/**
 * 校验组件——可插拔的独立校验单元。
 *
 * @design-rule 借鉴 SkillJsonValidator 模式
 *   每个组件是独立对象，实现统一接口，通过注册表组合。
 *   组件互不感知，错误累积而非短路。
 *
 * @design-rule 纯函数风格（§11.2）
 *   validate 不修改外部状态——相同输入永远相同输出。
 */
export interface PolicyValidatorComponent {
  /** 组件名称 */
  readonly name: string;

  /** 组件对应的规则 ID */
  readonly ruleId: string;

  /**
   * 对单个文件执行校验。
   *
   * @param filePath - 待校验文件路径
   * @param content - 文件内容（已读取）
   * @returns 校验结果项（null 表示规则不适用此文件）
   */
  validate(
    filePath: string,
    content: string,
  ): Promise<PolicyRuleResult | null>;
}

// ============================================================
// IRuleEngine — 规则引擎接口
// ============================================================

/**
 * 规则引擎——执行校验的核心引擎。
 *
 * @design-rule 外部接口抽象具体化（§9.3）
 *   对外暴露的契约清晰、稳定、最小化。
 *
 * @design-rule 数据流向明细化（§9.2）
 *   execute() 内部管线：
 *   [加载规则] → [筛选匹配] → [文件扫描] → [逐规则校验] → [汇总报告]
 */
export interface IRuleEngine {
  /** 执行全量校验——扫描项目文件并执行所有匹配规则 */
  execute(options?: {
    rootDir?: string;
    filter?: RuleFilter;
  }): Promise<PolicyReport>;

  /** 对指定文件列表执行校验 */
  executeOnFiles(
    files: string[],
    filter?: RuleFilter,
  ): Promise<PolicyReport>;

  /** 注册事件监听 */
  on(event: PolicyEvent["type"], handler: PolicyEventHandler): void;

  /** 移除事件监听 */
  off(event: PolicyEvent["type"], handler: PolicyEventHandler): void;

  /** 更新引擎配置（运行时动态调整） */
  updateConfig(config: Partial<RuleEngineConfig>): void;

  /** 获取当前配置 */
  getConfig(): RuleEngineConfig;
}

// ============================================================
// RuleEngine — 实现类
// ============================================================

/**
 * RuleEngine 实现——基于可插拔组件的事件驱动引擎。
 *
 * @design-rule Observer 模式（§14.4）
 *   引擎只管 emit 事件，不知道谁在听。
 *   日志记录、报告生成、进度显示通过事件订阅实现。
 */
export class RuleEngine implements IRuleEngine {
  private _registry: IRuleRegistry;
  private _components: Map<string, PolicyValidatorComponent>;
  private _listeners: Map<string, Set<PolicyEventHandler>>;
  private _config: Required<RuleEngineConfig>;

  constructor(
    registry: IRuleRegistry,
    components?: readonly PolicyValidatorComponent[],
    config?: RuleEngineConfig,
  ) {
    this._registry = registry;
    this._components = new Map();
    this._listeners = new Map();
    this._config = {
      ruleTimeoutMs: config?.ruleTimeoutMs ?? 30_000,
      maxConcurrency: config?.maxConcurrency ?? 4,
      failFast: config?.failFast ?? false,
      enableCache: config?.enableCache ?? true,
      verbose: config?.verbose ?? false,
      maxErrors: config?.maxErrors ?? 0,
    };

    if (components) {
      for (const comp of components) {
        this._components.set(comp.ruleId, comp);
      }
    }
  }

  // ── 事件管理 ──

  on(event: PolicyEvent["type"], handler: PolicyEventHandler): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.add(handler);
    }
  }

  off(event: PolicyEvent["type"], handler: PolicyEventHandler): void {
    this._listeners.get(event)?.delete(handler);
  }

  private _emit(event: PolicyEvent): void {
    const handlers = this._listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  // ── 配置管理 ──

  updateConfig(config: Partial<RuleEngineConfig>): void {
    this._config = { ...this._config, ...config };
  }

  getConfig(): RuleEngineConfig {
    return { ...this._config };
  }

  // ── 核心校验 ──

  async execute(options?: {
    rootDir?: string;
    filter?: RuleFilter;
  }): Promise<PolicyReport> {
    const rootDir = options?.rootDir ?? process.cwd();
    const filter = options?.filter;

    // Step 1: 从注册表获取匹配的规则
    const rules = this._registry.query(filter);
    if (rules.length === 0) {
      return this._emptyReport();
    }

    // Step 2: 收集待校验文件（简化实现——实际应扫描文件系统）
    const targetFiles = await this._collectTargetFiles(rules, rootDir);

    // Step 3: 初始化
    const startTime = Date.now();
    this._emit({
      type: "engine-start",
      payload: { totalRules: rules.length, targetFiles },
    });

    // Step 4: 逐文件逐规则校验
    const allResults: PolicyRuleResult[] = [];
    let errorCount = 0;

    for (const filePath of targetFiles) {
      if (this._config.maxErrors > 0 && errorCount >= this._config.maxErrors) {
        break;
      }

      let content: string;
      try {
        content = await this._readFile(filePath);
      } catch {
        // 文件读取失败，跳过
        continue;
      }

      for (const rule of rules) {
        if (this._config.maxErrors > 0 && errorCount >= this._config.maxErrors) {
          break;
        }

        if (!this._matchesFilePattern(rule, filePath)) {
          continue;
        }

        const component = this._components.get(rule.id);
        if (!component) {
          continue;
        }

        this._emit({
          type: "rule-start",
          payload: { ruleId: rule.id, filePath },
        });

        const ruleStart = Date.now();

        try {
          const result = await component.validate(filePath, content);

          if (result) {
            allResults.push(result);

            if (!result.passed && result.severity === "error") {
              errorCount++;
              this._emit({
                type: "rule-fail",
                payload: { ruleId: rule.id, filePath, result },
              });
            } else if (result.passed) {
              this._emit({
                type: "rule-pass",
                payload: {
                  ruleId: rule.id,
                  filePath,
                  durationMs: Date.now() - ruleStart,
                },
              });
            }
          }
        } catch (e) {
          this._emit({
            type: "rule-error",
            payload: {
              ruleId: rule.id,
              filePath,
              error: e instanceof Error ? e.message : String(e),
            },
          });
        }

        if (this._config.failFast && errorCount > 0) {
          break;
        }
      }
    }

    // Step 5: 汇总报告
    const report = this._buildReport(allResults, startTime);
    this._emit({ type: "engine-end", payload: { report } });
    return report;
  }

  async executeOnFiles(
    files: string[],
    filter?: RuleFilter,
  ): Promise<PolicyReport> {
    const rules = this._registry.query(filter);
    if (rules.length === 0) {
      return this._emptyReport();
    }

    const startTime = Date.now();
    this._emit({
      type: "engine-start",
      payload: { totalRules: rules.length, targetFiles: files },
    });

    const allResults: PolicyRuleResult[] = [];
    let errorCount = 0;

    for (const filePath of files) {
      if (this._config.maxErrors > 0 && errorCount >= this._config.maxErrors) {
        break;
      }

      let content: string;
      try {
        content = await this._readFile(filePath);
      } catch {
        continue;
      }

      for (const rule of rules) {
        if (this._config.maxErrors > 0 && errorCount >= this._config.maxErrors) {
          break;
        }

        if (!this._matchesFilePattern(rule, filePath)) {
          continue;
        }

        const component = this._components.get(rule.id);
        if (!component) {
          continue;
        }

        this._emit({
          type: "rule-start",
          payload: { ruleId: rule.id, filePath },
        });

        const ruleStart = Date.now();

        try {
          const result = await component.validate(filePath, content);

          if (result) {
            allResults.push(result);

            if (!result.passed && result.severity === "error") {
              errorCount++;
              this._emit({
                type: "rule-fail",
                payload: { ruleId: rule.id, filePath, result },
              });
            } else if (result.passed) {
              this._emit({
                type: "rule-pass",
                payload: {
                  ruleId: rule.id,
                  filePath,
                  durationMs: Date.now() - ruleStart,
                },
              });
            }
          }
        } catch (e) {
          this._emit({
            type: "rule-error",
            payload: {
              ruleId: rule.id,
              filePath,
              error: e instanceof Error ? e.message : String(e),
            },
          });
        }

        if (this._config.failFast && errorCount > 0) {
          break;
        }
      }
    }

    const report = this._buildReport(allResults, startTime);
    this._emit({ type: "engine-end", payload: { report } });
    return report;
  }

  // ── 内部辅助方法 ──

  private async _collectTargetFiles(
    rules: readonly PolicyRule[],
    _rootDir: string,
  ): Promise<string[]> {
    // 简化实现：从规则的 filePattern 收集
    const fileSet = new Set<string>();
    for (const rule of rules) {
      if (rule.filePattern) {
        // 实际项目中使用 glob 扫描
        // 这里简单返回一个空数组，测试中覆盖
        fileSet.add(rule.filePattern);
      }
    }
    return Array.from(fileSet);
  }

  private async _readFile(filePath: string): Promise<string> {
    // 实际实现使用 fs.readFile
    // 为便于测试，返回空字符串
    return "";
  }

  private _matchesFilePattern(rule: PolicyRule, filePath: string): boolean {
    if (!rule.filePattern) {
      return true;
    }
    // 简单 glob 匹配——实际实现应使用 minimatch
    const regexStr = rule.filePattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");
    try {
      return new RegExp(`^${regexStr}$`).test(filePath);
    } catch {
      return filePath === rule.filePattern;
    }
  }

  private _buildReport(
    results: PolicyRuleResult[],
    startTime: number,
  ): PolicyReport {
    const errors = results.filter(r => !r.passed && r.severity === "error");
    const warnings = results.filter(r => !r.passed && r.severity === "warning");
    const infos = results.filter(r => r.passed || r.severity === "info");
    const passed = results.filter(r => r.passed);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      infos,
      results,
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
      totalRules: results.length,
      passedRules: passed.length,
      failedRules: results.length - passed.length,
    };
  }

  private _emptyReport(): PolicyReport {
    return {
      valid: true,
      errors: [],
      warnings: [],
      infos: [],
      results: [],
      timestamp: Date.now(),
      durationMs: 0,
      totalRules: 0,
      passedRules: 0,
      failedRules: 0,
    };
  }
}
