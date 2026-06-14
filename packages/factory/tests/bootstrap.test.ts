// @ci: unit
/**
 * bootstrap.test.ts — @cortex/factory Bootstrap 主流程单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationChannel } from '@cortex/notification';

vi.mock('../src/loaders/agents.loader.js', () => ({
  loadAgentsConfig: vi.fn(),
}));
vi.mock('../src/loaders/cognition.loader.js', () => ({
  loadCognitionConfig: vi.fn(),
}));
vi.mock('../src/loaders/docs.loader.js', () => ({
  loadDocsConfig: vi.fn(),
}));

import { bootstrap } from '../src/bootstrap.js';
import { loadAgentsConfig } from '../src/loaders/agents.loader.js';
import { loadCognitionConfig } from '../src/loaders/cognition.loader.js';
import { loadDocsConfig } from '../src/loaders/docs.loader.js';

function mockValidAgentsConfig() {
  return {
    agents: {
      ganyu: {
        id: 'ganyu', type: 'code', role: 'Ganyu — 代码',
        produces: ['code.complete'], model: 'm1', key: 'k1',
        systemPrompt: 'You are Ganyu',
      },
    },
    eventRouting: {
      routeTable: { 'code.complete': { channel: NotificationChannel.Routine, ackRequired: false } },
    },
  };
}

describe('bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAgentsConfig).mockReturnValue(mockValidAgentsConfig() as any);
    vi.mocked(loadCognitionConfig).mockReturnValue({ activationMatrix: [], attention: { hcaWeight: 0.6, csaWeight: 0.4, maxMemoryItems: 20 } });
    vi.mocked(loadDocsConfig).mockReturnValue({ constitutionPath: 'docs/宪法.md', docRegistry: [] });
  });

  it('成功执行完整 bootstrap 流程', () => {
    const result = bootstrap('/project');
    expect(result.agentDefinitions).toHaveLength(1);
    expect(result.agentDefinitions[0].id).toBe('ganyu');
    expect(result.eventRouting).toBeDefined();
    expect(result.cognition).toBeDefined();
    expect(result.docs).toBeDefined();
    expect(result.roundtableTemplates).toEqual([]);
    expect(result.warnings).toBeDefined();
  });

  it('loadAgentsConfig 失败时抛出错误', () => {
    vi.mocked(loadAgentsConfig).mockImplementation(() => { throw new Error('加载失败'); });
    expect(() => bootstrap('/project')).toThrow('加载 cortex-agents.json 失败');
  });

  it('loadCognitionConfig 失败时抛出错误', () => {
    vi.mocked(loadCognitionConfig).mockImplementation(() => { throw new Error('认知加载失败'); });
    expect(() => bootstrap('/project')).toThrow('加载 cortex-cognition.json 失败');
  });

  it('loadDocsConfig 失败时抛出错误', () => {
    vi.mocked(loadDocsConfig).mockImplementation(() => { throw new Error('文档加载失败'); });
    expect(() => bootstrap('/project')).toThrow('加载 cortex-docs.json 失败');
  });
});
