// @ci: unit
/**
 * task-board.test.ts — @cortex/scheduler TaskBoard 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskBoard } from '@cortex/scheduler';
import type { TaskNode, AgentType } from '@cortex/shared';

function makeNode(id: string, overrides?: Partial<TaskNode>): TaskNode {
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
    ...overrides,
  };
}

describe('TaskBoard', () => {
  let board: TaskBoard;

  beforeEach(() => {
    board = new TaskBoard();
  });

  it('addNode/getNode 基本存取', () => {
    board.addNode(makeNode('n1'));
    const node = board.getNode('n1');
    expect(node).toBeDefined();
    expect(node!.id).toBe('n1');
  });

  it('getAllNodes 返回所有节点', () => {
    board.addNode(makeNode('a'));
    board.addNode(makeNode('b'));
    expect(board.getAllNodes()).toHaveLength(2);
  });

  it('claim 普通节点成功', () => {
    board.addNode(makeNode('n1', { tags: ['inspect'] }));
    const claimed = board.claim('n1', 'inspector' as AgentType);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('claimed');
  });

  it('claim 不匹配标签返回 null', () => {
    board.addNode(makeNode('n1', { tags: ['audit'] }));
    const claimed = board.claim('n1', 'inspector' as AgentType);
    expect(claimed).toBeNull();
  });

  it('claim 重复认领返回 null', () => {
    board.addNode(makeNode('n1', { tags: ['audit'] }));
    board.claim('n1', 'review' as AgentType);
    const second = board.claim('n1', 'code' as AgentType);
    expect(second).toBeNull();
  });

  it('release 普通节点回到 pending', () => {
    board.addNode(makeNode('n1', { tags: ['audit'] }));
    board.claim('n1', 'review' as AgentType);
    const ok = board.release('n1', 'review' as AgentType);
    expect(ok).toBe(true);
    const node = board.getNode('n1');
    expect(node!.status).toBe('pending');
    expect(node!.claimedBy).toEqual([]);
  });

  it('complete 普通节点置为 done', () => {
    board.addNode(makeNode('n1', { tags: ['audit'] }));
    board.claim('n1', 'review' as AgentType);
    board.complete('n1', 'review' as AgentType, true, 'ok');
    const node = board.getNode('n1');
    expect(node!.status).toBe('done');
    expect(node!.results).toHaveLength(1);
  });

  it('complete 失败节点置为 failed', () => {
    board.addNode(makeNode('n1', { tags: ['audit'] }));
    board.claim('n1', 'review' as AgentType);
    board.complete('n1', 'review' as AgentType, false, undefined, '出错了');
    const node = board.getNode('n1');
    expect(node!.status).toBe('failed');
    expect(node!.results[0]!.success).toBe(false);
  });

  it('failNode 强制标记失败', () => {
    board.addNode(makeNode('n1'));
    const ok = board.failNode('n1');
    expect(ok).toBe(true);
    expect(board.getNode('n1')!.status).toBe('failed');
  });

  it('failNode 不存在返回 false', () => {
    expect(board.failNode('nope')).toBe(false);
  });

  it('getPendingNodes 只返回 pending/claimed', () => {
    board.addNode(makeNode('a', { status: 'pending' }));
    board.addNode(makeNode('b', { status: 'done' }));
    board.addNode(makeNode('c', { status: 'failed' }));
    const pending = board.getPendingNodes();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('a');
  });

  it('removeNode 删除节点', () => {
    board.addNode(makeNode('n1'));
    board.removeNode('n1');
    expect(board.getNode('n1')).toBeUndefined();
  });

  it('removeSubtree 删除节点及其子孙', () => {
    board.addNode(makeNode('root'));
    board.addNode(makeNode('child', { parentId: 'root' }));
    board.addNode(makeNode('grandchild', { parentId: 'child' }));
    board.removeSubtree('root');
    expect(board.getNode('root')).toBeUndefined();
    expect(board.getNode('child')).toBeUndefined();
    expect(board.getNode('grandchild')).toBeUndefined();
  });

  it('cancel pending 节点成功', () => {
    board.addNode(makeNode('n1'));
    const ok = board.cancel('n1');
    expect(ok).toBe(true);
    expect(board.getNode('n1')).toBeUndefined();
  });

  it('cancel done 节点失败', () => {
    board.addNode(makeNode('n1', { status: 'done' }));
    const ok = board.cancel('n1');
    expect(ok).toBe(false);
    expect(board.getNode('n1')).toBeDefined();
  });

  // ── Multi-perspective ──
  describe('multi-perspective', () => {
    it('多种 Agent 可并行认领', () => {
      board.addNode(makeNode('mp', { needsMultiPerspective: true, tags: ['audit', 'inspect'] }));
      const c1 = board.claim('mp', 'review' as AgentType);
      expect(c1).not.toBeNull();
      const c2 = board.claim('mp', 'inspector' as AgentType);
      expect(c2).not.toBeNull();
      expect(board.getNode('mp')!.claimedBy).toHaveLength(2);
    });

    it('同类型不可重复认领', () => {
      board.addNode(makeNode('mp', { needsMultiPerspective: true, tags: ['audit'] }));
      board.claim('mp', 'review' as AgentType);
      const second = board.claim('mp', 'review' as AgentType);
      expect(second).toBeNull();
    });

    it('等齐所有认领后自动 done', () => {
      board.addNode(makeNode('mp', { needsMultiPerspective: true, tags: ['audit', 'inspect'] }));
      board.claim('mp', 'review' as AgentType);
      board.claim('mp', 'inspector' as AgentType);
      board.complete('mp', 'review' as AgentType, true, 'review ok');
      // 尚未等齐
      expect(board.getNode('mp')!.status).not.toBe('done');
      board.complete('mp', 'inspector' as AgentType, true, 'inspect ok');
      // 等齐
      expect(board.getNode('mp')!.status).toBe('done');
    });
  });
});
