// ============================================================
// 🌿 Cortex 技能注册表 — Result 类型工具
// 实现：阿贝多
//
// @moved-from projects/solo-flight/src/utils/result.ts
// ============================================================

/** 简单的 Result 类型——用于需要返回成功/错误的场景 */
export type SimpleResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

/** 创建成功结果 */
export function ok<T>(data: T): SimpleResult<T> {
  return { success: true, data };
}

/** 创建空成功结果 */
export function okVoid(): SimpleResult<void> {
  return { success: true, data: undefined as unknown as void };
}

/** 创建失败结果 */
export function fail<T = void>(error: string): SimpleResult<T> {
  return { success: false, error };
}

/** 判断是否为成功结果 */
export function isOk<T>(result: SimpleResult<T>): result is { success: true; data: T } {
  return result.success;
}

/** 判断是否为失败结果 */
export function isFail<T>(result: SimpleResult<T>): result is { success: false; error: string } {
  return !result.success;
}

/** 安全执行异步函数，返回 Result */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  errorMessage?: string
): Promise<SimpleResult<T>> {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    const msg = errorMessage ?? (err instanceof Error ? err.message : String(err));
    return fail(msg);
  }
}

/** 安全执行同步函数，返回 Result */
export function tryCatchSync<T>(
  fn: () => T,
  errorMessage?: string
): SimpleResult<T> {
  try {
    return ok(fn());
  } catch (err) {
    const msg = errorMessage ?? (err instanceof Error ? err.message : String(err));
    return fail(msg);
  }
}
