/**
 * json-file.adapter.ts — JSON 文件存储适配器
 *
 * 将任务数据存储为 JSON 文件。
 * 写操作使用原子写入（写临时文件 → rename）。
 *
 * 原位于 .cortex/archive/.../solo-flight/src/storage/adapters/json-file.adapter.ts
 *
 * @fix P2-9 — 同步 I/O 置换为异步 fs.promises，避免阻塞事件循环
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { Task, TaskJSON } from '../../core/models/task.js';
import { TaskRepository, TaskFilter } from '../interfaces/task.repository.js';
import { TaskNotFoundError, StorageIOError } from '../errors.js';

export class JsonFileAdapter implements TaskRepository {
  private tasks: Map<string, Task> = new Map();
  private readonly filePath: string;
  private loaded: boolean = false;
  private _loadPromise: Promise<void> | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  /** ensureDir 仍使用同步版本——目录创建是轻量操作，避免在每个 I/O 前引入额外 await */
  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    // 防并发：多个请求同时触发 load 时，首个请求负责加载，后续请求等待
    if (this._loadPromise) {
      await this._loadPromise;
      return;
    }

    this._loadPromise = this._doLoad();
    try {
      await this._loadPromise;
    } finally {
      this._loadPromise = null;
    }
  }

  private async _doLoad(): Promise<void> {
    this.ensureDir();

    let fileExists = false;
    try {
      await readFile(this.filePath, 'utf-8');
      fileExists = true;
    } catch {
      fileExists = false;
    }

    if (!fileExists) {
      this.tasks = new Map();
      this.loaded = true;
      return;
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8');

      if (!raw || raw.trim().length === 0) {
        this.tasks = new Map();
        this.loaded = true;
        return;
      }

      const data: { version: number; tasks: Record<string, TaskJSON> } = JSON.parse(raw);

      this.tasks = new Map();
      if (data && data.tasks) {
        for (const [id, taskData] of Object.entries(data.tasks)) {
          this.tasks.set(id, Task.fromJSON(taskData));
        }
      }
      this.loaded = true;
    } catch (err) {
      throw new StorageIOError(
        `无法读取任务数据文件: ${this.filePath}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  private async persist(): Promise<void> {
    this.ensureDir();

    const data: { version: number; tasks: Record<string, TaskJSON> } = {
      version: 1,
      tasks: {},
    };

    for (const [id, task] of this.tasks) {
      data.tasks[id] = task.toJSON();
    }

    const content = JSON.stringify(data, null, 2);
    const tmpPath = this.filePath + '.tmp';

    try {
      await writeFile(tmpPath, content, 'utf-8');
      await rename(tmpPath, this.filePath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw new StorageIOError(
        `无法写入任务数据文件: ${this.filePath}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async findAll(filter?: TaskFilter): Promise<Task[]> {
    await this.load();

    let result = Array.from(this.tasks.values());

    if (!filter?.includeDeleted) {
      result = result.filter(t => !t.isDeleted);
    }

    if (filter) {
      if (filter.status !== undefined) {
        result = result.filter(t => t.status === filter.status);
      }
      if (filter.priority !== undefined) {
        result = result.filter(t => t.priority === filter.priority);
      }
      if (filter.tags && filter.tags.length > 0) {
        result = result.filter(t =>
          filter.tags!.some(tag => t.tags.includes(tag)),
        );
      }
      if (filter.search && filter.search.trim()) {
        const keyword = filter.search.toLowerCase();
        result = result.filter(t =>
          t.title.toLowerCase().includes(keyword)
          || t.description.toLowerCase().includes(keyword)
          || t.tags.some(tag => tag.toLowerCase().includes(keyword))
        );
      }
    }

    result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return result;
  }

  async findById(id: string): Promise<Task | null> {
    await this.load();
    return this.tasks.get(id) || null;
  }

  async save(task: Task): Promise<void> {
    await this.load();
    this.tasks.set(task.id, task);
    await this.persist();
  }

  async delete(id: string): Promise<void> {
    await this.load();
    if (!this.tasks.has(id)) {
      throw new TaskNotFoundError(id);
    }
    this.tasks.delete(id);
    await this.persist();
  }

  async count(filter?: TaskFilter): Promise<number> {
    const tasks = await this.findAll(filter);
    return tasks.length;
  }
}
