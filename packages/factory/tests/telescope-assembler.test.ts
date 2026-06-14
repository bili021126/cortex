// @ci: unit
/**
 * telescope-assembler.test.ts — @cortex/factory 望远镜组装器单元测试
 */

import { describe, it, expect } from 'vitest';
import { assembleTelescope } from '../src/assemblers/telescope.assembler.js';

describe('assembleTelescope', () => {
  it('返回默认配置', () => {
    const config = assembleTelescope();
    expect(config.provider).toBe('local');
    expect(config.localModel).toBe('qwen2.5-vl-3b');
    expect(config.cdpFallback).toBe(true);
    expect(config.strategy).toBe('first-available');
  });

  it('合并覆写参数', () => {
    const config = assembleTelescope({ provider: 'cdp', cdpFallback: false });
    expect(config.provider).toBe('cdp');
    expect(config.cdpFallback).toBe(false);
    expect(config.localModel).toBe('qwen2.5-vl-3b'); // 默认值不变
  });
});
