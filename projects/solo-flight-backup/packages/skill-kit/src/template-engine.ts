// ============================================================================
// @cortex/skill-kit — Template Engine
//
// Lightweight {{variable}} and {{#each list}}...{{/each}} renderer.
// Zero external dependencies.
// ============================================================================

import type { TemplateVariables } from './types.js';

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * 渲染模板。
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  const topLevel = collectTopLevelVars(template);
  const missing = topLevel.filter((name) => !(name in variables));
  if (missing.length > 0) {
    throw new Error(`Missing template variables: ${missing.join(', ')}`);
  }

  let result = processEachBlocks(template, variables);
  result = replaceTopLevelVars(result, variables);
  return result;
}

/**
 * 从模板中提取所有顶层变量名（不含 #each 块内的变量）。
 */
export function listTemplateVariables(template: string): string[] {
  return collectTopLevelVars(template);
}

/**
 * 校验变量是否满足模板要求。
 */
export function validateTemplateVariables(
  template: string,
  variables: TemplateVariables,
): boolean {
  const names = collectTopLevelVars(template);
  return names.every((name) => name in variables);
}

// ─── Internal ─────────────────────────────────────────────────────────────

/**
 * Scan template char-by-char to find top-level variables.
 */
function collectTopLevelVars(template: string): string[] {
  const names = new Set<string>();
  const chars = template.split('');
  let depth = 0;
  let i = 0;

  while (i < chars.length) {
    // Look for {{...}}
    if (chars[i] === '{' && i + 1 < chars.length && chars[i + 1] === '{') {
      const snippet = template.slice(i);

      // Check {{#each name}}
      const eachOpenMatch = snippet.match(/^\{\{#each\s+(\w+)\}\}/);
      if (eachOpenMatch) {
        depth++;
        i += eachOpenMatch[0].length;
        continue;
      }

      // Check {{/each}}
      const eachCloseMatch = snippet.match(/^\{\{\/each\}\}/);
      if (eachCloseMatch) {
        depth = Math.max(0, depth - 1);
        i += eachCloseMatch[0].length;
        continue;
      }

      // Check {{variable}} — only top-level (depth === 0)
      const varMatch = snippet.match(/^\{\{(\w+)\}\}/);
      if (varMatch && depth === 0) {
        names.add(varMatch[1]);
        i += varMatch[0].length;
        continue;
      }
    }

    i++;
  }

  return Array.from(names);
}

/**
 * Replace remaining top-level {{variable}} placeholders.
 */
function replaceTopLevelVars(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const val = variables[name];
    if (val === undefined || val === null) return '';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  });
}

/**
 * Process {{#each listName}}...{{/each}} blocks recursively.
 */
function processEachBlocks(template: string, variables: TemplateVariables): string {
  const result = template;
  const eachRe = /^\{\{#each\s+(\w+)\}\}/;

  // Find the first {{#each ...}} block
  let startIdx = -1;
  let listName = '';
  let i = 0;
  const chars = result.split('');

  while (i < chars.length) {
    if (chars[i] === '{' && i + 1 < chars.length && chars[i + 1] === '{') {
      const snippet = result.slice(i);
      const match = snippet.match(eachRe);
      if (match) {
        startIdx = i;
        listName = match[1];
        break;
      }
    }
    i++;
  }

  if (startIdx === -1) return result; // No more #each blocks

  const openLen = result.slice(startIdx).match(eachRe)![0].length;
  const afterOpen = result.slice(startIdx + openLen);

  // Find matching {{/each}} considering nesting
  let closePos = -1;
  let depth = 1;
  let pos = 0;
  const chars2 = afterOpen.split('');

  while (depth > 0 && pos < chars2.length) {
    if (chars2[pos] === '{' && pos + 1 < chars2.length && chars2[pos + 1] === '{') {
      const snippet = afterOpen.slice(pos);
      const eachOpenMatch = snippet.match(/^\{\{#each\s+(\w+)\}\}/);
      if (eachOpenMatch) {
        depth++;
        pos += eachOpenMatch[0].length;
        continue;
      }
      const eachCloseMatch = snippet.match(/^\{\{\/each\}\}/);
      if (eachCloseMatch) {
        depth--;
        if (depth === 0) {
          closePos = startIdx + openLen + pos;
        }
        pos += eachCloseMatch[0].length;
        continue;
      }
    }
    pos++;
  }

  if (closePos === -1) {
    throw new Error(`Unclosed {{#each ${listName}}} block`);
  }

  const blockContent = result.slice(startIdx + openLen, closePos);
  const blockEndIdx = closePos + '{{/each}}'.length;

  const list = variables[listName];
  if (!Array.isArray(list)) {
    throw new Error(`"${listName}" is not an array, cannot use {{#each}}`);
  }

  // Render items
  const varRe = /\{\{(\w+)\}\}/g;
  const rendered = list
    .map((item) => {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        return blockContent.replace(varRe, (_m, name: string) => {
          const val = rec[name];
          if (val === undefined || val === null) return '';
          if (Array.isArray(val)) return val.join(', ');
          return String(val);
        });
      }
      return blockContent.replace(varRe, () => String(item));
    })
    .join('');

  // Reconstruct and recurse (in case of nested #each blocks)
  const newResult = result.slice(0, startIdx) + rendered + result.slice(blockEndIdx);
  return processEachBlocks(newResult, variables);
}
