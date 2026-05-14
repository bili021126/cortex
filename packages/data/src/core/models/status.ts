/**
 * status.ts — 任务状态枚举
 *
 * 状态流转（允许自由流转）：
 *   todo ←→ in-progress ←→ done
 *
 * 原位于 .cortex/archive/.../solo-flight/src/core/models/status.ts
 */

export enum TaskStatus {
  Todo       = 'todo',
  InProgress = 'in-progress',
  Done       = 'done',
}

/** 所有合法状态值列表 */
export const VALID_STATUSES: string[] = Object.values(TaskStatus);

/**
 * 检查字符串是否为合法状态值
 */
export function isValidStatus(value: string): value is TaskStatus {
  return VALID_STATUSES.includes(value);
}
