// @ci: unit
/**
 * json-file-adapter.test.ts — @cortex/data JSON 文件存储适配器单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { JsonFileAdapter } from '../src/storage/adapters/json-file.adapter.js';
import { Task } from '../src/core/models/task.js';
import { TaskNotFoundError, StorageIOError } from '../src/storage/errors.js';

describe('JsonFileAdapter', () => {
  let tmpDir: string;
  let dataPath: string;
  let adapter: JsonFileAdapter;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-test-'));
    dataPath = path.join(tmpDir, 'tasks.json');
    adapter = new JsonFileAdapter(dataPath);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('save() 后 findById() 可检索', async () => {
    const task = new Task({ id: 't1', title: '测试' });
    await adapter.save(task);
    const found = await adapter.findById('t1');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('测试');
  });

  it('findById() 不存在返回 null', async () => {
    const found = await adapter.findById('nonexistent');
    expect(found).toBeNull();
  });

  it('save() 写入文件后重启可读取', async () => {
    const task = new Task({ id: 't2', title: '持久化' });
    await adapter.save(task);

    // 新建一个 adapter 实例读取同一文件
    const adapter2 = new JsonFileAdapter(dataPath);
    const found = await adapter2.findById('t2');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('持久化');
  });

  it('findAll() 返回全部非删除任务', async () => {
    await adapter.save(new Task({ id: 'a', title: 'A' }));
    await adapter.save(new Task({ id: 'b', title: 'B' }));
    const tasks = await adapter.findAll();
    expect(tasks).toHaveLength(2);
  });

  it('findAll() 过滤已删除', async () => {
    const task = new Task({ id: 'del', title: '已删' });
    task.softDelete();
    await adapter.save(task);
    const tasks = await adapter.findAll();
    expect(tasks).toHaveLength(0);
    const withDeleted = await adapter.findAll({ includeDeleted: true });
    expect(withDeleted).toHaveLength(1);
  });

  it('findAll() 按状态过滤', async () => {
    const a = new Task({ id: 'a', title: 'A' });
    a.start();
    await adapter.save(a);
    await adapter.save(new Task({ id: 'b', title: 'B' }));
    const todo = await adapter.findAll({ status: 'todo' as any });
    expect(todo).toHaveLength(1);
    expect(todo[0].id).toBe('b');
  });

  it('findAll() 按搜索词过滤', async () => {
    await adapter.save(new Task({ id: 'a', title: 'Alpha', description: '测试' }));
    await adapter.save(new Task({ id: 'b', title: 'Beta', tags: ['urgent'] }));
    const results = await adapter.findAll({ search: 'Beta' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('b');

    const all = await adapter.findAll({ search: '' });
    expect(all).toHaveLength(2);
  });

  it('delete() 移除任务', async () => {
    await adapter.save(new Task({ id: 'd1', title: '待删' }));
    await adapter.delete('d1');
    const found = await adapter.findById('d1');
    expect(found).toBeNull();
  });

  it('delete() 不存在抛出错误', async () => {
    await expect(adapter.delete('nope')).rejects.toThrow(TaskNotFoundError);
  });

  it('count() 返回数量', async () => {
    await adapter.save(new Task({ id: 'c1', title: 'C1' }));
    await adapter.save(new Task({ id: 'c2', title: 'C2' }));
    expect(await adapter.count()).toBe(2);
    expect(await adapter.count({ status: 'done' as any })).toBe(0);
  });

  it('文件不存在时自动创建', async () => {
    expect(fs.existsSync(dataPath)).toBe(false);
    await adapter.findAll();
    // 文件应被创建
    expect(fs.existsSync(dataPath)).toBe(true);
  });

  it('空文件可正常加载', async () => {
    fs.writeFileSync(dataPath, '', 'utf-8');
    const tasks = await adapter.findAll();
    expect(tasks).toEqual([]);
  });

  it('损坏文件抛出 StorageIOError', async () => {
    fs.writeFileSync(dataPath, '{坏 json', 'utf-8');
    await expect(adapter.findAll()).rejects.toThrow(StorageIOError);
  });
});
