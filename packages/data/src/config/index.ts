/**
 * config/index.ts — 应用配置
 *
 * 配置加载优先级：环境变量 > 默认值
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
  // src/config/index.ts → data 包根 → packages → 项目根
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

export const config = loadConfig();
