/**
 * mcp-client.ts —— 轻量 MCP (Model Context Protocol) 客户端
 *
 * 通过统一的 Transport 抽象屏蔽 stdio/HTTP 两种传输模式。
 * 外部使用者（Toolkit / SearchAggregator）不感知底层传输——只调 JSON-RPC。
 *
 * 传输模式：
 *   - stdio：启动子进程，通过 stdin/stdout JSON-RPC 通信（Claude Desktop 风格）
 *   - http：通过 HTTP POST JSON-RPC 通信（远程 MCP Server / OpenAI 风格）
 *
 * 实现 MCP 协议的最小子集: initialize → tools/list → tools/call。
 *
 * 设计约束:
 * - 零外部依赖 —— 只用 Node.js 内置 child_process + fetch
 * - 每个 McpClient 管理一个传输连接
 * - 支持 tool call 独立超时
 * - 支持优雅关闭
 *
 * @layer platform —— 被 SearchAggregator / Toolkit 使用
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { Tool, ToolResult } from "@cortex/shared";
import { ToolCategory, ReversibilityLevel } from "@cortex/config";

// ─── 类型定义 ──────────────────────────────────────

/** MCP 传输类型——对齐行业标准 mcpServers 配置 */
export type McpTransport = "stdio" | "http";

/**
 * MCP Server 配置——对齐行业标准 mcpServers 格式。
 *
 * 行业标准示例（Claude Desktop / Cursor / Continue 通用）：
 * ```json
 * {
 *   "mcpServers": {
 *     "brave-search": {
 *       "command": "npx",
 *       "args": ["-y", "@anthropic/brave-search-mcp"],
 *       "env": { "BRAVE_API_KEY": "xxx" }
 *     },
 *     "remote-api": {
 *       "transport": "http",
 *       "url": "https://mcp.example.com/mcp",
 *       "headers": { "Authorization": "Bearer xxx" }
 *     }
 *   }
 * }
 * ```
 */
export interface McpServerConfig {
  /** 唯一标识（mcpServers 对象的 key） */
  id: string;
  /** 传输类型——"stdio" 启动子进程，"http" 连接远程端点。默认 "stdio" */
  transport?: McpTransport;

  // ── stdio 传输字段 ──
  /** 启动命令 */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 子进程环境变量 (API Key 等) */
  env?: Record<string, string>;
  /** 子进程工作目录 */
  cwd?: string;

  /** 可选——MCP 服务器的 trust 配置（未设时默认 L2 + 所有 Agent 可用） */
  trust?: McpTrustConfig;
  /** HTTP 端点 URL */
  url?: string;
  /** HTTP 请求头 */
  headers?: Record<string, string>;

  /** 是否启用（Cortex 扩展字段——行业标准不包含，默认 true） */
  enabled?: boolean;
  /** 单次 tool call 超时 (ms), 默认 15000 */
  timeout?: number;
}

/**
 * MCP 服务器信任配置——声明式鉴权，不依赖 TrustModel 的历史行为计算。
 *
 * 与 ConfirmGate 的 reversibility 不同：trust 控制"谁能调"，reversibility 控制"调了要不要确认"。
 */
export interface McpTrustConfig {
  /** 可逆性等级——该服务器所有工具的默认等级（覆盖工具自身声明）。默认 L2 */
  level?: "L0" | "L1" | "L2" | "L3";
  /** 允许调用此 MCP 服务器的 Agent 类型列表。不设 = 全部允许 */
  allowedAgents?: string[];
  /** 是否需要 ConfirmGate 确认。默认 true */
  requireConfirmation?: boolean;
}

/** MCP Tool 定义 (来自 tools/list 响应) */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool/call 返回的文本内容项 */
interface McpTextContent {
  type: "text";
  text: string;
}

// ─── JSON-RPC 消息 ──────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingCall {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

// ════════════════════════════════════════════════════════════
// Transport 抽象——屏蔽 stdio / HTTP 差异
// ════════════════════════════════════════════════════════════

/** 统一的 MCP 传输接口——外部只调 JSON-RPC，不关心底层是子进程还是 HTTP */
interface McpTransportImpl {
  /** 启动传输连接，返回 serverInfo */
  start(): Promise<{ serverInfo?: { name: string } }>;
  /** 发送一条 JSON-RPC 行（序列化后的字符串） */
  send(line: string): void;
  /** 注册消息回调——传输层收到完整 JSON-RPC 响应时调用 */
  onMessage(handler: (line: string) => void): void;
  /** 优雅关闭——拒绝所有未完成的调用 */
  stop(reason: string): Promise<void>;
}

// ─── StdioTransport ─────────────────────────────────

class StdioTransport implements McpTransportImpl {
  private process: ChildProcess | null = null;
  private rl: Interface | null = null;
  private handlers: Array<(line: string) => void> = [];
  private serverId: string;

  constructor(private config: McpServerConfig) {
    this.serverId = config.id;
  }

  async start(): Promise<{ serverInfo?: { name: string } }> {
    const command = this.config.command;
    const args = this.config.args ?? [];
    if (!command) {
      throw new Error(`MCP server "${this.serverId}": stdio transport 需要 command 字段`);
    }

    const childEnv = { ...process.env, ...this.config.env };
    const spawnOpts: Parameters<typeof spawn>[2] = {
      stdio: ["pipe", "pipe", "pipe"] as const,
      env: childEnv,
    };
    if (this.config.cwd) {
      spawnOpts.cwd = this.config.cwd;
    }

    this.process = spawn(command, args, spawnOpts);

    // 行读取 stdout (MCP 响应)
    const stdout = this.process.stdout;
    if (!stdout) {
      throw new Error(`MCP server "${this.serverId}": spawned process has no stdout`);
    }
    this.rl = createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on("line", (line: string) => {
      for (const h of this.handlers) h(line);
    });

    // stderr 静默忽略
    this.process.stderr?.on("data", () => {});

    this.process.on("exit", () => {
      for (const h of this.handlers) {
        h(JSON.stringify({ jsonrpc: "2.0", id: -1, error: { code: -1, message: `Server "${this.serverId}" exited` } }));
      }
    });

    return {}; // serverInfo 由上层 initialize 握手填充
  }

  send(line: string): void {
    if (!this.process?.stdin) return;
    this.process.stdin.write(line + "\n");
  }

  onMessage(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  async stop(reason: string): Promise<void> {
    // 通知所有 handler 连接已断
    for (const h of this.handlers) {
      h(JSON.stringify({ jsonrpc: "2.0", id: -1, error: { code: -1, message: reason } }));
    }
    this.handlers = [];

    this.rl?.close();
    if (!this.process) return;

    // 先 SIGTERM, 2s 后 SIGKILL
    this.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
        resolve();
      }, 2000);
      this.process?.on("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });

    this.process = null;
    this.rl = null;
  }
}

// ─── HttpTransport ──────────────────────────────────

class HttpTransport implements McpTransportImpl {
  private sessionId: string | null = null;
  private handlers: Array<(line: string) => void> = [];

  constructor(private config: McpServerConfig) {}

  async start(): Promise<{ serverInfo?: { name: string } }> {
    const url = this.config.url;
    if (!url) {
      throw new Error(`MCP server "${this.config.id}": HTTP transport 需要 url 字段`);
    }
    // HTTP transport 在 send 时按需连接，start 只做校验
    return {};
  }

  send(line: string): void {
    const url = this.config.url;
    if (!url) {
      throw new Error(`MCP server "${this.config.id}": HTTP transport url not set`);
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    // 异步发送，响应通过 onMessage 回调
    fetch(url, {
      method: "POST",
      headers,
      body: line,
      signal: AbortSignal.timeout(this.config.timeout ?? 15_000),
    })
      .then(async (resp) => {
        // 捕获 session ID（initialize 响应会返回）
        const sid = resp.headers.get("Mcp-Session-Id");
        if (sid) this.sessionId = sid;

        const text = await resp.text();
        if (!resp.ok) {
          for (const h of this.handlers) {
            h(JSON.stringify({
              jsonrpc: "2.0", id: -1,
              error: { code: resp.status, message: `HTTP ${resp.status}: ${text.slice(0, 200)}` },
            }));
          }
          return;
        }
        // 解析请求中的 id 以匹配 pending call（通知无 id，无需回调）
        try {
          const req: JsonRpcRequest = JSON.parse(line);
          if (req.id === undefined) return; // 通知——不期待响应
        } catch { return; }
        // 响应可能已是 JSON-RPC 格式，也可能需要包装
        for (const h of this.handlers) h(text);
      })
      .catch((e) => {
        for (const h of this.handlers) {
          h(JSON.stringify({
            jsonrpc: "2.0", id: -1,
            error: { code: -1, message: `HTTP transport error: ${e instanceof Error ? e.message : String(e)}` },
          }));
        }
      });
  }

  onMessage(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  async stop(reason: string): Promise<void> {
    for (const h of this.handlers) {
      h(JSON.stringify({ jsonrpc: "2.0", id: -1, error: { code: -1, message: reason } }));
    }
    this.handlers = [];
    this.sessionId = null;
  }
}

// ════════════════════════════════════════════════════════════
// McpClient —— 只认 JSON-RPC，传输完全透明
// ════════════════════════════════════════════════════════════

export class McpClient {
  private _transport: McpTransportImpl | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private _started = false;
  private _tools: McpToolDef[] = [];
  private _serverName = "";

  constructor(private config: McpServerConfig) {}

  get id(): string { return this.config.id; }
  get started(): boolean { return this._started; }
  get tools(): McpToolDef[] { return this._tools; }
  get serverName(): string { return this._serverName; }

  /**
   * 启动 MCP 连接——自动选择 stdio 或 HTTP 传输。
   * 完成 initialize → tools/list 握手，对外暴露统一工具接口。
   */
  async start(): Promise<void> {
    if (this._started) return;

    const transport = this.config.transport ?? "stdio";
    if (transport === "http") {
      this._transport = new HttpTransport(this.config);
    } else {
      this._transport = new StdioTransport(this.config);
    }

    // 注册消息回调——传输层收到响应时解析 JSON-RPC 并匹配 pending call
    this._transport.onMessage((line: string) => this._handleMessage(line));

    // 启动传输
    await this._transport.start();

    // 初始化握手
    const initResult = await this._call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cortex-mcp-client", version: "1.0.0" },
    });
    const parsed = JSON.parse(initResult) as { serverInfo?: { name: string }; capabilities?: unknown };
    this._serverName = parsed.serverInfo?.name ?? this.config.id;

    // 发送 initialized 通知 (无 id, 非请求)
    this._sendNotification("notifications/initialized");

    // 获取工具列表
    const toolsResult = await this._call("tools/list", {});
    const toolsParsed = JSON.parse(toolsResult) as { tools?: McpToolDef[] };
    this._tools = toolsParsed.tools ?? [];

    this._started = true;
  }

  /** 调用 MCP Tool */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this._started) throw new Error(`MCP server "${this.config.id}" not started`);

    const timeout = this.config.timeout ?? 15_000;
    const result = await this._call("tools/call", { name, arguments: args }, timeout);
    const parsed = JSON.parse(result) as { content?: McpTextContent[]; isError?: boolean };

    if (parsed.isError) {
      throw new Error(`MCP tool "${name}" returned error: ${JSON.stringify(parsed.content)}`);
    }

    const texts = (parsed.content ?? [])
      .filter((c): c is McpTextContent => c.type === "text")
      .map((c) => c.text);
    return texts.join("\n");
  }

  /** 列出可用工具 (需先 start) */
  listTools(): McpToolDef[] {
    return this._tools;
  }

  /** H13 fix: 获取该 MCP 服务器的信任等级——默认 L2（需确认），除非 config.trust.level 指定 */
  getTrustLevel(): ReversibilityLevel {
    const raw = this.config.trust?.level;
    if (raw === "L0") return ReversibilityLevel.L0;
    if (raw === "L1") return ReversibilityLevel.L1;
    if (raw === "L3") return ReversibilityLevel.L3;
    // 默认 L2：MCP 工具涉及外部系统，默认需要确认
    return ReversibilityLevel.L2;
  }

  /** 查找 tool (按名称模糊匹配, 用于 "search" / "brave_web_search" 等) */
  findSearchTool(): McpToolDef | undefined {
    return this._tools.find((t) =>
      t.name.toLowerCase().includes("search") ||
      t.name.toLowerCase().includes("brave") ||
      t.name.toLowerCase().includes("tavily")
    );
  }

  /** 优雅关闭——级联清理 pending + 传输层 */
  async stop(): Promise<void> {
    if (!this._transport) return;

    // 清理 pending
    const reason = `MCP server "${this.config.id}" shutting down`;
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
      clearTimeout(p.timer);
    }
    this.pending.clear();

    await this._transport.stop(reason);
    this._transport = null;
    this._started = false;
    this._tools = [];
  }

  // ─── 内部方法 ──────────────────────────────────────

  /** 发送 JSON-RPC 请求并等待响应 */
  private _call(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<string> {
    if (!this._transport) throw new Error(`MCP server "${this.config.id}": transport not initialized`);
    const transport = this._transport;

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP call "${method}" timed out after ${timeoutMs}ms (server: ${this.config.id})`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      transport.send(JSON.stringify(request));
    });
  }

  /** 发送 JSON-RPC 通知（无 id，不期待响应） */
  private _sendNotification(method: string): void {
    if (!this._transport) return;
    this._transport.send(JSON.stringify({ jsonrpc: "2.0", method }));
  }

  /** 处理传输层到达的 JSON-RPC 响应——匹配 pending call */
  private _handleMessage(line: string): void {
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (msg.id === undefined || msg.id === null) return; // 通知, 忽略

      const pending = this.pending.get(msg.id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`MCP error (code ${msg.error.code}): ${msg.error.message}`));
      } else {
        pending.resolve(JSON.stringify(msg.result));
      }
    } catch {
      // 非 JSON 消息, 忽略
    }
  }
}

// ════════════════════════════════════════════════════════════
// McpToolAdapter —— MCP 工具 → 统一 Tool 接口适配器
// ════════════════════════════════════════════════════════════

/** MCP 工具名前缀 */
export const MCP_PREFIX = "mcp:";

/**
 * McpToolAdapter 将一个 MCP 工具的元数据与执行逻辑适配为统一的 Tool 接口。
 *
 * 对 Toolkit 而言，它与 LocalTool 没有任何区别——
 * 都实现 Tool，都通过 execute() 调度。
 *
 * 未来新增外部协议（A2A、gRPC 插件）只需以同样模式实现 Tool 即可。
 */
export class McpToolAdapter implements Tool {
  readonly name: string;
  readonly category = ToolCategory.Search;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly level: ReversibilityLevel;
  readonly needsLock = false;

  private _rawName: string;

  constructor(
    private _client: { callTool(name: string, args: Record<string, unknown>): Promise<string> },
    toolDef: { name: string; description: string; inputSchema: Record<string, unknown> },
    serverId: string,
    trustLevel?: ReversibilityLevel,
  ) {
    this.name = `${MCP_PREFIX}${serverId}:${toolDef.name}`;
    this._rawName = toolDef.name;
    this.description = `[MCP:${serverId}] ${toolDef.description || toolDef.name}`;
    this.parameters = (toolDef.inputSchema || {}) as Record<string, unknown>;
    // H13 fix: 使用 McpTrustConfig.level，默认 L2（需要确认），不再硬编码 L0
    this.level = trustLevel ?? ReversibilityLevel.L2;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const output = await this._client.callTool(this._rawName, params);
      return { success: true, output };
    } catch (e) {
      return {
        success: false,
        error: `MCP tool "${this._rawName}" failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
