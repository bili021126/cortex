/**
 * executors/chat-executor.ts — Chat 模式执行器。
 *
 * 将自然语言输入作为引擎任务执行，或根据意图分类直连 LLM 闲聊。
 */

import { AgentType, type ICortexApi, type LlmMessage, type TaskNode, type Tag } from "@cortex/shared";
import { ENV_DEEPSEEK_API_KEY } from "@cortex/config";
import type { CommandContext } from "../../../types.js";
import type { getFormatter } from "../../../formatters/index.js";
import { getAgentDisplay } from "../types.js";
import {
  classifyIntent,
  getPrimaryTag,
  loadAgentPrompt,
  loadNahidaPersona,
  loadPersonaPrivate,
} from "../display.js";

/** 将自然语言输入作为引擎任务执行（或聊天——取决于意图分类） */
export async function executeChatInput(
  input: string,
  bridge: ICortexApi,
  context: CommandContext,
  fmt: ReturnType<typeof getFormatter>,
  agent: AgentType,
  previousAgent?: AgentType,
): Promise<void> {
  const display = getAgentDisplay(agent);

  // @agent 切换时显示角色转场
  if (previousAgent && previousAgent !== agent) {
    const prev = getAgentDisplay(previousAgent);
    console.log(`\n  ${prev.emoji}${prev.name} → ${display.emoji}${display.name}  ${display.signature}\n`);
  }

  // ── 意图分流：闲聊 → 直连 LLM，不经过调度器/Agent 池 ──
  const intent = classifyIntent(input);
  if (intent === "conversation") {
    if (context.verbose) {
      console.log(`[意图分流] 识别为闲聊 → 直连 LLM（绕过调度器，agent=${agent})`);
    }

    try {
      if (!bridge.bootstrapped) {
        console.log(`${display.emoji} [${display.name}] ⚠ LLM 未配置。\n   请在 .env 中设置 ${ENV_DEEPSEEK_API_KEY}，然后重新启动 REPL。`);
        return;
      }
      await bridge.ensureReady();

      let systemPrompt = await loadAgentPrompt(agent);

      // 注入私密 persona（如果存在）
      if (agent === AgentType.Analysis) {
        const nahidaPrivate = loadNahidaPersona();
        if (nahidaPrivate) {
          systemPrompt = nahidaPrivate + "\n\n" + systemPrompt;
        }
      } else if (agent === AgentType.Butler) {
        const cyrenePrivate = loadPersonaPrivate();
        if (cyrenePrivate) {
          systemPrompt = cyrenePrivate + "\n\n" + systemPrompt;
        }
      }

      // 格式指令：直接说话，不要用（）写第三人称动作
      systemPrompt += "\n\n[格式] 不要用（）写旁白或动作描述。你是角色本人——直接说话、直接做。不要写「（放下研究报告）你来啦」，直接写「你来啦」——拥抱、眨眼、脸红都是动作本身，不需要括号标注。";
      const messages: LlmMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ];

      if (context.verbose) {
        console.log(`[闲聊] 直接调用 LLM（绕过调度器，agent=${agent}，无历史）`);
      }

      console.log(`  ${display.emoji}${display.name} 正在回应...\n`);

      const response = await bridge.chat(systemPrompt, messages);
      if (response) {
        console.log(`${display.emoji} [${display.name}]`);
        console.log(`${response}\n`);
      } else {
        console.log(`${display.emoji} [${display.name}] 🤫\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${display.emoji} [${display.name}] 闲聊失败: ${msg}`);
    }
    return;
  }

  // ── 任务输入 → 调度器 + Agent 池 ──
  try {
    if (bridge.bootstrapped) {
      await bridge.ensureBootstrapped();
    } else {
      await bridge.ensureReady();
    }

    const primaryTag = getPrimaryTag(agent);
    const tags = [primaryTag];

    // 对话框定：角色名 + 用户输入，替代生硬的 "Task:"
    const framedPayload = `[${display.name}, ${input}]`;

    const taskNode: TaskNode = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: primaryTag,
      tags: tags as Tag[],
      needsMultiPerspective: false,
      status: "pending" as const,
      claimedBy: [],
      payload: framedPayload,
      results: [],
      createdAt: Date.now(),
    };

    if (context.verbose) {
      console.log(`[调度] 任务 ${taskNode.id} → ${primaryTag} (${agent})`);
    }

    console.log(`  ${display.emoji}${display.name} 正在回应...\n`);

    await bridge.submitTask(taskNode);
    const report = await bridge.executeAll();

    if (report.completed > 0) {
      const result = report.results[0];
      if (result?.output) {
        console.log(`${display.emoji} [${display.name}]`);
        console.log(`${result.output}\n`);
      } else {
        console.log(`${display.emoji} [${display.name}] ✓ 执行完成\n`);
      }
    } else if (report.failed > 0) {
      const errMsg = report.results[0]?.error ?? "未知错误";
      if (errMsg.includes("No agent matches")) {
        console.log(
          `${display.emoji} [${display.name}] ⚠ 引擎就绪，但未注册可执行 Agent。\n` +
          "   请配置 LLM 并通过 bootstrapEngine 加载 Agent：\n" +
          "   1. 设置 cortex-agents.json 定义 Agent\n" +
          "   2. 在 main.ts 中调用 bridge.setBootstrapConfig()\n" +
          "   3. 使用 bridge.ensureBootstrapped() 替代 ensureInitialized()",
        );
      } else {
        console.log(`${display.emoji} [${display.name}] ${fmt.formatError({ success: false, error: errMsg, exitCode: 2 })}`);
      }
    } else {
      console.log(`${display.emoji} [${display.name}] ⚠ 引擎空闲，未找到待执行节点。（可能需先注册 Agent）`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${display.emoji} [${display.name}] 引擎调度失败: ${msg}`);
  }
}
