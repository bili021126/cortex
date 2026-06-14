// @ci: unit
/**
 * agents-loader.test.ts — @cortex/factory Agent 配置加载器单元测试
 *
 * 使用 vi.mock 隔离文件系统依赖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cortex/config', () => {
  const mockLoadConfigDomain = vi.fn();
  return {
    resolveConfigDataDir: vi.fn(() => '/mock/data'),
    loadConfigDomain: mockLoadConfigDomain,
  };
});

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(() => ''),
    existsSync: vi.fn(() => false),
  },
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
}));

import { loadAgentsConfig } from '../src/loaders/agents.loader.js';
import { loadConfigDomain } from '@cortex/config';

describe('loadAgentsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('加载并组装完整配置', () => {
    vi.mocked(loadConfigDomain)
      .mockReturnValueOnce({
        ganyu: {
          id: 'ganyu', type: 'code', role: 'Ganyu — 代码',
          produces: ['code.complete'], model: 'm1', key: 'k1',
          systemPrompt: 'You are Ganyu',
        },
      })
      .mockReturnValueOnce({
        routeTable: { 'code.complete': { channel: 'direct', ackRequired: false } },
      })
      .mockReturnValueOnce([])   // roundtable
      .mockReturnValueOnce(undefined) // searchProviders
      .mockReturnValueOnce(undefined) // selfExamination
      .mockReturnValueOnce(undefined) // crossVerification
      .mockReturnValueOnce(undefined) // seedMemories
      .mockReturnValueOnce(undefined) // governancePipeline
      .mockReturnValueOnce(undefined); // tools

    const result = loadAgentsConfig('/project');
    expect(result.agents.ganyu).toBeDefined();
    expect(result.agents.ganyu.type).toBe('code');
    expect(result.eventRouting.routeTable['code.complete']).toBeDefined();
    expect(result.roundtableTemplates).toEqual([]);
  });

  it('缺少 agents 字段报错', () => {
    vi.mocked(loadConfigDomain).mockReset();
    vi.mocked(loadConfigDomain)
      .mockReturnValueOnce(undefined) // agents 返回 undefined
      .mockReturnValueOnce({ routeTable: {} })
      .mockReturnValueOnce([])
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    // agents 返回 undefined，校验时会报错
    const agentsLoader = vi.fn(() => loadAgentsConfig('/project'));
    // 由于 loadConfigDomain.mockReturnValueOnce(undefined) 导致 agentsRaw 为 undefined，
    // _validateStructure 检查 config.agents 会抛错
    expect(() => loadAgentsConfig('/project')).toThrow();
  });

  it('检验 Agent 必填字段', () => {
    vi.mocked(loadConfigDomain)
      .mockReturnValueOnce({
        badAgent: {
          // 缺少 type、role、model、key、systemPrompt
          produces: [],
        },
      })
      .mockReturnValueOnce({ routeTable: {} })
      .mockReturnValueOnce([])
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    expect(() => loadAgentsConfig('/project')).toThrow();
  });
});
