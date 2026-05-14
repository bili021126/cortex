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
