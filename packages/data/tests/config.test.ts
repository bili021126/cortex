// @ci: unit
/**
 * config.test.ts — @cortex/data 应用配置单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getConfig } from '../src/config/index.js';

describe('应用配置', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    // 清除 getConfig 内部缓存
    // 由于 _config 模块级变量无法直接访问，每个测试环境变量不同即可
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('loadConfig 返回默认配置', () => {
    const config = loadConfig();
    expect(config.storage.type).toBe('json');
    expect(config.storage.path).toBeTruthy();
    expect(config.storage.path).toContain('tasks.json');
    expect(config.appearance.defaultFormat).toBe('table');
    expect(config.appearance.colorEnabled).toBe(true);
  });

  it('loadConfig 读取环境变量', () => {
    process.env.TASK_STORAGE = 'json';
    process.env.TASK_DATA_PATH = '/custom/path/tasks.json';
    process.env.TASK_FORMAT = 'json';
    process.env.TASK_NO_COLOR = '1';

    const config = loadConfig();
    expect(config.storage.path).toBe('/custom/path/tasks.json');
    expect(config.appearance.defaultFormat).toBe('json');
    expect(config.appearance.colorEnabled).toBe(false);
  });

  it('getConfig 返回配置快照（不可变副本）', () => {
    const config1 = getConfig();
    const config2 = getConfig();
    // 两次调用返回不同对象
    expect(config1).not.toBe(config2);
    // 但值相同
    expect(config1.appearance.defaultFormat).toBe(config2.appearance.defaultFormat);
  });
});
