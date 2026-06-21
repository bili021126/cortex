// ============================================================
// @cortex/schema — Primitive Schemas
//
// 基础类型 Schema 实现：string / number / boolean / literal
//
// 所有验证通过 @cortex/result 的 Result<T, E> 类型表达，
// 错误信息集中引用 DEFAULT_ERROR_MESSAGES。
//
// 零 any / 零非空断言 / 零空 catch / 零魔法数字
// ============================================================

import type { Result } from "@cortex/result";
import { ok, err } from "@cortex/result";
import {
  BaseSchema,
  type SchemaResult,
  type SchemaError,
  schemaError,
  DEFAULT_ERROR_MESSAGES,
  childPath,
} from "./schema.js";

// ─── StringSchema ───────────────────────────────────────────

/**
 * StringSchema 配置选项。
 */
export interface StringSchemaOptions {
  /** 最小长度（含），默认无限制 */
  readonly minLength?: number;
  /** 最大长度（含），默认无限制 */
  readonly maxLength?: number;
  /** 正则匹配模式 */
  readonly pattern?: RegExp;
}

/**
 * StringSchema —— 验证数据是否为字符串并满足额外约束。
 *
 * @example
 * ```ts
 * const name = s.string({ minLength: 1, maxLength: 100 });
 * name.parse("Alice");   // Ok("Alice")
 * name.parse("");         // Err([String too short])
 * name.parse(42);         // Err([Expected a string])
 * ```
 */
export class StringSchema extends BaseSchema<string> {
  private readonly _options: StringSchemaOptions;

  /**
   * @param options — 字符串验证选项
   */
  constructor(options: StringSchemaOptions = {}) {
    super();
    this._options = options;
  }

  parse(data: unknown): SchemaResult<string> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }
    return ok(data as string);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑，支持路径前缀（用于嵌套场景）。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (typeof data !== "string") {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_STRING, "EXPECTED_STRING"));
      return errors;
    }

    const { minLength, maxLength, pattern } = this._options;

    if (minLength !== undefined && data.length < minLength) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.STRING_TOO_SHORT} (minimum: ${minLength})`, "STRING_TOO_SHORT"),
      );
    }

    if (maxLength !== undefined && data.length > maxLength) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.STRING_TOO_LONG} (maximum: ${maxLength})`, "STRING_TOO_LONG"),
      );
    }

    if (pattern !== undefined && !pattern.test(data)) {
      errors.push(
        schemaError(path, `String does not match pattern: ${String(pattern)}`, "PATTERN_MISMATCH"),
      );
    }

    return errors;
  }
}

// ─── NumberSchema ───────────────────────────────────────────

/**
 * NumberSchema 配置选项。
 */
export interface NumberSchemaOptions {
  /** 最小值（含），默认无限制 */
  readonly min?: number;
  /** 最大值（含），默认无限制 */
  readonly max?: number;
  /** 是否允许 NaN，默认 false */
  readonly allowNaN?: boolean;
  /** 是否仅接受整数，默认 false */
  readonly integer?: boolean;
}

/**
 * NumberSchema —— 验证数据是否为数字并满足额外约束。
 *
 * @example
 * ```ts
 * const age = s.number({ min: 0, max: 150, integer: true });
 * age.parse(25);    // Ok(25)
 * age.parse(-1);    // Err([Number too small])
 * age.parse("25");  // Err([Expected a number])
 * ```
 */
export class NumberSchema extends BaseSchema<number> {
  private readonly _options: NumberSchemaOptions;

  /**
   * @param options — 数字验证选项
   */
  constructor(options: NumberSchemaOptions = {}) {
    super();
    this._options = options;
  }

  parse(data: unknown): SchemaResult<number> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }
    return ok(data as number);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑，支持路径前缀（用于嵌套场景）。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (typeof data !== "number") {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_NUMBER, "EXPECTED_NUMBER"));
      return errors;
    }

    if (!this._options.allowNaN && Number.isNaN(data)) {
      errors.push(
        schemaError(path, "Number is NaN", "NAN_NOT_ALLOWED"),
      );
      return errors;
    }

    const { min, max, integer } = this._options;

    if (integer !== undefined && integer && !Number.isInteger(data)) {
      errors.push(
        schemaError(path, "Number is not an integer", "NOT_INTEGER"),
      );
    }

    if (min !== undefined && data < min) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.NUMBER_TOO_SMALL} (minimum: ${min})`, "NUMBER_TOO_SMALL"),
      );
    }

    if (max !== undefined && data > max) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.NUMBER_TOO_LARGE} (maximum: ${max})`, "NUMBER_TOO_LARGE"),
      );
    }

    return errors;
  }
}

// ─── BooleanSchema ──────────────────────────────────────────

/**
 * BooleanSchema —— 验证数据是否为布尔值。
 *
 * @example
 * ```ts
 * const isActive = s.boolean();
 * isActive.parse(true);   // Ok(true)
 * isActive.parse("true"); // Err([Expected a boolean])
 * ```
 */
export class BooleanSchema extends BaseSchema<boolean> {
  parse(data: unknown): SchemaResult<boolean> {
    if (typeof data !== "boolean") {
      return err([schemaError([], DEFAULT_ERROR_MESSAGES.EXPECTED_BOOLEAN, "EXPECTED_BOOLEAN")]);
    }
    return ok(data);
  }

  validate(data: unknown): SchemaError[] {
    if (typeof data !== "boolean") {
      return [schemaError([], DEFAULT_ERROR_MESSAGES.EXPECTED_BOOLEAN, "EXPECTED_BOOLEAN")];
    }
    return [];
  }
}

// ─── LiteralSchema ──────────────────────────────────────────

/**
 * LiteralSchema —— 验证数据是否等于一个精确的字面值。
 *
 * 支持 string / number / boolean 三种字面量类型。
 *
 * @typeParam T — 字面量的精确类型
 *
 * @example
 * ```ts
 * const status = s.literal("active");
 * status.parse("active");   // Ok("active")
 * status.parse("inactive"); // Err([Value does not match expected literal])
 * ```
 */
export class LiteralSchema<T extends string | number | boolean> extends BaseSchema<T> {
  constructor(private readonly _expected: T) {
    super();
  }

  parse(data: unknown): SchemaResult<T> {
    if (data !== this._expected) {
      return err([
        schemaError(
          [],
          `${DEFAULT_ERROR_MESSAGES.EXPECTED_LITERAL}: ${String(this._expected)}`,
          "LITERAL_MISMATCH",
        ),
      ]);
    }
    return ok(data as T);
  }

  validate(data: unknown): SchemaError[] {
    if (data !== this._expected) {
      return [
        schemaError(
          [],
          `${DEFAULT_ERROR_MESSAGES.EXPECTED_LITERAL}: ${String(this._expected)}`,
          "LITERAL_MISMATCH",
        ),
      ];
    }
    return [];
  }
}

// ─── 内部工具：供 composite.ts 使用的重复验证模式 ────────────

/**
 * 调用各 primitive Schema 的路径感知验证函数。
 *
 * @internal 供 ObjectSchema 等复合类型内部使用。
 *
 * @param validator — 实现了 validate 的 Schema 实例
 * @param data — 待验证的数据
 * @param path — 当前路径前缀
 * @returns SchemaError 列表
 */
export function validateWithPath(
  validator: { validate(data: unknown): SchemaError[] },
  data: unknown,
  path: readonly string[],
): SchemaError[] {
  // 获取子 schema 的原始错误，并追加路径前缀
  const rawErrors = validator.validate(data);

  if (path.length === 0) {
    return rawErrors;
  }

  return rawErrors.map((error) => {
    const fullPath = [...path, ...error.path];
    return schemaError(fullPath, error.message, error.code);
  });
}
