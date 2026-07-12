/**
 * tui/renderer/chat-log.ts — ChatLog 纯追加消息容器
 *
 * 每条消息直接写 stdout，不重绘。
 * 保留内部消息记录用于 loadHistory / clear。
 *
 * @module tui/renderer/chat-log
 * @since v4 — Claude Code 风格纯追加
 */

/** 消息段类型 */
export type SegmentType = "text" | "tool";

/** 消息段 */
export interface ChatSegment {
  type: SegmentType;
  /** text 段的内容 */
  text?: string;
  /** tool 段的工具名 */
  tool?: string;
  /** tool 段的工具状态 */
  toolStatus?: "pending" | "success" | "error";
  /** tool 段持续时间 */
  toolDuration?: number;
}

/** ChatLog 消息模型 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  complete: boolean;
  /** 思考内容（reasoner 模型） */
  reasoning_content?: string;
  /** 内联段（text 和 tool 交替） */
  segments?: ChatSegment[];
}

/**
 * ChatLog — 纯追加消息容器。
 *
 * 不再实现 TuiComponent 接口，不再使用 DiffRenderer。
 * 每条消息直接写到 stdout，只追加不重绘。
 */
export class ChatLog {
  private messages: ChatMessage[] = [];
  private streamingRuns = new Map<string, ChatMessage>();
  private maxMessages = 50;
  /** 防抖 buffer——积攒 16ms 的 delta 后一次写 */
  private _debounceBuffers = new Map<string, string>();
  private _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 清空所有消息（同时清防抖状态） */
  clear(): void {
    this.messages = [];
    this.streamingRuns.clear();
    for (const t of this._debounceTimers.values()) clearTimeout(t);
    this._debounceTimers.clear();
    this._debounceBuffers.clear();
  }

  /** 追加用户消息 */
  addUser(text: string): void {
    this.messages.push({ id: `u-${Date.now()}`, role: "user", content: text, complete: true });
    process.stdout.write("▶ " + text + "\n");
  }

  /** 开始流式助手消息（不输出，等 updateAssistant） */
  startAssistant(runId: string): void {
    const msg: ChatMessage = { id: runId, role: "assistant", content: "", complete: false, segments: [] };
    this.streamingRuns.set(runId, msg);
    this.messages.push(msg);
  }

  /** 追加流式内容（防抖：攒 16ms 的 delta 后一次写 stdout） */
  updateAssistant(runId: string, delta: string): void {
    const msg = this.streamingRuns.get(runId);
    if (msg) {
      msg.content += delta;
      // 防抖: 攒 buffer，16ms 后一次写
      const buf = (this._debounceBuffers.get(runId) ?? "") + delta;
      this._debounceBuffers.set(runId, buf);
      if (!this._debounceTimers.has(runId)) {
        const timer = setTimeout(() => {
          this._debounceTimers.delete(runId);
          const buffer = this._debounceBuffers.get(runId) ?? "";
          this._debounceBuffers.delete(runId);
          if (buffer) process.stdout.write(buffer);
        }, 16);
        this._debounceTimers.set(runId, timer);
      }
    }
  }

  /** 完成流式消息（先刷防抖 buffer，再双换行结束） */
  finalizeAssistant(runId: string): void {
    const msg = this.streamingRuns.get(runId);
    if (msg) {
      msg.complete = true;
      this.streamingRuns.delete(runId);
      // 刷新残留防抖 buffer
      const timer = this._debounceTimers.get(runId);
      if (timer) { clearTimeout(timer); this._debounceTimers.delete(runId); }
      const buffer = this._debounceBuffers.get(runId) ?? "";
      this._debounceBuffers.delete(runId);
      if (buffer) process.stdout.write(buffer);
      process.stdout.write("\n\n");
    }
  }

  /** 追加 tool 内联段到最近的助手消息（只记状态，不写 stdout——由 TUI 事件处理器负责） */
  addToolSegment(runId: string | null, tool: string, status: "pending" | "success" | "error", durationMs?: number): void {
    let msg: ChatMessage | undefined;
    if (runId) {
      msg = this.streamingRuns.get(runId);
    }
    if (!msg) {
      msg = [...this.messages].reverse().find(m => m.role === "assistant");
    }

    if (msg) {
      if (!msg.segments) msg.segments = [];
      msg.segments.push({
        type: "tool",
        tool,
        toolStatus: status,
        toolDuration: durationMs,
      });
    }
  }

  /** 更新已有 tool 段的状态（只记状态，不写 stdout——由 TUI 事件处理器负责） */
  updateToolSegment(runId: string | null, tool: string, status: "success" | "error", durationMs: number): void {
    let msg: ChatMessage | undefined;
    if (runId) {
      msg = this.streamingRuns.get(runId);
    }
    if (!msg) {
      msg = [...this.messages].reverse().find(m => m.role === "assistant");
    }

    if (msg && msg.segments) {
      for (let i = msg.segments.length - 1; i >= 0; i--) {
        const seg = msg.segments[i];
        if (seg && seg.type === "tool" && seg.tool === tool) {
          seg.toolStatus = status;
          seg.toolDuration = durationMs;
          break;
        }
      }
    }
  }

  /** 从保存的会话中回填历史消息——逐条输出到 stdout */
  loadHistory(msgs: Array<{ role: string; content: string }>): void {
    for (const m of msgs.slice(-this.maxMessages)) {
      const role = m.role === "user" || m.role === "assistant" ? m.role : "user";
      this.messages.push({
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role,
        content: m.content,
        complete: true,
      });
      const prefix = role === "user" ? "▶ " : "◆ ";
      process.stdout.write(prefix + m.content + "\n");
    }
  }

  /** 获取内部消息列表（用于测试断言） */
  getMessages(): ChatMessage[] {
    return this.messages;
  }

  /** 获取正在流式的 runId */
  getStreamingRuns(): Map<string, ChatMessage> {
    return this.streamingRuns;
  }

  /**
   * 嵌入 ANSI 艺术框——用于 group.create / group.dissolve 等结构化消息。
   * 纯 stdout 直出，不进入消息历史。
   */
  addEmbed(title: string, lines: string[]): void {
    const width = Math.min(72, process.stdout.columns ?? 72);
    const innerWidth = width - 4;
    const topBorder = `┌─ ${title} ${"─".repeat(Math.max(0, innerWidth - title.length - 1))}┐`;
    process.stdout.write(topBorder + "\n");
    for (const line of lines) {
      const truncated = line.length > innerWidth ? line.slice(0, innerWidth - 1) + "…" : line;
      process.stdout.write(`│ ${truncated.padEnd(innerWidth)} │\n`);
    }
    const bottomBorder = `└${"─".repeat(width - 2)}┘`;
    process.stdout.write(bottomBorder + "\n");
  }
}

export const chatLog = new ChatLog();
