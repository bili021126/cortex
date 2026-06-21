// ============================================================
// src/validator.ts —— 基于 Zod 的核心校验模块
//
// 职责：
//   提供可复用的校验 schema 定义、类型安全的结果类型、
//   以及统一的校验工具函数，供 Cortex 各模块使用。
//
// 设计原则：
//   1. 零 any / 零非空断言 / 零空 catch / 零 var / 零魔法数字
//   2. 所有公开符号均有完整 JSDoc
//   3. 错误链保留（cause 属性）
//   4. 类型安全优先（discriminated union 表示校验结果）
// ============================================================

import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// 第一部分：校验结果类型
// ─────────────────────────────────────────────────────────────

/** 校验问题级别枚举 */
export enum ValidationIssueLevel {
  /** 错误——数据不合法，必须修复 */
  Error = "error",
  /** 警告——数据可疑但不阻断 */
  Warning = "warning",
  /** 信息——仅供记录 */
  Info = "info",
}

/** 单个校验问题的结构化表示 */
export interface ValidationIssue {
  /** 问题路径（如 "user.name" 或 "items.0.value"） */
  readonly path: string;
  /** 问题描述 */
  readonly message: string;
  /** 问题级别 */
  readonly level: ValidationIssueLevel;
  /** Zod 内部错误码（如有） */
  readonly code?: string;
}

/**
 * 校验成功结果。
 * @template T 校验后的输出类型
 */
export interface ValidationSuccess<T> {
  readonly success: true;
  /** 校验通过后的数据 */
  readonly data: T;
}

/**
 * 校验失败结果。
 * @template T 仅用于类型参数占位，与 ValidationSuccess<T> 保持泛型一致
 */
export interface ValidationFailure<T = unknown> {
  readonly success: false;
  /** 原始输入值 */
  readonly input: unknown;
  /** 所有校验问题列表 */
  readonly issues: readonly ValidationIssue[];
  /** 人类可读的错误摘要 */
  readonly message: string;
}

/**
 * 统一校验结果——带 discriminated union 的 typesafe 结果。
 * @template T 校验成功后的数据类型
 *
 * @example
 * ```ts
 * const result = validate(nameSchema, input);
 * if (result.success) {
 *   console.log(result.data); // T
 * } else {
 *   console.error(result.message); // string
 * }
 * ```
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure<T>;

// ─────────────────────────────────────────────────────────────
// 第二部分：常量（防魔法数字）
// ─────────────────────────────────────────────────────────────

/** 字符串最小长度默认值 */
const DEFAULT_MIN_STRING_LENGTH = 1;
/** 字符串最大长度默认值 */
const DEFAULT_MAX_STRING_LENGTH = 1024;
/** 数组最小长度默认值 */
const DEFAULT_MIN_ARRAY_LENGTH = 0;
/** 数组最大长度默认值 */
const DEFAULT_MAX_ARRAY_LENGTH = 1000;
/** 正整数最小值 */
const POSITIVE_INT_MIN = 1;
/** 分数范围最小值 */
const SCORE_MIN = 0;
/** 分数范围最大值 */
const SCORE_MAX = 100;
/** 端口号最小值 */
const PORT_MIN = 1;
/** 端口号最大值 */
const PORT_MAX = 65535;

// ─────────────────────────────────────────────────────────────
// 第三部分：常用 Schema 定义
// ─────────────────────────────────────────────────────────────

/**
 * Cortex 内部 ID schema。
 * 格式：字母开头，后接字母、数字、连字符或下划线，总长 1-64。
 */
export const cortexIdSchema = z.string()
  .min(DEFAULT_MIN_STRING_LENGTH, "ID 不能为空")
  .max(64, "ID 长度不能超过 64 个字符")
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, "ID 必须以字母开头，仅包含字母、数字、连字符和下划线");

/** Cortex ID 的推导类型 */
export type CortexId = z.output<typeof cortexIdSchema>;

/**
 * 非空字符串 schema。
 * 默认最大长度由 DEFAULT_MAX_STRING_LENGTH 控制，可链式覆写。
 */
export const nonEmptyStringSchema = z.string()
  .min(DEFAULT_MIN_STRING_LENGTH, "字符串不能为空")
  .max(DEFAULT_MAX_STRING_LENGTH, `字符串长度不能超过 ${String(DEFAULT_MAX_STRING_LENGTH)}`);

/** 非空字符串的推导类型 */
export type NonEmptyString = z.output<typeof nonEmptyStringSchema>;

/**
 * 电子邮件 schema。
 */
export const emailSchema = z.email("无效的电子邮件地址");

/** 电子邮件的推导类型 */
export type EmailAddress = z.output<typeof emailSchema>;

/**
 * URL schema。
 */
export const urlSchema = z.url("无效的 URL 地址");

/** URL 的推导类型 */
export type UrlString = z.output<typeof urlSchema>;

/**
 * 文件路径 schema。
 * 支持相对路径（./foo/bar）和绝对路径（/foo/bar 或 C:\\foo\\bar）。
 */
export const filePathSchema = z.string()
  .min(DEFAULT_MIN_STRING_LENGTH, "路径不能为空")
  .max(512, "路径长度不能超过 512 个字符")
  .regex(
    /^(\/[a-zA-Z0-9_./-]+|[a-zA-Z]:\\[a-zA-Z0-9_.\\-]+|\.\.?\/[a-zA-Z0-9_./-]+)$/,
    "路径格式不合法：仅支持 Unix 绝对路径、Windows 绝对路径或相对路径",
  );

/** 文件路径的推导类型 */
export type FilePath = z.output<typeof filePathSchema>;

/**
 * 正整数 schema（>= 1）。
 */
export const positiveIntSchema = z.number()
  .int("必须是整数")
  .min(POSITIVE_INT_MIN, `值必须大于等于 ${String(POSITIVE_INT_MIN)}`);

/** 正整数的推导类型 */
export type PositiveInt = z.output<typeof positiveIntSchema>;

/**
 * 非负整数 schema（>= 0）。
 */
export const nonNegativeIntSchema = z.number()
  .int("必须是整数")
  .nonnegative("值不能为负数");

/** 非负整数的推导类型 */
export type NonNegativeInt = z.output<typeof nonNegativeIntSchema>;

/**
 * 分数 schema（0-100）。
 */
export const scoreSchema = z.number()
  .min(SCORE_MIN, `分数不能低于 ${String(SCORE_MIN)}`)
  .max(SCORE_MAX, `分数不能高于 ${String(SCORE_MAX)}`);

/** 分数的推导类型 */
export type Score = z.output<typeof scoreSchema>;

/**
 * 端口号 schema（1-65535）。
 */
export const portSchema = z.number()
  .int("端口号必须是整数")
  .min(PORT_MIN, `端口号不能小于 ${String(PORT_MIN)}`)
  .max(PORT_MAX, `端口号不能大于 ${String(PORT_MAX)}`);

/** 端口号的推导类型 */
export type PortNumber = z.output<typeof portSchema>;

/**
 * 时间戳 schema（ISO 8601 格式）。
 */
export const timestampSchema = z.string()
  .datetime("时间戳须为 ISO 8601 格式（如 2024-01-01T00:00:00Z）");

/** 时间戳的推导类型 */
export type Timestamp = z.output<typeof timestampSchema>;

/**
 * JSON 值 schema（递归）。
 */
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

/** JSON 值的推导类型 */
export type JsonValue = z.output<typeof jsonValueSchema>;

// ─────────────────────────────────────────────────────────────
// 第四部分：校验工具函数
// ─────────────────────────────────────────────────────────────

/**
 * 将 Zod 错误转换为统一的 ValidationIssue 列表。
 *
 * @param error - Zod 校验错误对象
 * @returns 标准化后的校验问题列表
 */
export function toValidationIssues(error: z.ZodError): readonly ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
    level: ValidationIssueLevel.Error,
    code: issue.code,
  }));
}

/**
 * 将 Zod 错误转换为人类可读的错误消息。
 *
 * @param error - Zod 校验错误对象
 * @returns 格式化的错误消息（每行一个 issue）
 */
export function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const pathStr = issue.path.length > 0 ? `路径 "${issue.path.join(".")}"：` : "";
    return `  ${pathStr}${issue.message} (错误码: ${issue.code})`;
  });
  return `校验失败，共发现 ${String(error.issues.length)} 个问题：\n${lines.join("\n")}`;
}

/**
 * 安全校验——使用 zod schema 校验数据，返回详细的校验结果。
 * 这是首选校验方式，统一了成功和失败的数据结构。
 *
 * @param schema - Zod schema
 * @param data - 待校验的原始数据
 * @returns 标准化的 ValidationResult
 *
 * @example
 * ```ts
 * const result = validate(z.string().email(), "not-an-email");
 * if (!result.success) {
 *   console.error(result.message);
 * }
 * ```
 */
export function validate<T>(
  schema: z.ZodType<T>,
  data: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(data);

  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
    } as ValidationSuccess<T>;
  }

  return {
    success: false,
    input: data,
    issues: toValidationIssues(parsed.error),
    message: formatZodError(parsed.error),
  } as ValidationFailure<T>;
}

/**
 * 严格校验——如果校验失败则抛出 Error。
 * 适用于"数据必须合法，否则无法继续"的场景。
 *
 * @param schema - Zod schema
 * @param data - 待校验的原始数据
 * @param label - 可选的人类可读标签（用于错误消息）
 * @returns 校验通过后的类型安全数据
 * @throws Error 当校验失败时抛出，保留原始 cause
 */
export function validateOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label?: string,
): T {
  const parsed = schema.safeParse(data);

  if (parsed.success) {
    return parsed.data;
  }

  const prefix = label !== undefined ? `[${label}] ` : "";
  throw new Error(`${prefix}数据校验失败`, { cause: parsed.error });
}

/**
 * 批量校验——同时校验多个字段，汇总所有错误。
 *
 * @param checks - 键值对集合，键为字段名，值为 { schema, data }
 * @returns 以字段名为 key 的 ValidationResult 映射
 *
 * @example
 * ```ts
 * const results = validateMany({
 *   name: { schema: nonEmptyStringSchema, data: input.name },
 *   age: { schema: positiveIntSchema, data: input.age },
 * });
 * // results.name.success, results.age.success
 * ```
 */
export function validateMany<T extends Record<string, unknown>>(
  checks: {
    [K in keyof T]: {
      readonly schema: z.ZodType<T[K]>;
      readonly data: unknown;
    };
  },
): { [K in keyof T]: ValidationResult<T[K]> } {
  const results = {} as { [K in keyof T]: ValidationResult<T[K]> };

  for (const key of Object.keys(checks) as (keyof T)[]) {
    const check = checks[key];
    results[key] = validate(check.schema, check.data);
  }

  return results;
}

/**
 * 批量严格校验——全部通过返回 true，否则抛出首个错误。
 *
 * @param checks - 键值对集合，键为字段名，值为 { schema, data }
 * @returns true（当所有校验通过时）
 * @throws Error 当任意校验失败时抛出首个错误
 */
export function validateManyOrThrow<T extends Record<string, unknown>>(
  checks: {
    [K in keyof T]: {
      readonly schema: z.ZodType<T[K]>;
      readonly data: unknown;
    };
  },
): true {
  const results = validateMany(checks);

  for (const key of Object.keys(results) as (keyof T)[]) {
    const result = results[key];
    if (!result.success) {
      throw new Error(`字段 "${String(key)}" 校验失败: ${result.message}`, {
        cause: result.issues,
      });
    }
  }

  return true;
}

/**
 * 校验所有问题是否均为成功——便捷类型守卫。
 *
 * @param results - 校验结果数组
 * @returns 是否全部通过
 */
export function allSuccessful<T>(
  results: readonly ValidationResult<T>[],
): results is readonly ValidationSuccess<T>[] {
  return results.every((r) => r.success);
}

/**
 * 从校验结果数组中提取所有失败项。
 *
 * @param results - 校验结果数组
 * @returns 仅包含失败项的数组
 */
export function collectFailures<T>(
  results: readonly ValidationResult<T>[],
): ValidationFailure<T>[] {
  const failures: ValidationFailure<T>[] = [];
  for (const result of results) {
    if (!result.success) {
      failures.push(result);
    }
  }
  return failures;
}

// ─────────────────────────────────────────────────────────────
// 第五部分：Schema 组合器
// ─────────────────────────────────────────────────────────────

/**
 * 创建同时支持 optional 和 nullable 的 schema。
 *
 * @param schema - 基础 schema
 * @returns 扩展后的 schema（接受 undefined 或 null）
 */
export function nullish<T extends z.ZodType<unknown>>(
  schema: T,
): z.ZodOptional<z.ZodNullable<T>> {
  return schema.nullable().optional();
}

/**
 * 创建严格对象 schema —— 不允许额外属性。
 * 与 `z.strictObject()` 等价，提供统一入口。
 *
 * @param shape - 对象形状定义
 * @returns 严格对象 schema
 */
export function strictObject<T extends z.ZodRawShape>(
  shape: T,
): z.ZodObject<T, "strict"> {
  return z.strictObject(shape);
}

/**
 * 创建宽松对象 schema —— 允许额外属性通过。
 *
 * @param shape - 对象形状定义
 * @returns 宽松对象 schema
 */
export function looseObject<T extends z.ZodRawShape>(
  shape: T,
): z.ZodObject<T, "loose"> {
  return z.looseObject(shape);
}

/**
 * 创建带默认值的非空字符串 schema。
 *
 * @param defaultValue - 当输入为空字符串或 undefined 时的默认值
 * @returns 带默认值的字符串 schema
 */
export function defaultString(
  defaultValue: string,
): z.ZodDefault<z.ZodString> {
  return z.string().default(() => defaultValue);
}

/**
 * 创建带默认值的正整数 schema。
 *
 * @param defaultValue - 当输入为 undefined 时的默认值
 * @returns 带默认值的正整数 schema
 */
export function defaultPositiveInt(
  defaultValue: number,
): z.ZodDefault<z.ZodNumber> {
  return z.number().int().positive().default(() => defaultValue);
}

/**
 * 创建枚举 schema（从字符串联合类型生成）。
 *
 * @param values - 枚举允许的字符串值列表（至少一个）
 * @returns 枚举 schema
 */
export function enumFromValues<const T extends readonly [string, ...string[]]>(
  values: T,
): z.ZodEnum<{ [K in T[number]]: K }> {
  return z.enum(values);
}

// ─────────────────────────────────────────────────────────────
// 第六部分：类型导出
// ─────────────────────────────────────────────────────────────

/** ZodError 的便捷类型引用 */
export type { ZodError } from "zod";

/** ZodSafeParseSuccess 的便捷类型引用 */
export type { ZodSafeParseSuccess } from "zod";

/** ZodSafeParseError 的便捷类型引用 */
export type { ZodSafeParseError } from "zod";
