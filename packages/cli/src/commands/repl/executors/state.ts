/**
 * executors/state.ts — 闲聊会话历史（模块级共享状态）。
 *
 * talk/party/trio 模式共享同一段会话历史，保持多轮上下文连贯。
 * 模式切换时通过 clearTalkHistory() 清空。
 */

import type { LlmMessage } from "@cortex/shared";

/** 闲聊模式会话历史（多轮记忆，保持上下文连贯） */
export const talkHistory: LlmMessage[] = [];

/** 清空闲聊会话历史（模式切换时调用） */
export function clearTalkHistory(): void {
  talkHistory.length = 0;
}
