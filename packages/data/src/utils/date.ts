/**
 * date.ts — 日期工具函数
 *
 * 原位于 .cortex/archive/.../solo-flight/src/utils/date.ts
 */

/**
 * 获取当前 ISO 时间戳字符串
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * 格式化日期为可读字符串
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '无效日期';
  }
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 获取当前时间戳（毫秒）
 */
export function nowMs(): number {
  return Date.now();
}
