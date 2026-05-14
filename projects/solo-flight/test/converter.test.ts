/**
 * converter.test.ts — 转换器验证测试
 *
 * 测试步骤：
 *   1. 读取 test-input.md
 *   2. 调用 convert() 转换为 HTML
 *   3. 检查输出 HTML 结构是否与预期一致
 *   4. 输出测试报告到 webui/test_report.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convert, convertToDocument } from '../packages/parser/src/parser.js';

// ─── 辅助函数 ───────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 测试断言 */
function assert(condition: boolean, message: string): string {
  return condition ? `  ✅ ${message}` : `  ❌ ${message}`;
}

/** 检查 HTML 中是否包含指定标签结构 */
function hasTag(html: string, tag: string): boolean {
  const regex = new RegExp(`<${tag}[\\s>]`);
  return regex.test(html);
}

/** 检查 HTML 中是否包含指定标签对 */
function hasTagPair(html: string, tag: string): boolean {
  const regex = new RegExp(`<${tag}>.*?</${tag}>`, 's');
  return regex.test(html);
}

/** 检查 HTML 中是否包含指定文本（转义后） */
function hasText(html: string, text: string): boolean {
  return html.includes(text);
}

// ─── 测试用例定义 ───────────────────────────────────────

interface TestCase {
  name: string;
  run: () => string[]; // 返回断言结果列表
}

const testCases: TestCase[] = [];

// ── 测试 1: 段落 ──
testCases.push({
  name: '段落转换',
  run: () => {
    const md = '这是一段普通段落。';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'p'), '段落被 <p> 包裹'),
      assert(hasText(html, '这是一段普通段落。'), '段落文本内容正确'),
    ];
  },
});

// ── 测试 2: 标题 ──
testCases.push({
  name: '标题转换',
  run: () => {
    const md = '# 一级标题\n## 二级标题\n### 三级标题';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'h1'), 'H1 标题存在'),
      assert(hasTagPair(html, 'h2'), 'H2 标题存在'),
      assert(hasTagPair(html, 'h3'), 'H3 标题存在'),
      assert(hasText(html, '一级标题'), 'H1 内容正确'),
      assert(hasText(html, '二级标题'), 'H2 内容正确'),
      assert(hasText(html, '三级标题'), 'H3 内容正确'),
    ];
  },
});

// ── 测试 3: 加粗与斜体 ──
testCases.push({
  name: '加粗与斜体',
  run: () => {
    const md = '**加粗** *斜体*';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'strong'), '加粗文字被 <strong> 包裹'),
      assert(hasTagPair(html, 'em'), '斜体文字被 <em> 包裹'),
      assert(hasText(html, '加粗'), '加粗内容正确'),
      assert(hasText(html, '斜体'), '斜体内容正确'),
    ];
  },
});

// ── 测试 4: 行内代码 ──
testCases.push({
  name: '行内代码',
  run: () => {
    const md = '这是 `code` 示例';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'code'), '行内代码被 <code> 包裹'),
      assert(hasText(html, 'code'), '代码内容正确'),
    ];
  },
});

// ── 测试 5: 代码块 ──
testCases.push({
  name: '代码块',
  run: () => {
    const md = '```typescript\nconst x = 1;\n```';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'pre'), '代码块被 <pre> 包裹'),
      assert(hasTagPair(html, 'code'), '代码块内包含 <code>'),
      assert(hasText(html, 'language-typescript'), '代码块有 language 类名'),
      assert(hasText(html, 'const x = 1;'), '代码内容正确'),
    ];
  },
});

// ── 测试 6: 无序列表 ──
testCases.push({
  name: '无序列表',
  run: () => {
    const md = '- 项目甲\n- 项目乙';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'ul'), '无序列表被 <ul> 包裹'),
      assert(hasText(html, '<li>项目甲</li>'), '列表项内容正确'),
      assert(hasText(html, '<li>项目乙</li>'), '列表项内容正确'),
    ];
  },
});

// ── 测试 7: 有序列表 ──
testCases.push({
  name: '有序列表',
  run: () => {
    const md = '1. 第一项\n2. 第二项';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'ol'), '有序列表被 <ol> 包裹'),
      assert(hasText(html, '<li>第一项</li>'), '有序列表项内容正确'),
      assert(hasText(html, '<li>第二项</li>'), '有序列表项内容正确'),
    ];
  },
});

// ── 测试 8: 引用块 ──
testCases.push({
  name: '引用块',
  run: () => {
    const md = '> 引用内容';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'blockquote'), '引用块被 <blockquote> 包裹'),
      assert(hasText(html, '引用内容'), '引用内容正确'),
    ];
  },
});

// ── 测试 9: 链接 ──
testCases.push({
  name: '链接转换',
  run: () => {
    const md = '[链接文本](https://example.com)';
    const html = convert(md);
    return [
      assert(hasTagPair(html, 'a'), '链接被 <a> 包裹'),
      assert(hasText(html, 'href="https://example.com"'), '链接 href 属性正确'),
      assert(hasText(html, '链接文本'), '链接文本正确'),
    ];
  },
});

// ── 测试 10: 图片 ──
testCases.push({
  name: '图片转换',
  run: () => {
    const md = '![alt文本](https://example.com/img.png)';
    const html = convert(md);
    return [
      assert(hasTag(html, 'img'), '图片被 <img> 标签渲染'),
      assert(hasText(html, 'src="https://example.com/img.png"'), '图片 src 属性正确'),
      assert(hasText(html, 'alt="alt文本"'), '图片 alt 属性正确'),
    ];
  },
});

// ── 测试 11: 分割线 ──
testCases.push({
  name: '分割线',
  run: () => {
    const md = '---';
    const html = convert(md);
    return [
      assert(hasTag(html, 'hr'), '分割线被 <hr> 标签渲染'),
    ];
  },
});

// ── 测试 12: 转义 ──
testCases.push({
  name: '转义字符',
  run: () => {
    const md = '\\*这不是斜体\\*';
    const html = convert(md);
    return [
      assert(!hasTagPair(html, 'em'), '转义后的星号不会被解析为斜体'),
      assert(hasText(html, '*这不是斜体*'), '星号以字面量显示'),
    ];
  },
});

// ── 测试 13: 完整文档转换 ──
testCases.push({
  name: '完整文档转换 (convertToDocument)',
  run: () => {
    const md = '# 文档标题\n\n正文内容';
    const html = convertToDocument(md);
    return [
      assert(hasTag(html, '!DOCTYPE'), '输出包含 DOCTYPE'),
      assert(hasTagPair(html, 'html'), '输出包含 <html> 标签'),
      assert(hasTagPair(html, 'head'), '输出包含 <head> 标签'),
      assert(hasTagPair(html, 'body'), '输出包含 <body> 标签'),
      assert(hasTagPair(html, 'title'), '输出包含 <title> 标签'),
      assert(hasText(html, '文档标题'), '标题内容出现在文档中'),
      assert(hasText(html, '<style>'), '输出包含样式表'),
    ];
  },
});

// ── 测试 14: 完整文件转换（从 test-input.md） ──
testCases.push({
  name: '完整文件转换（test-input.md）',
  run: () => {
    const inputPath = path.join(__dirname, 'test-input.md');
    const md = fs.readFileSync(inputPath, 'utf-8');
    const html = convert(md);
    const results: string[] = [];
    results.push(assert(md.length > 0, `测试文件读取成功 (${md.length} 字节)`));
    results.push(assert(hasTagPair(html, 'h1'), '输出包含 H1 标题'));
    results.push(assert(hasTagPair(html, 'h2'), '输出包含 H2 标题'));
    results.push(assert(hasTagPair(html, 'h3'), '输出包含 H3 标题'));
    results.push(assert(hasTagPair(html, 'pre'), '输出包含代码块 <pre>'));
    results.push(assert(hasTagPair(html, 'ul'), '输出包含无序列表 <ul>'));
    results.push(assert(hasTagPair(html, 'ol'), '输出包含有序列表 <ol>'));
    results.push(assert(hasTagPair(html, 'blockquote'), '输出包含引用块 <blockquote>'));
    results.push(assert(hasTag(html, 'hr'), '输出包含分割线 <hr>'));
    results.push(assert(hasTagPair(html, 'strong'), '输出包含加粗 <strong>'));
    results.push(assert(hasTagPair(html, 'em'), '输出包含斜体 <em>'));
    results.push(assert(hasTagPair(html, 'code'), '输出包含行内代码 <code>'));
    results.push(assert(hasTag(html, 'a'), '输出包含链接 <a>'));
    return results;
  },
});

// ─── 主测试流程 ─────────────────────────────────────────

function runAllTests(): { total: number; passed: number; failed: number; report: string } {
  const reportLines: string[] = [];
  let totalAsserts = 0;
  let passedAsserts = 0;
  let failedAsserts = 0;

  reportLines.push('# 转换器测试报告');
  reportLines.push('');
  reportLines.push(`**测试时间**: ${new Date().toISOString()}`);
  reportLines.push(`**测试框架**: tsx`);
  reportLines.push('');
  reportLines.push('---');
  reportLines.push('');

  for (const testCase of testCases) {
    reportLines.push(`## ${testCase.name}`);
    reportLines.push('');

    const results = testCase.run();
    for (const result of results) {
      reportLines.push(result);
      totalAsserts++;
      if (result.includes('✅')) {
        passedAsserts++;
      } else {
        failedAsserts++;
      }
    }
    reportLines.push('');
  }

  reportLines.push('---');
  reportLines.push('');
  reportLines.push('## 汇总');
  reportLines.push('');
  reportLines.push(`| 指标 | 数值 |`);
  reportLines.push(`|------|------|`);
  reportLines.push(`| 总断言数 | ${totalAsserts} |`);
  reportLines.push(`| 通过 | ${passedAsserts} |`);
  reportLines.push(`| 失败 | ${failedAsserts} |`);
  reportLines.push(`| 通过率 | ${totalAsserts > 0 ? ((passedAsserts / totalAsserts) * 100).toFixed(1) : 'N/A'}% |`);
  reportLines.push('');
  reportLines.push(`**结论**: ${failedAsserts === 0 ? '✅ 全部通过' : '❌ 存在失败断言'}`);

  return {
    total: totalAsserts,
    passed: passedAsserts,
    failed: failedAsserts,
    report: reportLines.join('\n'),
  };
}

// ─── 执行并输出 ─────────────────────────────────────────

const { total, passed, failed, report } = runAllTests();

// 写入报告到 webui/test_report.md
const reportPath = path.resolve(__dirname, '..', 'webui', 'test_report.md');
fs.writeFileSync(reportPath, report, 'utf-8');

console.log(report);
console.log(`\n📄 测试报告已写入: ${reportPath}`);

// 以退出码反映结果
process.exit(failed > 0 ? 1 : 0);
