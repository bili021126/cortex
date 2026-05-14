/**
 * parser.ts — Markdown → HTML 转换解析器
 *
 * 支持的 Markdown 语法：
 *   - 标题: # ~ ######
 *   - 段落: 连续文本块
 *   - 强调: **加粗**, *斜体*
 *   - 行内代码: `code`
 *   - 代码块: ```language ... ```
 *   - 无序列表: -, *
 *   - 有序列表: 1. 2. 3.
 *   - 引用块: >
 *   - 分割线: ---, ***, ___
 *   - 链接: [text](url)
 *   - 图片: ![alt](url)
 *   - 转义: \<char> 保留字面字符
 */

// ─── 行内解析 ───────────────────────────────────────────

/** 转义字符映射 */
const ESCAPE_MAP: Record<string, string> = {
  '\\`': '`',
  '\\*': '*',
  '\\_': '_',
  '\\[': '[',
  '\\]': ']',
  '\\(': '(',
  '\\)': ')',
  '\\!': '!',
  '\\#': '#',
  '\\\\': '\\',
};

/**
 * 解析行内元素（强调、代码、链接、图片、转义）。
 * 使用单次扫描 + 正则匹配，按优先级依次处理。
 */
function parseInline(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    // 转义字符
    if (text[i] === '\\' && i + 1 < text.length) {
      const seq = text.slice(i, i + 2);
      if (ESCAPE_MAP[seq] !== undefined) {
        result += ESCAPE_MAP[seq];
        i += 2;
        continue;
      }
    }

    // 行内代码 `…`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        result += `<code>${escapeHtml(text.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    // 图片 ![alt](url)
    if (text[i] === '!' && i + 1 < text.length && text[i + 1] === '[') {
      const closeBracket = text.indexOf(']', i + 2);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const alt = text.slice(i + 2, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          result += `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">`;
          i = closeParen + 1;
          continue;
        }
      }
    }

    // 链接 [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          result += `<a href="${escapeAttr(url)}">${parseInline(linkText)}</a>`;
          i = closeParen + 1;
          continue;
        }
      }
    }

    // 加粗 **text** 或 __text__
    if ((text[i] === '*' && text[i + 1] === '*') ||
        (text[i] === '_' && text[i + 1] === '_')) {
      const marker = text.slice(i, i + 2);
      const end = text.indexOf(marker, i + 2);
      if (end !== -1) {
        result += `<strong>${parseInline(text.slice(i + 2, end))}</strong>`;
        i = end + 2;
        continue;
      }
    }

    // 斜体 *text* 或 _text_
    if (text[i] === '*' || text[i] === '_') {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end !== -1) {
        // 避免误匹配加粗标记
        if (end + 1 < text.length && text[end + 1] === marker) {
          // 这是加粗的起始，不是斜体的结束
          result += text[i];
          i++;
          continue;
        }
        result += `<em>${parseInline(text.slice(i + 1, end))}</em>`;
        i = end + 1;
        continue;
      }
    }

    // 普通字符
    result += text[i];
    i++;
  }

  return result;
}

/** HTML 实体转义 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** HTML 属性值转义 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── 块级解析 ───────────────────────────────────────────

/** 判断是否为分割线 */
function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  // ---
  if (/^---+\s*$/.test(trimmed)) return true;
  // ***
  if (/^\*{3,}\s*$/.test(trimmed)) return true;
  // ___
  if (/^_{3,}\s*$/.test(trimmed)) return true;
  return false;
}

/** 判断是否为标题行 */
function isHeading(line: string): { level: number; content: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    return { level: match[1].length, content: match[2].trim() };
  }
  return null;
}

/** 判断是否为引用行 */
function isBlockquote(line: string): string | null {
  const match = line.match(/^>\s?(.*)$/);
  return match ? match[1] : null;
}

/** 判断是否为无序列表项 */
function isUnorderedListItem(line: string): string | null {
  const match = line.match(/^[-*+]\s+(.+)$/);
  return match ? match[1] : null;
}

/** 判断是否为有序列表项 */
function isOrderedListItem(line: string): { content: string; start: number } | null {
  const match = line.match(/^(\d+)\.\s+(.+)$/);
  if (match) {
    return { content: match[2], start: parseInt(match[1], 10) };
  }
  return null;
}

/** 判断是否为代码围栏开始 */
function isFenceStart(line: string): string | null {
  const match = line.match(/^```(\w*)$/);
  return match ? match[1] || null : null;
}

/** 解析代码块内容 */
function parseCodeBlock(lines: string[], startIdx: number): { html: string; endIdx: number } {
  const fenceLang = isFenceStart(lines[startIdx]);
  const langClass = fenceLang ? ` class="language-${escapeAttr(fenceLang)}"` : '';
  const codeLines: string[] = [];
  let i = startIdx + 1;

  while (i < lines.length) {
    if (lines[i].trim() === '```') {
      i++; // 跳过结束围栏
      break;
    }
    codeLines.push(lines[i]);
    i++;
  }

  const code = codeLines.join('\n');
  const html = `<pre><code${langClass}>${escapeHtml(code)}</code></pre>\n`;
  return { html, endIdx: i };
}

// ─── 公开 API ───────────────────────────────────────────

/**
 * 将 Markdown 文本转换为 HTML 字符串。
 *
 * @param markdown - 原始 Markdown 文本
 * @returns 转换后的 HTML 字符串
 */
export function convert(markdown: string): string {
  const lines = markdown.split('\n');
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行 — 跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 代码块
    if (line.trimStart().startsWith('```')) {
      const { html, endIdx } = parseCodeBlock(lines, i);
      htmlParts.push(html);
      i = endIdx;
      continue;
    }

    // 分割线
    if (isThematicBreak(line)) {
      htmlParts.push('<hr>\n');
      i++;
      continue;
    }

    // 标题
    const heading = isHeading(line);
    if (heading) {
      htmlParts.push(
        `<h${heading.level}>${parseInline(heading.content)}</h${heading.level}>\n`
      );
      i++;
      continue;
    }

    // 引用块（支持多行）
    if (isBlockquote(line) !== null) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const q = isBlockquote(lines[i]);
        if (q === null) break;
        quoteLines.push(q);
        i++;
      }
      const content = quoteLines
        .map((q) => parseInline(q))
        .join('<br>\n');
      htmlParts.push(`<blockquote>\n<p>${content}</p>\n</blockquote>\n`);
      continue;
    }

    // 无序列表
    const ulItem = isUnorderedListItem(line);
    if (ulItem !== null) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = isUnorderedListItem(lines[i]);
        if (item === null) break;
        items.push(parseInline(item));
        i++;
      }
      htmlParts.push(
        '<ul>\n' + items.map((item) => `  <li>${item}</li>`).join('\n') + '\n</ul>\n'
      );
      continue;
    }

    // 有序列表
    const olItem = isOrderedListItem(line);
    if (olItem !== null) {
      const items: string[] = [];
      let startNum = olItem.start;
      while (i < lines.length) {
        const item = isOrderedListItem(lines[i]);
        if (item === null) break;
        if (i === lines.length - 1 || isOrderedListItem(lines[i + 1]) === null) {
          items.push(parseInline(item.content));
        } else {
          items.push(parseInline(item.content));
        }
        i++;
      }
      const startAttr = startNum !== 1 ? ` start="${startNum}"` : '';
      htmlParts.push(
        `<ol${startAttr}>\n` + items.map((item) => `  <li>${item}</li>`).join('\n') + '\n</ol>\n'
      );
      continue;
    }

    // 段落 — 收集连续非空行
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (cur.trim() === '') break;
      if (isHeading(cur) || isThematicBreak(cur) || isFenceStart(cur.trimStart()) !== null) break;
      if (isBlockquote(cur) !== null) break;
      if (isUnorderedListItem(cur) !== null) break;
      if (isOrderedListItem(cur) !== null) break;
      paraLines.push(cur);
      i++;
    }

    if (paraLines.length > 0) {
      const content = paraLines
        .map((l) => parseInline(l))
        .join('<br>\n');
      htmlParts.push(`<p>${content}</p>\n`);
    } else {
      i++;
    }
  }

  return htmlParts.join('');
}

/**
 * 将 Markdown 文本转换为完整的 HTML 文档。
 *
 * @param markdown - 原始 Markdown 文本
 * @param title - 文档标题（可选）
 * @returns 完整的 HTML 文档字符串
 */
export function convertToDocument(markdown: string, title?: string): string {
  const bodyContent = convert(markdown);
  const docTitle = title || extractTitle(markdown) || 'Markdown';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeAttr(docTitle)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 2em; line-height: 1.6; color: #333; }
h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; line-height: 1.25; }
h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding: 0 1em; border-left: 4px solid #dfe2e5; color: #6a737d; }
ul, ol { padding-left: 2em; }
a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #ddd; margin: 2em 0; }
</style>
</head>
<body>
${bodyContent}
</body>
</html>
`;
}

/** 从 Markdown 中提取第一个标题作为文档标题 */
function extractTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}
