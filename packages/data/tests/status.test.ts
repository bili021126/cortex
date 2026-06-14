// @ci: unit
/**
 * status.test.ts — @cortex/data TaskStatus 枚举单元测试
 */

import { describe, it, expect } from 'vitest';
import { TaskStatus, isValidStatus, VALID_STATUSES } from '../src/core/models/status.js';

describe('TaskStatus', () => {
  it('枚举值正确', () => {
    expect(TaskStatus.Todo).toBe('todo');
    expect(TaskStatus.InProgress).toBe('in-progress');
    expect(TaskStatus.Done).toBe('done');
  });

  it('VALID_STATUSES 包含所有合法值', () => {
    expect(VALID_STATUSES).toEqual(['todo', 'in-progress', 'done']);
  });

  it('isValidStatus 校验正确', () => {
    expect(isValidStatus('todo')).toBe(true);
    expect(isValidStatus('in-progress')).toBe(true);
    expect(isValidStatus('done')).toBe(true);
    expect(isValidStatus('pending')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus('deleted')).toBe(false);
  });
});
