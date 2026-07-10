/**
 * tui/renderer/chat-log.ts — ChatLog 流式消息容器
 *
 * 管理用户/助手的对话消息，支持流式追加与完成状态追踪。
 * 参考 OpenClaw 的 ChatLog 实现。
 *
 * @module tui/renderer/chat-log
 * @since v3 — Core-3 差分渲染
 */

import type { TuiComponent } from "./diff-renderer.js";
import { diffRenderer } from "./diff-renderer.js";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  complete: boolean;
}

export class ChatLog implements TuiComponent {
  private messages: ChatMessage[] = [];
  private streamingRuns = new Map<string, ChatMessage>(); // runId → msg
  private maxMessages = 50;

  render(_width: number): string[] {
    const rows: string[] = [];
    for (const msg of this.messages.slice(-this.maxMessages)) {
      const prefix = msg.role === "user" ? "▶" : "◆";
      const status = msg.complete ? "" : " ⠋";
      // 跳过空消息
      if (!msg.content.trim()) continue;
      rows.push(`${prefix} ${msg.content.slice(0, 80)}${status}`);
    }
    return rows;
  }

  invalidate(): void {
    diffRenderer.requestRender();
  }

  /** 追加用户消息 */
  addUser(text: string): void {
    this.messages.push({ id: `u-${Date.now()}`, role: "user", content: text, complete: true });
    this.invalidate();
  }

  /** 开始流式助手消息 */
  startAssistant(runId: string): void {
    const msg: ChatMessage = { id: runId, role: "assistant", content: "", complete: false };
    this.streamingRuns.set(runId, msg);
    this.messages.push(msg);
  }

  /** 追加流式内容 */
  updateAssistant(runId: string, delta: string): void {
    const msg = this.streamingRuns.get(runId);
    if (msg) {
      msg.content += delta;
      this.invalidate();
    }
  }

  /** 完成流式消息 */
  finalizeAssistant(runId: string): void {
    const msg = this.streamingRuns.get(runId);
    if (msg) {
      msg.complete = true;
      this.streamingRuns.delete(runId);
      this.invalidate();
    }
  }

  /** 从保存的会话中回填历史消息 */
  loadHistory(msgs: Array<{ role: string; content: string }>): void {
    for (const m of msgs.slice(-this.maxMessages)) {
      const role = m.role === "user" || m.role === "assistant" ? m.role : "user";
      this.messages.push({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content: m.content,
        complete: true,
      });
    }
    this.invalidate();
  }
}

export const chatLog = new ChatLog();
