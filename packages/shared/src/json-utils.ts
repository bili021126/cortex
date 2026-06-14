/**
 * json-utils.ts — 统一 JSON 提取工具
 *
 * 从 LLM 输出 / Markdown 文本中提取 JSON 子串的统一实现。
 * 消除 engine/skill-extractor、engine/meta-agent、pattern-extractor/markdown-extractor
 * 三处重复的 ```json 围栏 + 平衡括号提取逻辑。
 *
 * @since 全系统重构 — JSON 提取统一
 */

/**
 * 从原始文本中提取 JSON 子串。
 *
 * 策略优先级：
 * 1. ```json ... ``` 标记围栏（非贪婪，匹配最近闭合）
 * 2. 回退：提取最外层平衡 [ ... ] 或 { ... }，感知 JSON 字符串边界
 *
 * @param raw - 可能包含 JSON 的原始文本（LLM 输出 / Markdown）
 * @returns 提取的 JSON 子串，或 null 表示未找到
 */
export function extractJsonBlock(raw: string): string | null {
  // 策略 1：```json ... ``` 标记围栏
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    const content = fenceMatch[1].trim();
    if (content.length > 0) return content;
  }

  // 策略 2：回退到最外层平衡括号
  return _extractBalanced(raw);
}

/**
 * 从文本中提取最外层平衡 [ ... ] 或 { ... }，感知 JSON 字符串边界。
 *
 * 处理 LLM 输出中常见的"前置说明 + JSON + 后置注释"模式。
 * 字符串感知确保 payload 内的 [ ] { } 字符不会误导计数器。
 */
function _extractBalanced(raw: string): string | null {
  const trimmed = raw.trim();

  // 尝试从开头匹配
  const startChar = trimmed[0];
  if (startChar === "{" || startChar === "[") {
    const endChar = startChar === "{" ? "}" : "]";
    const result = _scanBalanced(trimmed, 0, endChar);
    if (result !== null) return result;
  }

  // 从第一个 { 或 [ 开始扫描
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  if (objStart === -1 && arrStart === -1) return null;

  const start = objStart === -1 ? arrStart
    : arrStart === -1 ? objStart
    : Math.min(objStart, arrStart);

  const expectedEnd = trimmed[start] === "{" ? "}" : "]";
  return _scanBalanced(trimmed, start, expectedEnd);
}

/** 从指定位置扫描平衡括号，感知字符串/转义 */
function _scanBalanced(
  text: string,
  startIdx: number,
  endChar: string,
): string | null {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === stringChar) { inString = false; }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      depth++;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === endChar) {
        return text.slice(startIdx, i + 1);
      }
      if (depth < 0) return null; // 不平衡
    }
  }

  return null; // 未闭合
}
