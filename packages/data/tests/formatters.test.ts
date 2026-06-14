// @ci: unit
/**
 * formatters.test.ts — @cortex/data 格式化器单元测试
 */

import { describe, it, expect } from 'vitest';
import { Task, TaskStatus, Priority } from '../src/index.js';
import { JsonFormatter } from '../src/formatters/json.formatter.js';
import { PlainFormatter } from '../src/formatters/plain.formatter.js';
import { TableFormatter } from '../src/formatters/table.formatter.js';

function makeTask(overrides?: Partial<ConstructorParameters<typeof Task>[0]>): Task {
  return new Task({
    id: 'test-1',
    title: '测试任务',
    description: '描述',
    status: TaskStatus.Todo,
    priority: Priority.P2,
    tags: ['dev'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  });
}

describe('JsonFormatter', () => {
  it('formatList 输出 JSON 数组', () => {
    const fmt = new JsonFormatter();
    const result = fmt.formatList([makeTask()]);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe('测试任务');
  });

  it('formatDetail 输出 JSON 对象', () => {
    const fmt = new JsonFormatter();
    const result = fmt.formatDetail(makeTask());
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('test-1');
    expect(parsed.title).toBe('测试任务');
  });
});

describe('PlainFormatter', () => {
  it('formatList 空列表返回提示', () => {
    const fmt = new PlainFormatter();
    expect(fmt.formatList([])).toBe('暂无任务');
  });

  it('formatList 包含状态和标题', () => {
    const fmt = new PlainFormatter();
    const result = fmt.formatList([makeTask()]);
    expect(result).toContain('[待办]');
    expect(result).toContain('测试任务');
    expect(result).toContain('P2');
  });

  it('formatDetail 包含完整信息', () => {
    const fmt = new PlainFormatter();
    const result = fmt.formatDetail(makeTask());
    expect(result).toContain('测试任务');
    expect(result).toContain('test-1');
    expect(result).toContain('待办');
    expect(result).toContain('描述');
  });
});

describe('TableFormatter', () => {
  it('formatList 空列表返回提示', () => {
    const fmt = new TableFormatter();
    expect(fmt.formatList([])).toContain('暂无任务');
  });

  it('formatList 返回表格字符串', () => {
    const fmt = new TableFormatter();
    const result = fmt.formatList([makeTask()]);
    expect(result).toContain('测试任务');
    expect(result).toContain('待办');
  });

  it('formatDetail 返回详情格式', () => {
    const fmt = new TableFormatter();
    const result = fmt.formatDetail(makeTask());
    expect(result).toContain('测试任务');
    expect(result).toContain('test-1');
    expect(result).toContain('待办');
  });
});
