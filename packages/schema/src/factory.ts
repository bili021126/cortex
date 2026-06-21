// ============================================================
// @cortex/schema — Factory function `s` for schema construction
//
// 提供声明式的 schema 构建入口 s.string() / s.number() / s.object() 等。
// 所有方法返回对应的 Schema<T> 实例。
//
// 零 any / 零非空断言 / 零空 catch / 零魔法数字
// ============================================================

import { StringSchema, type StringSchemaOptions } from "./primitives.js";
import { NumberSchema, type NumberSchemaOptions } from "./primitives.js";
import { BooleanSchema } from "./primitives.js";
import { LiteralSchema } from "./primitives.js";
import {
  ObjectSchema,
  type ObjectShape,
  ArraySchema,
  type ArraySchemaOptions,
  UnionSchema,
  EnumSchema,
  RecordSchema,
  TupleSchema,
} from "./composite.js";
import type { Schema } from "./schema.js";

/**
 * SchemaFactory —— 声明式 schema 构建器实例。
 *
 * 提供所有基础类型的工厂方法，推荐通过 `s` 单例使用：
 *
 * @example
 * ```ts
 * import { s } from "@cortex/schema";
 *
 * const userSchema = s.object({
 *   name: s.string({ minLength: 1 }),
 *   age: s.number({ integer: true, min: 0 }),
 *   email: s.string().optional(),
 *   tags: s.array(s.string()),
 * });
 * ```
 */
class SchemaFactory {
  /**
   * 创建一个 StringSchema。
   *
   * @param options — 字符串验证选项（minLength / maxLength / pattern）
   * @returns StringSchema 实例
   */
  string(options?: StringSchemaOptions): StringSchema {
    return new StringSchema(options);
  }

  /**
   * 创建一个 NumberSchema。
   *
   * @param options — 数字验证选项（min / max / integer / allowNaN）
   * @returns NumberSchema 实例
   */
  number(options?: NumberSchemaOptions): NumberSchema {
    return new NumberSchema(options);
  }

  /**
   * 创建一个 BooleanSchema。
   *
   * @returns BooleanSchema 实例
   */
  boolean(): BooleanSchema {
    return new BooleanSchema();
  }

  /**
   * 创建一个精确匹配的字面量 Schema。
   *
   * @typeParam T — 字面量类型
   * @param value — 期望的精确值
   * @returns LiteralSchema 实例
   */
  literal<T extends string | number | boolean>(value: T): LiteralSchema<T> {
    return new LiteralSchema(value);
  }

  /**
   * 创建一个对象 Schema。
   *
   * @typeParam T — 对象形状类型
   * @param shape — 字段定义映射
   * @returns ObjectSchema 实例
   */
  object<T extends Record<string, unknown>>(shape: ObjectShape<T>): ObjectSchema<T> {
    return new ObjectSchema<T>(shape);
  }

  /**
   * 创建一个数组 Schema。
   *
   * @typeParam T — 数组元素类型
   * @param elementSchema — 元素 Schema
   * @param options — 数组验证选项（minLength / maxLength）
   * @returns ArraySchema 实例
   */
  array<T>(elementSchema: Schema<T>, options?: ArraySchemaOptions): ArraySchema<T> {
    return new ArraySchema<T>(elementSchema, options);
  }

  /**
   * 创建一个联合类型 Schema。
   *
   * @typeParam T — 联合类型
   * @param schemas — 待匹配的 schema 列表（按序尝试）
   * @returns UnionSchema 实例
   */
  union<T>(schemas: readonly Schema<unknown>[]): UnionSchema<T> {
    return new UnionSchema<T>(schemas);
  }

  /**
   * 创建一个枚举 Schema。
   *
   * @typeParam T — 枚举字符串类型
   * @param allowed — 允许的字符串值列表
   * @returns EnumSchema 实例
   */
  enum<T extends string>(allowed: readonly T[]): EnumSchema<T> {
    return new EnumSchema<T>(allowed);
  }

  /**
   * 创建一个 Record Schema。
   *
   * @typeParam V — Record 值的类型
   * @param valueSchema — 值 Schema
   * @returns RecordSchema 实例
   */
  record<V>(valueSchema: Schema<V>): RecordSchema<V> {
    return new RecordSchema<V>(valueSchema);
  }

  /**
   * 创建一个元组 Schema。
   *
   * @typeParam T — 元组元素类型
   * @param elementSchemas — 按序排列的元素 schema 列表
   * @returns TupleSchema 实例
   */
  tuple<T extends unknown[]>(elementSchemas: readonly Schema<unknown>[]): TupleSchema<T> {
    return new TupleSchema<T>(elementSchemas);
  }
}

/**
 * s —— @cortex/schema 的默认工厂入口。
 *
 * 单例 SchemaFactory，提供所有 schema 类型的声明式构建。
 *
 * @example
 * ```ts
 * import { s } from "@cortex/schema";
 *
 * const userSchema = s.object({
 *   id: s.number(),
 *   name: s.string({ minLength: 1, maxLength: 100 }),
 *   role: s.enum(["admin", "user", "guest"] as const),
 * });
 * ```
 */
export const s: SchemaFactory = new SchemaFactory();
