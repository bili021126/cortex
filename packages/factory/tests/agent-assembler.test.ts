// @ci: unit
/**
 * agent-assembler.test.ts — @cortex/factory Agent 组装器单元测试
 */

import { describe, it, expect } from 'vitest';
import { assembleAgents } from '../src/assemblers/agent.assembler.js';
import type { AgentDefinition } from '../src/types.js';

function makeDef(id: string, overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    id,
    type: 'code',
    role: `${id} — 代码`,
    produces: ['code.complete'],
    model: 'deepseek-v4-flash',
    key: 'default',
    systemPrompt: `You are ${id}`,
    ...overrides,
  };
}

describe('assembleAgents', () => {
  it('空列表返回空结果', () => {
    const result = assembleAgents([]);
    expect(result.configs).toEqual([]);
    expect(result.byKey.size).toBe(0);
  });

  it('组装单个 Agent', () => {
    const defs = [makeDef('albedo')];
    const result = assembleAgents(defs);
    expect(result.configs).toHaveLength(1);
    expect(result.configs[0].type).toBe('code');
    expect(result.configs[0].maxInstances).toBe(1);
  });

  it('按 key 分组', () => {
    const defs = [
      makeDef('a', { key: 'group1' }),
      makeDef('b', { key: 'group1' }),
      makeDef('c', { key: 'group2' }),
    ];
    const result = assembleAgents(defs);
    expect(result.byKey.get('group1')).toHaveLength(2);
    expect(result.byKey.get('group2')).toHaveLength(1);
  });

  it('使用自定义 maxInstances', () => {
    const defs = [makeDef('x', { maxInstances: 3 })];
    const result = assembleAgents(defs);
    expect(result.configs[0].maxInstances).toBe(3);
  });

  it('默认 maxInstances 为 1', () => {
    const defs = [makeDef('y')];
    const result = assembleAgents(defs);
    expect(result.configs[0].maxInstances).toBe(1);
  });
});
