// @ci: unit
/**
 * priority.test.ts — @cortex/data Priority 枚举单元测试
 */

import { describe, it, expect } from 'vitest';
import { Priority, isValidPriority, VALID_PRIORITIES, priorityLabel } from '../src/core/models/priority.js';

describe('Priority', () => {
  it('枚举值正确', () => {
    expect(Priority.P0).toBe(0);
    expect(Priority.P1).toBe(1);
    expect(Priority.P2).toBe(2);
    expect(Priority.P3).toBe(3);
  });

  it('VALID_PRIORITIES 包含所有合法值', () => {
    expect(VALID_PRIORITIES).toEqual([0, 1, 2, 3]);
  });

  it('isValidPriority 校验正确', () => {
    expect(isValidPriority(0)).toBe(true);
    expect(isValidPriority(1)).toBe(true);
    expect(isValidPriority(2)).toBe(true);
    expect(isValidPriority(3)).toBe(true);
    expect(isValidPriority(-1)).toBe(false);
    expect(isValidPriority(4)).toBe(false);
  });

  it('priorityLabel 返回带 emoji 标签', () => {
    expect(priorityLabel(Priority.P0)).toContain('P0');
    expect(priorityLabel(Priority.P0)).toContain('🔥');
    expect(priorityLabel(Priority.P1)).toContain('⚡');
    expect(priorityLabel(Priority.P2)).toContain('📋');
    expect(priorityLabel(Priority.P3)).toContain('🍃');
  });
});
