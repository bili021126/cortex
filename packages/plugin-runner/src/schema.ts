/**
 * @cortex/plugin-runner — PluginSchema 校验 Schema 定义模块
 *
 * 提供手写 validator 的插件类型校验 schema 系统。
 * 无外部校验库依赖（零依赖策略），纯函数式设计。
 *
 * # 设计理念
 *
 * 本模块提供两层 API：
 *
 * ## 第一层：类型校验原语（Validator Primitives）
 *
 * 基础校验函数组合子，类似 zod 的轻量替代品：
 *
 * ```ts
 * import { s } from "./schema.js";
 *
 * const NameSchema = s.object({
 *   first: s.string().min(1).max(50),
 *   last: s.string().min(1).max(50),
 * });
 *
 * const errors = NameSchema.validate({ first: "John" });
 * // → ["last: 必填"]
 * ```
 *
 * ## 第二层：PluginSchema 定义助手
 *
 * 将校验原语组合成完整的 PluginSchema：
 *
 * ```ts
 * import { definePluginSchema, s } from "./schema.js";
 *
 * const MyPluginSchema = definePluginSchema("my-plugin", {
 *   config: s.object({
 *     apiKey: s.string().required(),
 *     timeout: s.number().min(1000).max(60000).optional(),
 *   }),
 *   input: s.object({
 *     prompt: s.string().min(1),
 *   }),
 *   output: s.object({
 *     result: s.string(),
 *   }),
 * });
 * ```
 *
 * @module
 */

import type { PluginSchema } from "./types.js";

// ════════════════════════════════════════════════════════════════
// 第一层：类型校验原语
// ════════════════════════════════════════════════════════════════

/**
 * 校验结果类型 —— 校验函数返回的错误列表。
 * 空数组 = 校验通过。
 */
export type ValidationErrors = string[];

/**
 * TypeValidator<T> —— 类型校验器接口。
 *
 * 每个校验原语（string、number、boolean 等）返回此接口的实例。
 * 支持链式调用（.required()、.min()、.max() 等）。
 *
 * @template T — 校验通过后的类型。
 */
export interface TypeValidator<T = unknown> {
  /**
   * 校验一个值，返回错误列表。
   * 空数组 = 校验通过，值应符合类型 T。
   *
   * @param value — 待校验的值
   * @param path — 当前路径前缀（用于嵌套错误信息）
   * @returns 错误信息数组
   */
  validate(value: unknown, path?: string): ValidationErrors;

  /**
   * 将当前校验器标记为可选。
   * 可选字段允许 undefined 和 null（但不允许缺失 key）。
   */
  optional(): TypeValidator<T | undefined>;

  /**
   * 将当前校验器标记为可空。
   * 可空字段允许 null。
   */
  nullable(): TypeValidator<T | null>;

  /**
   * 给校验器附加描述信息（用于错误消息和文档生成）。
   */
  describe(description: string): TypeValidator<T>;
}

// ── 内部辅助 ──

/**
 * 创建一个校验器实例。
 *
 * @param validateFn — 核心校验函数
 * @returns TypeValidator
 */
function createValidator<T>(
  validateFn: (value: unknown, path: string) => ValidationErrors,
  options?: { optional?: boolean; nullable?: boolean; description?: string },
): TypeValidator<T> {
  const validator: TypeValidator<T> = {
    validate(value: unknown, path = ""): ValidationErrors {
      // 处理空值
      if (value === undefined) {
        if (options?.optional) return [];
        return [`${path}: 必填`];
      }
      if (value === null) {
        if (options?.nullable) return [];
        return [`${path}: 不能为 null`];
      }

      return validateFn(value, path);
    },

    optional(): TypeValidator<T | undefined> {
      return createValidator<T | undefined>(validateFn, {
        ...options,
        optional: true,
      });
    },

    nullable(): TypeValidator<T | null> {
      return createValidator<T | null>(validateFn, {
        ...options,
        nullable: true,
      });
    },

    describe(description: string): TypeValidator<T> {
      return createValidator<T>(validateFn, { ...options, description });
    },
  };

  return validator;
}

/**
 * 给错误列表添加路径前缀。
 */
function prefixPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * 生成 "期望 X，实际得到 Y" 的错误信息。
 */
function typeError(path: string, expected: string, actual: string): string {
  return `${path}: 期望 ${expected}，实际得到 ${actual}`;
}

/**
 * 获取值的实际类型描述。
 */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// ── 基础校验原语 ──

// 导出命名空间 s，方便使用
export const s = {
  // ═══════════════════════════════════════════════════════════
  // string
  // ═══════════════════════════════════════════════════════════

  /**
   * 字符串校验器。
   *
   * ```ts
   * s.string().validate("hello")        // → []
   * s.string().validate(123)            // → ["期望 string，实际得到 number"]
   * s.string().min(2).max(5).validate("a") // → ["长度不能小于 2"]
   * ```
   */
  string: (): StringValidator => new StringValidator(),

  // ═══════════════════════════════════════════════════════════
  // number
  // ═══════════════════════════════════════════════════════════

  /**
   * 数字校验器。
   *
   * ```ts
   * s.number().validate(42)             // → []
   * s.number().validate("42")           // → ["期望 number，实际得到 string"]
   * s.number().min(0).max(100)          // → 范围限制
   * ```
   */
  number: (): NumberValidator => new NumberValidator(),

  // ═══════════════════════════════════════════════════════════
  // boolean
  // ═══════════════════════════════════════════════════════════

  /**
   * 布尔值校验器。
   *
   * ```ts
   * s.boolean().validate(true)          // → []
   * s.boolean().validate(0)             // → ["期望 boolean，实际得到 number"]
   * ```
   */
  boolean: (): BooleanValidator => new BooleanValidator(),

  // ═══════════════════════════════════════════════════════════
  // object
  // ═══════════════════════════════════════════════════════════

  /**
   * 对象校验器。
   *
   * ```ts
   * const UserSchema = s.object({
   *   name: s.string().required(),
   *   age: s.number().optional(),
   * });
   *
   * UserSchema.validate({ name: "Alice" })          // → []
   * UserSchema.validate({})                          // → ["name: 必填"]
   * UserSchema.validate({ name: "Alice", age: "?" }) // → ["age: 期望 number，实际得到 string"]
   * ```
   */
  object: <T extends Record<string, TypeValidator>>(
    shape: T,
  ): ObjectValidator<T> => new ObjectValidator<T>(shape),

  // ═══════════════════════════════════════════════════════════
  // array
  // ═══════════════════════════════════════════════════════════

  /**
   * 数组校验器。
   *
   * ```ts
   * s.array(s.string()).validate(["a", "b"])  // → []
   * s.array(s.string()).validate("not array") // → ["期望 array，实际得到 string"]
   * s.array(s.number()).validate([1, "x"])    // → ["[1]: 期望 number，实际得到 string"]
   * ```
   */
  array: <T>(itemValidator: TypeValidator<T>): ArrayValidator<T> =>
    new ArrayValidator<T>(itemValidator),

  // ═══════════════════════════════════════════════════════════
  // literal
  // ═══════════════════════════════════════════════════════════

  /**
   * 字面量校验器 —— 值必须严格等于给定值。
   *
   * ```ts
   * s.literal("strict").validate("strict")  // → []
   * s.literal("strict").validate("loose")   // → ["期望 'strict'，实际得到 'loose'"]
   * ```
   */
  literal: <T extends string | number | boolean | null>(
    value: T,
  ): TypeValidator<T> =>
    createValidator<T>((v, path) => {
      if (v !== value) {
        return [typeError(path, `'${String(value)}'`, String(v))];
      }
      return [];
    }),

  // ═══════════════════════════════════════════════════════════
  // union (枚举/联合)
  // ═══════════════════════════════════════════════════════════

  /**
   * 联合校验器 —— 值需满足至少一个子校验器。
   *
   * ```ts
   * s.union(s.string(), s.number()).validate(42)   // → []
   * s.union(s.string(), s.number()).validate(true) // → ["不匹配任何联合成员"]
   * ```
   */
  union: <T>(...validators: TypeValidator<T>[]): TypeValidator<T> =>
    createValidator<T>((v, path) => {
      const allErrors: ValidationErrors = [];
      let allFailed = true;

      for (const validator of validators) {
        const errors = validator.validate(v, path);
        if (errors.length === 0) {
          allFailed = false;
          break;
        }
        allErrors.push(...errors);
      }

      if (allFailed) {
        return [`${path}: 不匹配任何联合成员 — ${allErrors.join("; ")}`];
      }
      return [];
    }),

  // ═══════════════════════════════════════════════════════════
  // enum (字符串枚举快捷方式)
  // ═══════════════════════════════════════════════════════════

  /**
   * 枚举校验器 —— 值必须在给定列表中。
   *
   * ```ts
   * s.enum(["low", "medium", "high"]).validate("low")     // → []
   * s.enum(["low", "medium", "high"]).validate("urgent") // → ["必须为以下值之一: low, medium, high"]
   * ```
   */
  enum: <T extends string>(values: readonly T[]): TypeValidator<T> =>
    createValidator<T>((v, path) => {
      if (!values.includes(v as T)) {
        return [
          `${path}: 必须为以下值之一: ${values.join(", ")}，实际得到 ${String(v)}`,
        ];
      }
      return [];
    }),

  // ═══════════════════════════════════════════════════════════
  // any
  // ═══════════════════════════════════════════════════════════

  /**
   * 任意值校验器 —— 始终通过。
   * 用于宽松校验或尚未定义具体 schema 的字段。
   */
  any: <T = unknown>(): TypeValidator<T> =>
    createValidator<T>((_v, _path) => []),

  // ═══════════════════════════════════════════════════════════
  // record (字典)
  // ═══════════════════════════════════════════════════════════

  /**
   * 字典校验器 —— 所有值需满足指定类型。
   *
   * ```ts
   * s.record(s.number()).validate({ a: 1, b: 2 })      // → []
   * s.record(s.number()).validate({ a: "x" })           // → ["a: 期望 number，实际得到 string"]
   * ```
   */
  record: <T>(valueValidator: TypeValidator<T>): TypeValidator<Record<string, T>> =>
    createValidator<Record<string, T>>((v, path) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return [typeError(path, "Record", typeOf(v))];
      }

      const errors: ValidationErrors = [];
      const obj = v as Record<string, unknown>;

      for (const [key, val] of Object.entries(obj)) {
        const keyPath = prefixPath(path, key);
        errors.push(...valueValidator.validate(val, keyPath));
      }

      return errors;
    }),
};

// ════════════════════════════════════════════════════════════════
// 校验器实现类
// ════════════════════════════════════════════════════════════════

/**
 * StringValidator —— 字符串校验器。
 */
export class StringValidator implements TypeValidator<string> {
  private _minLength?: number;
  private _maxLength?: number;
  private _pattern?: RegExp;
  private _patternMessage?: string;
  private _optional = false;
  private _nullable = false;
  private _trimmed = false;
  private _description?: string;

  /** @internal */
  validate(value: unknown, path = ""): ValidationErrors {
    if (value === undefined) {
      return this._optional ? [] : [`${path}: 必填`];
    }
    if (value === null) {
      return this._nullable ? [] : [`${path}: 不能为 null`];
    }

    if (typeof value !== "string") {
      return [typeError(path, "string", typeOf(value))];
    }

    const str = this._trimmed ? value.trim() : value;

    const errors: ValidationErrors = [];

    if (this._minLength !== undefined && str.length < this._minLength) {
      errors.push(`${path}: 长度不能小于 ${this._minLength}（当前 ${str.length}）`);
    }

    if (this._maxLength !== undefined && str.length > this._maxLength) {
      errors.push(`${path}: 长度不能大于 ${this._maxLength}（当前 ${str.length}）`);
    }

    if (this._pattern && !this._pattern.test(str)) {
      errors.push(`${path}: ${this._patternMessage ?? `不匹配模式 ${this._pattern}`}`);
    }

    return errors;
  }

  // ── 链式约束 ──

  /** 设置最小长度。 */
  min(len: number): this {
    this._minLength = len;
    return this;
  }

  /** 设置最大长度。 */
  max(len: number): this {
    this._maxLength = len;
    return this;
  }

  /** 设置正则模式匹配。 */
  pattern(regex: RegExp, message?: string): this {
    this._pattern = regex;
    this._patternMessage = message;
    return this;
  }

  /** 标记为必填（默认行为，显式声明）。 */
  required(): this {
    this._optional = false;
    return this;
  }

  /** 标记为可选。 */
  optional(): this {
    this._optional = true;
    return this;
  }

  /** 标记为可空。 */
  nullable(): this {
    this._nullable = true;
    return this;
  }

  /** 添加描述。 */
  describe(description: string): this {
    this._description = description;
    return this;
  }

  /** 获取描述。 */
  getDescription(): string | undefined {
    return this._description;
  }

  // ── 语义快捷方式 ──

  /** 匹配 email 格式。 */
  email(): this {
    return this.pattern(
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      "格式必须为有效 email 地址",
    );
  }

  /** 匹配 URL 格式。 */
  url(): this {
    return this.pattern(
      /^(https?:\/\/)?[\w-]+(\.[\w-]+)+[/#?]?.*$/,
      "格式必须为有效 URL",
    );
  }

  /** 匹配 UUID v4 格式。 */
  uuid(): this {
    return this.pattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "格式必须为有效 UUID v4",
    );
  }

  /** 非空字符串（长度 ≥ 1）。 */
  nonEmpty(): this {
    return this.min(1);
  }

  /** 去除首尾空白后校验。 */
  trimmed(): this {
    this._trimmed = true;
    return this;
  }
}

/**
 * NumberValidator —— 数字校验器。
 */
export class NumberValidator implements TypeValidator<number> {
  private _min?: number;
  private _max?: number;
  private _integer = false;
  private _positive = false;
  private _optional = false;
  private _nullable = false;
  private _description?: string;

  /** @internal */
  validate(value: unknown, path = ""): ValidationErrors {
    if (value === undefined) {
      return this._optional ? [] : [`${path}: 必填`];
    }
    if (value === null) {
      return this._nullable ? [] : [`${path}: 不能为 null`];
    }

    if (typeof value !== "number" || Number.isNaN(value)) {
      return [typeError(path, "number", typeOf(value))];
    }

    const errors: ValidationErrors = [];

    if (this._integer && !Number.isInteger(value)) {
      errors.push(`${path}: 必须为整数（当前 ${value}）`);
    }

    if (this._positive && value <= 0) {
      errors.push(`${path}: 必须为正数（当前 ${value}）`);
    }

    if (this._min !== undefined && value < this._min) {
      errors.push(`${path}: 不能小于 ${this._min}（当前 ${value}）`);
    }

    if (this._max !== undefined && value > this._max) {
      errors.push(`${path}: 不能大于 ${this._max}（当前 ${value}）`);
    }

    return errors;
  }

  // ── 链式约束 ──

  /** 设置最小值（包含）。 */
  min(n: number): this {
    this._min = n;
    return this;
  }

  /** 设置最大值（包含）。 */
  max(n: number): this {
    this._max = n;
    return this;
  }

  /** 限制为整数。 */
  integer(): this {
    this._integer = true;
    return this;
  }

  /** 限制为正数 (> 0)。 */
  positive(): this {
    this._positive = true;
    return this;
  }

  /** 标记为必填。 */
  required(): this {
    this._optional = false;
    return this;
  }

  /** 标记为可选。 */
  optional(): this {
    this._optional = true;
    return this;
  }

  /** 标记为可空。 */
  nullable(): this {
    this._nullable = true;
    return this;
  }

  /** 添加描述。 */
  describe(description: string): this {
    this._description = description;
    return this;
  }

  /** 获取描述。 */
  getDescription(): string | undefined {
    return this._description;
  }
}

/**
 * BooleanValidator —— 布尔值校验器。
 */
export class BooleanValidator implements TypeValidator<boolean> {
  private _optional = false;
  private _nullable = false;
  private _description?: string;

  /** @internal */
  validate(value: unknown, path = ""): ValidationErrors {
    if (value === undefined) {
      return this._optional ? [] : [`${path}: 必填`];
    }
    if (value === null) {
      return this._nullable ? [] : [`${path}: 不能为 null`];
    }

    if (typeof value !== "boolean") {
      return [typeError(path, "boolean", typeOf(value))];
    }

    return [];
  }

  /** 标记为必填。 */
  required(): this {
    this._optional = false;
    return this;
  }

  /** 标记为可选。 */
  optional(): this {
    this._optional = true;
    return this;
  }

  /** 标记为可空。 */
  nullable(): this {
    this._nullable = true;
    return this;
  }

  /** 添加描述。 */
  describe(description: string): this {
    this._description = description;
    return this;
  }
}

/**
 * ObjectValidator<T> —— 对象校验器。
 */
export class ObjectValidator<T extends Record<string, TypeValidator>> {
  /** shape 的类型映射 */
  private _shape: T;
  private _strict = false;
  private _optional = false;
  private _nullable = false;
  private _description?: string;
  private _passthrough = false;

  constructor(shape: T) {
    this._shape = shape;
  }

  /** @internal */
  validate(value: unknown, path = ""): ValidationErrors {
    if (value === undefined) {
      return this._optional ? [] : [`${path}: 必填`];
    }
    if (value === null) {
      return this._nullable ? [] : [`${path}: 不能为 null`];
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return [typeError(path, "object", typeOf(value))];
    }

    const obj = value as Record<string, unknown>;
    const errors: ValidationErrors = [];

    // 校验 shape 中定义的每个字段
    for (const [key, validator] of Object.entries(this._shape)) {
      const keyPath = prefixPath(path, key);
      errors.push(...validator.validate(obj[key], keyPath));
    }

    // 严格模式：不允许未在 shape 中定义的字段
    if (this._strict && !this._passthrough) {
      const allowedKeys = new Set(Object.keys(this._shape));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push(`${prefixPath(path, key)}: 未知字段`);
        }
      }
    }

    return errors;
  }

  // ── 链式约束 ──

  /** 启用严格模式（不允许未定义的额外字段）。 */
  strict(): this {
    this._strict = true;
    this._passthrough = false;
    return this;
  }

  /** 允许额外字段（默认行为）。 */
  passthrough(): this {
    this._passthrough = true;
    return this;
  }

  /** 标记整个对象为可选。 */
  optional(): this {
    this._optional = true;
    return this;
  }

  /** 标记整个对象为可空。 */
  nullable(): this {
    this._nullable = true;
    return this;
  }

  /** 添加描述。 */
  describe(description: string): this {
    this._description = description;
    return this;
  }

  /**
   * 扩展现有 shape，返回新的 ObjectValidator。
   *
   * ```ts
   * const Base = s.object({ name: s.string() });
   * const Extended = Base.extend({ age: s.number() });
   * ```
   */
  extend<U extends Record<string, TypeValidator>>(
    extension: U,
  ): ObjectValidator<T & U> {
    const combinedShape = { ...this._shape, ...extension } as T & U;
    const extended = new ObjectValidator<T & U>(combinedShape);
    extended._strict = this._strict;
    extended._passthrough = this._passthrough;
    return extended;
  }

  /**
   * 从对象中选取部分字段。
   */
  pick<K extends keyof T>(keys: K[]): ObjectValidator<Pick<T, K>> {
    const pickedShape = {} as Pick<T, K>;
    for (const key of keys) {
      pickedShape[key] = this._shape[key];
    }
    const picked = new ObjectValidator<Pick<T, K>>(pickedShape);
    picked._strict = this._strict;
    picked._passthrough = this._passthrough;
    return picked;
  }

  /**
   * 从对象中排除部分字段。
   */
  omit<K extends keyof T>(keys: K[]): ObjectValidator<Omit<T, K>> {
    const omittedShape = {} as Omit<T, K>;
    for (const [key, validator] of Object.entries(this._shape)) {
      if (!(keys as string[]).includes(key)) {
        (omittedShape as Record<string, TypeValidator>)[key] = validator;
      }
    }
    const omitted = new ObjectValidator<Omit<T, K>>(omittedShape);
    omitted._strict = this._strict;
    omitted._passthrough = this._passthrough;
    return omitted;
  }
}

/**
 * ArrayValidator<T> —— 数组校验器。
 */
export class ArrayValidator<T> implements TypeValidator<T[]> {
  private _itemValidator: TypeValidator<T>;
  private _minLength?: number;
  private _maxLength?: number;
  private _optional = false;
  private _nullable = false;
  private _description?: string;

  constructor(itemValidator: TypeValidator<T>) {
    this._itemValidator = itemValidator;
  }

  /** @internal */
  validate(value: unknown, path = ""): ValidationErrors {
    if (value === undefined) {
      return this._optional ? [] : [`${path}: 必填`];
    }
    if (value === null) {
      return this._nullable ? [] : [`${path}: 不能为 null`];
    }

    if (!Array.isArray(value)) {
      return [typeError(path, "array", typeOf(value))];
    }

    const errors: ValidationErrors = [];

    if (this._minLength !== undefined && value.length < this._minLength) {
      errors.push(`${path}: 长度不能小于 ${this._minLength}（当前 ${value.length}）`);
    }

    if (this._maxLength !== undefined && value.length > this._maxLength) {
      errors.push(`${path}: 长度不能大于 ${this._maxLength}（当前 ${value.length}）`);
    }

    for (let i = 0; i < value.length; i++) {
      const itemPath = `${path}[${i}]`;
      errors.push(...this._itemValidator.validate(value[i], itemPath));
    }

    return errors;
  }

  // ── 链式约束 ──

  /** 设置最小数组长度。 */
  min(len: number): this {
    this._minLength = len;
    return this;
  }

  /** 设置最大数组长度。 */
  max(len: number): this {
    this._maxLength = len;
    return this;
  }

  /** 标记为可选。 */
  optional(): this {
    this._optional = true;
    return this;
  }

  /** 标记为可空。 */
  nullable(): this {
    this._nullable = true;
    return this;
  }

  /** 添加描述。 */
  describe(description: string): this {
    this._description = description;
    return this;
  }
}

// ════════════════════════════════════════════════════════════════
// 第二层：PluginSchema 定义助手
// ════════════════════════════════════════════════════════════════

/**
 * SchemaDefinition —— definePluginSchema 的配置参数。
 *
 * 定义插件在其生命周期各阶段应满足的校验规则。
 */
export interface SchemaDefinition<TConfig = Record<string, unknown>> {
  /** 配置校验器（init(config) 时注入的配置） */
  config: TypeValidator<TConfig>;
  /** 输入参数校验器（选填，execute 的 payload 校验） */
  input?: TypeValidator<unknown>;
  /** 输出结果校验器（选填，execute 的 output 校验） */
  output?: TypeValidator<unknown>;
  /** 元数据字段校验器（选填，插件元数据字段） */
  meta?: TypeValidator<Record<string, unknown>>;
}

/**
 * 定义完整的 PluginSchema。
 *
 * 将 TypeValidator 原语组合为 PluginSchema 接口兼容的对象，
 * 可直接注册到 PluginValidator。
 *
 * @param name   — Schema 名称（对应插件类型名称）
 * @param schema — Schema 定义（config / input / output 校验器）
 * @returns PluginSchema 兼容对象
 *
 * @example
 * ```ts
 * const GreeterSchema = definePluginSchema("greeter-plugin", {
 *   config: s.object({
 *     greeting: s.string().default("Hello").optional(),
 *     maxUsers: s.number().min(1).max(1000).optional(),
 *   }),
 *   input: s.object({
 *     name: s.string().min(1).max(100),
 *   }),
 *   output: s.object({
 *     message: s.string(),
 *   }),
 * });
 *
 * validator.registerSchema(GreeterSchema);
 * ```
 */
export function definePluginSchema<TConfig = Record<string, unknown>>(
  name: string,
  schema: SchemaDefinition<TConfig>,
): PluginSchema<TConfig> {
  return {
    name,
    validateConfig(config: unknown): string[] {
      return schema.config.validate(config);
    },
    validateInput(input: unknown): string[] {
      if (!schema.input) return [];
      return schema.input.validate(input);
    },
    validateOutput(output: unknown): string[] {
      if (!schema.output) return [];
      return schema.output.validate(output);
    },
  };
}

/**
 * 创建只校验配置的简单 PluginSchema。
 *
 * 适用于只需要配置校验、不关心输入/输出校验的插件。
 *
 * @param name   — Schema 名称
 * @param config — 配置校验器
 * @returns PluginSchema
 */
export function defineConfigSchema<TConfig = Record<string, unknown>>(
  name: string,
  config: TypeValidator<TConfig>,
): PluginSchema<TConfig> {
  return {
    name,
    validateConfig(cfg: unknown): string[] {
      return config.validate(cfg);
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 预定义 Schema 模板
// ════════════════════════════════════════════════════════════════

/**
 * 通用插件配置 Schema。
 *
 * 描述标准的 PluginConfig 结构：
 * ```json
 * {
 *   "enabled": true,
 *   "timeout": 30000,
 *   "env": { "API_KEY": "xxx" }
 * }
 * ```
 *
 * 所有继承 PluginConfig 的配置均可用此 schema 做基础校验，
 * 再通过 `baseConfigSchema.extend(...)` 扩展自定义字段。
 */
export const baseConfigSchema = s.object({
  enabled: s.boolean().optional(),
  timeout: s.number().min(0).max(300_000).optional(),
  env: s.record(s.string()).optional(),
});

/**
 * 严格模式配置 Schema —— 不允许额外字段。
 */
export const strictConfigSchema = baseConfigSchema.strict();

/**
 * 默认插件 Schema —— 适用于绝大多数插件。
 *
 * 仅校验标准 PluginConfig 字段，不校验 input/output。
 */
export const defaultPluginSchema: PluginSchema = defineConfigSchema(
  "default",
  baseConfigSchema,
);

/**
 * 创建一个带有最小配置要求的通用 PluginSchema。
 *
 * @param name — 插件名称
 * @param requiredFields — 必填字段列表
 * @returns PluginSchema
 */
export function createMinimalSchema(
  name: string,
  requiredFields: string[] = [],
): PluginSchema {
  const shape: Record<string, TypeValidator> = {
    enabled: s.boolean().optional(),
    timeout: s.number().min(0).max(300_000).optional(),
  };

  for (const field of requiredFields) {
    shape[field] = s.any().describe(`必填字段: ${field}`);
  }

  return defineConfigSchema(
    name,
    s.object(shape) as TypeValidator<Record<string, unknown>>,
  );
}

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

/**
 * 将多个 PluginSchema 合并为一个复合 Schema。
 *
 * 合并规则：
 * - validateConfig: 所有子 schema 的校验结果合并
 * - validateInput: 取第一个定义了 validateInput 的子 schema
 * - validateOutput: 取第一个定义了 validateOutput 的子 schema
 *
 * @param name — 复合 schema 名称
 * @param schemas — 子 schema 列表
 * @returns 复合 PluginSchema
 */
export function composeSchemas(
  name: string,
  ...schemas: PluginSchema[]
): PluginSchema {
  return {
    name,
    validateConfig(config: unknown): string[] {
      const errors: string[] = [];
      for (const schema of schemas) {
        errors.push(...schema.validateConfig(config));
      }
      return errors;
    },
    validateInput(input: unknown): string[] {
      for (const schema of schemas) {
        if (schema.validateInput) {
          return schema.validateInput(input);
        }
      }
      return [];
    },
    validateOutput(output: unknown): string[] {
      for (const schema of schemas) {
        if (schema.validateOutput) {
          return schema.validateOutput(output);
        }
      }
      return [];
    },
  };
}

/**
 * 校验结果工具函数。
 */
export const validation = {
  /**
   * 快速校验并返回布尔值。
   */
  isValid(validator: TypeValidator, value: unknown): boolean {
    return validator.validate(value).length === 0;
  },

  /**
   * 校验失败时抛出 Error。
   */
  assert(
    validator: TypeValidator,
    value: unknown,
    label = "value",
  ): void {
    const errors = validator.validate(value);
    if (errors.length > 0) {
      throw new Error(`[Schema] ${label} 校验失败:\n  - ${errors.join("\n  - ")}`);
    }
  },

  /**
   * 格式化错误列表为人类可读字符串。
   */
  formatErrors(errors: string[]): string {
    if (errors.length === 0) return "校验通过";
    return `校验失败 (${errors.length} 项):\n${errors.map((e) => `  - ${e}`).join("\n")}`;
  },
};
