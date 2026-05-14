/**
 * task.repository.ts — 任务仓库接口
 *
 * 所有存储后端实现此接口，保证可替换性。
 *
 * 原位于 .cortex/archive/.../solo-flight/src/storage/interfaces/task.repository.ts
 */

import { Task } from '../../core/models/task.js';
import { TaskStatus } from '../../core/models/status.js';
import { Priority } from '../../core/models/priority.js';

export interface TaskFilter {
  status?: TaskStatus;
  priority?: Priority;
  tags?: string[];
  search?: string;
  includeDeleted?: boolean;
}

export interface TaskRepository {
  findAll(filter?: TaskFilter): Promise<Task[]>;
  findById(id: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: TaskFilter): Promise<number>;
}
