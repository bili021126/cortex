/**
 * task.service.ts — 任务服务：核心业务逻辑编排者
 *
 * 依赖 TaskRepository 接口而非具体实现。
 * 不感知 CLI 或任何 IO 细节，只操作领域对象。
 *
 * 原位于 .cortex/archive/.../solo-flight/src/core/services/task.service.ts
 */

import { Task, TaskUpdateData } from '../models/task.js';
import { TaskStatus } from '../models/status.js';
import { Priority } from '../models/priority.js';
import { TaskRepository, TaskFilter } from '../../storage/interfaces/task.repository.js';
import { TaskNotFoundError, TaskDeletedError } from '../../storage/errors.js';

export interface TaskStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  byPriority: Record<number, number>;
}

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  async add(params: { title: string; description?: string; priority?: Priority; tags?: string[] }): Promise<Task> {
    const task = new Task({
      title: params.title,
      description: params.description,
      priority: params.priority ?? Priority.P2,
      tags: params.tags || [],
    });

    await this.repository.save(task);
    return task;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    return this.repository.findAll(filter);
  }

  async show(id: string): Promise<Task> {
    const task = await this.repository.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    if (task.isDeleted) throw new TaskDeletedError(id);
    return task;
  }

  async update(id: string, data: TaskUpdateData): Promise<Task> {
    const task = await this.repository.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    if (task.isDeleted) throw new TaskDeletedError(id);
    task.update(data);
    await this.repository.save(task);
    return task;
  }

  async delete(id: string): Promise<{ alreadyDeleted: boolean }> {
    const task = await this.repository.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    if (task.isDeleted) return { alreadyDeleted: true };
    task.softDelete();
    await this.repository.save(task);
    return { alreadyDeleted: false };
  }

  async start(id: string): Promise<Task> {
    const task = await this.repository.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    if (task.isDeleted) throw new TaskDeletedError(id);
    task.start();
    await this.repository.save(task);
    return task;
  }

  async done(id: string): Promise<Task> {
    const task = await this.repository.findById(id);
    if (!task) throw new TaskNotFoundError(id);
    if (task.isDeleted) throw new TaskDeletedError(id);
    task.done();
    await this.repository.save(task);
    return task;
  }

  async stats(): Promise<TaskStats> {
    const all = await this.repository.findAll({ includeDeleted: false });

    const stats: TaskStats = {
      total: all.length,
      todo: 0,
      inProgress: 0,
      done: 0,
      byPriority: { 0: 0, 1: 0, 2: 0, 3: 0 },
    };

    for (const task of all) {
      if (task.status === TaskStatus.Todo) stats.todo++;
      if (task.status === TaskStatus.InProgress) stats.inProgress++;
      if (task.status === TaskStatus.Done) stats.done++;
      stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;
    }

    return stats;
  }
}
