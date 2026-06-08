/**
 * executors/plan-executor.ts — Plan 模式执行器。
 *
 * 甘雨拆解意图→展示计划→等待审批。支持 .approve/.reject/.review/.status 命令。
 */

import type { ICortexApi, LlmMessage, TaskNode } from "@cortex/shared";
import type { CommandContext } from "../../../types.js";
import { type IntentClarification, type MetaAgent } from "@cortex/engine";
import type { getFormatter } from "../../../formatters/index.js";
import { CLI_REPL_PLAN_OUTPUT_MAX_LEN } from "@cortex/config";
import type { PlanExecutionContext } from "../types.js";
import { EngineBridge } from "../../../services/engine-bridge.js";

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

/** 规划模式：甘雨确认意图→拆解意图→展示计划→等待审批 */
export async function executePlanInput(
  input: string,
  bridge: ICortexApi,
  context: CommandContext,
  fmt: ReturnType<typeof getFormatter>,
  planCtx?: PlanExecutionContext,
  askUser?: (question: string) => Promise<string>,
): Promise<void> {
  const metaAgent = await bridge.getMetaAgent() as MetaAgent | undefined;
  if (!metaAgent) {
    console.log("⚠ 规划模式需要配置驱动初始化（bootstrapEngine）。请先配置 LLM。");
    return;
  }

  const startGen = planCtx?.startGeneration;

  // ── 意图明晰化确认 ──
  const effectiveIntent = await clarifyAndConfirm(input, metaAgent, askUser);
  if (effectiveIntent === null) return; // 用户拒绝

  console.log("\n🤔 甘雨正在拆解意图...");

  try {
    const nodes = await metaAgent.plan(effectiveIntent);

    // 版本校验：LLM 返回时模式可能已切换
    if (startGen != null && planCtx?.getGeneration && planCtx.getGeneration() !== startGen) {
      return;
    }

    if (!nodes || nodes.length === 0) {
      console.log("🛑 甘雨拒绝了此意图——目标路径不在当前工作区内，无法执行。");
      console.log("   请检查路径后重试，或将目标项目置于当前工作区中。");
      return;
    }

    if (planCtx) {
      planCtx.setPlanNodes(nodes);
      planCtx.setPlanIntent(effectiveIntent);
    }

    console.log(formatPlanTree(nodes));
    console.log(`\n📋 共 ${nodes.length} 个任务节点。`);
    console.log("输入 .review 三省审议，.approve 批准执行，.reject 放弃计划，.status 查看进度");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`规划失败: ${msg}`);
  }
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
  console.log(`\n┌─ 意图确认 ─────────────────────────────`);
  console.log(`│ 🎯 目标: ${cl.goal}`);
  console.log(`│ ${actionIcon[cl.actionType] ?? "❓"} 类型: ${actionLabel[cl.actionType] ?? cl.actionType}`);
  console.log(`│ 📂 范围: ${cl.scope}`);
  console.log(`│ ⚠️ 约束: ${cl.constraints}`);
  if (cl.unclear) {
    console.log(`│ ❓ 不明确: ${cl.unclear}`);
  }
  console.log(`└─────────────────────────────────────────`);
}

/**
 * 意图明晰化确认循环。
 * 调用 MetaAgent.clarifyIntent 解析意图→展示→等待用户确认。
 * 返回 effectiveIntent（用户确认后使用），null 表示用户取消。
 */
export async function clarifyAndConfirm(
  input: string,
  metaAgent: MetaAgent,
  askUser?: (question: string) => Promise<string>,
): Promise<string | null> {
  if (!askUser) return input; // 无交互能力时跳过确认

  let currentIntent = input;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const clarification = await metaAgent.clarifyIntent(currentIntent);
      displayClarification(clarification);
    } catch {
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
      console.log("🛑 已取消。");
      return null;
    }

    // 中文确认词识别——用户说「是的，而且…」不是修正意图，是确认+补充
    const confirmed = _matchChineseConfirm(response);
    if (confirmed !== null) {
      if (confirmed === "") return currentIntent;
      // 确认 + 补充上下文：拼接原意图和补充信息
      currentIntent = `${currentIntent}\n补充说明：${confirmed}`;
      console.log(`📝 已确认并记录补充说明。`);
      return currentIntent;
    }

    // 用户输入了修正——用修正后的意图重新确认
    currentIntent = response;
    console.log(`📝 已修正意图，重新确认…`);
  }

  // 三次确认仍未通过，最后一次机会
  console.log("⚠️ 多次修正未确认，直接使用最后意图进入规划。");
  return currentIntent;
}

/**
 * 识别中文确认词。
 * 「是的，而且…」不是修正——是确认+补充。
 * 返回补充内容（纯确认时返回空串），null 表示不是确认句。
 */
function _matchChineseConfirm(raw: string): string | null {
  const patterns: Array<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
    { re: /^是的[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^是的[！!。]*$/u, extract: () => "" },
    { re: /^对[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^对的?[！!。]*$/u, extract: () => "" },
    { re: /^嗯[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^嗯[！!。]*$/u, extract: () => "" },
    { re: /^好[的的]?[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^好[的的]?[！!。]*$/u, extract: () => "" },
    { re: /^是[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^可以[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^可以[！!。]*$/u, extract: () => "" },
    { re: /^没错[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
    { re: /^没错[！!。]*$/u, extract: () => "" },
    { re: /^嗯嗯[！!。]*$/u, extract: () => "" },
    { re: /^确认[，,、。\s]+(.+)$/u, extract: (m) => m[1] },
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
        render(children[i], depth + 1, i === children.length - 1, prefix + childPrefix);
      }
    }
  };

  lines.push("═══════════════════════════════════════");
  lines.push("📋 任务计划（甘雨出品）");
  lines.push("═══════════════════════════════════════");

  for (let i = 0; i < roots.length; i++) {
    render(roots[i], 0, i === roots.length - 1, "");
  }

  return lines.join("\n");
}

/** Plan 模式内部命令处理器 */
export async function handlePlanCommand(
  input: string,
  bridge: ICortexApi,
  ctx: {
    getPlanNodes: () => TaskNode[];
    setPlanNodes: (nodes: TaskNode[]) => void;
    getPlanIntent: () => string;
    setPlanIntent: (intent: string) => void;
    getFormat: () => string;
    getVerbose: () => boolean;
    bumpGeneration: () => void;
  },
): Promise<"handled" | "passthrough"> {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".approve": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("⚠ 没有待审批的计划。请先输入意图描述让甘雨生成计划。");
        return "handled";
      }

      const snapshot = nodes.slice();
      const intent = ctx.getPlanIntent(); // 先捕获意图——下面会清空
      ctx.setPlanNodes([]);
      ctx.setPlanIntent("");
      ctx.bumpGeneration();

      console.log("\n✅ 计划已批准，开始执行...\n");

      try {
        // 检查用户是否指定了不同的工作区路径
        const wsPath = extractWorkspacePath(intent);
        if (wsPath && bridge instanceof EngineBridge) {
          console.log(`🔀 切换工作区至: ${wsPath}`);
          await bridge.rebootstrapIfNeeded(wsPath);
        }
        await bridge.ensureBootstrapped();

        for (const node of snapshot) {
          await bridge.submitTask(node);
        }

        if (ctx.getVerbose()) {
          console.log(`[调度] 已添加 ${snapshot.length} 个节点到任务板`);
        }

        console.log("⏳ 正在调度 Agent 执行...");
        const report = await bridge.executeAll();

        const sep = "─".repeat(50);
        console.log(`\n${sep}`);
        console.log("📊 执行结果");
        console.log(`${sep}`);
        console.log(`  ✅ 完成: ${report.completed}  |  ❌ 失败: ${report.failed}  |  ⏱ ${(report.durationMs / 1000).toFixed(1)}s  |  📋 ${report.totalNodes} 节点`);

        if (report.results.length > 0) {
          console.log(`\n${sep}`);
          console.log("📝 节点详情");
          console.log(`${sep}`);
          for (const r of report.results) {
            const status = r.success ? "✅" : "❌";
            const agentName = r.agentType ?? "?";
            const shortId = r.nodeId.slice(-12);
            if (r.output) {
              console.log(`\n${status} [${agentName}] ${shortId}`);
              const maxLen = CLI_REPL_PLAN_OUTPUT_MAX_LEN;
              const out = r.output.length > maxLen ? r.output.slice(0, maxLen) + `\n... (截断，共 ${r.output.length} 字符)` : r.output;
              console.log(`   ${out.replace(/\n/g, "\n   ")}`);
            } else if (r.error) {
              console.log(`\n${status} [${agentName}] ${shortId}`);
              console.log(`   ⚠ ${r.error.slice(0, 300)}`);
            }
          }
        }
        console.log(`\n${sep}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`执行失败: ${msg}`);
      }

      return "handled";
    }

    case ".reject": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("⚠ 没有待审批的计划。");
        return "handled";
      }
      console.log(`❌ 计划已放弃（${nodes.length} 个节点）。`);
      ctx.setPlanNodes([]);
      ctx.setPlanIntent("");
      return "handled";
    }

    case ".status": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("📋 当前无计划。输入意图描述让甘雨生成计划。");
      } else {
        const intent = ctx.getPlanIntent();
        console.log(`📋 当前计划: "${intent.slice(0, 80)}${intent.length > 80 ? "..." : ""}"`);
        console.log(`   共 ${nodes.length} 个节点，输入 .review 三省审议，.approve 执行，.reject 放弃`);
      }
      return "handled";
    }

    case ".review": {
      const nodes = ctx.getPlanNodes();
      if (nodes.length === 0) {
        console.log("⚠ 没有待审批的计划。请先输入意图描述让甘雨生成计划。");
        return "handled";
      }

      console.log("\n⚖️ 三省审议启动——凝光审计 + 钟离契约守护 + 霜凝方向监理...\n");

      try {
        const intent = ctx.getPlanIntent();
        const planTree = nodes.map((n) => `- [${n.type}] ${n.payload}${n.tags?.length ? ` {${n.tags.join(", ")}}` : ""}`).join("\n");

        const reviewPrompt = [
          "[三省审议模式——凝光·钟离·霜凝 联合审阅计划]",
          "",
          `原始意图: ${intent}`,
          "",
          "甘雨产出的任务计划:",
          planTree,
          "",
          "请三位 Agent 依次发言:",
          "",
          "### 凝光（DocGovern）——天权定论，不得上诉",
          "· 审计计划的可执行性、覆盖完整性、合规性",
          "· 检查是否违反宪法原则七、硬编码禁令",
          "· 指出缺失的审计/审查/归档节点",
          "· 给出 P0（必须修正）/ P1（建议修正）清单",
          "",
          "### 钟离（Strategist）——契约既成，食言者当受食岩之罚",
          "· 评估计划的长期契约稳定性——会不会产生技术债",
          "· 检查任务边界是否清晰（不会越权或重叠）",
          "· 判断哪些任务风险太高需要降级或拆分",
          "· 给出契约修正建议",
          "",
          "### 霜凝（Strategist·方向监理）",
          "· 评估计划是否与项目整体方向一致",
          "· 检查是否有遗漏的战略维度",
          "· 给出方向性建议",
          "",
          "格式——用角色名开头，凝光先，钟离其次，霜凝最后:",
          "⚖️ 凝光审计:",
          "[审计意见——P0/P1清单]",
          "",
          "⚖️ 钟离契约评估:",
          "[契约稳定性评估]",
          "",
          "⚖️ 霜凝方向监理:",
          "[方向建议]",
          "",
          "## 综合裁决",
          "[凝光收束——给出: 批准 / 修正后批准 / 驳回 及理由]",
        ].join("\n");

        const messages: LlmMessage[] = [
          { role: "system", content: reviewPrompt },
        ];

        const response = await bridge.chat(reviewPrompt, messages);
        if (response) {
          console.log(response);
          console.log("\n📋 审阅完成。根据审议结果输入 .approve 执行 或 .reject 放弃。");
        } else {
          console.log("⚠ 审议无响应，可直接 .approve 执行。");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`审议失败: ${msg}`);
      }

      return "handled";
    }

    default:
      return "passthrough";
  }
}
