// @ci: unit
/**
 * utils.test.ts — @cortex/data 工具函数单元测试
 */

import { describe, it, expect } from 'vitest';
import { generateId } from '../src/utils/id.js';
import { nowISO, formatDate, nowMs } from '../src/utils/date.js';

describe('id 工具', () => {
  it('generateId 返回 UUID 格式字符串', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generateId 每次调用返回不同 ID', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });
});

describe('date 工具', () => {
  it('nowISO 返回合法 ISO 时间戳', () => {
    const ts = nowISO();
    const d = new Date(ts);
    expect(d.toISOString()).toBe(ts);
  });

  it('formatDate 格式化中文日期', () => {
    const formatted = formatDate('2024-06-15T10:30:00.000Z');
    expect(typeof formatted).toBe('string');
    expect(formatted).not.toBe('无效日期');
  });

  it('formatDate 处理无效日期', () => {
    expect(formatDate('not-a-date')).toBe('无效日期');
  });

  it('formatDate 处理空字符串', () => {
    expect(formatDate('')).toBe('无效日期');
  });

  it('nowMs 返回当前时间戳', () => {
    const ms = nowMs();
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThan(0);
  });
});
