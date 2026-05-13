// ============================================================
// @cortex/shared — 工具与确认门域
// 工具定义、可逆性等级、确认门、信任模型
// ============================================================

import type { AgentType } from "./agent.js";

// ─── 工具定义 ──────────────────────────────────────────────

export enum ToolCategory {
  Read = "read",
  Write = "write",
  Shell = "shell",
  Search = "search",
}

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  /** JSON Schema 参数定义（LLM function calling 用） */
  parameters?: Record<string, unknown>;
}

export interface ToolInvocation {
  toolName: string;
  params: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** 工具执行处理器签名 */
export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

// ─── 可逆性等级 ────────────────────────────────────────────

export enum ReversibilityLevel {
  L0 = "L0", // 纯读取，永不确认
  L1 = "L1", // 可逆写入，信任够则放行
  L2 = "L2", // 不可逆写入，永远确认
  L3 = "L3", // 不可恢复，永远确认
}

// ─── 确认门 ────────────────────────────────────────────────

export interface ConfirmationRequest {
  id: string;
  level: ReversibilityLevel;
  toolName: string;
  summary: string; // 管家用的可读摘要
  detail?: string;
}

export interface ConfirmationResponse {
  requestId: string;
  approved: boolean;
}

export interface IConfirmGate {
  needsConfirmation(level: ReversibilityLevel): boolean;
  request(req: ConfirmationRequest): string;
  waitFor(requestId: string, timeoutMs?: number): Promise<boolean>;
}

// ─── 信任模型 ──────────────────────────────────────────────

export type RiskDomain =
  | "file_write"
  | "shell_exec"
  | "network"
  | "config_change";

export interface TrustScore {
  agentType: AgentType;
  domain: RiskDomain;
  score: number; // 0..1
  historyCount: number;
}
