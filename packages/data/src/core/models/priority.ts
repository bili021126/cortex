/**
 * priority.ts — 任务优先级
 *
 * P0 = 最高，P3 = 最低
 *
 * 原位于 .cortex/archive/.../solo-flight/src/core/models/priority.ts
 */

export enum Priority {
  P0 = 0,
  P1 = 1,
  P2 = 2,
  P3 = 3,
}

/** 所有合法优先级值列表 */
export const VALID_PRIORITIES: number[] = [0, 1, 2, 3];

/**
 * 检查数值是否为合法优先级
 */
export function isValidPriority(value: number): value is Priority {
  return VALID_PRIORITIES.includes(value);
}

/**
 * 将优先级数字转为可读标签
 */
export function priorityLabel(p: Priority): string {
  const labels: Record<Priority, string> = {
    [Priority.P0]: 'P0 🔥',
    [Priority.P1]: 'P1 ⚡',
    [Priority.P2]: 'P2 📋',
    [Priority.P3]: 'P3 🍃',
  };
  return labels[p] || `P${p}`;
}
