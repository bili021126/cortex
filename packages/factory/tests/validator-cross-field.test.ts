// @ci: unit
/**
 * validator-cross-field.test.ts — @cortex/factory 跨字段校验器单元测试
 */

import { describe, it, expect } from 'vitest';
import { validateCrossField } from '../src/schemas/cross-field.validator.js';
import type { CortexAgentsConfig } from '../src/types.js';
import { NotificationChannel } from '@cortex/notification';
import { AgentType } from '@cortex/shared';

function makeValidConfig(): CortexAgentsConfig {
  return {
    agents: {
      ganyu: {
        id: 'ganyu',
        type: AgentType.Code,
        role: 'Ganyu — 代码',
        produces: ['code.complete'],
        model: 'deepseek-v4-flash',
        key: 'default',
        systemPrompt: 'You are Ganyu',
      },
    },
    eventRouting: {
      routeTable: {
        'code.complete': { channel: NotificationChannel.Routine, ackRequired: false },
      },
    },
  };
}

describe('validateCrossField', () => {
  it('合法配置通过校验', () => {
    const result = validateCrossField(makeValidConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('produces 声明无对应路由时报错', () => {
    const config = makeValidConfig();
    config.agents.ganyu.produces.push('unrouted.event');
    const result = validateCrossField(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unrouted.event'))).toBe(true);
  });

  it('非法 channel 值报错', () => {
    const config = makeValidConfig();
    config.eventRouting.routeTable['code.complete'].channel = 'invalid_channel' as NotificationChannel;
    const result = validateCrossField(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('channel'))).toBe(true);
  });

  it('routeTable 中无 Agent 生产的事件产生警告', () => {
    const config = makeValidConfig();
    config.eventRouting.routeTable['orphan.event'] = { channel: NotificationChannel.Routine, ackRequired: false };
    const result = validateCrossField(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('orphan.event'))).toBe(true);
  });

  it('多 Agent 声明同一事件但无合并规则时警告', () => {
    const config = makeValidConfig();
    config.agents.albedo = {
      id: 'albedo',
      type: AgentType.Code,
      role: 'Albedo — 代码',
      produces: ['code.complete'],
      model: 'deepseek-v4-flash',
      key: 'default',
      systemPrompt: 'You are Albedo',
    };
    const result = validateCrossField(config);
    expect(result.warnings.some(w => w.includes('mergeRule'))).toBe(true);
  });

  it('无效标签报错', () => {
    const config = makeValidConfig();
    config.agents.ganyu.tags = [''];
    const result = validateCrossField(config);
    expect(result.valid).toBe(false);
  });

  it('未知工具权限产生警告', () => {
    const config = makeValidConfig();
    config.agents.ganyu.toolPermissions = ['unknown_tool'];
    const result = validateCrossField(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('unknown_tool'))).toBe(true);
  });

  it('roundtableTemplate 缺少 name 报错', () => {
    const config = makeValidConfig();
    config.roundtableTemplates = [{ name: '', description: '', personas: 0, rounds: 0, agents: [] } as any];
    const result = validateCrossField(config);
    expect(result.valid).toBe(false);
  });
});
