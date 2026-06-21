// ============================================================
// @cortex/schema — Composite Schemas
//
// 复合类型 Schema 实现：object / array / union / enum / record / tuple
//
// 所有验证通过 @cortex/result 的 Result<T, E> 类型表达，
// 嵌套验证错误路径自动拼接前缀。
//
// 零 any / 零非空断言 / 零空 catch / 零魔法数字
// ============================================================

import { ok, err } from "@cortex/result";
import type { Result } from "@cortex/result";
import {
  BaseSchema,
  type Schema,
  type SchemaResult,
  type SchemaError,
  schemaError,
  DEFAULT_ERROR_MESSAGES,
  childPath,
} from "./schema.js";
import { validateWithPath } from "./primitives.js";

// ─── ObjectSchema ───────────────────────────────────────────

/**
 * ObjectSchema 字段定义映射。
 *
 * 每个键对应一个 Schema，定义该字段的验证规则。
 *
 * @typeParam T — 对象的形状类型
 */
export type ObjectShape<T extends Record<string, unknown>> = {
  [K in keyof T]: Schema<T[K]>;
};

/**
 * ObjectSchema —— 验证数据是否为对象并逐字段验证。
 *
 * @typeParam T — 对象值类型
 *
 * @example
 * ```ts
 * const userSchema = s.object({
 *   name: s.string(),
 *   age: s.number({ integer: true }),
 *   email: s.string().optional(),
 * });
 *
 * userSchema.parse({ name: "Alice", age: 30 });
 * // Ok({ name: "Alice", age: 30 })
 *
 * userSchema.parse({ name: "Alice" });
 * // Err([age: Required field is missing])
 * ```
 */
export class ObjectSchema<T extends Record<string, unknown>> extends BaseSchema<T> {
  constructor(private readonly _shape: ObjectShape<T>) {
    super();
  }

  parse(data: unknown): SchemaResult<T> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }
    // 类型安全：_validateInternal 已保证 data 是 T
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(this._shape)) {
      const fieldResult = this._shape[key].parse(obj[key]);
      if (fieldResult._tag === "Err") {
        // 不应发生——validate 已检查所有字段
        return err(fieldResult.error);
      }
      result[key] = fieldResult.value;
    }
    return ok(result as unknown as T);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑，支持路径前缀。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (typeof data !== "object" || data === null) {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_OBJECT, "EXPECTED_OBJECT"));
      return errors;
    }

    const obj = data as Record<string, unknown>;
    const shapeKeys = Object.keys(this._shape);

    for (const key of shapeKeys) {
      const fieldPath = childPath(path, key);

      if (!(key in obj)) {
        errors.push(
          schemaError(fieldPath, DEFAULT_ERROR_MESSAGES.REQUIRED_FIELD_MISSING, "REQUIRED_FIELD_MISSING"),
        );
        continue;
      }

      const fieldSchema = this._shape[key];
      // 不需要检查 optional——OptionalSchema 内部接受 undefined
      const fieldErrors = validateWithPath(fieldSchema, obj[key], fieldPath);
      errors.push(...fieldErrors);
    }

    return errors;
  }
}

// ─── ArraySchema ────────────────────────────────────────────

/**
 * ArraySchema 配置选项。
 */
export interface ArraySchemaOptions {
  /** 最小元素数量（含），默认无限制 */
  readonly minLength?: number;
  /** 最大元素数量（含），默认无限制 */
  readonly maxLength?: number;
}

/**
 * ArraySchema —— 验证数据是否为数组并逐元素验证。
 *
 * @typeParam T — 数组元素的类型
 *
 * @example
 * ```ts
 * const tags = s.array(s.string(), { minLength: 1 });
 * tags.parse(["a", "b"]);  // Ok(["a", "b"])
 * tags.parse([]);           // Err([Array too short])
 * ```
 */
export class ArraySchema<T> extends BaseSchema<T[]> {
  constructor(
    private readonly _elementSchema: Schema<T>,
    private readonly _options: ArraySchemaOptions = {},
  ) {
    super();
  }

  parse(data: unknown): SchemaResult<T[]> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }

    const arr = data as unknown[];
    const result: T[] = [];
    for (let i = 0; i < arr.length; i++) {
      const itemResult = this._elementSchema.parse(arr[i]);
      if (itemResult._tag === "Err") {
        return err(itemResult.error);
      }
      result.push(itemResult.value);
    }
    return ok(result);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑，支持路径前缀。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (!Array.isArray(data)) {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_ARRAY, "EXPECTED_ARRAY"));
      return errors;
    }

    const { minLength, maxLength } = this._options;

    if (minLength !== undefined && data.length < minLength) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.ARRAY_TOO_SHORT} (minimum: ${minLength})`, "ARRAY_TOO_SHORT"),
      );
    }

    if (maxLength !== undefined && data.length > maxLength) {
      errors.push(
        schemaError(path, `${DEFAULT_ERROR_MESSAGES.ARRAY_TOO_LONG} (maximum: ${maxLength})`, "ARRAY_TOO_LONG"),
      );
    }

    // 即使长度检查失败，仍然逐元素验证以收集所有错误
    for (let i = 0; i < data.length; i++) {
      const elementPath = childPath(path, String(i));
      const elementErrors = validateWithPath(this._elementSchema, data[i], elementPath);
      errors.push(...elementErrors);
    }

    return errors;
  }
}

// ─── UnionSchema ────────────────────────────────────────────

/**
 * UnionSchema —— 验证数据是否匹配联合类型中的任一 schema。
 *
 * 按顺序尝试每个子 schema，第一个验证通过即返回。
 * 若所有子 schema 均失败，收集所有错误返回。
 *
 * @typeParam T — 联合类型
 *
 * @example
 * ```ts
 * const idOrName = s.union([s.number(), s.string()]);
 * idOrName.parse(42);      // Ok(42)
 * idOrName.parse("abc");   // Ok("abc")
 * idOrName.parse(true);    // Err([Union: No schema matched])
 * ```
 */
export class UnionSchema<T> extends BaseSchema<T> {
  constructor(private readonly _schemas: readonly Schema<unknown>[]) {
    super();
  }

  parse(data: unknown): SchemaResult<T> {
    const allErrors: SchemaError[] = [];

    for (const schema of this._schemas) {
      const result = schema.parse(data);
      if (result._tag === "Ok") {
        return ok(result.value as T);
      }
      allErrors.push(...result.error);
    }

    return err([
      schemaError([], DEFAULT_ERROR_MESSAGES.UNION_NO_MATCH, "UNION_NO_MATCH"),
      ...allErrors,
    ]);
  }

  validate(data: unknown): SchemaError[] {
    const allErrors: SchemaError[] = [];

    for (const schema of this._schemas) {
      const errors = schema.validate(data);
      if (errors.length === 0) {
        return [];
      }
      allErrors.push(...errors);
    }

    return [
      schemaError([], DEFAULT_ERROR_MESSAGES.UNION_NO_MATCH, "UNION_NO_MATCH"),
      ...allErrors,
    ];
  }
}

// ─── EnumSchema ─────────────────────────────────────────────

/**
 * EnumSchema —— 验证数据是否为枚举值列表中的一员。
 *
 * @typeParam T — 枚举值的类型
 *
 * @example
 * ```ts
 * const color = s.enum(["red", "green", "blue"] as const);
 * color.parse("red");    // Ok("red")
 * color.parse("yellow"); // Err([Expected a valid enum value])
 * ```
 */
export class EnumSchema<T extends string> extends BaseSchema<T> {
  private readonly _allowed: readonly T[];

  constructor(allowed: readonly T[]) {
    super();
    this._allowed = allowed;
  }

  parse(data: unknown): SchemaResult<T> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }
    return ok(data as T);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const allowed = this._allowed as readonly unknown[];
    if (!allowed.includes(data)) {
      return [
        schemaError(
          path,
          `${DEFAULT_ERROR_MESSAGES.EXPECTED_ENUM_VALUE}: ${String(data)}`,
          "ENUM_MISMATCH",
        ),
      ];
    }
    return [];
  }
}

// ─── RecordSchema ───────────────────────────────────────────

/**
 * RecordSchema —— 验证数据是否为 Record<string, V>。
 *
 * 验证所有键为字符串，所有值符合值 schema。
 *
 * @typeParam V — 值的类型
 *
 * @example
 * ```ts
 * const scores = s.record(s.number());
 * scores.parse({ alice: 95, bob: 87 }); // Ok({ alice: 95, bob: 87 })
 * scores.parse([1, 2, 3]);              // Err([Expected a record])
 * ```
 */
export class RecordSchema<V> extends BaseSchema<Record<string, V>> {
  constructor(private readonly _valueSchema: Schema<V>) {
    super();
  }

  parse(data: unknown): SchemaResult<Record<string, V>> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }

    const obj = data as Record<string, unknown>;
    const result: Record<string, V> = {};

    for (const key of Object.keys(obj)) {
      const itemResult = this._valueSchema.parse(obj[key]);
      if (itemResult._tag === "Err") {
        return err(itemResult.error);
      }
      result[key] = itemResult.value;
    }

    return ok(result);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_RECORD, "EXPECTED_RECORD"));
      return errors;
    }

    const obj = data as Record<string, unknown>;

    for (const key of Object.keys(obj)) {
      const valuePath = childPath(path, key);
      const valueErrors = validateWithPath(this._valueSchema, obj[key], valuePath);
      errors.push(...valueErrors);
    }

    return errors;
  }
}

// ─── TupleSchema ────────────────────────────────────────────

/**
 * TupleSchema —— 验证数据是否为固定长度的元组。
 *
 * @typeParam T — 元组元素的联合类型（通过元组类型推导）
 *
 * @example
 * ```ts
 * const point = s.tuple([s.number(), s.number()]);
 * point.parse([10, 20]);  // Ok([10, 20])
 * point.parse([10]);       // Err([Tuple length does not match])
 * ```
 */
export class TupleSchema<T extends unknown[]> extends BaseSchema<T> {
  constructor(private readonly _elementSchemas: readonly Schema<unknown>[]) {
    super();
  }

  parse(data: unknown): SchemaResult<T> {
    const errors = this._validateInternal(data, []);
    if (errors.length > 0) {
      return err(errors);
    }

    const arr = data as unknown[];
    const result: unknown[] = [];

    for (let i = 0; i < this._elementSchemas.length; i++) {
      const itemResult = this._elementSchemas[i].parse(arr[i]);
      if (itemResult._tag === "Err") {
        return err(itemResult.error);
      }
      result.push(itemResult.value);
    }

    return ok(result as unknown as T);
  }

  validate(data: unknown): SchemaError[] {
    return this._validateInternal(data, []);
  }

  /**
   * 内部验证逻辑。
   *
   * @param data — 待验证数据
   * @param path — 当前路径前缀
   * @returns SchemaError 列表
   */
  private _validateInternal(data: unknown, path: readonly string[]): SchemaError[] {
    const errors: SchemaError[] = [];

    if (!Array.isArray(data)) {
      errors.push(schemaError(path, DEFAULT_ERROR_MESSAGES.EXPECTED_TUPLE, "EXPECTED_TUPLE"));
      return errors;
    }

    if (data.length !== this._elementSchemas.length) {
      errors.push(
        schemaError(
          path,
          `${DEFAULT_ERROR_MESSAGES.TUPLE_LENGTH_MISMATCH} (expected: ${this._elementSchemas.length}, got: ${data.length})`,
          "TUPLE_LENGTH_MISMATCH",
        ),
      );
      // 即使长度不匹配也继续逐元素验证
    }

    const maxCheck = Math.min(data.length, this._elementSchemas.length);
    for (let i = 0; i < maxCheck; i++) {
      const elementPath = childPath(path, String(i));
      const elementErrors = validateWithPath(this._elementSchemas[i], data[i], elementPath);
      errors.push(...elementErrors);
    }

    return errors;
  }
}
