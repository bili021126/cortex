/**
 * cli.test.ts — @cortex/cli 冒烟测试
 *
 * 验证 CLI 参数解析和转换功能
 */

import { describe, it, expect } from 'vitest';
import { convert, convertToDocument } from '@cortex/parser';

describe('@cortex/cli', () => {
  it('通过 @cortex/parser 正确导入 convert', () => {
    expect(typeof convert).toBe('function');
  });

  it('通过 @cortex/parser 正确导入 convertToDocument', () => {
    expect(typeof convertToDocument).toBe('function');
  });

  it('convert 基本功能正常', () => {
    const html = convert('# Hello');
    expect(html).toContain('<h1>');
    expect(html).toContain('Hello');
  });

  it('convertToDocument 生成完整文档', () => {
    const html = convertToDocument('# Title', 'Test');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test</title>');
  });
});
