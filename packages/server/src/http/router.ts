/**
 * @cortex/server — HTTP Router
 *
 * Unified HTTP router for the daemon REST API.
 * Routes: health, state, nodes, agents, memory, sessions, chat.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineHost } from "../engine-host.js";
import type { SessionManager } from "../session-manager.js";
import type { ChatExecutor } from "../chat-executor.js";
import { problem, PROTOCOL_VERSION } from "@cortex/protocol";
import { AgentType } from "@cortex/shared";
import { handleChat } from "./chat-handler.js";
import { handleMemoryGet, handleMemoryPost, handleMemoryDelete } from "./memory-handler.js";
import { handleSessionGet, handleSessionPost, handleSessionDelete } from "./session-handler.js";
import { StateAggregator } from "./state-handler.js";

export class HttpRouter {
  private readonly engine: EngineHost;
  private readonly sessionManager: SessionManager;
  private readonly chatExecutor: ChatExecutor;
  private readonly projectRoot: string;
  private stateAggregator: StateAggregator | null = null;

  constructor(
    engine: EngineHost,
    sessionManager: SessionManager,
    chatExecutor: ChatExecutor,
    projectRoot?: string,
  ) {
    this.engine = engine;
    this.sessionManager = sessionManager;
    this.chatExecutor = chatExecutor;
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Handle an HTTP request. Returns true if the route was matched.
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // GET /api/v1/capabilities（C5：能力发现——共面/专化声明的载体）
    if (method === "GET" && path === "/api/v1/capabilities") {
      this.handleCapabilities(res);
      return true;
    }

    // GET /api/v1/health
    if (method === "GET" && path === "/api/v1/health") {
      this.handleHealth(res);
      return true;
    }

    // GET /api/v1/daemon/health
    if (method === "GET" && path === "/api/v1/daemon/health") {
      this.handleDaemonHealth(res);
      return true;
    }

    // POST /api/v1/execute（C2：daemon 补齐 execute 路由——G10 修复，
    //   RemoteEngineBridge/WebUI 的 execute 不再对 daemon 404）
    if (method === "POST" && path === "/api/v1/execute") {
      void handleExecute(req, res, this.engine).catch(err =>
        sendProblem(res, 500, "Execute Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // POST /api/v1/chat
    if (method === "POST" && path === "/api/v1/chat") {
      void handleChat(req, res, this.chatExecutor, this.sessionManager).catch(err =>
        sendProblem(res, 500, "Chat Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // GET /api/v1/state
    if (method === "GET" && path === "/api/v1/state") {
      this.handleState(res);
      return true;
    }

    // GET /api/v1/nodes
    if (method === "GET" && path === "/api/v1/nodes") {
      this.handleNodes(res, url);
      return true;
    }

    // R12-H3：GET /api/v1/nodes/:id——单节点查询（此前 client getNode 404——路由不存在）
    if (method === "GET" && path.startsWith("/api/v1/nodes/")) {
      this.handleNode(res, path.slice("/api/v1/nodes/".length));
      return true;
    }

    // GET /api/v1/agents
    if (method === "GET" && path === "/api/v1/agents") {
      this.handleAgents(res);
      return true;
    }

    // GET /api/v1/memory
    if (method === "GET" && path === "/api/v1/memory") {
      void handleMemoryGet(req, res, this.engine).catch(err =>
        sendProblem(res, 500, "Memory Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // POST /api/v1/memory
    if (method === "POST" && path === "/api/v1/memory") {
      void handleMemoryPost(req, res, this.engine).catch(err =>
        sendProblem(res, 500, "Memory Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // DELETE /api/v1/memory/:id
    if (method === "DELETE" && path.startsWith("/api/v1/memory/")) {
      const id = path.slice("/api/v1/memory/".length);
      void handleMemoryDelete(res, this.engine, id).catch(err =>
        sendProblem(res, 500, "Memory Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // GET /api/v1/sessions
    if (method === "GET" && path === "/api/v1/sessions") {
      handleSessionGet(res, this.sessionManager);
      return true;
    }

    // POST /api/v1/sessions
    if (method === "POST" && path === "/api/v1/sessions") {
      void handleSessionPost(req, res, this.sessionManager).catch(err =>
        sendProblem(res, 500, "Session Error", err instanceof Error ? err.message : String(err))
      );
      return true;
    }

    // DELETE /api/v1/sessions/:id
    if (method === "DELETE" && path.startsWith("/api/v1/sessions/")) {
      const id = path.slice("/api/v1/sessions/".length);
      handleSessionDelete(res, this.sessionManager, id);
      return true;
    }

    return false;
  }

  // ── Route handlers ──────────────────────────────────

  private handleHealth(res: ServerResponse): void {
    const health = this.engine.healthCollector;
    // Round-10 P0-1：接入真实快照——降级事件经 DegradationBoundary → HealthCollector 聚合，
    // 此处不再返回硬编码零（观测最后一公里断点修复）
    const snapshot = health
      ? health.snapshot()
      : {
          timestamp: Date.now(),
          totalDegradations: 0,
          bySource: {},
          byLevel: {},
          recentSources: [],
          degradedSince: null,
        };
    sendJson(res, 200, { data: snapshot });
  }

  private handleDaemonHealth(res: ServerResponse): void {
    // S1-5：接真实快照——与 handleHealth 同源，降级事件经
    // DegradationBoundary → HealthCollector 聚合，不再返回硬编码零；
    // engineReady 用 healthCollector 真实存在性判断（不再恒 true）
    const health = this.engine.healthCollector;
    const snapshot = health
      ? health.snapshot()
      : {
          timestamp: Date.now(),
          totalDegradations: 0,
          bySource: {},
          byLevel: {},
          recentSources: [],
          degradedSince: null,
        };
    sendJson(res, 200, {
      data: {
        ...snapshot,
        daemon: {
          pid: process.pid,
          uptimeMs: process.uptime() * 1000,
          version: "0.1.0",
          engineReady: health !== undefined,
          activeSessions: this.sessionManager.size,
        },
        // F4：ObservabilityInfo 兑现——S2-9 数据源补齐（telemetry/audit 行数 + 记忆持久化）
        observability: this._collectObservability(),
      },
    });
  }

  /** 读取观测层数据源状态（.cortex/telemetry.jsonl / audit.jsonl 行数） */
  private _collectObservability(): {
    telemetryFile: string | null;
    telemetryEntries: number;
    auditEntries: number;
    memoryPersisted: boolean;
  } {
    const root = this.projectRoot ?? process.cwd();
    const cortexDir = join(root, ".cortex");
    const telemetryFile = join(cortexDir, "telemetry.jsonl");
    const auditFile = join(cortexDir, "audit.jsonl");
    const countLines = (fp: string): number => {
      try {
        if (!existsSync(fp)) return 0;
        return readFileSync(fp, "utf-8").split("\n").filter((l) => l.trim().length > 0).length;
      } catch {
        return 0;
      }
    };
    return {
      telemetryFile: existsSync(telemetryFile) ? telemetryFile : null,
      telemetryEntries: countLines(telemetryFile),
      auditEntries: countLines(auditFile),
      memoryPersisted: this.engine.memory?.isPersisted === true,
    };
  }

  private handleState(res: ServerResponse): void {
    if (!this.stateAggregator) {
      this.stateAggregator = new StateAggregator(
        this.engine.board,
        this.engine.pool,
        this.engine.healthCollector,
      );
    }
    const snapshot = this.stateAggregator.getSnapshot();
    sendJson(res, 200, { data: snapshot });
  }

  private handleNodes(res: ServerResponse, url: URL): void {
    try {
      // C4：分页形状对齐——返回 PaginatedResponse 结构（与 client getNodes 类型声明一致）
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
      const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50);
      const nodes = this.engine.board.getAllNodes();
      const nodeSnapshots = nodes.map((n) => ({
        id: n.id,
        nodeType: n.type ?? "unknown",
        agent: n.claimedBy?.[0] ?? "",
        description: n.payload ?? "",
        status: n.status === "done" ? "complete" : n.status === "claimed" ? "pending" : n.status,
        parentId: n.parentId,
      }));
      const total = nodeSnapshots.length;
      const start = (page - 1) * limit;
      sendJson(res, 200, {
        data: nodeSnapshots.slice(start, start + limit),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
    }
  }

  // R12-H3：单节点快照（与 handleNodes 同一映射）——此前 client getNode 404（路由不存在）
  private handleNode(res: ServerResponse, id: string): void {
    try {
      const n = this.engine.board.getNode(decodeURIComponent(id));
      if (!n) {
        sendJson(res, 404, { error: `Node ${id} not found` });
        return;
      }
      sendJson(res, 200, {
        data: {
          id: n.id,
          nodeType: n.type ?? "unknown",
          agent: n.claimedBy?.[0] ?? "",
          description: n.payload ?? "",
          status: n.status === "done" ? "complete" : n.status === "claimed" ? "pending" : n.status,
          parentId: n.parentId,
        },
      });
    } catch (err) {
      sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
    }
  }

  private handleAgents(res: ServerResponse): void {
    try {
      // C3：语义统一——按 agentType 返回状态字符串映射（与 client getAgents 类型声明一致，
      //   修复「client 期望 / daemon 返回 pool stats / WebUI 返回 statuses」三头错）
      const pool = this.engine.pool;
      const result: Record<string, string[]> = {};
      for (const type of Object.values(AgentType)) {
        result[type] = pool.getStatuses(type).map((s) => String(s));
      }
      sendJson(res, 200, { data: result });
    } catch (err) {
      sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
    }
  }

  private handleCapabilities(res: ServerResponse): void {
    // C5：能力发现——daemon 身份 + 共面/专化声明
    sendJson(res, 200, {
      data: {
        server: "daemon",
        version: PROTOCOL_VERSION,
        api: {
          state: true,
          health: true,
          nodes: true,
          agents: true,
          chat: true,
          memory: true,
          sessions: true,
          daemonHealth: true,
          execute: true,
          events: false,
          config: false,
        },
        wsChannels: ["state", "pipeline", "system", "config", "chat", "gate", "notification"],
      },
    });
  }
}

// ── Helpers ──────────────────────────────────────────

/**
 * POST /api/v1/execute（C2）——daemon 工具执行入口（G10 修复）。
 * 与 WebUI 语义一致：toolkit.execute("execute", { input })——引擎正式工具链路。
 */
async function handleExecute(req: IncomingMessage, res: ServerResponse, engine: EngineHost): Promise<void> {
  const raw = await readBody(req);
  let body: { input?: unknown };
  try {
    body = JSON.parse(raw) as { input?: unknown };
  } catch {
    sendProblem(res, 422, "Validation Error", "请求体必须为 JSON");
    return;
  }
  const input = body?.input;
  if (typeof input !== "string" || input.trim() === "") {
    sendProblem(res, 422, "Validation Error", "input 必填且为非空字符串");
    return;
  }
  const toolkit = engine.toolkitInstance;
  const result = await toolkit.execute({ toolName: "execute", params: { input } }, AgentType.Code);
  if (!result.success) {
    sendProblem(res, 500, "Execute Error", result.error ?? "工具执行失败");
    return;
  }
  sendJson(res, 200, { data: { output: result.output ?? "" } });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function sendProblem(res: ServerResponse, status: number, title: string, detail?: string): void {
  if (res.headersSent) return;
  const body = problem(status, title, detail);
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/problem+json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
