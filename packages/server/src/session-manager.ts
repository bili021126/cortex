/**
 * @cortex/server — SessionManager
 *
 * Manages chat sessions with lifecycle tracking and garbage collection.
 */

import * as crypto from "node:crypto";
import type { SessionDTO } from "@cortex/protocol";
import type { LlmMessage } from "@cortex/shared";

/** A single chat session */
export interface ChatSession {
  id: string;
  agent: string;
  mode: string;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  history: LlmMessage[];
  abortController: AbortController;
  send: (msg: unknown) => void;
}

/** Send function type for WS message delivery */
export type SendFn = (msg: unknown) => void;

const DEFAULT_GC_INTERVAL_MS = 1_800_000; // 30 minutes
const SESSION_IDLE_TIMEOUT_MS = 3_600_000; // 1 hour

export class SessionManager {
  private sessions = new Map<string, ChatSession>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new chat session.
   */
  create(agent: string, mode: string, sendFn: SendFn, id?: string): ChatSession {
    // WS 修复：沿用客户端传入的 sessionId（此前 randomUUID——client 按传入 id 过滤事件——永不匹配）
    const sid = id ?? crypto.randomUUID();
    const now = Date.now();
    const session: ChatSession = {
      id: sid,
      agent,
      mode,
      createdAt: now,
      lastActiveAt: now,
      messageCount: 0,
      history: [],
      abortController: new AbortController(),
      send: sendFn,
    };
    this.sessions.set(sid, session);
    return session;
  }

  /**
   * Get a session by ID.
   */
  get(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Destroy a session and abort any in-flight work.
   */
  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.abortController.abort();
      this.sessions.delete(id);
    }
  }

  /**
   * List all sessions as DTOs.
   */
  list(): SessionDTO[] {
    const result: SessionDTO[] = [];
    for (const session of this.sessions.values()) {
      result.push({
        id: session.id,
        agent: session.agent,
        mode: session.mode,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        messageCount: session.messageCount,
      });
    }
    return result;
  }

  /**
   * Touch a session to update lastActiveAt.
   */
  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActiveAt = Date.now();
    }
  }

  /**
   * Start garbage collection of idle sessions.
   */
  startGC(intervalMs: number = DEFAULT_GC_INTERVAL_MS): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.lastActiveAt > SESSION_IDLE_TIMEOUT_MS) {
          session.abortController.abort();
          this.sessions.delete(id);
        }
      }
    }, intervalMs);
    // Allow process to exit even if timer is active
    if (this.gcTimer && typeof this.gcTimer === "object" && "unref" in this.gcTimer) {
      this.gcTimer.unref();
    }
  }

  /**
   * Stop garbage collection.
   */
  stopGC(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
