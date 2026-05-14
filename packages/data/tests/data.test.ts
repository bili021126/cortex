/**
 * data.test.ts — @cortex/data 单元测试
 *
 * 验证任务实体、状态、优先级、格式化等核心功能
 */

import { describe, it, expect } from 'vitest';
import { Task, TaskStatus, Priority, ValidationError } from '../src/index.js';
import { isValidStatus } from '../src/core/models/status.js';
import { priorityLabel } from '../src/core/models/priority.js';

describe('@cortex/data', () => {
  describe('Task 实体', () => {
    it('创建有效任务', () => {
      const task = new Task({ title: '测试任务' });
      expect(task.title).toBe('测试任务');
      expect(task.status).toBe(TaskStatus.Todo);
      expect(task.priority).toBe(Priority.P2);
      expect(task.id).toBeTruthy();
      expect(task.isDeleted).toBe(false);
    });

    it('标题为空时抛出 ValidationError', () => {
      expect(() => new Task({ title: '' })).toThrow(ValidationError);
      expect(() => new Task({ title: '   ' })).toThrow(ValidationError);
    });

    it('标题超过 200 字符时抛出 ValidationError', () => {
      expect(() => new Task({ title: 'x'.repeat(201) })).toThrow(ValidationError);
    });

    it('非法状态抛出 ValidationError', () => {
      expect(() => new Task({ title: 'test', status: 'invalid' as TaskStatus })).toThrow(ValidationError);
    });
  });

  describe('Task 状态流转', () => {
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

    it('softDelete() 标记为已删除', () => {
      const task = new Task({ title: 'test' });
      task.softDelete();
      expect(task.isDeleted).toBe(true);
      expect(task.deletedAt).toBeTruthy();
    });
  });

  describe('Task JSON 序列化', () => {
    it('toJSON/fromJSON 往返一致', () => {
      const original = new Task({
        title: '往返测试',
        description: '测试描述',
        priority: Priority.P1,
        tags: ['test', 'demo'],
      });
      original.start();

      const json = original.toJSON();
      const restored = Task.fromJSON(json);

      expect(restored.title).toBe(original.title);
      expect(restored.description).toBe(original.description);
      expect(restored.status).toBe(original.status);
      expect(restored.priority).toBe(original.priority);
      expect(restored.tags).toEqual(original.tags);
      expect(restored.id).toBe(original.id);
    });
  });

  describe('TaskStatus', () => {
    it('isValidStatus 验证合法状态', () => {
      expect(isValidStatus('todo')).toBe(true);
      expect(isValidStatus('in-progress')).toBe(true);
      expect(isValidStatus('done')).toBe(true);
      expect(isValidStatus('invalid')).toBe(false);
    });
  });

  describe('Priority', () => {
    it('priorityLabel 返回可读标签', () => {
      expect(priorityLabel(Priority.P0)).toContain('P0');
      expect(priorityLabel(Priority.P3)).toContain('P3');
    });
  });
});
