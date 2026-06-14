// @ci: unit
/**
 * docs-loader.test.ts — @cortex/factory 文档配置加载器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

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

const { loadCognitionConfig } = await import('../src/loaders/cognition.loader.js');
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
        activationMatrix: [{ agentType: 'code', active: true }],
        attention: { hcaWeight: 0.7, csaWeight: 0.3, maxMemoryItems: 10 },
      },
    });
    const config = loadCognitionConfig('/project');
    expect(config.activationMatrix).toHaveLength(1);
    expect(config.attention.hcaWeight).toBe(0.7);
  });

  it('部分注意力策略使用默认值填充', () => {
    setMockData({
      cognition: {
        activationMatrix: [],
        attention: { hcaWeight: 0.8 },
      },
    });
    const config = loadCognitionConfig('/project');
    expect(config.attention.hcaWeight).toBe(0.8);
    expect(config.attention.csaWeight).toBe(0.4); // 默认
    expect(config.attention.maxMemoryItems).toBe(20); // 默认
  });
});

// Docs loader test
import { loadDocsConfig } from '../src/loaders/docs.loader.js';

describe('loadDocsConfig', () => {
  beforeEach(() => {
    resetMockData();
  });

  it('文件不存在时返回默认配置', () => {
    const config = loadDocsConfig('/project');
    expect(config.constitutionPath).toBe('docs/Cortex 概念顶层设计 v2.5.md');
    expect(config.docRegistry).toEqual([]);
  });

  it('解析合法配置', () => {
    setMockData({
      docs: {
        constitutionPath: 'docs/宪法.md',
        docRegistry: [
          { path: 'docs/design.md', type: 'design', version: '1.0', canonical: true },
        ],
      },
    });
    const config = loadDocsConfig('/project');
    expect(config.constitutionPath).toBe('docs/宪法.md');
    expect(config.docRegistry).toHaveLength(1);
    expect(config.docRegistry[0].path).toBe('docs/design.md');
  });

  it('constitutionPath 缺失时使用默认值', () => {
    setMockData({
      docs: {
        docRegistry: [],
      },
    });
    const config = loadDocsConfig('/project');
    expect(config.constitutionPath).toBe('docs/Cortex 概念顶层设计 v2.5.md');
  });

  it('docRegistry 非数组时修正为空', () => {
    setMockData({
      docs: {
        constitutionPath: 'docs/test.md',
        docRegistry: 'invalid' as any,
      },
    });
    const config = loadDocsConfig('/project');
    expect(config.docRegistry).toEqual([]);
  });
});
