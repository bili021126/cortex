// @ci: unit
/**
 * cognition-loader.test.ts — @cortex/factory 认知配置加载器单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 模拟 loadConfigDomain
vi.mock('@cortex/config', () => {
  let mockData: Record<string, any> = {};
  return {
    resolveConfigDataDir: () => '/mock/data',
    loadConfigDomain: vi.fn((domain: string) => {
      if (mockData[domain] === undefined) {
        throw new Error('NOT_FOUND');
      }
      return mockData[domain];
    }),
    __setMockData: (data: Record<string, any>) => { mockData = data; },
    __resetMockData: () => { mockData = {}; },
  };
});

// We need to import after mocking
import { loadCognitionConfig } from '../src/loaders/cognition.loader.js';

// Get the mock to control it
const configModule = await import('@cortex/config');
const setMockData = (configModule as any).__setMockData;
const resetMockData = (configModule as any).__resetMockData;

describe('loadCognitionConfig', () => {
  beforeEach(() => {
    resetMockData();
  });

  it('文件不存在时返回默认配置', () => {
    const config = loadCognitionConfig('/project');
    expect(config.activationMatrix).toEqual([]);
    expect(config.attention.hcaWeight).toBe(0.6);
    expect(config.attention.csaWeight).toBe(0.4);
    expect(config.attention.maxMemoryItems).toBe(20);
  });

  it('解析合法配置', () => {
    setMockData({
      cognition: {
        activationMatrix: [
          { agentType: 'code', active: true },
        ],
        attention: {
          hcaWeight: 0.7,
          csaWeight: 0.3,
          maxMemoryItems: 10,
        },
      },
    });
    const config = loadCognitionConfig('/project');
    expect(config.activationMatrix).toHaveLength(1);
    expect(config.activationMatrix[0].agentType).toBe('code');
    expect(config.attention.hcaWeight).toBe(0.7);
  });

  it('注意力策略缺失时使用默认值', () => {
    setMockData({
      cognition: {
        activationMatrix: [],
        // 没有 attention
      },
    });
    const config = loadCognitionConfig('/project');
    expect(config.attention.hcaWeight).toBe(0.6);
  });

  it('activationMatrix 非数组时修正为空', () => {
    setMockData({
      cognition: {
        activationMatrix: 'invalid' as any,
        attention: { hcaWeight: 0.5, csaWeight: 0.5, maxMemoryItems: 5 },
      },
    });
    const config = loadCognitionConfig('/project');
    expect(config.activationMatrix).toEqual([]);
  });
});
