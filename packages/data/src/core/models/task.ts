/**
 * task.ts — 任务实体
 *
 * 领域模型，包含自验证逻辑。
 *
 * 原位于 .cortex/archive/.../solo-flight/src/core/models/task.ts
 */

import { TaskStatus, isValidStatus } from './status.js';
import { Priority, isValidPriority } from './priority.js';
import { generateId } from '../../utils/id.js';
import { nowISO } from '../../utils/date.js';

/**
 * 任务实体
 */
export class Task {
  public readonly id: string;
  public title: string;
  public description: string;
  public status: TaskStatus;
  public priority: Priority;
  public tags: string[];
  public readonly createdAt: string;
  public updatedAt: string;
  public deletedAt: string | null;

  constructor(data: TaskConstructorData) {
    this.id = data.id || generateId();
    this.title = data.title;
    this.description = data.description || '';
    this.status = data.status || TaskStatus.Todo;
    this.priority = data.priority ?? Priority.P2;
    this.tags = data.tags || [];
    this.createdAt = data.createdAt || nowISO();
    this.updatedAt = data.updatedAt || nowISO();
    this.deletedAt = data.deletedAt || null;

    this.validate();
  }

  validate(): void {
    if (!this.title || this.title.trim().length === 0) {
      throw new ValidationError('任务标题不能为空');
    }
    if (this.title.length > 200) {
      throw new ValidationError('任务标题不能超过 200 个字符');
    }
    if (!isValidStatus(this.status)) {
      throw new ValidationError(`非法状态值: ${this.status}`);
    }
    if (!isValidPriority(this.priority)) {
      throw new ValidationError(`非法优先级: ${this.priority}`);
    }
  }

  update(partial: Partial<TaskUpdateData>): void {
    if (partial.title !== undefined) this.title = partial.title;
    if (partial.description !== undefined) this.description = partial.description;
    if (partial.status !== undefined) {
      if (!isValidStatus(partial.status)) {
        throw new ValidationError(`非法状态值: ${partial.status}`);
      }
      this.status = partial.status;
    }
    if (partial.priority !== undefined) {
      if (!isValidPriority(partial.priority)) {
        throw new ValidationError(`非法优先级: ${partial.priority}`);
      }
      this.priority = partial.priority;
    }
    if (partial.tags !== undefined) this.tags = partial.tags;
    this.updatedAt = nowISO();
    this.validate();
  }

  start(): void {
    this.status = TaskStatus.InProgress;
    this.updatedAt = nowISO();
  }

  done(): void {
    this.status = TaskStatus.Done;
    this.updatedAt = nowISO();
  }

  softDelete(): void {
    this.deletedAt = nowISO();
    this.updatedAt = nowISO();
  }

  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  toJSON(): TaskJSON {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      status: this.status,
      priority: this.priority,
      tags: [...this.tags],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      deletedAt: this.deletedAt,
    };
  }

  static fromJSON(data: TaskJSON): Task {
    return new Task(data);
  }

  get statusLabel(): string {
    const labels: Record<TaskStatus, string> = {
      [TaskStatus.Todo]: '待办',
      [TaskStatus.InProgress]: '进行中',
      [TaskStatus.Done]: '已完成',
    };
    return labels[this.status] || this.status;
  }
}

export interface TaskConstructorData {
  id?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface TaskUpdateData {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  tags?: string[];
}

export interface TaskJSON {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
