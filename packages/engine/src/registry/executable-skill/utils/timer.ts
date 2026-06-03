// ============================================================
// 🌿 Cortex 技能注册表 — 超时控制工具
// 实现：阿贝多
//
// @moved-from projects/solo-flight/src/utils/timer.ts
// ============================================================

/**
 * 带超时的 Promise 包装
 * 如果超时，返回 SKILL_TIMEOUT 错误
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  skillId?: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const idInfo = skillId ? `[技能: ${skillId}] ` : '';
      reject(new Error(`${idInfo}执行超时 (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer!);
  }) as Promise<T>;
}
