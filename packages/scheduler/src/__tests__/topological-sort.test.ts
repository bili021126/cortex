// @ci: unit
/**
 * topological-sort.test.ts — @cortex/scheduler 拓扑排序单元测试
 */

import { describe, it, expect } from 'vitest';
import { topologicalSort } from '@cortex/scheduler';
import type { TaskNode } from '@cortex/shared';

function makeNode(id: string, parentId?: string, overrides?: Partial<TaskNode>): TaskNode {
  return {
    id,
    type: 'audit',
    tags: ['audit'],
    needsMultiPerspective: false,
    status: 'pending',
    claimedBy: [],
    payload: '',
    results: [],
    createdAt: Date.now(),
    parentId,
    ...overrides,
  };
}

describe('topologicalSort', () => {
  it('无依赖节点全在第 0 层', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toContain('a');
    expect(layers[0]).toContain('b');
  });

  it('父子节点分在不同层', () => {
    const nodes = [makeNode('root'), makeNode('child', 'root')];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toContain('root');
    expect(layers[1]).toContain('child');
  });

  it('链式依赖正确分层', () => {
    const nodes = [
      makeNode('a'),
      makeNode('b', 'a'),
      makeNode('c', 'b'),
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(3);
    expect(layers[0]).toContain('a');
    expect(layers[1]).toContain('b');
    expect(layers[2]).toContain('c');
  });

  it('软边 (soft) 与父节点同层', () => {
    const nodes = [
      makeNode('a'),
      makeNode('b', 'a', { edgeType: 'soft' }),
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(1); // a 和 b 同层
    expect(layers[0]).toContain('a');
    expect(layers[0]).toContain('b');
  });

  it('触发边 (trigger) 与父节点同层', () => {
    const nodes = [
      makeNode('a'),
      makeNode('b', 'a', { edgeType: 'trigger' }),
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toContain('b');
  });

  it('循环依赖返回空数组', () => {
    const nodes = [
      makeNode('a', 'b'),
      makeNode('b', 'a'),
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toEqual([]);
  });

  it('混合硬边和软边', () => {
    const nodes = [
      makeNode('root'),
      makeNode('hardChild', 'root'),           // 下一层
      makeNode('softChild', 'root', { edgeType: 'soft' }), // 同层
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(2);
    // root 和 softChild 在第 0 层
    expect(layers[0]).toContain('root');
    expect(layers[0]).toContain('softChild');
    // hardChild 在第 1 层
    expect(layers[1]).toContain('hardChild');
  });

  it('悬挂 parentId 的子节点被提升为根', () => {
    const nodes = [
      makeNode('orphan', 'nonexistent'),
    ];
    const layers = topologicalSort(nodes);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toContain('orphan');
  });
});
