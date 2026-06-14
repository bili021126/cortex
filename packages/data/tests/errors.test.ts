// @ci: unit
/**
 * errors.test.ts — @cortex/data 存储层错误类型单元测试
 */

import { describe, it, expect } from 'vitest';
import { TaskNotFoundError, TaskDeletedError, StorageIOError } from '../src/storage/errors.js';

describe('存储错误类型', () => {
  it('TaskNotFoundError 包含 ID', () => {
    const err = new TaskNotFoundError('task-42');
    expect(err.message).toContain('task-42');
    expect(err.name).toBe('TaskNotFoundError');
  });

  it('TaskDeletedError 包含 ID', () => {
    const err = new TaskDeletedError('task-42');
    expect(err.message).toContain('task-42');
    expect(err.name).toBe('TaskDeletedError');
  });

  it('StorageIOError 包含消息和可选的 cause', () => {
    const cause = new Error('磁盘已满');
    const err = new StorageIOError('无法写入文件', cause);
    expect(err.message).toBe('无法写入文件');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('StorageIOError');

    const errNoCause = new StorageIOError('读取失败');
    expect(errNoCause.cause).toBeUndefined();
  });
});
