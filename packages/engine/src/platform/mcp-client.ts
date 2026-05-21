/**
 * mcp-client.ts —— 轻量 MCP (Model Context Protocol) 客户端
 *
 * 通过 stdin/stdout JSON-RPC 与 MCP Server 子进程通信。
 * 实现 MCP 协议的最小子集: initialize → tools/list → tools/call。
 *
 * 设计约束:
 * - 零外部依赖 —— 只用 Node.js 内置 child_process
 * - 每个 McpClient 管理一个子进程
 * - 支持 tool call 独立超时
 * - 支持优雅关闭 (SIGTERM → SIGKILL cascade)
 *
 * @layer platform —— 被 SearchAggregator 使用
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

// ─── 类型定义 ──────────────────────────────────────

/** MCP Server 启动配置 */
export interface McpServerConfig {
  /** 唯一标识 */
  id: string;
  /** 启动命令, e.g. "npx" */
  command: string;
  /** 命令参数, e.g. ["-y", "@anthropic/brave-search-mcp"] */
  args: string[];
  /** 注入子进程的环境变量 (API Key 等) */
  env?: Record<string, string>;
  /** 是否启用 */
  enabled: boolean;
  /** 单次 tool call 超时 (ms), 默认 15000 */
  timeout?: number;
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

// ─── McpClient ──────────────────────────────────────

export class McpClient {
  private process: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private _started = false;
  private _tools: McpToolDef[] = [];
  private _serverName = "";
  private _buffer = "";

  constructor(private config: McpServerConfig) {}

  get id(): string { return this.config.id; }
  get started(): boolean { return this._started; }
  get tools(): McpToolDef[] { return this._tools; }
  get serverName(): string { return this._serverName; }

  /** 启动 MCP Server 子进程并完成 initialize 握手 */
  async start(): Promise<void> {
    if (this._started) return;

    const childEnv = { ...process.env, ...this.config.env };

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
    });

    // 行读取 stdout (MCP 响应)
    this.rl = createInterface({ input: this.process.stdout!, crlfDelay: Infinity });
    this.rl.on("line", (line: string) => this._onLine(line));

    // 错误日志 (stderr 仅 debug)
    this.process.stderr?.on("data", (chunk: Buffer) => {
      // MCP Server 的 stderr 输出为诊断信息，静默忽略
      void chunk;
    });

    this.process.on("exit", (code) => {
      this._started = false;
      // 拒绝所有未完成的调用
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP server "${this.config.id}" exited (code ${code})`));
        clearTimeout(p.timer);
      }
      this.pending.clear();
    });

    // 初始化握手
    const initResult = await this._call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cortex-mcp-client", version: "1.0.0" },
    });
    const parsed = JSON.parse(initResult) as { serverInfo?: { name: string }; capabilities?: unknown };
    this._serverName = parsed.serverInfo?.name ?? this.config.id;

    // 发送 initialized 通知 (无 id, 非请求)
    this._send({ jsonrpc: "2.0", method: "notifications/initialized" });

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

    // 提取文本内容
    const texts = (parsed.content ?? [])
      .filter((c): c is McpTextContent => c.type === "text")
      .map((c) => c.text);
    return texts.join("\n");
  }

  /** 列出可用工具 (需先 start) */
  listTools(): McpToolDef[] {
    return this._tools;
  }

  /** 查找 tool (按名称模糊匹配, 用于 "search" / "brave_web_search" 等) */
  findSearchTool(): McpToolDef | undefined {
    return this._tools.find((t) =>
      t.name.toLowerCase().includes("search") ||
      t.name.toLowerCase().includes("brave") ||
      t.name.toLowerCase().includes("tavily")
    );
  }

  /** 优雅关闭 */
  async stop(): Promise<void> {
    if (!this.process) return;

    // 清理 pending
    for (const [, p] of this.pending) {
      p.reject(new Error(`MCP server "${this.config.id}" shutting down`));
      clearTimeout(p.timer);
    }
    this.pending.clear();

    this.rl?.close();

    // 先 SIGTERM, 2s 后 SIGKILL
    const pid = this.process.pid;
    this.process.kill("SIGTERM");
    const killed = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
        resolve(false);
      }, 2000);
      this.process?.on("exit", () => {
        clearTimeout(t);
        resolve(true);
      });
    });

    this.process = null;
    this.rl = null;
    this._started = false;
    this._tools = [];
    void killed;
  }

  // ─── 内部方法 ──────────────────────────────────────

  /** 发送 JSON-RPC 请求并等待响应 */
  private _call(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<string> {
    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP call "${method}" timed out after ${timeoutMs}ms (server: ${this.config.id})`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this._send(request);
    });
  }

  /** 写一行 JSON 到子进程 stdin */
  private _send(message: JsonRpcRequest | { jsonrpc: "2.0"; method: string }): void {
    if (!this.process?.stdin) return;
    const line = JSON.stringify(message);
    this.process.stdin.write(line + "\n");
  }

  /** 处理 stdout 的每一行 (JSON-RPC 响应) */
  private _onLine(line: string): void {
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
      // 非 JSON 行, 忽略
    }
  }
}
