// ============================================================
// @cortex/schema — Core Schema<T> interface + SchemaError class
//
// 核心契约：所有 Schema 实现遵循 Schema<T> 接口，
// 所有验证结果通过 @cortex/result 的 Result<T, E> 类型表达。
//
// 零 any / 零非空断言 / 零空 catch / 零魔法数字
// ============================================================

import type { Result } from "@cortex/result";
import { ok, err } from "@cortex/result";

// ─── SchemaError ────────────────────────────────────────────

/**
 * SchemaError —— 表示一次 schema 验证失败。
 *
 * 包含验证失败的完整路径（如 `["user", "address", "zip"]`）、
 * 人类可读的错误消息，以及机器可读的错误码。
 *
 * 继承自 Error，保留原因链。
 */
export class SchemaError extends Error {
  override readonly name = "SchemaError";

  /**
   * @param path — 验证失败的字段路径（如 `["user", "name"]`）
   * @param message — 人类可读的错误描述
   * @param code — 机器可读的错误码（如 `"STRING_TOO_SHORT"`, `"REQUIRED_FIELD_MISSING"`）
   * @param options — ErrorOptions 可选参数
   */
  constructor(
    readonly path: readonly string[],
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

// ─── SchemaResult 类型 ──────────────────────────────────────

/**
 * SchemaResult<T> —— Schema 验证结果的类型别名。
 *
 * - 成功：Ok(T) —— 验证通过，包含解析后的值
 * - 失败：Err(SchemaError[]) —— 验证失败，包含所有错误
 *
 * @typeParam T — 验证成功后的值类型
 */
export type SchemaResult<T> = Result<T, SchemaError[]>;

// ─── Schema<T> 接口 ─────────────────────────────────────────

/**
 * Schema<T> —— 类型安全的运行时验证器接口。
 *
 * 所有 Schema 类型（StringSchema、NumberSchema、ObjectSchema 等）均实现此接口。
 *
 * @typeParam T — 该 Schema 在验证成功后产生的值的 TypeScript 类型
 *
 * @example
 * ```ts
 * const nameSchema: Schema<string> = s.string();
 * const result = nameSchema.parse("Alice");
 * ```
 */
export interface Schema<T> {
  /**
   * 解析并验证未知数据，返回 SchemaResult<T>。
   *
   * - 验证通过 → Ok(parsedValue)
   * - 验证失败 → Err([SchemaError, ...])
   *
   * @param data — 待验证的未知数据
   * @returns SchemaResult<T>
   */
  parse(data: unknown): SchemaResult<T>;

  /**
   * 验证未知数据，返回 SchemaError[]。
   * 空数组表示验证通过。
   *
   * 与 parse() 不同，validate() 不抛出异常，不返回 Result，
   * 适合在只需要错误信息而不关心转换值的场景。
   *
   * @param data — 待验证的未知数据
   * @returns SchemaError[] —— 验证失败时的错误列表；空数组 = 通过
   */
  validate(data: unknown): SchemaError[];

  /**
   * 对验证通过的值应用转换函数，返回新的 Schema。
   *
   * 转换函数在 parse/validate 过程中应用——先验证原始数据，
   * 验证通过后调用 transform，返回转换后的值。
   *
   * @typeParam U — 转换后的值类型
   * @param fn — 值转换函数
   * @returns 新的 Schema<U>
   */
  transform<U>(fn: (value: T) => U): Schema<U>;

  /**
   * 对验证通过的值应用额外的校验条件。
   *
   * 与 transform 不同，refine 不改变值类型，只在条件不满足时追加错误。
   *
   * @param predicate — 返回 true 表示验证通过，返回 false 时需提供错误消息
   * @param message — 验证失败时的错误消息
   * @returns 新的 Schema<T>（类型不变）
   */
  refine(predicate: (value: T) => boolean, message: string): Schema<T>;

  /**
   * 将当前 Schema 标记为可选（接受 undefined）。
   *
   * @returns Schema<T | undefined>
   */
  optional(): Schema<T | undefined>;

  /**
   * 将当前 Schema 标记为可空（接受 null）。
   *
   * @returns Schema<T | null>
   */
  nullable(): Schema<T | null>;
}

// ─── 内部工具函数 ───────────────────────────────────────────

/**
 * 格式化路径为人类可读的字符串。
 * 仅在 SchemaError 消息构建时内部使用。
 *
 * @param path — 字段路径数组
 * @returns 格式化后的路径字符串（如 `"user.address.zip"`）
 */
export function formatPath(path: readonly string[]): string {
  return path.join(".");
}

/**
 * 创建一个简单的路径附加函数。
 * 在嵌套 schema 验证时，将子 schema 的错误路径前缀追加到当前路径。
 *
 * @param parentPath — 父级路径前缀
 * @param key — 当前字段键名
 * @returns 拼接后的完整路径
 */
export function childPath(parentPath: readonly string[], key: string): readonly string[] {
  return [...parentPath, key];
}

/**
 * 生成单个 SchemaError 的工厂函数。
 * 减少嵌套对象字面量的重复。
 *
 * @param path — 错误路径
 * @param message — 错误消息
 * @param code — 错误码
 * @returns SchemaError 实例
 */
export function schemaError(
  path: readonly string[],
  message: string,
  code: string,
): SchemaError {
  return new SchemaError(path, message, code);
}

// ─── 默认错误消息 ────────────────────────────────────────────

/**
 * 默认错误消息集 —— 集中管理所有预定义错误消息。
 *
 * 遵循 §七（配置驱动开发）—— 默认消息集中于此而非散落在各模块中。
 */
export const DEFAULT_ERROR_MESSAGES = {
  EXPECTED_STRING: "Expected a string",
  EXPECTED_NUMBER: "Expected a number",
  EXPECTED_BOOLEAN: "Expected a boolean",
  EXPECTED_OBJECT: "Expected an object",
  EXPECTED_ARRAY: "Expected an array",
  EXPECTED_ENUM_VALUE: "Expected a valid enum value",
  EXPECTED_RECORD: "Expected a record (object with string keys)",
  EXPECTED_TUPLE: "Expected a tuple (array with exact length)",
  EXPECTED_LITERAL: "Value does not match expected literal",
  REQUIRED_FIELD_MISSING: "Required field is missing",
  STRING_TOO_SHORT: "String is too short",
  STRING_TOO_LONG: "String is too long",
  NUMBER_TOO_SMALL: "Number is too small",
  NUMBER_TOO_LARGE: "Number is too large",
  ARRAY_TOO_SHORT: "Array has too few elements",
  ARRAY_TOO_LONG: "Array has too many elements",
  TUPLE_LENGTH_MISMATCH: "Tuple length does not match",
  REFINE_FAILED: "Refinement check failed",
  UNION_NO_MATCH: "Value does not match any schema in the union",
  TRANSFORM_FAILED: "Transform function threw an error",
} as const;

// ─── 基类：抽象 Schema 实现 ──────────────────────────────────

/**
 * BaseSchema<T> —— Schema<T> 接口的抽象基类。
 *
 * 所有具体 Schema 实现（StringSchema、ObjectSchema 等）继承此类，
 * 获得 transform / refine / optional / nullable 的默认实现。
 *
 * @typeParam T — 该 Schema 验证成功后的值类型
 */
export abstract class BaseSchema<T> implements Schema<T> {
  abstract parse(data: unknown): SchemaResult<T>;
  abstract validate(data: unknown): SchemaError[];

  /**
   * 对验证通过的值应用转换函数，返回新的 Schema。
   *
   * @typeParam U — 转换后的值类型
   * @param fn — 值转换函数
   * @returns 新的 Schema<U>
   */
  transform<U>(fn: (value: T) => U): Schema<U> {
    return new TransformSchema<T, U>(this, fn);
  }

  /**
   * 对验证通过的值应用额外的校验条件。
   *
   * @param predicate — 返回 true 表示验证通过
   * @param message — 验证失败时的错误消息
   * @returns 新的 Schema<T>（类型不变）
   */
  refine(predicate: (value: T) => boolean, message: string): Schema<T> {
    return new RefineSchema<T>(this, predicate, message);
  }

  /**
   * 将当前 Schema 标记为可选（接受 undefined）。
   *
   * @returns Schema<T | undefined>
   */
  optional(): Schema<T | undefined> {
    return new OptionalSchema<T>(this);
  }

  /**
   * 将当前 Schema 标记为可空（接受 null）。
   *
   * @returns Schema<T | null>
   */
  nullable(): Schema<T | null> {
    return new NullableSchema<T>(this);
  }
}

// ─── 内部 Schema 实现：Transform / Refine / Optional / Nullable ──

/**
 * TransformSchema —— 对已验证的值应用转换函数的 Schema 包装器。
 *
 * @internal 不直接对外暴露——通过 BaseSchema.transform() 创建。
 */
class TransformSchema<T, U> extends BaseSchema<U> {
  constructor(
    private readonly _inner: Schema<T>,
    private readonly _fn: (value: T) => U,
  ) {
    super();
  }

  parse(data: unknown): SchemaResult<U> {
    const innerResult = this._inner.parse(data);
    if (innerResult._tag === "Err") {
      return innerResult as unknown as SchemaResult<U>;
    }
    try {
      const transformed = this._fn(innerResult.value);
      return ok(transformed) as SchemaResult<U>;
    } catch (e) {
      const error = schemaError(
        [],
        DEFAULT_ERROR_MESSAGES.TRANSFORM_FAILED,
        "TRANSFORM_FAILED",
      );
      return err([error]);
    }
  }

  validate(data: unknown): SchemaError[] {
    return this._inner.validate(data);
  }
}

/**
 * RefineSchema —— 在验证通过后应用额外校验条件的 Schema 包装器。
 *
 * @internal 不直接对外暴露——通过 BaseSchema.refine() 创建。
 */
class RefineSchema<T> extends BaseSchema<T> {
  constructor(
    private readonly _inner: Schema<T>,
    private readonly _predicate: (value: T) => boolean,
    private readonly _message: string,
  ) {
    super();
  }

  parse(data: unknown): SchemaResult<T> {
    const innerResult = this._inner.parse(data);
    if (innerResult._tag === "Err") {
      return innerResult;
    }
    if (!this._predicate(innerResult.value)) {
      const error = schemaError(
        [],
        this._message,
        "REFINE_FAILED",
      );
      return err([error]);
    }
    return innerResult;
  }

  validate(data: unknown): SchemaError[] {
    const innerErrors = this._inner.validate(data);
    if (innerErrors.length > 0) {
      return innerErrors;
    }
    const parsed = this._inner.parse(data);
    if (parsed._tag === "Ok" && !this._predicate(parsed.value)) {
      return [
        schemaError(
          [],
          this._message,
          "REFINE_FAILED",
        ),
      ];
    }
    return [];
  }
}

/**
 * OptionalSchema —— 接受 undefined 的 Schema 包装器。
 *
 * @internal 不直接对外暴露——通过 BaseSchema.optional() 创建。
 */
class OptionalSchema<T> extends BaseSchema<T | undefined> {
  constructor(private readonly _inner: Schema<T>) {
    super();
  }

  parse(data: unknown): SchemaResult<T | undefined> {
    if (data === undefined) {
      return ok(undefined);
    }
    return this._inner.parse(data) as SchemaResult<T | undefined>;
  }

  validate(data: unknown): SchemaError[] {
    if (data === undefined) {
      return [];
    }
    return this._inner.validate(data);
  }
}

/**
 * NullableSchema —— 接受 null 的 Schema 包装器。
 *
 * @internal 不直接对外暴露——通过 BaseSchema.nullable() 创建。
 */
class NullableSchema<T> extends BaseSchema<T | null> {
  constructor(private readonly _inner: Schema<T>) {
    super();
  }

  parse(data: unknown): SchemaResult<T | null> {
    if (data === null) {
      return ok(null);
    }
    return this._inner.parse(data) as SchemaResult<T | null>;
  }

  validate(data: unknown): SchemaError[] {
    if (data === null) {
      return [];
    }
    return this._inner.validate(data);
  }
}
