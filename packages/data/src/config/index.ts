/**
 * config/index.ts -- 应用配置
 *
 * 配置加载优先级：环境变量 > 默认值
 *
 * @fix P1-4 — 导出函数而非模块级常量，消除导入时的副作用。
 *   导入 @cortex/data 时不再立即触发文件系统操作（getProjectRoot）和环境变量读取。
 *
 * 原位于 .cortex/archive/.../solo-flight/src/config/index.ts
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface AppConfig {
  storage: {
    type: 'json';
    path: string;
  };
  appearance: {
    defaultFormat: 'table' | 'json' | 'plain';
    colorEnabled: boolean;
  };
}

function getProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  // src/config/index.ts -> data 包根 -> packages -> 项目根
  return resolve(dirname(dirname(dirname(dirname(__filename)))));
}

const defaultConfig: AppConfig = {
  storage: {
    type: 'json',
    path: resolve(getProjectRoot(), 'data', 'tasks.json'),
  },
  appearance: {
    defaultFormat: 'table',
    colorEnabled: true,
  },
};

export function loadConfig(): AppConfig {
  return {
    storage: {
      type: (process.env.TASK_STORAGE as 'json') || defaultConfig.storage.type,
      path: process.env.TASK_DATA_PATH || defaultConfig.storage.path,
    },
    appearance: {
      defaultFormat: (process.env.TASK_FORMAT as 'table' | 'json' | 'plain')
        || defaultConfig.appearance.defaultFormat,
      colorEnabled: process.env.TASK_NO_COLOR ? false : defaultConfig.appearance.colorEnabled,
    },
  };
}

/**
 * 获取应用配置——懒加载。
 *
 * @fix P1-4 — 替代模块级 `export const config = loadConfig()`，
 *   消除导入时的副作用。仅在首次调用时执行 loadConfig()，
 *   后续调用返回缓存值。
 */
let _config: AppConfig | null = null;
export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return { ..._config };
}

// 保留向后兼容——使用 getConfig() 替代
/** @deprecated 使用 getConfig() 替代 */
export const config = loadConfig();
