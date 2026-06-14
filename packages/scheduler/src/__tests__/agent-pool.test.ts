// @ci: unit
/**
 * agent-pool.test.ts — @cortex/scheduler AgentPool 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentPool } from '@cortex/scheduler';
import { AgentStatus } from '@cortex/shared';
import type { AgentType, AgentConfig } from '@cortex/shared';

function makeConfig(agentType: string, maxInstances = 2): AgentConfig {
  return { type: agentType as AgentType, maxInstances };
}

describe('AgentPool', () => {
  let pool: AgentPool;

  beforeEach(() => {
    pool = new AgentPool();
  });

  it('register 注册 Agent 类型', () => {
    pool.register(makeConfig('code'));
    expect(pool.canSpawn('code' as AgentType)).toBe(true);
  });

  it('未注册的类型 canSpawn 返回 false', () => {
    expect(pool.canSpawn('unknown' as AgentType)).toBe(false);
  });

  it('spawn 创建实例', () => {
    pool.register(makeConfig('code'));
    const ok = pool.spawn('code' as AgentType, 'code-1');
    expect(ok).toBe(true);
    expect(pool.count('code' as AgentType)).toBe(1);
  });

  it('spawn 超过上限返回 false', () => {
    pool.register(makeConfig('code', 1));
    pool.spawn('code' as AgentType, 'c1');
    const ok = pool.spawn('code' as AgentType, 'c2');
    expect(ok).toBe(false);
  });

  it('spawnSubtask 不占配额', () => {
    pool.register(makeConfig('code', 1));
    pool.spawn('code' as AgentType, 'c1');
    const ok = pool.spawnSubtask('code' as AgentType, 'c2');
    expect(ok).toBe(true); // 子任务不占上限
    expect(pool.count('code' as AgentType)).toBe(2);
  });

  it('setStatus 合法流转', () => {
    pool.register(makeConfig('code'));
    pool.spawn('code' as AgentType, 'c1');
    expect(pool.setStatus('c1', AgentStatus.Awake)).toBe(true);
    expect(pool.setStatus('c1', AgentStatus.Active)).toBe(true);
    expect(pool.setStatus('c1', AgentStatus.Draining)).toBe(true);
    expect(pool.setStatus('c1', AgentStatus.Destroyed)).toBe(true);
  });

  it('setStatus 非法流转返回 false', () => {
    pool.register(makeConfig('code'));
    pool.spawn('code' as AgentType, 'c1');
    // Created → Active 非法
    expect(pool.setStatus('c1', AgentStatus.Active)).toBe(false);
    expect(pool.getStatus('c1')).toBe(AgentStatus.Created); // 不变
  });

  it('getStatus 不存在的实例返回 undefined', () => {
    expect(pool.getStatus('nonexistent')).toBeUndefined();
  });

  it('hasAwake 检测唤醒实例', () => {
    pool.register(makeConfig('code'));
    pool.spawn('code' as AgentType, 'c1');
    expect(pool.hasAwake('code' as AgentType)).toBe(false);
    pool.setStatus('c1', AgentStatus.Awake);
    expect(pool.hasAwake('code' as AgentType)).toBe(true);
  });

  it('destroy 回收实例', () => {
    pool.register(makeConfig('code', 2));
    pool.spawn('code' as AgentType, 'c1');
    pool.spawn('code' as AgentType, 'c2');
    expect(pool.count('code' as AgentType)).toBe(2);
    pool.destroy('code' as AgentType, 'c1');
    expect(pool.count('code' as AgentType)).toBe(1);
  });

  it('setMaxInstances 动态扩容', () => {
    pool.register(makeConfig('code', 1));
    pool.spawn('code' as AgentType, 'c1');
    expect(pool.spawn('code' as AgentType, 'c2')).toBe(false);
    pool.setMaxInstances('code' as AgentType, 2);
    expect(pool.spawn('code' as AgentType, 'c2')).toBe(true);
  });

  it('getStatuses 返回类型全部状态', () => {
    pool.register(makeConfig('code', 3));
    pool.spawn('code' as AgentType, 'c1');
    pool.spawn('code' as AgentType, 'c2');
    pool.setStatus('c1', AgentStatus.Awake);
    const statuses = pool.getStatuses('code' as AgentType);
    expect(statuses).toHaveLength(2);
  });
});
