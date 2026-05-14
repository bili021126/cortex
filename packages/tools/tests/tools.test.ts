/**
 * tools.test.ts — @cortex/tools 冒烟测试
 *
 * 验证分析工具基础功能（模块可导入性）
 */

import { describe, it, expect } from 'vitest';

describe('@cortex/tools', () => {
  it('monorepo-analyzer 模块可加载', async () => {
    // 验证模块能正常导入（不抛出 SyntaxError）
    await expect(async () => {
      await import('../src/monorepo-analyzer.js');
    }).not.toThrow();
  });

  it('configuration-drift 模块可加载', async () => {
    await expect(async () => {
      await import('../src/configuration-drift.js');
    }).not.toThrow();
  });
});
