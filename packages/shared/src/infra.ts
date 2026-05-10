// ============================================================
// @cortex/shared — 基础设施类型域
// 工具、确认门、管线、平台、文件锁、LLM 协议
// ============================================================

import type { AgentType } from "./agent.js";
import type { AgentStatus } from "./agent.js";
import type { TaskNode, NodeResult } from "./task.js";

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

// ─── PipelineObserver ──────────────────────────────────────

export enum PipelinePriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
}

export interface ObservableEvent {
  type: string;
  priority: PipelinePriority;
  payload: unknown;
  timestamp: number;
  /**
   * 通知语义类型。
   *   FYI              — 信息告知，用户看一眼即可
   *   WARNING          — 异常警告，用户可能需要介入
   *   DECISION_REQUIRED — 治理呈报，用户必须响应（走 ConfirmGate）
   * undefined 为向后兼容，行为不变。
   */
  notificationType?: "FYI" | "WARNING" | "DECISION_REQUIRED";
}

export type PipelineHandler = (event: ObservableEvent) => void;

// ─── SafeErrorReporter ─────────────────────────────────────

/** 安全错误上下文——统一擦除点，杜绝静默吞错 */
export interface SafeErrorContext {
  /** 错误来源标识，如 "InspectorAgent._collectFacts" */
  source: string;
  /** 原始错误对象 */
  error: unknown;
  /** 严重级别：fatal(阻断)/degraded(降级)/silent(有意忽略) */
  severity: "fatal" | "degraded" | "silent";
  /** 可选附加提示 */
  hint?: string;
}

/**
 * SafeErrorReporter —— 统一错误上报回调。
 *
 * 治理判例 NG-2026-0509-Persist-False-Positive（假阳性禁止原则）：
 * 持久化失败必须传播为操作失败，不得静默返回成功。
 *
 * silent 级别的错误连续发生 N=3 次后自动升级为 degraded，
 * 防止"有意忽略"退化为"习惯性忽略"。升级逻辑由调用方（PipelineObserver）实现。
 */
export type SafeErrorReporter = (ctx: SafeErrorContext) => void;

// ─── 文件锁 ────────────────────────────────────────────────

export enum LockType {
  Read = "read",
  Write = "write",
}

export interface IFileLockManager {
  acquire(filePath: string, lockType: LockType, ownerId: string): boolean;
  release(filePath: string, ownerId: string): void;
}

// ─── 平台上下文 ─────────────────────────────────────────────

export enum PlatformKind {
  CLI = "cli",
  Electron = "electron",
}

export interface PlatformContext {
  kind: PlatformKind;
  foreground: boolean; // 用户是否在关注
  idle: boolean; // 用户是否空闲
}

// ─── PlatformBridge ────────────────────────────────────────

/**
 * PlatformBridge —— Engine ↔ 用户交互的抽象层。
 * Core-1 仅实现 CLIAdapter（stdin/stdout）。Core-2 追加 ElectronAdapter（IPC 弹窗）。
 */
export interface PlatformBridge {
  /** 阻塞等待用户确认（L2/L3 操作）。CLI 下为 stdin 读取，Electron 下为系统弹窗。 */
  confirm(request: ConfirmationRequest): Promise<ConfirmationResponse>;

  /** 通知用户（非阻塞）。 */
  notify(message: string): void;

  /** 获取当前平台上下文。 */
  getPlatformContext(): PlatformContext;
}

// ─── LLM 协议 ─────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
  name?: string;
  reasoning_content?: string; // V4-Flash 思考模式：多轮对话需回传
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
  reasoning_content?: string; // V4-Flash 思考模式：需在下一轮 assistant 消息中回传
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmAdapterConfig {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  reasonerModel: string;
  reasoningEffort?: "high" | "max"; // V4-Flash 思考模式推理深度
}

// ─── Agent 接口（定义于此以解耦 agent ↔ task 循环依赖） ───

/** Agent 接口——所有 Agent 类必须实现此接口 */
export interface Agent {
  readonly type: AgentType;
  readonly status: AgentStatus;
  wakeup(): Promise<void>;
  execute(node: TaskNode, model: string): Promise<NodeResult>;
  shutdown(): Promise<void>;
}

/** Agent 配置（权限由 Toolkit 层 AGENT_TOOL_PERMISSIONS 管理） */
export interface AgentConfig {
  type: AgentType;
  maxInstances: number;
}
