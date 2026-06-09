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

/** Agent 信任等级——决定 L1 操作是否免确认 */
export enum TrustLevel {
  L0 = 0, // 不可信——强制确认
  L1 = 1, // 冷启动——每次确认
  L2 = 2, // 可信——连续 5 次接受后晋升
  L3 = 3, // 高度可信——L1 操作免确认
}

export type RiskDomain =
  | "file_write"
  | "shell_exec"
  | "network"
  | "config_change";

/** 工具名 → RiskDomain 映射 */
export function toolNameToRiskDomain(toolName: string): RiskDomain | null {
  if (toolName === "write_file" || toolName === "delete_file") return "file_write";
  if (toolName === "run_shell") return "shell_exec";
  if (toolName === "web_search" || toolName.startsWith("mcp:")) return "network";
  return null;
}

/** 信任条目——内部追踪数据 */
export interface TrustEntry {
  readonly agentType: AgentType;
  readonly domain: RiskDomain;
  level: TrustLevel;
  consecutiveAccepts: number;
  totalConfirmations: number;
  lastAcceptedAt: number;
  updatedAt: number;
}

export interface TrustScore {
  agentType: AgentType;
  domain: RiskDomain;
  score: number; // 0..1
  historyCount: number;
}

/**
 * ITrustModel —— 信任模型接口（§九 外部接口抽象具体化）。
 *
 * 按 (AgentType, RiskDomain) 二维聚合接受率。
 * 冷启动从 L1 起。连续接受晋升，拒绝重置。7天无活动衰减。
 */
export interface ITrustModel {
  /** 查询 (agent, domain) 的信任等级 */
  getTrustLevel(agentType: AgentType, domain: RiskDomain): TrustLevel;

  /** 根据工具名推导 RiskDomain 并查询信任等级 */
  getTrustLevelForTool(agentType: AgentType, toolName: string): TrustLevel;

  /** 记录一次确认结果 */
  recordDecision(agentType: AgentType, toolName: string, approved: boolean): void;

  /** 模型变更时重置所有信任等级 */
  resetAll(): void;

  /** 获取信任快照（诊断用） */
  snapshot(): ReadonlyMap<string, TrustEntry>;
}
