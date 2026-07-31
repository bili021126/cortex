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

  it('spawnSubtask 不占主配额', () => {
    pool.register(makeConfig('code', 1));
    pool.spawn('code' as AgentType, 'c1');
    const ok = pool.spawnSubtask('code' as AgentType, 'c2');
    expect(ok).toBe(true); // 子任务不占上限
    expect(pool.count('code' as AgentType)).toBe(1); // 主配额不变
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

  // ── P1-B3 回归测试 ──────────────────────────────────

  it('P1-B3①: spawnSubtask 不占主配额——满配后仍可创建子任务', () => {
    pool.register(makeConfig('code', 1));
    pool.spawn('code' as AgentType, 'c1');
    // 主配额已满
    expect(pool.spawn('code' as AgentType, 'c2')).toBe(false);
    // 子任务不受影响
    expect(pool.spawnSubtask('code' as AgentType, 'sub1')).toBe(true);
    expect(pool.count('code' as AgentType)).toBe(1); // 主配额不变
    expect(pool.canSpawn('code' as AgentType)).toBe(false); // canSpawn 只看主配额
  });

  it('P1-B3②: spawnSubtask 防重复 id——与 spawn 一致', () => {
    pool.register(makeConfig('code', 5));
    pool.spawn('code' as AgentType, 'shared-id');
    // 重复 id 的子任务被拒绝
    expect(pool.spawnSubtask('code' as AgentType, 'shared-id')).toBe(false);
  });

  it('P1-B3③: spawnSubtask 补全 _activeByInstance——ping 可探测', async () => {
    pool.register(makeConfig('code', 2));
    pool.spawnSubtask('code' as AgentType, 'sub-ping');
    // ping 应返回 true
    const alive = await pool.ping('sub-ping');
    expect(alive).toBe(true);
  });

  it('P1-B3④: destroy 同时清理子任务集合', async () => {
    pool.register(makeConfig('code', 2));
    pool.spawn('code' as AgentType, 'c1');
    pool.spawnSubtask('code' as AgentType, 'sub1');
    pool.destroy('code' as AgentType, 'sub1');
    // destroy 后 ping 应返回 false
    await expect(pool.ping('sub1')).resolves.toBe(false);
    expect(pool.count('code' as AgentType)).toBe(1); // 主实例不受影响
  });
});
