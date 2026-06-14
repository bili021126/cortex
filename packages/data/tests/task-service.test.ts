// @ci: unit
/**
 * task-service.test.ts — @cortex/data TaskService 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TaskService } from '../src/core/services/task.service.js';
import { Task } from '../src/core/models/task.js';
import { TaskStatus } from '../src/core/models/status.js';
import { Priority } from '../src/core/models/priority.js';
import type { TaskRepository, TaskFilter } from '../src/storage/interfaces/task.repository.js';
import { TaskNotFoundError, TaskDeletedError } from '../src/storage/errors.js';

/** 内存 Mock 仓库 */
class MockRepository implements TaskRepository {
  private store = new Map<string, Task>();

  async findAll(filter?: TaskFilter): Promise<Task[]> {
    let tasks = Array.from(this.store.values());
    if (!filter?.includeDeleted) {
      tasks = tasks.filter(t => !t.isDeleted);
    }
    if (filter?.status !== undefined) {
      tasks = tasks.filter(t => t.status === filter.status);
    }
    if (filter?.priority !== undefined) {
      tasks = tasks.filter(t => t.priority === filter.priority);
    }
    tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return tasks;
  }

  async findById(id: string): Promise<Task | null> {
    return this.store.get(id) ?? null;
  }

  async save(task: Task): Promise<void> {
    this.store.set(task.id, task);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(filter?: TaskFilter): Promise<number> {
    const tasks = await this.findAll(filter);
    return tasks.length;
  }
}

describe('TaskService', () => {
  let repo: MockRepository;
  let service: TaskService;

  beforeEach(() => {
    repo = new MockRepository();
    service = new TaskService(repo);
  });

  it('add() 创建并保存任务', async () => {
    const task = await service.add({ title: '新任务', priority: Priority.P1, tags: ['bug'] });
    expect(task.title).toBe('新任务');
    expect(task.priority).toBe(Priority.P1);
    expect(task.tags).toEqual(['bug']);
    const found = await repo.findById(task.id);
    expect(found).toBeTruthy();
  });

  it('add() 默认使用 P2 优先级', async () => {
    const task = await service.add({ title: '默认优先级' });
    expect(task.priority).toBe(Priority.P2);
  });

  it('list() 返回所有非删除任务', async () => {
    await service.add({ title: 'A' });
    await service.add({ title: 'B' });
    const tasks = await service.list();
    expect(tasks).toHaveLength(2);
  });

  it('list() 支持过滤', async () => {
    await service.add({ title: 'A', priority: Priority.P0 });
    await service.add({ title: 'B', priority: Priority.P2 });
    const tasks = await service.list({ priority: Priority.P0 });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('A');
  });

  it('show() 返回未删除任务', async () => {
    const added = await service.add({ title: '展示' });
    const found = await service.show(added.id);
    expect(found.id).toBe(added.id);
  });

  it('show() 抛出 TaskNotFoundError', async () => {
    await expect(service.show('nonexistent')).rejects.toThrow(TaskNotFoundError);
  });

  it('show() 抛出 TaskDeletedError', async () => {
    const t = await service.add({ title: '将被删除' });
    await service.delete(t.id);
    await expect(service.show(t.id)).rejects.toThrow(TaskDeletedError);
  });

  it('update() 更新并保存', async () => {
    const t = await service.add({ title: '旧标题' });
    const updated = await service.update(t.id, { title: '新标题' });
    expect(updated.title).toBe('新标题');
  });

  it('update() 不存在的任务抛出错误', async () => {
    await expect(service.update('nope', { title: 'x' })).rejects.toThrow(TaskNotFoundError);
  });

  it('delete() 软删除任务', async () => {
    const t = await service.add({ title: '待删' });
    const result = await service.delete(t.id);
    expect(result.alreadyDeleted).toBe(false);
    const found = await repo.findById(t.id);
    expect(found?.isDeleted).toBe(true);
  });

  it('delete() 已删除任务返回标记', async () => {
    const t = await service.add({ title: '再删' });
    await service.delete(t.id);
    const result = await service.delete(t.id);
    expect(result.alreadyDeleted).toBe(true);
  });

  it('start() 将任务设为进行中', async () => {
    const t = await service.add({ title: '开始' });
    const started = await service.start(t.id);
    expect(started.status).toBe(TaskStatus.InProgress);
  });

  it('done() 将任务设为已完成', async () => {
    const t = await service.add({ title: '完成' });
    const done = await service.done(t.id);
    expect(done.status).toBe(TaskStatus.Done);
  });

  it('stats() 返回统计信息', async () => {
    await service.add({ title: '待办' });
    const ip = await service.add({ title: '进行中' });
    await service.start(ip.id);
    const done = await service.add({ title: '已完成' });
    await service.done(done.id);

    const stats = await service.stats();
    expect(stats.total).toBe(3);
    expect(stats.todo).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.done).toBe(1);
    expect(typeof stats.byPriority).toBe('object');
  });
});
