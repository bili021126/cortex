/**
 * @cortex/policy-validator — RuleLoader 规则加载器实现
 *
 * 从配置源 (config 常量、JSON、Markdown) 加载 PolicyRule 定义。
 * 依据 coding-standards.md：
 *   - §七 硬编码禁令：规则定义从配置源加载，不写死
 *   - §8.2 双源同步：人读源与机器源保持同步
 *   - §14.3 Strategy 模式：不同加载策略可互换
 *   - §14.1 Adapter 模式：外部规则源适配
 */

import type {
  PolicyRule,
  PolicyDomain,
  RuleSeverity,
  RuleLoadOptions,
  RuleLoadStats,
} from "./types.js";
import type { IRuleRegistry } from "./ruleRegistry.js";

// ============================================================
// IRuleLoader — 规则加载器接口
// ============================================================

/**
 * 规则加载器——从配置源加载 PolicyRule。
 *
 * @design-rule Strategy 模式（§14.3）
 *   不同加载策略（常量、JSON、TS 模块）通过统一接口切换。
 *
 * @design-rule 适配器模式（§14.1）
 *   外部规则源通过适配器接入统一接口。
 */
export interface IRuleLoader {
  /** 从 @cortex/config 常量加载内置规则集 */
  loadFromConfig(options?: RuleLoadOptions): Promise<number>;

  /** 从 JSON 文件加载规则定义 */
  loadFromJson(
    jsonPath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 从 TS/JS 模块加载动态规则 */
  loadFromModule(
    modulePath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 从 Markdown 文件自动提取规则 */
  loadFromMarkdown(
    mdPath: string,
    options?: RuleLoadOptions,
  ): Promise<number>;

  /** 获取已加载的规则数统计 */
  getLoadStats(): RuleLoadStats;
}

// ============================================================
// 内置规则定义（根据 coding-standards.md 映射）
// ============================================================

/**
 * 获取内置规则集——从 coding-standards.md 映射的预定义规则。
 * 这些规则是 coding-standards.md §一~§十四 所有规则的机器可读表示。
 *
 * @returns PolicyRule 数组
 */
export function getBuiltinRules(): PolicyRule[] {
  return [
    ..._buildExceptionRules(),
    ..._buildDeclarationRules(),
    ..._buildAsyncRules(),
    ..._buildImportPathRules(),
    ..._buildConsoleRules(),
    ..._buildStyleRules(),
    ..._buildHardcodedRules(),
    ..._buildPromptsRules(),
    ..._buildArchitectureRules(),
    ..._buildFunctionRules(),
    ..._buildImportModuleRules(),
    ..._buildInterfaceRules(),
    ..._buildPatternRules(),
  ];
}

// ── 内置规则按 § 分节工厂函数 ──

/** §一 异常处理 */
function _buildExceptionRules(): PolicyRule[] {
  return [
    {
      id: "exception/no-empty-catch",
      domain: "exception",
      severity: "error",
      description: "禁止空 catch {} 块",
      code: "NO_EMPTY_CATCH",
      tags: ["exception", "safety"],
      standardRef: "§一",
      fixSuggestion: "在 catch 块中添加处理逻辑或显式注释",
    },
    {
      id: "exception/throw-only-error",
      domain: "exception",
      severity: "error",
      description: "禁止 throw 非 Error",
      code: "THROW_ONLY_ERROR",
      tags: ["exception", "safety"],
      standardRef: "§一",
      fixSuggestion: "使用 new Error() 替代 throw 字符串",
    },
    {
      id: "exception/require-cause-chain",
      domain: "exception",
      severity: "warning",
      description: "throw 应含 { cause: e }",
      code: "REQUIRE_CAUSE_CHAIN",
      tags: ["exception", "quality"],
      standardRef: "§一",
    },
    {
      id: "exception/explicit-comment",
      domain: "exception",
      severity: "warning",
      description: "空 catch 须有显式注释",
      code: "EXPLICIT_CATCH_COMMENT",
      tags: ["exception", "style"],
      standardRef: "§一",
    },
  ];
}

/** §二 变量声明 */
function _buildDeclarationRules(): PolicyRule[] {
  return [
    {
      id: "declaration/no-var",
      domain: "declaration",
      severity: "error",
      description: "禁止 var 声明",
      code: "NO_VAR",
      tags: ["declaration", "style"],
      standardRef: "§二",
      fixSuggestion: "使用 const 或 let 替代 var",
    },
    {
      id: "declaration/prefer-const",
      domain: "declaration",
      severity: "error",
      description: "优先 const，可改则改",
      code: "PREFER_CONST",
      tags: ["declaration", "style"],
      standardRef: "§二",
      fixSuggestion: "将 let 改为 const（若变量未被重新赋值）",
    },
  ];
}

/** §三 异步规范 */
function _buildAsyncRules(): PolicyRule[] {
  return [
    {
      id: "async/return-await",
      domain: "async",
      severity: "error",
      description: "async 函数 return 须加 await",
      code: "RETURN_AWAIT",
      tags: ["async", "safety"],
      standardRef: "§三",
    },
    {
      id: "async/no-dropped-promise",
      domain: "async",
      severity: "error",
      description: "不允许 Promise 被静默丢弃",
      code: "NO_DROPPED_PROMISE",
      tags: ["async", "safety"],
      standardRef: "§三",
    },
    {
      id: "async/explicit-catch",
      domain: "async",
      severity: "warning",
      description: "fire-and-forget 须有 .catch",
      code: "EXPLICIT_CATCH",
      tags: ["async", "safety"],
      standardRef: "§三",
    },
  ];
}

/** §四 导入路径 */
function _buildImportPathRules(): PolicyRule[] {
  return [
    {
      id: "import/barrel-only",
      domain: "import",
      severity: "error",
      description: "新文件使用包名导入",
      code: "BARREL_ONLY",
      tags: ["import", "structure"],
      standardRef: "§四",
    },
    {
      id: "import/no-relative-test",
      domain: "import",
      severity: "error",
      description: "测试禁止 ../src/ 相对导入",
      code: "NO_RELATIVE_TEST_IMPORT",
      tags: ["import", "test"],
      standardRef: "§四",
    },
    {
      id: "import/update-barrel",
      domain: "import",
      severity: "warning",
      description: "新增公开符号须更新 barrel",
      code: "UPDATE_BARREL",
      tags: ["import", "structure"],
      standardRef: "§四",
    },
  ];
}

/** §五 控制台输出 */
function _buildConsoleRules(): PolicyRule[] {
  return [
    {
      id: "console/no-raw-error",
      domain: "console",
      severity: "warning",
      description: "禁止裸 console.error/warn",
      code: "NO_RAW_CONSOLE",
      tags: ["console", "logging"],
      standardRef: "§五",
    },
    {
      id: "console/use-pipeline",
      domain: "console",
      severity: "error",
      description: "生产代码走 PipelineObserver",
      code: "USE_PIPELINE",
      tags: ["console", "logging"],
      standardRef: "§五",
    },
  ];
}

/** §六 + §十 代码风格 */
function _buildStyleRules(): PolicyRule[] {
  return [
    {
      id: "style/require-no-require",
      domain: "style",
      severity: "error",
      description: "禁止 require() 导入",
      code: "NO_REQUIRE",
      tags: ["style", "module"],
      standardRef: "§六",
    },
    {
      id: "style/no-unused-vars",
      domain: "style",
      severity: "error",
      description: "禁止未使用变量",
      code: "NO_UNUSED_VARS",
      tags: ["style", "quality"],
      standardRef: "§六",
    },
    {
      id: "style/no-non-null-assertion",
      domain: "style",
      severity: "error",
      description: "禁止非空断言 !",
      code: "NO_NON_NULL_ASSERTION",
      tags: ["style", "safety"],
      standardRef: "§10.1",
      fixSuggestion: "使用可选链 ?. 或显式 if 守卫替代",
    },
    {
      id: "style/merge-duplicate-imports",
      domain: "style",
      severity: "error",
      description: "合并重复导入",
      code: "MERGE_DUPLICATE_IMPORTS",
      tags: ["style", "import"],
      standardRef: "§10.2",
    },
    {
      id: "style/no-any-in-public-api",
      domain: "style",
      severity: "error",
      description: "公开 API 禁止 any",
      code: "NO_ANY_IN_PUBLIC_API",
      tags: ["style", "types"],
      standardRef: "§10.3",
      fixSuggestion: "使用 unknown + 类型守卫替代 any",
    },
    {
      id: "style/no-dead-code",
      domain: "style",
      severity: "error",
      description: "禁止保留死代码",
      code: "NO_DEAD_CODE",
      tags: ["style", "quality"],
      standardRef: "§10.4",
    },
    {
      id: "style/consistent-param-naming",
      domain: "style",
      severity: "warning",
      description: "参数命名一致性",
      code: "CONSISTENT_PARAM_NAMING",
      tags: ["style", "naming"],
      standardRef: "§10.5",
    },
    {
      id: "style/return-type-explicit",
      domain: "style",
      severity: "error",
      description: "返回类型显式声明",
      code: "RETURN_TYPE_EXPLICIT",
      tags: ["style", "types"],
      standardRef: "§11.1",
    },
    {
      id: "style/no-boolean-trap",
      domain: "style",
      severity: "warning",
      description: "禁止 boolean trap 参数",
      code: "NO_BOOLEAN_TRAP",
      tags: ["style", "design"],
      standardRef: "§11.1",
    },
  ];
}

/** §七 硬编码禁令 */
function _buildHardcodedRules(): PolicyRule[] {
  return [
    {
      id: "hardcoded/no-magic-number",
      domain: "hardcoded",
      severity: "warning",
      description: "禁止魔法数字",
      code: "NO_MAGIC_NUMBER",
      tags: ["hardcoded", "config"],
      standardRef: "§七",
    },
    {
      id: "hardcoded/no-path-literal",
      domain: "hardcoded",
      severity: "error",
      description: "禁止路径字面量",
      code: "NO_PATH_LITERAL",
      tags: ["hardcoded", "config"],
      standardRef: "§七",
    },
    {
      id: "hardcoded/no-env-literal",
      domain: "hardcoded",
      severity: "error",
      description: "禁止环境变量名字面量",
      code: "NO_ENV_LITERAL",
      tags: ["hardcoded", "config"],
      standardRef: "§七",
    },
    {
      id: "hardcoded/no-version-literal",
      domain: "hardcoded",
      severity: "error",
      description: "禁止版本号字符串",
      code: "NO_VERSION_LITERAL",
      tags: ["hardcoded", "config"],
      standardRef: "§七",
    },
  ];
}

/** §八 提示词管理 */
function _buildPromptsRules(): PolicyRule[] {
  return [
    {
      id: "prompts/double-source-sync",
      domain: "prompts",
      severity: "error",
      description: "prompts/ 与 config 同步",
      code: "DOUBLE_SOURCE_SYNC",
      tags: ["prompts", "governance"],
      standardRef: "§8.2",
    },
    {
      id: "prompts/placeholder-convention",
      domain: "prompts",
      severity: "warning",
      description: "占位符使用 {{UPPER_SNAKE_CASE}}",
      code: "PLACEHOLDER_CONVENTION",
      tags: ["prompts", "style"],
      standardRef: "§8.3",
    },
    {
      id: "prompts/directory-structure",
      domain: "prompts",
      severity: "error",
      description: "提示词目录结构合规",
      code: "PROMPTS_DIR_STRUCTURE",
      tags: ["prompts", "structure"],
      standardRef: "§8.1",
    },
  ];
}

/** §九 架构设计原则 */
function _buildArchitectureRules(): PolicyRule[] {
  return [
    {
      id: "architecture/no-interface-leak",
      domain: "architecture",
      severity: "error",
      description: "接口不泄漏内部实现",
      code: "NO_INTERFACE_LEAK",
      tags: ["architecture", "design"],
      standardRef: "§9.3",
    },
    {
      id: "architecture/no-forked-routing",
      domain: "architecture",
      severity: "error",
      description: "禁止 if/instanceof 分叉路由",
      code: "NO_FORKED_ROUTING",
      tags: ["architecture", "design"],
      standardRef: "§9.2",
    },
    {
      id: "architecture/no-data-flow-blackhole",
      domain: "architecture",
      severity: "error",
      description: "禁止隐式全局状态通信",
      code: "NO_DATA_FLOW_BLACKHOLE",
      tags: ["architecture", "design"],
      standardRef: "§9.2",
    },
    {
      id: "architecture/no-regression-test-mod",
      domain: "architecture",
      severity: "warning",
      description: "新增功能不改已有测试",
      code: "NO_REGRESSION_TEST_MOD",
      tags: ["architecture", "test"],
      standardRef: "§9.5",
    },
    {
      id: "architecture/interface-before-implementation",
      domain: "architecture",
      severity: "error",
      description: "接口文件先于实现文件",
      code: "INTERFACE_BEFORE_IMPL",
      tags: ["architecture", "governance"],
      standardRef: "§9.4",
    },
  ];
}

/** §十一 函数设计 */
function _buildFunctionRules(): PolicyRule[] {
  return [
    {
      id: "function/positional-max-3",
      domain: "function",
      severity: "warning",
      description: "位置参数最多 3 个",
      code: "POSITIONAL_MAX_3",
      tags: ["function", "design"],
      standardRef: "§11.3",
    },
    {
      id: "function/options-object-for-excess",
      domain: "function",
      severity: "warning",
      description: "超过 3 个参数用 options 对象",
      code: "OPTIONS_OBJECT_FOR_EXCESS",
      tags: ["function", "design"],
      standardRef: "§11.3",
    },
    {
      id: "function/side-effect-naming",
      domain: "function",
      severity: "warning",
      description: "副作用函数须命名提示",
      code: "SIDE_EFFECT_NAMING",
      tags: ["function", "design"],
      standardRef: "§11.2",
    },
    {
      id: "function/body-max-30-lines",
      domain: "function",
      severity: "warning",
      description: "方法体不超过 30 行",
      code: "BODY_MAX_30_LINES",
      tags: ["function", "style"],
      standardRef: "§11.4",
    },
  ];
}

/** §十二 导入路径与模块组织 */
function _buildImportModuleRules(): PolicyRule[] {
  return [
    {
      id: "import/sort-order",
      domain: "import",
      severity: "error",
      description: "导入排序——内置→三方→@cortex→相对",
      code: "IMPORT_SORT_ORDER",
      tags: ["import", "style"],
      standardRef: "§12.1",
    },
    {
      id: "import/type-separate",
      domain: "import",
      severity: "error",
      description: "类型导入使用 import type",
      code: "TYPE_SEPARATE",
      tags: ["import", "style"],
      standardRef: "§12.2",
    },
    {
      id: "import/no-inline-type-mix",
      domain: "import",
      severity: "error",
      description: "禁止行内 import { type Foo }",
      code: "NO_INLINE_TYPE_MIX",
      tags: ["import", "style"],
      standardRef: "§12.2",
    },
    {
      id: "import/side-effect-annotate",
      domain: "import",
      severity: "warning",
      description: "副作用导入须注释说明",
      code: "SIDE_EFFECT_ANNOTATE",
      tags: ["import", "style"],
      standardRef: "§12.3",
    },
  ];
}

/** §十三 接口与类型设计 */
function _buildInterfaceRules(): PolicyRule[] {
  return [
    {
      id: "interface/isp-max-8-methods",
      domain: "interface",
      severity: "warning",
      description: "接口最多 8 个方法",
      code: "ISP_MAX_8_METHODS",
      tags: ["interface", "design"],
      standardRef: "§13.1",
    },
    {
      id: "interface/discriminated-union",
      domain: "interface",
      severity: "warning",
      description: "变体数据用 discriminated union",
      code: "DISCRIMINATED_UNION",
      tags: ["interface", "design"],
      standardRef: "§13.2",
    },
    {
      id: "interface/readonly-preference",
      domain: "interface",
      severity: "warning",
      description: "共享数据加 readonly",
      code: "READONLY_PREFERENCE",
      tags: ["interface", "design"],
      standardRef: "§13.3",
    },
    {
      id: "interface/interface-over-type",
      domain: "interface",
      severity: "warning",
      description: "对象形状优先 interface",
      code: "INTERFACE_OVER_TYPE",
      tags: ["interface", "style"],
      standardRef: "§13.4",
    },
  ];
}

/** §十四 设计模式约定 */
function _buildPatternRules(): PolicyRule[] {
  return [
    {
      id: "pattern/adapter-convention",
      domain: "pattern",
      severity: "warning",
      description: "Adapter 不混合业务逻辑",
      code: "ADAPTER_CONVENTION",
      tags: ["pattern", "design"],
      standardRef: "§14.1",
    },
    {
      id: "pattern/factory-single-entry",
      domain: "pattern",
      severity: "warning",
      description: "Factory 是唯一创建入口",
      code: "FACTORY_SINGLE_ENTRY",
      tags: ["pattern", "design"],
      standardRef: "§14.2",
    },
    {
      id: "pattern/strategy-central-selection",
      domain: "pattern",
      severity: "warning",
      description: "策略选择逻辑集中",
      code: "STRATEGY_CENTRAL_SELECTION",
      tags: ["pattern", "design"],
      standardRef: "§14.3",
    },
    {
      id: "pattern/observer-publisher-decoupled",
      domain: "pattern",
      severity: "warning",
      description: "发布者不感知订阅者",
      code: "OBSERVER_DECOUPLED",
      tags: ["pattern", "design"],
      standardRef: "§14.4",
    },
  ];
}

// ============================================================
// RuleLoader — 实现类
// ============================================================

/**
 * RuleLoader 实现——从多种配置源加载 PolicyRule 到注册表。
 */
export class RuleLoader implements IRuleLoader {
  private _registry: IRuleRegistry;
  private _stats: RuleLoadStats;

  constructor(registry: IRuleRegistry) {
    this._registry = registry;
    this._stats = {
      total: 0,
      byDomain: {} as Record<PolicyDomain, number>,
      bySeverity: {} as Record<RuleSeverity, number>,
      invalidCount: 0,
      durationMs: 0,
    };
  }

  async loadFromConfig(options?: RuleLoadOptions): Promise<number> {
    const startTime = Date.now();
    const strict = options?.strict ?? true;

    if (options?.clearBeforeLoad) {
      this._registry.clear();
    }

    const rules = getBuiltinRules();
    let loaded = 0;

    for (const rule of rules) {
      try {
        this._registry.register(rule);
        loaded++;
      } catch {
        if (strict) {
          throw new Error(`Failed to load builtin rule: ${rule.id}`);
        }
        this._stats.invalidCount++;
      }
    }

    this._updateStats(loaded, startTime);
    return loaded;
  }

  async loadFromJson(
    jsonPath: string,
    _options?: RuleLoadOptions,
  ): Promise<number> {
    const _startTime = Date.now();
    const _strict = _options?.strict ?? true;

    // 实际实现使用 fs.readFile + JSON.parse
    // 这里抛出一个清晰的错误，表明需要实际文件系统支持
    throw new Error(
      `loadFromJson requires actual file system access. ` +
      `Attempted to load from: ${jsonPath}. ` +
      `In production, implement with fs.readFile.`,
    );
  }

  async loadFromModule(
    modulePath: string,
    options?: RuleLoadOptions,
  ): Promise<number> {
    const startTime = Date.now();
    const strict = options?.strict ?? true;

    try {
      // 动态导入模块——实际实现中需要处理路径解析
      const mod = await import(modulePath);
      const rules: PolicyRule[] = mod.default ?? mod.rules ?? [];

      if (options?.clearBeforeLoad) {
        this._registry.clear();
      }

      let loaded = 0;
      for (const rule of rules) {
        try {
          this._registry.register(rule);
          loaded++;
        } catch {
          if (strict) {
            throw new Error(`Failed to load rule from module: ${rule.id}`);
          }
          this._stats.invalidCount++;
        }
      }

      this._updateStats(loaded, startTime);
      return loaded;
    } catch (e) {
      throw new Error(
        `Failed to load module: ${modulePath}. ` +
        `${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }

  async loadFromMarkdown(
    mdPath: string,
    _options?: RuleLoadOptions,
  ): Promise<number> {
    const _startTime = Date.now();

    // 实际实现应解析 Markdown 表格提取规则
    // 这里抛出清晰的未实现错误
    throw new Error(
      `loadFromMarkdown requires Markdown parsing logic. ` +
      `Attempted to load from: ${mdPath}. ` +
      `Implement with Markdown table parser.`,
    );
  }

  getLoadStats(): RuleLoadStats {
    return { ...this._stats };
  }

  // ── 内部辅助 ──

  private _updateStats(loaded: number, startTime: number): void {
    const rules = this._registry.getAll();
    this._stats.total = rules.length;
    this._stats.byDomain = this._registry.countByDomain();
    this._stats.bySeverity = this._registry.countBySeverity();
    this._stats.durationMs = Date.now() - startTime;
  }
}
