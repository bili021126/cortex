/**
 * repl/party.ts — Party 群聊模式状态管理。
 *
 * 概念模型：
 *   开拓者（超级管理员）— 可做任何事
 *     ├─ 群 A（owner: 昔涟）
 *     │   ├─ 昔涟（owner）
 *     │   ├─ 纳西妲（admin）
 *     │   └─ 刻晴（member,muted）
 *     └─ 群 B（owner: 刻晴）
 *         ├─ 刻晴（owner）
 *         └─ 北斗（member）
 *
 * - 所有群都可见（.groups 列表），但只有活跃群在聊天
 * - owner 和开拓者可以设 admin（最多 2 个）
 * - admin 可以拉人、禁言
 * - 开拓者是超级管理员，覆盖所有权限
 */

import { type AgentType, type LlmMessage } from "@cortex/shared";
import { getAgentDisplay } from "./types.js";

// ── 类型 ──────────────────────────────────────────

/** 群成员 */
export interface PartyMember {
  agentType: AgentType;
  role: "owner" | "admin" | "member";
  muted: boolean;
  joinedAt: number;
}

/** 群 */
export interface PartyGroup {
  id: string;
  name: string;
  owner: AgentType; // 创建者
  members: PartyMember[]; // 不含开拓者——开拓者始终隐含在场
  createdAt: number;
  /** 群独立会话历史 */
  history: LlmMessage[];
}

// ── MVP 限制 ─────────────────────────────────────

export const MAX_GROUPS = 3;
export const MAX_MEMBERS_PER_GROUP = 8;
export const MAX_ADMINS_PER_GROUP = 2;

// ── 全局群聊状态 ─────────────────────────────────

/** 全局群聊状态 */
export interface PartyState {
  groups: PartyGroup[]; // 所有群（最多 MAX_GROUPS 个）
  activeGroupId: string | null; // 当前活跃群
}

/** 创建初始 Party 状态 */
export function createPartyState(): PartyState {
  return {
    groups: [],
    activeGroupId: null,
  };
}

// ── 查询 ──────────────────────────────────────────

/** 获取当前活跃群 */
export function getActiveGroup(state: PartyState): PartyGroup | null {
  return state.groups.find((g) => g.id === state.activeGroupId) ?? null;
}

/** 获取活跃群的所有成员 */
export function getGroupMembers(state: PartyState): PartyMember[] {
  const group = getActiveGroup(state);
  return group?.members ?? [];
}

/** 获取活跃群的未禁言成员 */
export function getUnmutedMembers(state: PartyState): PartyMember[] {
  return getGroupMembers(state).filter((m) => !m.muted);
}

/** 按名称查找群 */
export function findGroupByName(state: PartyState, name: string): PartyGroup | undefined {
  return state.groups.find((g) => g.name === name);
}

/** 统计群内管理员数量 */
export function countAdmins(state: PartyState): number {
  return getGroupMembers(state).filter((m) => m.role === "admin").length;
}

/** 格式化群成员列表文本 */
export function formatMemberList(state: PartyState): string {
  const members = getGroupMembers(state);
  if (members.length === 0) return "  (空——用 .group invite <名称> 拉人)";
  return members.map((m) => {
    const d = getAgentDisplay(m.agentType);
    const roleTag = m.role === "owner" ? "[群主]" : m.role === "admin" ? "[管理]" : "";
    const muteTag = m.muted ? " 🔇" : "";
    return `  ${d.emoji} ${d.name} ${roleTag}${muteTag}`;
  }).join("\n");
}

/** 格式化所有群列表文本 */
export function formatGroupsList(state: PartyState): string {
  if (state.groups.length === 0) return "  (无群——用 .group create <群名> 创建)";
  return state.groups.map((g) => {
    const d = getAgentDisplay(g.owner);
    const active = g.id === state.activeGroupId ? " ← 当前" : "";
    const count = g.members.length;
    return `  ${g.id === state.activeGroupId ? "▶" : " "} ${g.name} (${count}人, 群主: ${d.emoji}${d.name})${active}`;
  }).join("\n");
}

// ── 群操作 ────────────────────────────────────────

/** 创建新群。返回 null 表示已达上限。 */
export function createGroup(state: PartyState, name: string, owner: AgentType): PartyGroup | null {
  if (state.groups.length >= MAX_GROUPS) return null;
  if (findGroupByName(state, name)) return null; // 重名

  const group: PartyGroup = {
    id: `party-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    owner,
    members: [{
      agentType: owner,
      role: "owner",
      muted: false,
      joinedAt: Date.now(),
    }],
    createdAt: Date.now(),
    history: [],
  };

  state.groups.push(group);
  if (!state.activeGroupId) state.activeGroupId = group.id;
  return group;
}

/** 删除群。返回 false 表示不存在。 */
export function deleteGroup(state: PartyState, groupId: string): boolean {
  const idx = state.groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return false;
  state.groups.splice(idx, 1);
  if (state.activeGroupId === groupId) {
    state.activeGroupId = state.groups[0]?.id ?? null;
  }
  return true;
}

/** 切换活跃群 */
export function switchActiveGroup(state: PartyState, groupId: string): boolean {
  if (!state.groups.some((g) => g.id === groupId)) return false;
  state.activeGroupId = groupId;
  return true;
}

// ── 成员操作 ──────────────────────────────────────

/** 添加成员。返回 false 表示上限或已存在。 */
export function addMember(
  state: PartyState,
  agentType: AgentType,
  role: "member" | "admin" = "member",
): boolean {
  const group = getActiveGroup(state);
  if (!group) return false;
  if (group.members.length >= MAX_MEMBERS_PER_GROUP) return false;
  if (group.members.some((m) => m.agentType === agentType)) return false;
  if (role === "admin" && countAdmins(state) >= MAX_ADMINS_PER_GROUP) {
    role = "member";
  }

  group.members.push({
    agentType,
    role,
    muted: false,
    joinedAt: Date.now(),
  });
  return true;
}

/** 删除成员。返回 false 表示不存在。自动处理 owner 离开时的所有权转移。 */
export function removeMember(state: PartyState, agentType: AgentType): boolean {
  const group = getActiveGroup(state);
  if (!group) return false;
  const idx = group.members.findIndex((m) => m.agentType === agentType);
  if (idx === -1) return false;

  const leaving = group.members[idx];

  if (leaving.role === "owner") {
    group.members.splice(idx, 1);
    const firstAdmin = group.members.find((m) => m.role === "admin");
    const firstMember = group.members[0];
    if (firstAdmin) {
      firstAdmin.role = "owner";
      group.owner = firstAdmin.agentType;
    } else if (firstMember) {
      firstMember.role = "owner";
      group.owner = firstMember.agentType;
    } else {
      deleteGroup(state, group.id);
    }
    return true;
  }

  group.members.splice(idx, 1);
  return true;
}

/** 设置禁言状态 */
export function setMuted(state: PartyState, agentType: AgentType, muted: boolean): boolean {
  const group = getActiveGroup(state);
  if (!group) return false;
  const member = group.members.find((m) => m.agentType === agentType);
  if (!member) return false;
  member.muted = muted;
  return true;
}

/** 设置角色（admin / member）。不能降级 owner。 */
export function setRole(
  state: PartyState,
  agentType: AgentType,
  role: "admin" | "member",
): boolean {
  const group = getActiveGroup(state);
  if (!group) return false;
  const member = group.members.find((m) => m.agentType === agentType);
  if (!member) return false;
  if (member.role === "owner") return false;
  if (role === "admin" && countAdmins(state) >= MAX_ADMINS_PER_GROUP) return false;
  member.role = role;
  return true;
}

// ── 权限 ──────────────────────────────────────────

/**
 * 检查操作者是否可以对目标执行管理操作。
 * 开拓者是超级管理员——永远返回 true。
 *
 * 权限层级：
 *   开拓者 > owner > admin > member
 *   - owner 可以管理所有人（除了自己）
 *   - admin 可以管理 member（不能管 owner 和其他 admin）
 *   - member 没有管理权限
 */
export function canManage(state: PartyState, actor: AgentType, target: AgentType): boolean {
  const group = getActiveGroup(state);
  if (!group) return false;
  if (actor === target) return false; // 不能管理自己

  const actorMember = group.members.find((m) => m.agentType === actor);
  const targetMember = group.members.find((m) => m.agentType === target);
  if (!targetMember) return false;
  if (!actorMember) return false;

  if (actorMember.role === "owner") return targetMember.role !== "owner";
  if (actorMember.role === "admin") return targetMember.role === "member";

  return false;
}
