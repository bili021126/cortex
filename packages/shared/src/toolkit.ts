// ============================================================
// @cortex/shared — 工具与确认门域
// 工具定义、可逆性等级、确认门、信任模型
//
// @core v3 — 统一 Tool 接口：本地工具与 MCP 工具对上层透明，
//         Toolkit 不区分来源，统一通过 Tool.execute() 调度。
// ============================================================

import type { AgentType } from "./agent.js";

// ─── 工具定义 ──────────────────────────────────────────────

export enum ToolCategory {
  Read = "Read",
  Write = "Write",
  Shell = "Shell",
  Search = "Search",
}

/** LLM function calling 用的工具声明（不含执行逻辑） */
export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  /** JSON Schema 参数定义（LLM function calling 用） */
  parameters?: Record<string, unknown>;
}

/** 工具执行上下文——传给 Tool.execute() */
export interface ToolInvocation {
  toolName: string;
  params: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** 工具执行处理器签名 */
export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

// ─── 统一 Tool 接口（v3）──────────────────────────────────

/**
 * Tool —— 本地工具与 MCP 工具的统一接口。
 *
 * 无论工具是本地 handler 直接执行，还是通过 McpToolAdapter 代理到远程 MCP Server，
 * 对 Toolkit 而言都只是一个 Tool 对象。所有元数据（名称、参数、可逆性等级）与
 * 执行逻辑（execute）封装在同一接口内，消除了旧版的双路径分派。
 *
 * 外部协议（MCP、未来 A2A、gRPC 插件）只需实现此接口即可接入——不改 Toolkit 一行。
 */
export interface Tool {
  /** 唯一名称（注册到 Toolkit 的 key）。MCP 工具前缀 mcp:<serverId>: */
  readonly name: string;
  /** 工具分类 */
  readonly category: ToolCategory;
  /** 工具描述（LLM function calling 用） */
  readonly description: string;
  /** JSON Schema 参数定义 */
  readonly parameters: Record<string, unknown>;
  /** 可逆性等级——决定 ConfirmGate 是否拦截 */
  readonly level: ReversibilityLevel;
  /** 是否需要文件写锁（write_file / delete_file 需设为 true） */
  readonly needsLock?: boolean;
  /** 执行工具。本地工具直接执行 handler；MCP 工具通过 McpClient 代理 */
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

// ─── 可逆性等级 ────────────────────────────────────────────

export enum ReversibilityLevel {
  L0 = "L0", // 纯读取，永不确认
  L1 = "L1", // 可逆写入，信任够则放行
  L2 = "L2", // 不可逆写入，永远确认
  L3 = "L3", // 不可恢复，永远确认
}

/**
 * ReversibilityLevel → modification-record 中 ReversibilityClass 的显式映射。
 * @fix 艾尔海森 P0-1 — 两套枚举描述同一域但无映射，消费方需自己推断。
 */
export function toReversibilityClass(level: ReversibilityLevel): "reversible" | "irreversible" | "meta" {
  switch (level) {
    case ReversibilityLevel.L0: return "meta";
    case ReversibilityLevel.L1: return "reversible";
    case ReversibilityLevel.L2:
    case ReversibilityLevel.L3: return "irreversible";
  }
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
  /** 跳过所有确认（测试/CI 自动化用，生产过程调用会抛错） */
  bypassAll(): void;
  /** CLI 查询：是否有待处理的确认请求 */
  hasPending(): boolean;
  /** CLI 操作：批准或拒绝确认请求 */
  resolve(response: ConfirmationResponse): boolean;
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
