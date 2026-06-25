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
 *
 * 原位于 projects/solo-flight/packages/parser/src/parser.ts
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
 *
 * @fix N-08 — 在加粗检查前插入三级嵌套 `***text***` 检测，
 *       防止加粗匹配误将 `***` 结尾的前两个 `*` 当作结束标记。
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
          // H-19: 过滤危险协议 URL（图片 src 也可能执行 javascript:）
          if (!isSafeUrl(url)) {
            result += `<img src="#" alt="${escapeAttr(alt)}" class="unsafe-url">`;
          } else {
            result += `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">`;
          }
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
          // H-19: 过滤危险协议 URL
          if (!isSafeUrl(url)) {
            result += `<a href="#" class="unsafe-url">${parseInline(linkText)}</a>`;
          } else {
            result += `<a href="${escapeAttr(url)}">${parseInline(linkText)}</a>`;
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // @fix N-08 — 三级嵌套 ***text*** → <strong><em>text</em></strong>
    if ((text[i] === '*' && text[i + 1] === '*' && text[i + 2] === '*') ||
        (text[i] === '_' && text[i + 1] === '_' && text[i + 2] === '_')) {
      const marker = text.slice(i, i + 3);
      const end = text.indexOf(marker, i + 3);
      if (end !== -1) {
        result += `<strong><em>${parseInline(text.slice(i + 3, end))}</em></strong>`;
        i = end + 3;
        continue;
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
      const marker = text[i] as string;
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

    // 普通字符 — HTML 实体转义防止 XSS
    if (text[i] === '<') result += '&lt;';
    else if (text[i] === '>') result += '&gt;';
    else if (text[i] === '&') result += '&amp;';
    else result += text[i];
    i++;
  }

  return result;
}

// ─── XSS 防护 ───────────────────────────────────────────

/** 允许的 HTML 标签属性白名单 */
const _ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel']);

/**
 * 过滤/转义 HTML 标签中的危险属性。
 * 将 on* 事件属性（onerror, onload, onclick 等）转义为 data-x-on*，
 * 阻止 XSS 注入。
 */
function sanitizeAttrs(html: string): string {
  return html.replace(/\s(on\w+)\s*=/gi, ' data-x-$1=');
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

/** H-19: 检查 URL 协议是否安全（拒绝 javascript: data: vbscript: 等危险协议） */
function isSafeUrl(url: string): boolean {
  const dangerousProtocols = /^(javascript|data|vbscript)\s*:/i;
  return !dangerousProtocols.test(url.trim());
}

// ─── 块级解析 ───────────────────────────────────────────

/** 判断是否为分割线 */
function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  if (/^---+\s*$/.test(trimmed)) return true;
  if (/^\*{3,}\s*$/.test(trimmed)) return true;
  if (/^_{3,}\s*$/.test(trimmed)) return true;
  return false;
}

/** 判断是否为标题行 */
function isHeading(line: string): { level: number; content: string } | null {
  const match = line.match(/^(#{1,6})\s+(.+)$/);
  if (match) {
    return { level: (match[1] ?? '').length, content: (match[2] ?? '').trim() };
  }
  return null;
}

/** 判断是否为引用行 */
function isBlockquote(line: string): string | null {
  const match = line.match(/^>\s?(.*)$/);
  return match ? (match[1] ?? null) : null;
}

/** 判断是否为无序列表项 */
function isUnorderedListItem(line: string): string | null {
  const match = line.match(/^[-*+]\s+(.+)$/);
  return match ? (match[1] ?? null) : null;
}

/** 判断是否为有序列表项 */
function isOrderedListItem(line: string): { content: string; start: number } | null {
  const match = line.match(/^(\d+)\.\s+(.+)$/);
  if (match) {
    return { content: match[2] ?? '', start: parseInt(match[1] ?? '0', 10) };
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
  const fenceLang = isFenceStart(lines[startIdx] ?? '');
  const langClass = fenceLang ? ` class="language-${escapeAttr(fenceLang)}"` : '';
  const codeLines: string[] = [];
  let i = startIdx + 1;

  while (i < lines.length) {
    if ((lines[i] ?? '').trim() === '```') {
      i++; // 跳过结束围栏
      break;
    }
    codeLines.push(lines[i] ?? '');
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
    const line = lines[i] ?? '';

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
        const q = isBlockquote(lines[i] ?? '');
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
        const item = isUnorderedListItem(lines[i] ?? '');
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
      const startNum = olItem.start;
      while (i < lines.length) {
        const item = isOrderedListItem(lines[i] ?? '');
        if (item === null) break;
        items.push(parseInline(item.content));
        i++;
      }
      const startAttr = startNum !== 1 ? ` start="${startNum}"` : '';
      htmlParts.push(
        `<ol${startAttr}>\n` + items.map((item) => `  <li>${item}</li>`).join('\n') + '\n</ol>\n'
      );
      continue;
    }

    // 段落
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '') break;
      if (isHeading(l)) break;
      if (isThematicBreak(l)) break;
      if (l.trimStart().startsWith('```')) break;
      if (isBlockquote(l) !== null) break;
      if (isUnorderedListItem(l) !== null) break;
      if (isOrderedListItem(l) !== null) break;
      paragraphLines.push(l);
      i++;
    }

    if (paragraphLines.length > 0) {
      const paragraph = paragraphLines
        .map((l) => parseInline(l))
        .join('\n');
      htmlParts.push(`<p>${paragraph}</p>\n`);
    }
  }

  const raw = htmlParts.join('');
  return sanitizeAttrs(raw);
}

/**
 * 将 Markdown 文本转换为完整的 HTML 文档。
 * 包装 convert() 的输出，添加 DOCTYPE、head、title、基础样式和 body。
 *
 * @param markdown - 原始 Markdown 文本
 * @param title - 可选文档标题，默认 "Document"
 * @returns 完整的 HTML 文档字符串
 */
export function convertToDocument(markdown: string, title?: string): string {
  const docTitle = title || 'Document';
  const body = convert(markdown);
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${docTitle}</title>`,
    '<style>',
    'body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #333; }',
    'pre { background: #f4f4f4; padding: 1rem; border-radius: 4px; overflow-x: auto; }',
    'code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }',
    'pre code { background: none; padding: 0; }',
    'blockquote { border-left: 3px solid #ccc; margin: 0; padding: 0.5em 1em; color: #666; }',
    '</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}
