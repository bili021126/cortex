// ============================================================
// @cortex/schema —— Public API Surface
//
// 【Public API】
//   本文件导出的所有类型/类/函数为公开契约。
//   所有外部消费者应从 @cortex/schema 导入，非子路径。
//
// 【职责域】
//   类型安全的运行时验证，集成 @cortex/result 的 Result<T, E> 类型。
//   零 any / 零非空断言 / 零空 catch / 零魔法数字。
//
// 【分包】
//   - schema.ts       —— 核心接口 Schema<T> + SchemaError 类
//   - primitives.ts   —— 基础类型（string / number / boolean / literal）
//   - composite.ts    —— 复合类型（object / array / union / enum / record / tuple）
//   - factory.ts      —— 工厂入口 s
// ============================================================

// ─── 核心类型 ───────────────────────────────────────────────
export { SchemaError, BaseSchema, formatPath, childPath, schemaError, DEFAULT_ERROR_MESSAGES } from "./schema.js";
export type { Schema, SchemaResult } from "./schema.js";

// ─── 原始类型 ───────────────────────────────────────────────
export {
  StringSchema,
  NumberSchema,
  BooleanSchema,
  LiteralSchema,
  validateWithPath,
} from "./primitives.js";
export type { StringSchemaOptions, NumberSchemaOptions } from "./primitives.js";

// ─── 复合类型 ───────────────────────────────────────────────
export {
  ObjectSchema,
  ArraySchema,
  UnionSchema,
  EnumSchema,
  RecordSchema,
  TupleSchema,
} from "./composite.js";
export type { ObjectShape, ArraySchemaOptions } from "./composite.js";

// ─── 工厂入口 ───────────────────────────────────────────────
export { s } from "./factory.js";
