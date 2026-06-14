// @ci: unit
/**
 * committee-assembler.test.ts — @cortex/factory 委员会组装器单元测试
 */

import { describe, it, expect } from 'vitest';
import { assembleCommittee } from '../src/assemblers/committee.assembler.js';
import type { CommitteeRule } from '../src/types.js';

function makeRule(id: string, urgent: boolean): CommitteeRule {
  return {
    id,
    triggerEvent: 'review.needed',
    members: ['review' as any, 'code' as any],
    urgent,
  };
}

describe('assembleCommittee', () => {
  it('空规则返回空分组', () => {
    const result = assembleCommittee([]);
    expect(result.urgent).toEqual([]);
    expect(result.normal).toEqual([]);
  });

  it('按紧急/常规分组', () => {
    const rules = [makeRule('r1', true), makeRule('r2', false), makeRule('r3', true)];
    const result = assembleCommittee(rules);
    expect(result.urgent).toHaveLength(2);
    expect(result.normal).toHaveLength(1);
    expect(result.urgent[0].id).toBe('r1');
    expect(result.normal[0].id).toBe('r2');
  });
});
