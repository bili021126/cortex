/**
 * tui/session-store.ts — TUI 会话持久化（v4 群聊版）
 *
 * 纯文件 I/O 模块，与 EngineBridge 零依赖。
 * 会话状态序列化为 .cortex/tui-session.json，退出保存、启动恢复。
 *
 * v4: 移除 mode 字段，添加 groups 序列化。
 *
 * @module tui/session-store
 * @since v4 — 群聊架构更新
 */

import type { AgentType, LlmMessage } from "@cortex/shared";
import type { GroupSnapshot } from "./group-chat.js";
import * as fs from "node:fs";
import * as path from "node:path";

/** 会话持久化快照——与 TuiSession 同构 */
export interface SessionSnapshot {
  agent: AgentType;
  history: LlmMessage[];
  groups: GroupSnapshot[];
  /** 三人模式（昔涟+纳西妲） */
  talkTrio: boolean;
}

const SESSION_FILE = ".cortex/tui-session.json";
/** 历史消息最大保留条数（防 JSON 膨胀） */
const MAX_HISTORY = 200;

/**
 * 保存当前会话到 .cortex/tui-session.json。
 * 历史超过 MAX_HISTORY 条时仅保留最近 N 条。
 */
export function saveSession(projectRoot: string, session: SessionSnapshot): void {
  try {
    const cortexDir = path.join(projectRoot, ".cortex");
    if (!fs.existsSync(cortexDir)) {
      fs.mkdirSync(cortexDir, { recursive: true });
    }

    const toSave: SessionSnapshot = {
      ...session,
      history: session.history.length > MAX_HISTORY
        ? session.history.slice(-MAX_HISTORY)
        : session.history,
    };

    const filePath = path.join(projectRoot, SESSION_FILE);
    fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
  } catch (err) {
    // 持久化失败不应阻塞用户操作
    console.warn('[DEGRADED:tui-session-store-save]', err instanceof Error ? err.message : String(err));
  }
}

/**
 * 从 .cortex/tui-session.json 加载上次会话。
 * @returns 有效的会话快照，或 null（文件不存在/损坏/过期）
 */
export function loadSession(projectRoot: string): SessionSnapshot | null {
  try {
    const filePath = path.join(projectRoot, SESSION_FILE);
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as SessionSnapshot;

    // 基本合法性校验
    if (!data || !Array.isArray(data.history)) {
      return null;
    }

    // 确保 groups 是数组
    if (!Array.isArray(data.groups)) data.groups = [];
    if (typeof data.talkTrio !== "boolean") data.talkTrio = false;

    return data;
  } catch (err) {
    console.warn('[DEGRADED:tui-session]', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * 删除持久化的会话文件。
 */
export function clearSession(projectRoot: string): void {
  try {
    const filePath = path.join(projectRoot, SESSION_FILE);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.warn('[DEGRADED:tui-session]', err instanceof Error ? err.message : String(err));
  }
}
