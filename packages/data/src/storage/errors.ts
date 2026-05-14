/**
 * errors.ts — 存储层错误类型
 *
 * 原位于 .cortex/archive/.../solo-flight/src/storage/errors.ts
 */

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`任务未找到: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskDeletedError extends Error {
  constructor(id: string) {
    super(`任务已删除，无法操作: ${id}`);
    this.name = 'TaskDeletedError';
  }
}

export class StorageIOError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'StorageIOError';
  }
}
