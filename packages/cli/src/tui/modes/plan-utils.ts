/* eslint-disable no-console */
/**
 * tui/modes/plan-utils.ts — Plan 模式工具函数
 *
 * 从 commands/repl/executors/plan-executor.ts 迁移的纯工具函数。
 * 不依赖 EngineBridge/ICortexApi，仅纯函数计算。
 *
 * @module tui/modes/plan-utils
 * @since v3 — CLI TUI 全栈重构，旧 REPL 清理后迁移
 */

import type { TaskNode, IntentClarification } from "@cortex/shared";

/**
 * 从用户意图中提取显式指定的工作区路径。
 * 匹配模式："将这个路径作为工作区"/"以...为工作区"/"把工作区设为..."
 * 返回绝对路径或 null。
 */
export function extractWorkspacePath(input: string): string | null {
  const patterns = [
    /[将对]这个路径作为工作区\s*[,，]\s*(?:对\s*)?([A-Za-z]:\\[^\n]*?)(?:\s*(?:做|进行|分析|修改|重构|，|。|$))/i,
    /以\s*([A-Za-z]:\\[^\n]*?)\s*为工作区/i,
    /把工作区设[为到]\s*(?:对\s*)?([A-Za-z]:\\[^\n]*?)(?:\s*(?:做|进行|分析|，|。|$))/i,
    /工作区[为是：:]\s*(?:对\s*)?([A-Za-z]:\\[^\n]*?)(?:\s*(?:做|进行|分析|，|。|$))/i,
  ];
  for (const re of patterns) {
    const m = input.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** 展示意图解析结果 */
export function displayClarification(cl: IntentClarification): void {
  const actionIcon: Record<string, string> = {
    analysis: "🔬", modification: "🔨", audit: "📋",
    refactor: "♻️", generation: "✨", inquiry: "❓",
  };
  const actionLabel: Record<string, string> = {
    analysis: "分析", modification: "修改", audit: "审计",
    refactor: "重构", generation: "生成", inquiry: "询问",
  };
  console.error(`\n┌─ 意图确认 ─────────────────────────────`);
/* eslint-disable-next-line no-console */
  console.error(`│ 🎯 目标: ${cl.goal}`);
/* eslint-disable-next-line no-console */
  console.error(`│ ${actionIcon[cl.actionType] ?? "❓"} 类型: ${actionLabel[cl.actionType] ?? cl.actionType}`);
/* eslint-disable-next-line no-console */
  console.error(`│ 📂 范围: ${cl.scope}`);
/* eslint-disable-next-line no-console */
  console.error(`│ ⚠️ 约束: ${cl.constraints}`);
  if (cl.unclear) {
    console.error(`│ ❓ 不明确: ${cl.unclear}`);
  }
/* eslint-disable-next-line no-console */
  console.error(`└─────────────────────────────────────────`);
}

/**
 * 意图明晰化确认循环。
 * 调用 MetaAgent.clarifyIntent 解析意图→展示→等待用户确认。
 * 返回 effectiveIntent（用户确认后使用），null 表示用户取消。
 */
export async function clarifyAndConfirm(
  input: string,
  metaAgent: { clarifyIntent: (intent: string) => Promise<IntentClarification> },
  askUser?: (question: string) => Promise<string>,
): Promise<string | null> {
  if (!askUser) return input; // 无交互能力时跳过确认

  let currentIntent = input;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const clarification = await metaAgent.clarifyIntent(currentIntent);
      displayClarification(clarification);
    } catch (err) { console.warn('[DEGRADED:tui-plan-utils]', String(err));
      // 解析失败不影响主流程，直接用原始意图
      return currentIntent;
    }

    const raw = await askUser(
      "\n✅ 理解正确？(.yes 确认 / 输入修正意图 / .reject 放弃)"
      + "\n> ",
    );
    const response = raw.trim();

    if (response === ".yes" || response === "") {
      return currentIntent;
    }
    if (response === ".reject") {
      console.error("🛑 已取消。");
      return null;
    }

    // 中文确认词识别——用户说「是的，而且…」不是修正意图，是确认+补充
    const confirmed = _matchChineseConfirm(response);
    if (confirmed !== null) {
      if (confirmed === "") return currentIntent;
      // 确认 + 补充上下文：拼接原意图和补充信息
      currentIntent = `${currentIntent}\n补充说明：${confirmed}`;
      console.error(`📝 已确认并记录补充说明。`);
      return currentIntent;
    }

    // 用户输入了修正——用修正后的意图重新确认
    currentIntent = response;
    console.error(`📝 已修正意图，重新确认…`);
  }

  // 三次确认仍未通过，最后一次机会
/* eslint-disable-next-line no-console */
  console.error("⚠️ 多次修正未确认，直接使用最后意图进入规划。");
  return currentIntent;
}

/**
 * 识别中文确认词。
 * 「是的，而且…」不是修正——是确认+补充。
 * 返回补充内容（纯确认时返回空串），null 表示不是确认句。
 */
function _matchChineseConfirm(raw: string): string | null {
  const patterns: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
    { re: /^是的[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^是的[！!。]*$/u, extract: () => "" },
    { re: /^对[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^对的?[！!。]*$/u, extract: () => "" },
    { re: /^嗯[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^嗯[！!。]*$/u, extract: () => "" },
    { re: /^好[的的]?[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^好[的的]?[！!。]*$/u, extract: () => "" },
    { re: /^是[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^可以[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^可以[！!。]*$/u, extract: () => "" },
    { re: /^没错[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^没错[！!。]*$/u, extract: () => "" },
    { re: /^嗯嗯[！!。]*$/u, extract: () => "" },
    { re: /^确认[，,、。\s]+(.+)$/u, extract: (m) => m[1]! },
    { re: /^确认[！!。]*$/u, extract: () => "" },
  ];

  for (const { re, extract } of patterns) {
    const m = raw.match(re);
    if (m) return extract(m);
  }
  return null;
}

/** 将 TaskNode 树格式化为可读的缩进展示 */
export function formatPlanTree(nodes: TaskNode[]): string {
  const childrenMap = new Map<string, TaskNode[]>();
  const roots: TaskNode[] = [];

  for (const node of nodes) {
    if (!node.parentId) {
      roots.push(node);
    } else {
      const list = childrenMap.get(node.parentId) ?? [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  const lines: string[] = [];
  const icon = (node: TaskNode): string => {
    if (node.needsMultiPerspective) return "🔀";
    const t = node.type.toLowerCase();
    if (t === "code" || t === "implementation") return "🔨";
    if (t === "review") return "🔍";
    if (t === "analysis" || t === "research") return "🧠";
    if (t === "fix" || t === "bugfix") return "💊";
    if (t === "inspect" || t === "inspector") return "🔭";
    if (t === "ops" || t === "deploy") return "⚓";
    if (t === "doc-govern" || t === "audit") return "📜";
    if (t === "browser") return "🎆";
    if (t === "loop" || t === "pattern_scan") return "🔮";
    return "📌";
  };

  const render = (node: TaskNode, depth: number, isLast: boolean, prefix: string) => {
    const connector = depth === 0 ? "" : isLast ? "  └─ " : "  ├─ ";
    const typeLabel = node.type ? `[${node.type}]` : "";
    const tagStr = node.tags?.length ? ` {${node.tags.join(", ")}}` : "";
    const multiStr = node.needsMultiPerspective ? " [多视角]" : "";
    lines.push(`${prefix}${connector}${icon(node)} ${typeLabel} ${node.payload}${tagStr}${multiStr}`);

    const children = childrenMap.get(node.id);
    if (children && children.length > 0) {
      for (let i = 0; i < children.length; i++) {
        const childPrefix = depth === 0 ? "" : isLast ? "    " : "  │ ";
        render(children[i]!, depth + 1, i === children.length - 1, prefix + childPrefix);
      }
    }
  };

  lines.push("═══════════════════════════════════════");
  lines.push("📋 任务计划（甘雨出品）");
  lines.push("═══════════════════════════════════════");

  for (let i = 0; i < roots.length; i++) {
    render(roots[i]!, 0, i === roots.length - 1, "");
  }

  return lines.join("\n");
}

/* eslint-enable no-console */