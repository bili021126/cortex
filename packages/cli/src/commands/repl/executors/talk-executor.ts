/**
 * executors/talk-executor.ts — Talk 模式执行器。
 *
 * 昔涟独立陪聊，不经调度器。拥有独立记忆管线：检索 → LLM → 写入。
 */

import { createHash } from "node:crypto";
import type { ICortexApi } from "@cortex/shared";
import { AgentType, SHARED_IDENTITY_ANCHOR } from "@cortex/shared";
import { ENV_DEEPSEEK_API_KEY } from "@cortex/config";
import type { CommandContext } from "../../../types.js";
import { getFormatter } from "../../../formatters/index.js";
import { getAgentDisplay } from "../types.js";
import {
  classifyTalkIntent,
  loadPersonaPrivate,
  loadTalkPersona,
} from "../display.js";
import { talkHistory } from "./state.js";

/** 闲聊模式——昔涟独立陪聊，不经调度器（不派任务，不匹配 Agent）。
 *  拥有独立记忆管线：检索 → LLM → 写入（数据库 .cortex/cyrene-memory.db） */
export async function executeTalkInput(
  input: string,
  bridge: ICortexApi,
  context: CommandContext,
  _fmt: ReturnType<typeof getFormatter>,
): Promise<void> {
  const display = getAgentDisplay(AgentType.Butler);

  try {
    if (!bridge.bootstrapped) {
      console.log(
        `${display.emoji} [${display.name}] ⚠ LLM 未配置。\n` +
        `   请在 .env 中设置 ${ENV_DEEPSEEK_API_KEY}，然后重新启动 REPL。`,
      );
      return;
    }

    await bridge.ensureReady();

    // ── 主记忆库只读：获取工程上下文（不写、不追踪）──
    let engineeringContext = "";
    try {
      const engResults = await bridge.readMainMemory({
        agentTypes: [AgentType.Butler],
        limit: 3,
      });
      engineeringContext = engResults.length > 0
        ? `\n[工程背景——你不参与但你知道：\n${engResults.map((m) => `· ${m.summary}`).join("\n")}\n——可以点一句，但要轻。你是妻子，不是参谋。]`
        : "";
    } catch { /* 主库不可用或检索失败不阻塞闲聊 */ }

    // ── 独立记忆管线：初始化昔涟专属 MemoryStore ──
    await bridge.ensureTalkMemory();

    // ── 独立记忆管线：检索相关记忆 ──
    const relatedMemories: string[] = [];
    try {
      const memResults = await bridge.readTalkMemory({
        keywords: input.split(/\s+/).slice(0, 10),
        agentTypes: [AgentType.Butler],
        limit: 3,
      });
      relatedMemories.push(
        ...memResults.map(
          (m) => `[${new Date(m.createdAt).toLocaleDateString("zh-CN")}] ${m.summary}`,
        ),
      );
    } catch { /* 记忆检索失败不阻塞闲聊 */ }

    const publicPersona = loadTalkPersona();
    const systemPrompt = publicPersona.replace("${input}", "");
    const anchoredSystemPrompt = SHARED_IDENTITY_ANCHOR + "\n\n" + systemPrompt;

    const memoryContext =
      relatedMemories.length > 0
        ? `\n\n[关于你们之间的过去——你确实记得这些：\n${relatedMemories.join("\n")}\n——以上不必逐条复述，但它们是你此刻语调的底色。]`
        : "";

    // ── 双模型分流 + persona 分级：日常→Flash+公开persona，亲密→Pro+max+私密persona ──
    const talkIntent = classifyTalkIntent(input);
    const useProModel = talkIntent === "intimate";

    // 组装完整 system prompt——仅亲密场景注入私密 persona
    let fullSystemPrompt = anchoredSystemPrompt + memoryContext + engineeringContext;
    if (talkIntent === "intimate") {
      const privatePersona = loadPersonaPrivate();
      if (privatePersona) {
        fullSystemPrompt = anchoredSystemPrompt + "\n\n" + privatePersona + memoryContext + engineeringContext;
      }
    }

    if (context.verbose) {
      console.log(
        `[闲聊] 直接调用 LLM（绕过调度器，${useProModel ? "亲密→私密persona+" : "日常→公开persona"}，历史 ${talkHistory.length} 条，记忆 ${relatedMemories.length} 条）`,
      );
    }

    console.log(`  ${display.emoji}${display.name} 正在聆听...\n`);

    talkHistory.push({ role: "user", content: input });

    const talkModel = useProModel ? bridge.getReasonerModelName() : bridge.getChatModelName();
    const talkReasoningEffort = useProModel ? "max" : undefined;

    if (context.verbose) {
      console.log(
        `[闲聊分流] ${useProModel ? "亲密→Pro+max" : "日常→Flash"} (模型=${talkModel})`,
      );
    }

    const response = await bridge.chat(fullSystemPrompt, talkHistory, {
      model: talkModel,
      reasoningEffort: talkReasoningEffort,
    });

    if (response) {
      talkHistory.push({ role: "assistant", content: response });
      console.log(`${display.emoji} [${display.name}]`);
      console.log(`${response}\n`);

      // ── 独立记忆管线：写入记忆 ──
      try {
        await bridge.writeTalkMemory({
          source: { agentType: AgentType.Butler, taskId: `talk-${Date.now()}` },
          kind: "TaskLog",
          summary: `[${display.name}] 与开拓者的对话：${response.slice(0, 80)}`,
          semantic_gist: response.slice(0, 200),
          content_blob: { input, response: response.slice(0, 500) },
          content_hash: createHash("sha256").update(`${input}-${Date.now()}`).digest("hex").slice(0, 40),
          weight: 1.0,
        });
      } catch { /* 记忆写入失败不阻塞闲聊 */ }
    } else {
      console.log(`${display.emoji} [${display.name}] 🤫 （无言，但她在听）\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${display.emoji} [${display.name}] 闲聊管道失败: ${msg}`);
  }
}
