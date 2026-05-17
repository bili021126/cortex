/**
 * cli.test.ts — @cortex/cli 冒烟测试
 *
 * 覆盖：
 * 1. 向后兼容：convert/convertToDocument 仍然可用
 * 2. 命令注册表：基本路由
 * 3. 格式器：三种格式输出
 * 4. 配置管理器：基本读写
 */

import { describe, it, expect } from 'vitest';
import { convert, convertToDocument } from '@cortex/parser';
import { CommandRegistry } from '../src/commands/index.js';
import { ConfigManager } from '../src/services/config-manager.js';
import { getFormatter, detectDefaultFormat } from '../src/formatters/index.js';
import { CORTEX_VERSION } from '../src/commands/version.js';

// ── 向后兼容 ──────────────────────────────────────

describe('@cortex/cli — 向后兼容', () => {
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

// ── 命令注册表 ─────────────────────────────────────

describe('@cortex/cli — 命令注册表', () => {
  it('注册和查找命令', () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'test-cmd',
      description: '测试命令',
      handler: async () => ({ success: true, exitCode: 0 }),
    });

    const cmd = registry.find('test-cmd');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('test-cmd');
  });

  it('别名解析', () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'run',
      alias: 'r',
      description: '运行',
      handler: async () => ({ success: true, exitCode: 0 }),
    });

    expect(registry.find('r')).toBeDefined();
    expect(registry.find('r')!.name).toBe('run');
  });

  it('分发命令到处理器', async () => {
    const registry = new CommandRegistry();
    let handled = false;

    registry.register({
      name: 'test',
      description: '测试',
      handler: async () => {
        handled = true;
        return { success: true, exitCode: 0 };
      },
    });

    await registry.dispatch(['test'], {
      format: 'text',
      quiet: false,
      verbose: false,
      rawOptions: {},
    });

    expect(handled).toBe(true);
  });

  it('未知命令返回错误', async () => {
    const registry = new CommandRegistry();
    const result = await registry.dispatch(['unknown-cmd'], {
      format: 'text',
      quiet: false,
      verbose: false,
      rawOptions: {},
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

// ── 格式器 ────────────────────────────────────────

describe('@cortex/cli — 输出格式器', () => {
  it('检测默认格式', () => {
    const fmt = detectDefaultFormat();
    expect(['text', 'json', 'color']).toContain(fmt);
  });

  it('文本格式器基本输出', () => {
    const fmt = getFormatter('text');
    const output = fmt.formatSuccess({ success: true, exitCode: 0, output: '测试输出' });
    expect(output).toBe('测试输出');
  });

  it('JSON 格式器结构正确', () => {
    const fmt = getFormatter('json');
    const output = fmt.formatSuccess({ success: true, exitCode: 0, data: { key: 'value' } });
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('ok');
    expect(parsed.data.key).toBe('value');
    expect(parsed.meta).toBeDefined();
  });

  it('JSON 格式器错误输出结构正确', () => {
    const fmt = getFormatter('json');
    const output = fmt.formatError({ success: false, exitCode: 2, error: '执行失败' });
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('error');
    expect(parsed.error.message).toBe('执行失败');
    expect(parsed.error.code).toBe('ERR_EXECUTION');
  });

  it('彩色格式器包含 ANSI 码', () => {
    const fmt = getFormatter('color');
    const output = fmt.formatInfo('测试信息');
    expect(output).toContain('\x1b[');
  });

  it('文本格式器表格输出', () => {
    const fmt = getFormatter('text');
    const output = fmt.formatTable(['名称', '状态'], [['code', 'awake'], ['review', 'awake']]);
    expect(output).toContain('名称');
    expect(output).toContain('code');
    expect(output).toContain('awake');
  });
});

// ── 配置管理器 ─────────────────────────────────────

describe('@cortex/cli — 配置管理器', () => {
  it('默认配置完整', () => {
    const config = new ConfigManager();
    const all = config.getAll();
    expect(all.version).toBe('0.2');
    expect(all.cli.defaultFormat).toBe('text');
    expect(all.llm.chatModel).toBe('deepseek-v4-flash');
  });

  it('获取嵌套配置', () => {
    const config = new ConfigManager();
    const model = config.getNested('llm.chatModel');
    expect(model).toBe('deepseek-v4-flash');
  });

  it('设置配置值', () => {
    const config = new ConfigManager();
    config.set('cli.defaultFormat', 'json');
    expect(config.getNested('cli.defaultFormat')).toBe('json');
  });

  it('校验通过（非严格模式）', () => {
    const config = new ConfigManager();
    const errors = config.validate();
    expect(errors.length).toBe(0);
  });
});

// ── 版本信息 ───────────────────────────────────────

describe('@cortex/cli — 版本', () => {
  it('版本号格式正确', () => {
    expect(CORTEX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
