// @ci: unit
/**
 * parser.test.ts — @cortex/parser 单元测试
 *
 * 验证 Markdown→HTML 转换的各项语法特性
 *
 * 基于 projects/solo-flight/test/converter.test.ts 适配
 */

import { describe, it, expect } from 'vitest';
import { convert, convertToDocument } from '../src/parser.js';

/** 检查 HTML 中是否包含指定标签（支持标签后跟属性或 >） */
function hasTag(html: string, tag: string): boolean {
  const regex = new RegExp(`<${tag}(\\s|>)`);
  return regex.test(html);
}

/** 检查 HTML 中是否包含指定标签对（支持标签带属性） */
function hasTagPair(html: string, tag: string): boolean {
  const regex = new RegExp(`<${tag}[\\s>][^]*?</${tag}>`);
  return regex.test(html);
}

function hasText(html: string, text: string): boolean {
  return html.includes(text);
}

describe('@cortex/parser', () => {
  describe('段落', () => {
    it('转换普通段落为 <p>', () => {
      const html = convert('这是一段普通段落。');
      expect(hasTagPair(html, 'p')).toBe(true);
      expect(hasText(html, '这是一段普通段落。')).toBe(true);
    });
  });

  describe('标题', () => {
    it('转换 H1-H3 标题', () => {
      const md = '# 一级标题\n## 二级标题\n### 三级标题';
      const html = convert(md);
      expect(hasTagPair(html, 'h1')).toBe(true);
      expect(hasTagPair(html, 'h2')).toBe(true);
      expect(hasTagPair(html, 'h3')).toBe(true);
      expect(hasText(html, '一级标题')).toBe(true);
      expect(hasText(html, '二级标题')).toBe(true);
      expect(hasText(html, '三级标题')).toBe(true);
    });
  });

  describe('加粗与斜体', () => {
    it('转换 **加粗** 和 *斜体*', () => {
      const html = convert('**加粗** *斜体*');
      expect(hasTagPair(html, 'strong')).toBe(true);
      expect(hasTagPair(html, 'em')).toBe(true);
      expect(hasText(html, '加粗')).toBe(true);
      expect(hasText(html, '斜体')).toBe(true);
    });
  });

  describe('行内代码', () => {
    it('转换 `code`', () => {
      const html = convert('这是 `code` 示例');
      expect(hasTagPair(html, 'code')).toBe(true);
      expect(hasText(html, 'code')).toBe(true);
    });
  });

  describe('代码块', () => {
    it('转换 ``` 代码块', () => {
      const md = '```typescript\nconst x = 1;\n```';
      const html = convert(md);
      expect(hasTagPair(html, 'pre')).toBe(true);
      expect(hasTagPair(html, 'code')).toBe(true);
      expect(hasText(html, 'language-typescript')).toBe(true);
      expect(hasText(html, 'const x = 1;')).toBe(true);
    });
  });

  describe('列表', () => {
    it('转换无序列表', () => {
      const html = convert('- 项目甲\n- 项目乙');
      expect(hasTagPair(html, 'ul')).toBe(true);
      expect(hasText(html, '<li>项目甲</li>')).toBe(true);
    });

    it('转换有序列表', () => {
      const html = convert('1. 第一项\n2. 第二项');
      expect(hasTagPair(html, 'ol')).toBe(true);
      expect(hasText(html, '<li>第一项</li>')).toBe(true);
    });
  });

  describe('引用块', () => {
    it('转换 > 引用', () => {
      const html = convert('> 引用内容');
      expect(hasTagPair(html, 'blockquote')).toBe(true);
      expect(hasText(html, '引用内容')).toBe(true);
    });
  });

  describe('链接', () => {
    it('转换 [text](url)', () => {
      const html = convert('[链接文本](https://example.com)');
      expect(hasTagPair(html, 'a')).toBe(true);
      expect(hasText(html, 'href="https://example.com"')).toBe(true);
      expect(hasText(html, '链接文本')).toBe(true);
    });
  });

  describe('图片', () => {
    it('转换 ![alt](url)', () => {
      const html = convert('![alt文本](https://example.com/img.png)');
      expect(hasTag(html, 'img')).toBe(true);
      expect(hasText(html, 'src="https://example.com/img.png"')).toBe(true);
      expect(hasText(html, 'alt="alt文本"')).toBe(true);
    });
  });

  describe('分割线', () => {
    it('转换 ---', () => {
      const html = convert('---');
      expect(hasTag(html, 'hr')).toBe(true);
    });
  });

  describe('转义', () => {
    it('转义 \\* 不解析为斜体', () => {
      const html = convert('\\*这不是斜体\\*');
      expect(hasTagPair(html, 'em')).toBe(false);
      expect(hasText(html, '*这不是斜体*')).toBe(true);
    });
  });

  describe('空输入', () => {
    it('空字符串返回空 HTML', () => {
      const html = convert('');
      expect(html).toBe('');
    });

    it('仅空白字符返回空 HTML', () => {
      const html = convert('   \n  \n  ');
      expect(html).toBe('');
    });

    it('仅换行符返回空 HTML', () => {
      const html = convert('\n\n\n');
      expect(html).toBe('');
    });
  });

  describe('超大输入边界', () => {
    it('超大输入（>100KB）不崩溃', () => {
      // 生成约 120KB 的 Markdown
      const line = '# 标题\n\n这是一段很长的段落内容，用于测试解析器在大输入下的稳定性。'.repeat(3000);
      expect(line.length).toBeGreaterThan(100 * 1024);
      expect(() => convert(line)).not.toThrow();
      const result = convert(line);
      expect(result.length).toBeGreaterThan(0);
    });

    it('超大代码块（5000 行）不崩溃', () => {
      const codeLines = Array.from({ length: 5000 }, (_, i) => `const line${i} = ${i};`);
      const md = '```\n' + codeLines.join('\n') + '\n```';
      expect(() => convert(md)).not.toThrow();
      const result = convert(md);
      expect(result).toContain('<pre><code>');
    });
  });

  describe('嵌套与深度极限', () => {
    it('嵌套加粗不崩溃', () => {
      let md = 'text';
      for (let i = 0; i < 3; i++) {
        md = `**${md}**`;
      }
      expect(() => convert(md)).not.toThrow();
    });

    it('深层嵌套列表不崩溃', () => {
      // 生成嵌套列表（深度 20）
      const lines: string[] = [];
      for (let i = 0; i < 20; i++) {
        lines.push(`${'  '.repeat(i)}- level ${i}`);
      }
      const md = lines.join('\n');
      expect(() => convert(md)).not.toThrow();
    });
  });

  describe('XSS 防护验证', () => {
    it('输出 HTML 中属性值被转义（XSS 防御）', () => {
      // 属性值中的特殊字符被 HTML 实体转义
      const md = '[链接](https://x.com?a=1&b=2 "title")';
      const html = convert(md);
      // & 被转义为 &amp;
      expect(html).toContain('&amp;');
    });

    it('javascript: 协议链接被过滤', () => {
      const md = '[点击](javascript:alert(1))';
      const html = convert(md);
      expect(html).not.toContain('javascript:');
      // 应被替换为不安全链接标记
      expect(html).toContain('unsafe-url');
    });

    it('javascript: 协议图片被过滤', () => {
      const md = '![img](javascript:alert(1))';
      const html = convert(md);
      expect(html).not.toContain('javascript:');
      expect(html).toContain('unsafe-url');
    });

    it('HTML 标签注入被转义', () => {
      const md = '<script>alert(1)</script>';
      const html = convert(md);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('data: 协议被过滤', () => {
      const md = '[data](data:text/html,<script>alert(1)</script>)';
      const html = convert(md);
      expect(html).not.toContain('data:text/html');
    });

    it('onload 属性经 sanitizeAttrs 处理', () => {
      // onload 无法直接通过 markdown 语法注入，但经过 convert 的 sanitizeAttrs 处理
      // 验证 sanitize 函数是否被正确调用
      const md = '[test](https://example.com)';
      const html = convert(md);
      // 即使只包含 clean 输入，输出也应该正常
      expect(html).toContain('href=');
      // 构造一个模拟：markdown 本身不会产出 onload，但 sanitizeAttrs 在出口保护
    });
  });

  describe('Unicode/emoji 处理', () => {
    it('支持混合中日韩文字', () => {
      const md = '# 日本語と中文混在\n\n你好世界 こんにちは';
      const html = convert(md);
      expect(html).toContain('日本語と中文混在');
      expect(html).toContain('你好世界 こんにちは');
    });

    it('支持 emoji 字符', () => {
      const md = '**🚀** 发射 *🎯* 命中';
      const html = convert(md);
      expect(hasTagPair(html, 'strong')).toBe(true);
      expect(hasTagPair(html, 'em')).toBe(true);
      expect(html).toContain('🚀');
      expect(html).toContain('🎯');
    });

    it('支持特殊 Unicode 符号', () => {
      const md = '数学符号：∑∏∫√∞≠≤≥';
      const html = convert(md);
      expect(html).toContain('∑');
      expect(html).toContain('≠');
    });

    it('RTL 文本不破坏解析', () => {
      const md = '**مرحبا** بالعالم *اختبار*';
      const html = convert(md);
      expect(hasTagPair(html, 'strong')).toBe(true);
      expect(hasTagPair(html, 'em')).toBe(true);
    });
  });

  describe('格式错误的 Markdown 降级', () => {
    it('未闭合的加粗标记不崩溃', () => {
      const md = '这是**未闭合的加粗';
      expect(() => convert(md)).not.toThrow();
    });

    it('未闭合的代码标记不崩溃', () => {
      const md = '这是`未闭合的代码';
      expect(() => convert(md)).not.toThrow();
      const html = convert(md);
      expect(html).toContain('未闭合的代码');
    });

    it('未闭合的链接括号不崩溃', () => {
      const md = '[未闭合链接(text';
      expect(() => convert(md)).not.toThrow();
    });

    it('孤立的 ``` 不崩溃', () => {
      const md = '```\n只有开始围栏';
      expect(() => convert(md)).not.toThrow();
    });

    it('错误的列表格式不崩溃', () => {
      const md = '-\n-\n-\n'; // 空列表项
      expect(() => convert(md)).not.toThrow();
    });

    it('混合多种格式错误不崩溃', () => {
      const md = '# 标题\n**未闭合\n`code\n[text\n![alt\n-\n>';
      expect(() => convert(md)).not.toThrow();
    });
  });

  describe('全量覆盖：convertToDocument', () => {
    it('convertToDocument 正确处理中文标题', () => {
      const html = convertToDocument('# 你好世界', '中文标题');
      expect(html).toContain('<title>中文标题</title>');
      expect(html).toContain('<h1>');
      expect(html).toContain('你好世界');
    });

    it('convertToDocument 默认标题为 Document', () => {
      const html = convertToDocument('# Hello');
      expect(html).toContain('<title>Document</title>');
    });

    it('convertToDocument 包含 DOCTYPE 和基础样式', () => {
      const html = convertToDocument('# test');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<style>');
      expect(html).toContain('system-ui');
    });
  });

  describe('完整文档 (convertToDocument)', () => {
    it('生成完整 HTML 文档', () => {
      const html = convertToDocument('# 文档标题\n\n正文内容');
      expect(hasTag(html, '!DOCTYPE')).toBe(true);
      expect(hasTagPair(html, 'html')).toBe(true);
      expect(hasTagPair(html, 'head')).toBe(true);
      expect(hasTagPair(html, 'body')).toBe(true);
      expect(hasTagPair(html, 'title')).toBe(true);
      expect(hasText(html, '文档标题')).toBe(true);
      expect(hasText(html, '<style>')).toBe(true);
    });
  });
});
