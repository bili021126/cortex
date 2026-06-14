// @ci: unit
/**
 * event-router-assembler.test.ts — @cortex/factory 事件路由器组装器单元测试
 */

import { describe, it, expect } from 'vitest';
import { assembleEventRouter } from '../src/assemblers/event-router.assembler.js';
import type { CortexAgentsConfig } from '../src/types.js';

function makeConfig(overrides?: Partial<CortexAgentsConfig>): CortexAgentsConfig {
  return {
    agents: {},
    eventRouting: {
      routeTable: {
        'code.complete': { channel: 'direct', ackRequired: false },
      },
      mergeRules: [],
      committeeRules: [],
    },
    ...overrides,
  };
}

describe('assembleEventRouter', () => {
  it('返回路由表和归并规则', () => {
    const config = makeConfig();
    const result = assembleEventRouter(config);
    expect(result.routeTable['code.complete']).toBeDefined();
    expect(result.routeTable['code.complete'].channel).toBe('direct');
    expect(result.mergeRules).toEqual([]);
  });

  it('mergeRules 默认空数组', () => {
    const config = makeConfig();
    config.eventRouting.mergeRules = undefined as any;
    const result = assembleEventRouter(config);
    expect(result.mergeRules).toEqual([]);
  });
});
