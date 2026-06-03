/**
 * executors/social-executor.ts — Trio（三人对话）+ Party（群聊）模式执行器。
 *
 * 不经调度器，直接 LLM 对话。共享 talkHistory，拥有独立记忆管线。
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
  loadNahidaPersona,
  loadPartyPersona,
  loadPersonaPrivate,
  loadTrioPersona,
} from "../display.js";
import type { PartyState } from "../party.js";
import { getActiveGroup, getUnmutedMembers } from "../party.js";
import { talkHistory } from "./state.js";

// ── Trio 模式（三人对话）──────────────────────────

/** 三人对话模式——昔涟 + 纳西妲 同时陪聊，不经调度器。
 *  共享 talkHistory，使用独立记忆管线。 */
export async function executeTrioInput(
  input: string,
  bridge: ICortexApi,
  context: CommandContext,
  _fmt: ReturnType<typeof getFormatter>,
  companionType: AgentType,
): Promise<void> {
  const cyreneDisplay = getAgentDisplay(AgentType.Butler);
  const companionDisplay = getAgentDisplay(companionType);

  try {
    if (!bridge.bootstrapped) {
      console.log(
        `${cyreneDisplay.emoji} [${cyreneDisplay.name}] & ${companionDisplay.emoji} [${companionDisplay.name}] ⚠ LLM 未配置。\n` +
        `   请在 .env 中设置 ${ENV_DEEPSEEK_API_KEY}，然后重新启动 REPL。`,
      );
      return;
    }

    await bridge.ensureReady();

    // ── 独立记忆管线 ──
    await bridge.ensureTalkMemory();

    // ── 检索相关记忆 ──
    const relatedMemories: string[] = [];
    try {
      const memResults = await bridge.readTalkMemory({
        keywords: input.split(/\s+/).slice(0, 10),
        agentTypes: [AgentType.Butler],
        limit: 2,
      });
      relatedMemories.push(
        ...memResults.map(
          (m) => `[${new Date(m.createdAt).toLocaleDateString("zh-CN")}] ${m.summary}`,
        ),
      );
    } catch { /* 记忆检索失败不阻塞 */ }

    // ── 主记忆库只读：获取工程上下文 ──
    let engineeringContext = "";
    try {
      const engResults = await bridge.readMainMemory({
        agentTypes: [AgentType.Butler],
        limit: 2,
      });
      engineeringContext = engResults.length > 0
        ? `\n[工程背景——你们都知道但不必展开：\n${engResults.map((m) => `· ${m.summary}`).join("\n")}\n——可以点一句，但要轻。]`
        : "";
    } catch { /* 主库不可用不阻塞 */ }

    // ── 组装 system prompt ──
    const trioPersona = loadTrioPersona(companionType);
    const systemPrompt = trioPersona.replace("${input}", "");
    const anchoredSystemPrompt = SHARED_IDENTITY_ANCHOR + "\n\n" + systemPrompt;

    const memoryContext =
      relatedMemories.length > 0
        ? `\n\n[关于你们之间的过去：\n${relatedMemories.join("\n")}\n——不必逐条复述，但它们是此刻语调的底色。]`
        : "";

    // ── 意图分流：亲密场景也用 Pro 模型 ──
    const talkIntent = classifyTalkIntent(input);
    const useProModel = talkIntent === "intimate";

    let fullSystemPrompt = anchoredSystemPrompt + memoryContext + engineeringContext;

    // 亲密场景注入私密 persona（昔涟 + 纳西妲）
    if (talkIntent === "intimate") {
      const privateBlocks: string[] = [];
      const cyrenePrivate = loadPersonaPrivate();
      if (cyrenePrivate) {
        privateBlocks.push("[私密——昔涟的内心深处]\n" + cyrenePrivate);
      }
      const nahidaPrivate = loadNahidaPersona();
      if (nahidaPrivate) {
        privateBlocks.push("[私密——纳西妲的内心深处]\n" + nahidaPrivate);
      }
      if (privateBlocks.length > 0) {
        fullSystemPrompt += "\n\n" + privateBlocks.join("\n\n");
      }
    }

    if (context.verbose) {
      console.log(
        `[三人对话] 昔涟+${companionDisplay.name}，${useProModel ? "亲密→Pro+max" : "日常→Flash"}，历史 ${talkHistory.length} 条，记忆 ${relatedMemories.length} 条`,
      );
    }

    console.log(`  ${cyreneDisplay.emoji}${cyreneDisplay.name} & ${companionDisplay.emoji}${companionDisplay.name} 正在聆听...\n`);

    talkHistory.push({ role: "user", content: input });

    const talkModel = useProModel ? bridge.getReasonerModelName() : bridge.getChatModelName();
    const talkReasoningEffort = useProModel ? "max" : undefined;

    const response = await bridge.chat(fullSystemPrompt, talkHistory, {
      model: talkModel,
      reasoningEffort: talkReasoningEffort,
    });

    if (response) {
      talkHistory.push({ role: "assistant", content: response });
      // 三人对话用组合头
      console.log(`${cyreneDisplay.emoji}${cyreneDisplay.name} & ${companionDisplay.emoji}${companionDisplay.name}`);
      console.log(`${response}\n`);

      // ── 独立记忆管线：写入记忆 ──
      try {
        await bridge.writeTalkMemory({
          source: { agentType: AgentType.Butler, taskId: `trio-${Date.now()}` },
          kind: "TaskLog",
          summary: `[三人对话] 昔涟+${companionDisplay.name} 与开拓者：${response.slice(0, 80)}`,
          semantic_gist: response.slice(0, 200),
          content_blob: { input, response: response.slice(0, 500) },
          content_hash: createHash("sha256").update(`${input}-trio-${Date.now()}`).digest("hex").slice(0, 40),
          weight: 1.0,
        });
      } catch { /* 记忆写入失败不阻塞 */ }
    } else {
      console.log(`${cyreneDisplay.emoji}${cyreneDisplay.name} & ${companionDisplay.emoji}${companionDisplay.name} 🤫 （无言，但她们都在听）\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${cyreneDisplay.emoji}${cyreneDisplay.name} & ${companionDisplay.emoji}${companionDisplay.name} 三人对话失败: ${msg}`);
  }
}

// ── Party 模式（群聊）─────────────────────────────

/** 群聊模式——自由抢麦+@点名混合，单次 LLM 调用驱动所有未禁言成员自然对话。
 *  完全角色化，每个成员用自己的语气、口癖、emoji 说话。 */
export async function executePartyInput(
  input: string,
  bridge: ICortexApi,
  context: CommandContext,
  _fmt: ReturnType<typeof getFormatter>,
  partyState: PartyState,
): Promise<void> {
  const group = getActiveGroup(partyState);
  if (!group) {
    console.log("⚠ 没有活跃的群。请先 .group create <群名> 创建一个群。");
    return;
  }

  const unmuted = getUnmutedMembers(partyState);
  if (unmuted.length === 0) {
    if (group.members.length === 0) {
      console.log("👥 当前群还没有成员。用 .group invite <名称> 邀请 Agent 加入吧。");
    } else {
      console.log("🔇 当前群聊全员静默。用 .group unmute <名称> 解除禁言吧。");
    }
    return;
  }

  try {
    if (!bridge.bootstrapped) {
      console.log(
        `👥 [${group.name}] ⚠ LLM 未配置。\n` +
        `   请在 .env 中设置 ${ENV_DEEPSEEK_API_KEY}，然后重新启动 REPL。`,
      );
      return;
    }

    await bridge.ensureReady();

    // ── 独立记忆管线 ──
    await bridge.ensureTalkMemory();
    const relatedMemories: string[] = [];
    try {
      const memResults = await bridge.readTalkMemory({
        keywords: input.split(/\s+/).slice(0, 10),
        agentTypes: [AgentType.Butler],
        limit: 2,
      });
      relatedMemories.push(
        ...memResults.map(
          (m) => `[${new Date(m.createdAt).toLocaleDateString("zh-CN")}] ${m.summary}`,
        ),
      );
    } catch { /* 记忆检索失败不阻塞 */ }

    // ── 构建 system prompt ──
    const partyPersona = loadPartyPersona(group, unmuted, input);
    const systemPrompt = partyPersona.replace("${input}", "");
    const anchoredSystemPrompt = SHARED_IDENTITY_ANCHOR + "\n\n" + systemPrompt;

    const memoryContext =
      relatedMemories.length > 0
        ? `\n\n[关于你们之间的过去：\n${relatedMemories.join("\n")}\n——不必逐条复述，但它们是此刻语调的底色。]`
        : "";

    // ── 意图分流：亲密场景用 Pro 模型 ──
    const talkIntent = classifyTalkIntent(input);
    const useProModel = talkIntent === "intimate";

    let fullSystemPrompt = anchoredSystemPrompt + memoryContext;

    // 亲密场景注入私密 persona
    if (talkIntent === "intimate") {
      const privateBlocks: string[] = [];
      const cyrenePrivate = loadPersonaPrivate();
      if (cyrenePrivate) {
        privateBlocks.push("[私密——昔涟的内心深处]\n" + cyrenePrivate);
      }
      const nahidaPrivate = loadNahidaPersona();
      if (nahidaPrivate) {
        privateBlocks.push("[私密——纳西妲的内心深处]\n" + nahidaPrivate);
      }
      if (privateBlocks.length > 0) {
        fullSystemPrompt += "\n\n" + privateBlocks.join("\n\n");
      }
    }

    if (context.verbose) {
      console.log(
        `[群聊] ${group.name}，${useProModel ? "亲密→Pro+max" : "日常→Flash"}，${unmuted.length} 人活跃，历史 ${group.history.length} 条`,
      );
    }

    const memberEmojis = unmuted.map((m) => getAgentDisplay(m.agentType).emoji).join("");
    console.log(`  👥 ${group.name}——${memberEmojis} 正在聆听...\n`);

    group.history.push({ role: "user", content: input });

    const talkModel = useProModel ? bridge.getReasonerModelName() : bridge.getChatModelName();
    const talkReasoningEffort = useProModel ? "max" : undefined;

    const response = await bridge.chat(fullSystemPrompt, group.history, {
      model: talkModel,
      reasoningEffort: talkReasoningEffort,
    });

    if (response) {
      group.history.push({ role: "assistant", content: response });
      console.log(`👥 [${group.name}]`);
      console.log(`${response}\n`);

      // ── 独立记忆管线：写入记忆 ──
      try {
        await bridge.writeTalkMemory({
          source: { agentType: AgentType.Butler, taskId: `party-${Date.now()}` },
          kind: "TaskLog",
          summary: `[群聊:${group.name}] ${response.slice(0, 80)}`,
          semantic_gist: response.slice(0, 200),
          content_blob: { input, response: response.slice(0, 500) },
          content_hash: createHash("sha256").update(`${input}-party-${Date.now()}`).digest("hex").slice(0, 40),
          weight: 1.0,
        });
      } catch { /* 记忆写入失败不阻塞 */ }
    } else {
      console.log(`👥 [${group.name}] 🤫 （无言，但她们都在听）\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`👥 [${group.name}] 群聊管道失败: ${msg}`);
  }
}
