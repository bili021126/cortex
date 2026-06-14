// @ci: unit
/**
 * task.test.ts — @cortex/data Task 实体单元测试
 */

import { describe, it, expect } from 'vitest';
import { Task, ValidationError } from '../src/core/models/task.js';
import { TaskStatus } from '../src/core/models/status.js';
import { Priority } from '../src/core/models/priority.js';

describe('Task 实体', () => {
  it('应从必填字段创建 Task', () => {
    const task = new Task({ title: '测试任务' });
    expect(task.title).toBe('测试任务');
    expect(task.description).toBe('');
    expect(task.status).toBe(TaskStatus.Todo);
    expect(task.priority).toBe(Priority.P2);
    expect(task.tags).toEqual([]);
    expect(task.id).toBeTruthy();
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();
    expect(task.deletedAt).toBeNull();
  });

  it('应使用传入的完整数据创建 Task', () => {
    const task = new Task({
      id: 'task-001',
      title: '完整任务',
      description: '详细描述',
      status: TaskStatus.InProgress,
      priority: Priority.P0,
      tags: ['urgent', 'bug'],
    });
    expect(task.id).toBe('task-001');
    expect(task.title).toBe('完整任务');
    expect(task.description).toBe('详细描述');
    expect(task.status).toBe(TaskStatus.InProgress);
    expect(task.priority).toBe(Priority.P0);
    expect(task.tags).toEqual(['urgent', 'bug']);
  });

  it('拒绝空标题', () => {
    expect(() => new Task({ title: '' })).toThrow(ValidationError);
    expect(() => new Task({ title: '   ' })).toThrow(ValidationError);
  });

  it('拒绝超过 200 字符的标题', () => {
    const longTitle = 'x'.repeat(201);
    expect(() => new Task({ title: longTitle })).toThrow(ValidationError);
  });

  it('接受 200 字符标题', () => {
    const okTitle = 'x'.repeat(200);
    const task = new Task({ title: okTitle });
    expect(task.title).toHaveLength(200);
  });

  it('拒绝非法状态值', () => {
    expect(() => new Task({ title: 'test', status: 'invalid' as TaskStatus })).toThrow(ValidationError);
  });

  it('拒绝非法优先级', () => {
    expect(() => new Task({ title: 'test', priority: 99 as Priority })).toThrow(ValidationError);
  });

  it('update() 应更新字段', async () => {
    const task = new Task({ title: '原标题' });
    // 等待至少 1ms 确保 updatedAt 与 createdAt 不同
    await new Promise((r) => setTimeout(r, 2));
    task.update({ title: '新标题', description: '新描述' });
    expect(task.title).toBe('新标题');
    expect(task.description).toBe('新描述');
    expect(task.updatedAt).not.toBe(task.createdAt);
  });

  it('update() 拒绝非法状态', () => {
    const task = new Task({ title: 'test' });
    expect(() => task.update({ status: 'invalid' as TaskStatus })).toThrow(ValidationError);
  });

  it('start() 将状态设为 InProgress', () => {
    const task = new Task({ title: 'test' });
    task.start();
    expect(task.status).toBe(TaskStatus.InProgress);
  });

  it('done() 将状态设为 Done', () => {
    const task = new Task({ title: 'test' });
    task.done();
    expect(task.status).toBe(TaskStatus.Done);
  });

  it('softDelete() 标记已删除', () => {
    const task = new Task({ title: 'test' });
    expect(task.isDeleted).toBe(false);
    task.softDelete();
    expect(task.isDeleted).toBe(true);
    expect(task.deletedAt).toBeTruthy();
  });

  it('toJSON() 返回正确的序列化格式', () => {
    const task = new Task({ title: 'test', tags: ['a'] });
    const json = task.toJSON();
    expect(json.id).toBe(task.id);
    expect(json.title).toBe('test');
    expect(json.tags).toEqual(['a']);
    expect(json.deletedAt).toBeNull();
  });

  it('fromJSON() 正确反序列化', () => {
    const task = Task.fromJSON({
      id: 'tid-1',
      title: '还原任务',
      description: '',
      status: TaskStatus.Done,
      priority: Priority.P1,
      tags: ['done'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      deletedAt: null,
    });
    expect(task.title).toBe('还原任务');
    expect(task.status).toBe(TaskStatus.Done);
    expect(task.priority).toBe(Priority.P1);
  });

  it('statusLabel 返回中文标签', () => {
    const todo = new Task({ title: 't' });
    expect(todo.statusLabel).toBe('待办');
    const ip = new Task({ title: 't', status: TaskStatus.InProgress });
    expect(ip.statusLabel).toBe('进行中');
    const done = new Task({ title: 't', status: TaskStatus.Done });
    expect(done.statusLabel).toBe('已完成');
  });
});
