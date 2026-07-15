/**
 * tui/group-chat.ts — 群聊层：数据结构 + 消息管道 + ANSI 增量渲染
 *
 * GroupChatManager 作为全局单例，关联 dispatchTask 的群创建/解散、
 * dispatchChat 的消息写入、以及 tuiEventBus 的 tool/节点事件订阅。
 *
 * 渲染策略：每次 addMessage 后调用 renderGroup()，使用 \x1b[N A 回退
 * 到盒子上方，清屏重绘。保证不干扰上方的 ChatLog 和下方的 prompt。
 *
 * @module tui/group-chat
 */

import { AgentType, AGENT_DISPLAY_BY_TYPE, AGENT_DISPLAY_FALLBACK } from "@cortex/shared";
import { terminalWidth, cursorUp, eraseLine } from "./renderer/ansi.js";

// ═══════════════════════════════════════════════════════════
// §1 类型定义
// ═══════════════════════════════════════════════════════════

export type GroupMsgType = "plan" | "task_start" | "task_done" | "tool_start" | "tool_result" | "chat" | "system" | "review" | "simulation";

/** Agent 在线状态 */
export interface AgentState {
  agent: string;
  status: "waiting" | "working" | "done" | "failed";
}

// ── 鉴别式联合：GroupMessage ──

/** 群聊发送方：Agent 本体或用户（"user" 作为哨兵值，不属于 AgentType 枚举） */
export type GroupMsgSender = AgentType | "user";

interface BaseGroupMsg {
  id: string;
  agent: GroupMsgSender;
  replyTo?: string;
}

interface PlainMsg extends BaseGroupMsg {
  type: "plan" | "task_start" | "task_done" | "chat" | "system" | "review" | "simulation";
  content: string;
}

interface ToolStartMsg extends BaseGroupMsg {
  type: "tool_start";
  content: string;
  toolName: string;
}

interface ToolResultMsg extends BaseGroupMsg {
  type: "tool_result";
  content: string;
  toolName: string;
  toolSuccess: boolean;
  toolDuration?: number;
}

export type GroupMessage = PlainMsg | ToolStartMsg | ToolResultMsg;

/** 任务群——带 _lastRenderLineCount 用于增量渲染 */
export interface TaskGroup {
  id: string;
  task: string;
  agents: AgentType[];
  messages: GroupMessage[];
  agentStates: Map<string, AgentState>;
  status: "active" | "done" | "failed" | "archived" | "paused";
  parentGroupId?: string; // 父群 id（子任务群归属）
  _lastRenderLineCount: number;
}

/** 群聊快照（持久化用） */
export interface GroupSnapshot {
  id: string;
  task: string;
  agents: AgentType[];
  status: "active" | "done" | "failed" | "archived" | "paused";
  messages: GroupMessage[];
}

// ═══════════════════════════════════════════════════════════
// §2 辅助函数
// ═══════════════════════════════════════════════════════════

let _msgSeq = 0;

function nextId(): string {
  return `gm-${Date.now()}-${++_msgSeq}`;
}

function agentEmoji(agent: GroupMsgSender): string {
  if (agent === "user") return "⭐";
  return (AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK).emoji;
}

function agentDisplayName(agent: GroupMsgSender): string {
  if (agent === "user") return "你";
  return (AGENT_DISPLAY_BY_TYPE[agent] ?? AGENT_DISPLAY_FALLBACK).name;
}

// ═══════════════════════════════════════════════════════════
// §3 GroupChatManager
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// 事件监听类型
// ═══════════════════════════════════════════════════════════

export type GroupEventType = "created" | "message" | "dissolved";

export interface GroupEvent {
  type: GroupEventType;
  groupId: string;
  data?: unknown;
}

export type GroupEventListener = (event: GroupEvent) => void;

export class GroupChatManager {
  private static readonly MAX_GROUPS = 20;
  groups: Map<string, TaskGroup> = new Map();
  activeGroupId: string | null = null;
  private listeners: GroupEventListener[] = [];

  /**
   * 创建一个新的任务群。
   * 自动将其设为活跃群。
   * @returns 群 ID
   */
  /**
   * 注册群聊事件监听器。
   * @returns 取消订阅函数
   */
  on(listener: GroupEventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(type: GroupEventType, groupId: string, data?: unknown): void {
    this.listeners.forEach(l => l({ type, groupId, data }));
  }

  createGroup(task: string, agents: AgentType[]): string {
    // LRU 淘汰：超过上限时解散最旧的已归档群
    if (this.groups.size >= GroupChatManager.MAX_GROUPS) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [gid, g] of this.groups) {
        const lastMsg = g.messages[g.messages.length - 1];
        const ts = lastMsg ? parseInt(lastMsg.id.split("-")[1] ?? "0", 10) : 0;
        if (g.status !== "active" && g.status !== "paused" && ts < oldestAt) {
          oldestAt = ts; oldest = gid;
        }
      }
      if (oldest) { this.groups.delete(oldest); this.emit("dissolved", oldest, { summary: "LRU evicted" }); }
    }
    const id = `gc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const agentStates = new Map<string, AgentState>();
    for (const a of [...new Set(agents)]) {
      agentStates.set(a as string, { agent: a as string, status: "waiting" });
    }
    const group: TaskGroup = {
      id,
      task,
      agents: [...new Set(agents)], // 去重
      messages: [],
      agentStates,
      status: "active",
      _lastRenderLineCount: 0,
    };
    this.groups.set(id, group);
    this.activeGroupId = id;
    this.emit("created", id, { task, agents });
    return id;
  }

  /**
   * 向指定群添加消息，自动触发增量重绘。
   * 如果群不存在或状态不是 active，静默忽略。
   */
  addMessage(groupId: string, msg: Omit<GroupMessage, "id">): void {
    const group = this.groups.get(groupId);
    if (!group || (group.status !== "active" && group.status !== "paused")) return;
    group.messages.push({
      ...msg,
      id: nextId(),
    } as GroupMessage);
    this.emit("message", groupId, { agent: msg.agent, type: msg.type, content: msg.content });
    this.renderGroup(groupId);
  }

  /**
   * 解散群——标记为 done 并追加一条 summary 系统消息，然后渲染终态。
   */
  dissolveGroup(groupId: string, summary: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.status = "done";
    group.messages.push({
      id: nextId(),
      agent: AgentType.Butler,
      type: "system",
      content: `✅ ${summary}`,
    } as GroupMessage);
    this.emit("dissolved", groupId, { summary });
    this.renderGroup(groupId);
    if (this.activeGroupId === groupId) {
      this.activeGroupId = null;
    }

    // 通知父群
    if (group.parentGroupId) {
      this.addMessage(group.parentGroupId, {
        agent: AgentType.Butler,
        type: "system",
        content: `子任务完成: ${summary}`
      });
    }

    // 群完成后在主聊天输出摘要
    const msgs = group.messages;
    const done = msgs.filter(m => m.type === "task_done" && !m.content?.includes("❌")).length;
    const fail = msgs.filter(m => m.type === "task_done" && m.content?.includes("❌")).length;
    const toolMsgs = msgs.filter(m => m.type === "tool_result");
    const avgDur = toolMsgs.length > 0
      ? Math.round(toolMsgs.reduce((s, m) => s + (m.toolDuration ?? 0), 0) / toolMsgs.length)
      : 0;

    process.stdout.write(`\n✅ ${group.task} 完成 — ${done}成功, ${fail}失败 | ${toolMsgs.length}工具调用, 平均${avgDur}ms\n\n`);
  }

  /**
   * 从快照恢复一个群（会话恢复时调用）。
   */
  restoreGroup(snapshot: GroupSnapshot): void {
    const agentStates = new Map<string, AgentState>();
    for (const a of snapshot.agents) {
      agentStates.set(a as string, { agent: a as string, status: "waiting" });
    }
    const group: TaskGroup = {
      id: snapshot.id,
      task: snapshot.task,
      agents: snapshot.agents,
      messages: snapshot.messages,
      agentStates,
      status: snapshot.status,
      _lastRenderLineCount: 0,
    };
    this.groups.set(group.id, group);
    if (group.status === "active") {
      this.activeGroupId = group.id;
    }
  }

  /**
   * 获取当前活跃群的快照（持久化用）。
   */
  getActiveSnapshot(): GroupSnapshot | null {
    if (!this.activeGroupId) return null;
    const group = this.groups.get(this.activeGroupId);
    if (!group) return null;
    return {
      id: group.id,
      task: group.task,
      agents: [...group.agents],
      status: group.status,
      messages: [...group.messages],
    };
  }

  /**
   * 设置群中某 Agent 的在线状态。
   * 状态变更后自动调用 renderGroup 刷新 header。
   */
  setAgentState(groupId: string, agent: AgentType, status: AgentState["status"]): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    const key = agent as string;
    const existing = group.agentStates.get(key);
    if (existing) {
      existing.status = status;
    } else {
      group.agentStates.set(key, { agent: key, status });
    }
    this.renderGroup(groupId);
  }

  pauseGroup(groupId: string): void {
    const g = this.groups.get(groupId);
    if (g) g.status = "paused";
  }

  resumeGroup(groupId: string): void {
    const g = this.groups.get(groupId);
    if (g) g.status = "active";
  }

  /** 获取所有活跃群 */
  getActiveGroups(): TaskGroup[] {
    return [...this.groups.values()].filter(g => g.status === "active");
  }

  /**
   * 获取所有群聊的快照（持久化用）。
   */
  getAllSnapshots(): GroupSnapshot[] {
    return [...this.groups.values()].map(g => ({
      id: g.id,
      task: g.task,
      agents: [...g.agents],
      status: g.status,
      messages: [...g.messages],
    }));
  }

  /** 切换活跃群 */
  switchGroup(groupId: string): void {
    if (this.groups.has(groupId)) {
      this.activeGroupId = groupId;
      this.renderGroup(groupId);
    }
  }

  /** 归档群——不渲染但保留 */
  archiveGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.status = "archived";
    if (this.activeGroupId === groupId) {
      this.activeGroupId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // §4 ANSI 渲染——增量重绘
  // ═══════════════════════════════════════════════════════════

  /**
   * 增量渲染单个群为聊天框：
   *
   * ┌─ 📋 {task} ── {agent_emojis} ─────────────────────────────┐
   * │ 📋 甘雨: [计划] 3节点: counter, test, deploy             │
   * │ 🧪 阿贝多: 开始 counter.ts                                │
   * │   ⏳ write_file                                           │
   * │   ✅ write_file · 42ms                                    │
   * │ ⚡ 刻晴: [审查] 通过                                       │
   * │ ✅ 群完成 — 3成功, 0失败                                  │
   * └──────────────────────────────────────────────────────────┘
   *
   * 增量策略：\x1b[_lastRenderLineCount A → 回退到盒子上方 → 逐行清屏重绘
   */
  renderGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    const lines = this._getGroupLines(group);
    const lineCount = lines.length;

    const output: string[] = [];

    // 增量重绘：回退到盒子上方
    if (group._lastRenderLineCount > 0) {
      output.push(cursorUp(group._lastRenderLineCount));
    }

    // 逐行清屏重绘（处理盒子伸缩）
    const maxLines = Math.max(lineCount, group._lastRenderLineCount);
    for (let i = 0; i < maxLines; i++) {
      output.push(eraseLine);
      if (i < lineCount) {
        output.push(lines[i]!);
      }
      if (i < maxLines - 1) {
        output.push("\n");
      }
    }

    process.stdout.write(output.join(""));
    group._lastRenderLineCount = lineCount;
  }

  /** 渲染所有活跃群 */
  renderAllActive(): void {
    for (const group of this.groups.values()) {
      if (group.status === "active") {
        this.renderGroup(group.id);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // §5 内部：行生成 & 消息格式化
  // ═══════════════════════════════════════════════════════════

  /**
   * 生成群聊盒子的所有文本行（不含 ANSI 控制序列）。
   */
  private _getGroupLines(group: TaskGroup): string[] {
    const width = Math.min(terminalWidth(), 80);
    const innerWidth = width - 2; // 去掉 │ ─ 边框

    const lines: string[] = [];

    // ── 标题行 ──
    const STATUS_ICON: Record<string, string> = { waiting: "○", working: "⏳", done: "✓", failed: "✗" };
    // 进度计算
    const taskDoneMsgs = group.messages.filter(m => m.type === "task_done");
    const doneCount = taskDoneMsgs.filter(m => !m.content?.includes("❌")).length;
    const totalCount = taskDoneMsgs.length;
    const progressLabel = totalCount > 0 ? ` (${doneCount}/${totalCount}完成)` : "";
    const taskLabel = `📋 ${group.task.slice(0, 24)}${progressLabel}`;
    const agentsLabel = group.agents
      .map(a => {
        const state = group.agentStates.get(a as string);
        const statusIcon = state ? STATUS_ICON[state.status] ?? "○" : "○";
        return `${agentEmoji(a)}${statusIcon}${agentDisplayName(a)}`;
      })
      .join(" ");
    const titleInner = ` ${taskLabel} ── ${agentsLabel} `;
    const topBorderRaw = `┌${titleInner}`;
    if (topBorderRaw.length >= width - 1) {
      lines.push(topBorderRaw.slice(0, width - 1) + "┐");
    } else {
      lines.push(topBorderRaw + "─".repeat(width - 1 - topBorderRaw.length) + "┐");
    }

    // ── 消息行（折叠：最多显示 15 条）──
    const MAX_VISIBLE = 15;
    const displayMessages = group.messages.length > MAX_VISIBLE
      ? group.messages.slice(-MAX_VISIBLE)
      : group.messages;
    const foldedCount = group.messages.length - displayMessages.length;

    if (foldedCount > 0) {
      const foldLine = `... (${foldedCount} 条更早的消息)`;
      lines.push(`│ ${foldLine.padEnd(innerWidth - 2)} │`);
    }

    for (const msg of displayMessages) {
      const msgLine = this._formatMessage(msg);
      const maxContentLen = innerWidth - 2; // "│ " + " │"
      const truncated = msgLine.length > maxContentLen
        ? msgLine.slice(0, maxContentLen - 3) + "..."
        : msgLine;
      lines.push(`│ ${truncated.padEnd(innerWidth - 2)} │`);
    }

    // ── 底部边框 ──
    lines.push(`└${"─".repeat(width - 2)}┘`);

    return lines;
  }

  /**
   * 格式化单条消息为可读字符串。
   *
   * 渲染格式：
   *   plan:       "📋 {agent}: [计划] {content}"
   *   task_start: "🧪 {agent}: 开始 {content}"
   *   task_done:  "🧪 {agent}: 完成 {content}"
   *   tool_start: "  ⏳ {tool}"
   *   tool_result:"  ✅ {tool} · {duration}ms"
   *   chat:       "{emoji} {agent}: {content}"
   *   system:     "  ⚡ {content}"
   *   review:     "⚡ {agent}: [审查] {content}"
   */
  private _formatMessage(msg: GroupMessage): string {
    let formatted: string;
    const name = agentDisplayName(msg.agent);
    const emoji = agentEmoji(msg.agent);
    switch (msg.type) {
      case "plan":
        formatted = `📋 ${name}: [计划] ${msg.content}`;
        break;
      case "task_start":
        formatted = `🧪 ${name}: 开始 ${msg.content}`;
        break;
      case "task_done":
        formatted = `🧪 ${name}: 完成 ${msg.content}`;
        break;
      case "tool_start":
        formatted = `  ⏳ ${msg.toolName ?? msg.content}`;
        break;
      case "tool_result": {
        const check = msg.toolSuccess ? "✅" : "❌";
        const duration = msg.toolDuration !== undefined ? ` · ${msg.toolDuration}ms` : "";
        formatted = `  ${check} ${msg.toolName ?? msg.content}${duration}`;
        break;
      }
      case "chat":
        formatted = `${emoji} ${name}: ${msg.content}`;
        break;
      case "system":
        formatted = `  ⚡ ${msg.content}`;
        break;
      case "review":
        formatted = `⚡ ${name}: [审查] ${msg.content}`;
        break;
      case "simulation":
        formatted = `🌐 仿真层: ${msg.content}`;
        break;
      default:
        formatted = (msg as GroupMessage).content;
        break;
    }
    if (msg.replyTo) {
      formatted = `  ↳ ${formatted}`;
    }
    return formatted;
  }
}

// ═══════════════════════════════════════════════════════════
// §6 全局单例
// ═══════════════════════════════════════════════════════════

export const groupChat = new GroupChatManager();
