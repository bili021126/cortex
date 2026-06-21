// ============================================================
// @cortex/result — Rust-style Result<T, E> 类型
//
// 所有公共 API 均提供完整 JSDoc。
// 零 any / 零非空断言 / 零空 catch 块。
// ============================================================

/**
 * PanicError —— 当对 Err 值调用 unwrap / expect 时抛出的错误。
 *
 * 继承自 Error，保留原始错误原因链。
 */
export class PanicError extends Error {
  override readonly name = "PanicError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Result<T, E> —— 表示一个可能成功或失败的操作结果。
 *
 * 受 Rust 标准库 `std::result::Result` 启发。
 * - `Ok` 变体：操作成功，包含类型为 `T` 的值。
 * - `Err` 变体：操作失败，包含类型为 `E` 的错误。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型
 */
export type Result<T, E> =
  | { readonly _tag: "Ok"; readonly value: T }
  | { readonly _tag: "Err"; readonly error: E };

// ─── 构造函数 ───────────────────────────────────────────

/**
 * 创建一个 Ok 变体的 Result。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型（通常由 TypeScript 推断为 `never`）
 * @param value — 成功值
 * @returns 包含 `value` 的 Ok Result
 *
 * @example
 * ```ts
 * const r: Result<number, string> = ok(42);
 * ```
 */
export function ok<T, E = never>(value: T): Result<T, E> {
  return { _tag: "Ok", value };
}

/**
 * 创建一个 Err 变体的 Result。
 *
 * @typeParam E — 错误值的类型
 * @typeParam T — 成功值的类型（通常由 TypeScript 推断为 `never`）
 * @param error — 错误值
 * @returns 包含 `error` 的 Err Result
 *
 * @example
 * ```ts
 * const r: Result<number, string> = err("file not found");
 * ```
 */
export function err<E, T = never>(error: E): Result<T, E> {
  return { _tag: "Err", error };
}

// ─── 类型守卫 ───────────────────────────────────────────

/**
 * 判断一个 Result 是否为 Ok 变体。
 *
 * 同时作为 TypeScript 类型守卫，将类型窄化为 Ok 分支。
 *
 * @param result — 待检查的 Result
 * @returns `true` 如果 Result 是 Ok
 *
 * @example
 * ```ts
 * if (isOk(result)) {
 *   console.log(result.value); // 类型已窄化
 * }
 * ```
 */
export function isOk<T, E>(result: Result<T, E>): result is { readonly _tag: "Ok"; readonly value: T } {
  return result._tag === "Ok";
}

/**
 * 判断一个 Result 是否为 Err 变体。
 *
 * 同时作为 TypeScript 类型守卫，将类型窄化为 Err 分支。
 *
 * @param result — 待检查的 Result
 * @returns `true` 如果 Result 是 Err
 *
 * @example
 * ```ts
 * if (isErr(result)) {
 *   console.error(result.error); // 类型已窄化
 * }
 * ```
 */
export function isErr<T, E>(result: Result<T, E>): result is { readonly _tag: "Err"; readonly error: E } {
  return result._tag === "Err";
}

// ─── 解包 ─────────────────────────────────────────────

/**
 * 解包 Result，返回 Ok 中的值。
 * 如果 Result 是 Err，则抛出 PanicError。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型
 * @param result — 待解包的 Result
 * @returns Ok 中的值
 * @throws {PanicError} 如果 Result 是 Err
 *
 * @example
 * ```ts
 * const val = unwrap(ok(42)); // 42
 * const val = unwrap(err("fail")); // throws PanicError
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw new PanicError(
    `Called unwrap on an Err value: ${String(result.error)}`,
    { cause: result.error },
  );
}

/**
 * 解包 Result，返回 Ok 中的值，或在 Err 时返回默认值。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型
 * @param result — 待解包的 Result
 * @param defaultValue — 当 Result 为 Err 时返回的默认值
 * @returns Ok 中的值或 `defaultValue`
 *
 * @example
 * ```ts
 * const val = unwrapOr(ok(42), 0); // 42
 * const val = unwrapOr(err("fail"), 0); // 0
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value;
  }
  return defaultValue;
}

/**
 * 解包 Result，返回 Ok 中的值，或在 Err 时通过函数计算替代值。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型
 * @param result — 待解包的 Result
 * @param fn — 接收错误值并返回替代值的函数
 * @returns Ok 中的值或 `fn` 的计算结果
 *
 * @example
 * ```ts
 * const val = unwrapOrElse(err("not found"), (e) => `fallback: ${e}`);
 * // "fallback: not found"
 * ```
 */
export function unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
  if (isOk(result)) {
    return result.value;
  }
  return fn(result.error);
}

/**
 * 解包 Result，返回 Ok 中的值，或在 Err 时抛出带自定义消息的 PanicError。
 *
 * @typeParam T — 成功值的类型
 * @typeParam E — 错误值的类型
 * @param result — 待解包的 Result
 * @param message — 自定义错误消息
 * @returns Ok 中的值
 * @throws {PanicError} 如果 Result 是 Err
 *
 * @example
 * ```ts
 * const val = expect(ok(42), "should succeed"); // 42
 * const val = expect(err("fail"), "data must exist"); // throws PanicError("data must exist")
 * ```
 */
export function expect<T, E>(result: Result<T, E>, message: string): T {
  if (isOk(result)) {
    return result.value;
  }
  throw new PanicError(message, { cause: result.error });
}

// ─── 转换 ─────────────────────────────────────────────

/**
 * 对 Ok 变体中的值应用转换函数，返回新的 Result。
 * Err 变体保持不变。
 *
 * @typeParam T — 原始成功值类型
 * @typeParam U — 转换后的成功值类型
 * @typeParam E — 错误值类型
 * @param result — 待转换的 Result
 * @param fn — 对 Ok 值应用的转换函数
 * @returns 转换后的 Result
 *
 * @example
 * ```ts
 * const r = map(ok(42), (n) => n.toString()); // Ok("42")
 * const r = map(err("fail"), (n) => n.toString()); // Err("fail")
 * ```
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * 对 Err 变体中的错误值应用转换函数，返回新的 Result。
 * Ok 变体保持不变。
 *
 * @typeParam T — 成功值类型
 * @typeParam E — 原始错误值类型
 * @typeParam F — 转换后的错误值类型
 * @param result — 待转换的 Result
 * @param fn — 对 Err 值应用的转换函数
 * @returns 转换后的 Result
 *
 * @example
 * ```ts
 * const r = mapErr(err("not_found"), (e) => `error: ${e}`); // Err("error: not_found")
 * const r = mapErr(ok(42), (e) => `error: ${e}`); // Ok(42)
 * ```
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error));
  }
  return result;
}

// ─── 链式操作 ─────────────────────────────────────────

/**
 * 对 Ok 变体中的值应用返回 Result 的函数，平铺嵌套的 Result。
 * 类似 Rust 的 `and_then`、FP 的 `flatMap` / `bind`。
 *
 * Err 变体保持不变。
 *
 * @typeParam T — 原始成功值类型
 * @typeParam U — 链式操作后的成功值类型
 * @typeParam E — 错误值类型
 * @param result — 待链式操作的 Result
 * @param fn — 对 Ok 值应用并返回 Result 的函数
 * @returns 链式操作后的 Result
 *
 * @example
 * ```ts
 * const r = andThen(ok(42), (n) => ok(n * 2)); // Ok(84)
 * const r = andThen(err("fail"), (n) => ok(n * 2)); // Err("fail")
 * ```
 */
export function andThen<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value);
  }
  return result;
}

/**
 * 对 Err 变体中的错误值应用返回 Result 的恢复函数。
 * 类似 Rust 的 `or_else`。
 *
 * Ok 变体保持不变。
 *
 * @typeParam T — 成功值类型
 * @typeParam E — 原始错误值类型
 * @typeParam F — 恢复后的错误值类型
 * @param result — 待恢复的 Result
 * @param fn — 对 Err 值应用并返回 Result 的恢复函数
 * @returns 恢复后的 Result
 *
 * @example
 * ```ts
 * const r = orElse(err("not_found"), (e) => ok(`recovered from ${e}`)); // Ok("recovered from not_found")
 * const r = orElse(ok(42), (e) => ok(`recovered from ${e}`)); // Ok(42)
 * ```
 */
export function orElse<T, E, F>(result: Result<T, E>, fn: (error: E) => Result<T, F>): Result<T, F> {
  if (isErr(result)) {
    return fn(result.error);
  }
  return result;
}

// ─── 模式匹配 ─────────────────────────────────────────

/**
 * 对 Result 的两个变体分别应用处理函数，返回统一类型的值。
 * 类似 Rust 的 `match` 表达式。
 *
 * @typeParam T — 成功值类型
 * @typeParam E — 错误值类型
 * @typeParam U — 两个处理函数的统一返回类型
 * @param result — 待匹配的 Result
 * @param handlers — 包含 `ok` 和 `err` 两个处理函数的对象
 * @returns 匹配结果
 *
 * @example
 * ```ts
 * const message = match(result, {
 *   ok: (val) => `Success: ${val}`,
 *   err: (e) => `Error: ${e}`,
 * });
 * ```
 */
export function match<T, E, U>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => U;
    err: (error: E) => U;
  },
): U {
  if (isOk(result)) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

// ─── try/catch 桥接 ───────────────────────────────────

/**
 * 将一个可能抛出异常的函数包装为返回 Result 的安全版本。
 *
 * @typeParam T — 函数成功返回值的类型
 * @typeParam E — 错误映射后的类型
 * @param fn — 可能抛出异常的同步函数
 * @param onError — 将捕获的异常映射为错误值 `E`
 * @returns 包装后的 Result
 *
 * @example
 * ```ts
 * const r = tryCatch(
 *   () => JSON.parse(rawJson),
 *   (e) => `Parse error: ${e instanceof Error ? e.message : String(e)}`,
 * );
 * ```
 */
export function tryCatch<T, E>(fn: () => T, onError: (error: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    return err(onError(e));
  }
}

/**
 * 将一个返回 Promise 的异步函数包装为返回 Promise<Result> 的安全版本。
 *
 * @typeParam T — 异步函数成功返回值的类型
 * @typeParam E — 错误映射后的类型
 * @param fn — 可能抛出异常或返回 rejected Promise 的异步函数
 * @param onError — 将捕获的异常映射为错误值 `E`
 * @returns 包装后的 Promise<Result>
 *
 * @example
 * ```ts
 * const r = await tryCatchAsync(
 *   () => fetch(url).then(r => r.json()),
 *   (e) => `Fetch error: ${e instanceof Error ? e.message : String(e)}`,
 * );
 * ```
 */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(onError(e));
  }
}

// ─── 集合操作 ─────────────────────────────────────────

/**
 * 将 `null` 或 `undefined` 转换为 Result。
 * 如果值不为 null/undefined，返回 Ok(value)；否则返回 Err(errorFn())。
 *
 * @typeParam T — 值类型
 * @typeParam E — 错误值类型
 * @param value — 可能为 null/undefined 的值
 * @param errorFn — 当值为 null/undefined 时调用的错误工厂函数
 * @returns Result<T, E>
 *
 * @example
 * ```ts
 * const r = fromNullable(someValue, () => "value is null");
 * ```
 */
export function fromNullable<T, E>(
  value: T | null | undefined,
  errorFn: () => E,
): Result<T, E> {
  if (value === null || value === undefined) {
    return err(errorFn());
  }
  return ok(value);
}

/**
 * 将数组中的 Result 聚合为一个 Result。
 * 如果所有 Result 均为 Ok，返回包含所有值的 Ok 数组。
 * 如果任一 Result 为 Err，返回第一个 Err。
 *
 * @typeParam T — 成功值类型
 * @typeParam E — 错误值类型
 * @param results — Result 数组
 * @returns 聚合后的 Result
 *
 * @example
 * ```ts
 * const r = all([ok(1), ok(2), ok(3)]); // Ok([1, 2, 3])
 * const r = all([ok(1), err("fail"), ok(3)]); // Err("fail")
 * ```
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (isOk(result)) {
      values.push(result.value);
    } else {
      return result;
    }
  }
  return ok(values);
}

// ─── 辅助 ─────────────────────────────────────────────

/**
 * 将 Result 转换为人类可读的字符串表示。
 *
 * @typeParam T — 成功值类型
 * @typeParam E — 错误值类型
 * @param result — 待格式化的 Result
 * @returns 格式化的字符串（如 `"Ok(42)"` 或 `"Err(file not found)"`）
 *
 * @example
 * ```ts
 * console.log(toString(ok(42))); // "Ok(42)"
 * console.log(toString(err("fail"))); // "Err(fail)"
 * ```
 */
export function toString<T, E>(result: Result<T, E>): string {
  if (isOk(result)) {
    return `Ok(${String(result.value)})`;
  }
  return `Err(${String(result.error)})`;
}
