/**
 * @cortex/server — HTTP Router
 *
 * Unified HTTP router for the daemon REST API.
 * Routes: health, state, nodes, agents, memory, sessions, chat.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { EngineHost } from "../engine-host.js";
import type { SessionManager } from "../session-manager.js";
import type { ChatExecutor } from "../chat-executor.js";
import { problem } from "@cortex/protocol";
import { handleChat } from "./chat-handler.js";
import { handleMemoryGet, handleMemoryPost, handleMemoryDelete } from "./memory-handler.js";
import { handleSessionGet, handleSessionPost, handleSessionDelete } from "./session-handler.js";
import { StateAggregator } from "./state-handler.js";

export class HttpRouter {
  private readonly engine: EngineHost;
  private readonly sessionManager: SessionManager;
  private readonly chatExecutor: ChatExecutor;
  private stateAggregator: StateAggregator | null = null;

  constructor(engine: EngineHost, sessionManager: SessionManager, chatExecutor: ChatExecutor) {
    this.engine = engine;
    this.sessionManager = sessionManager;
    this.chatExecutor = chatExecutor;
  }

  /**
   * Handle an HTTP request. Returns true if the route was matched.
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

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
      this.handleNodes(res);
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
    const snapshot = health
      ? {
          timestamp: Date.now(),
          totalDegradations: 0,
          bySource: {},
          byLevel: {},
          recentSources: [],
          degradedSince: null,
        }
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
    const snapshot = {
      timestamp: Date.now(),
      totalDegradations: 0,
      bySource: {},
      byLevel: {},
      recentSources: [],
      degradedSince: null,
      daemon: {
        pid: process.pid,
        uptimeMs: process.uptime() * 1000,
        version: "0.1.0",
        engineReady: true,
        activeSessions: this.sessionManager.size,
      },
    };
    sendJson(res, 200, { data: snapshot });
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

  private handleNodes(res: ServerResponse): void {
    try {
      const nodes = this.engine.board.getAllNodes();
      const nodeSnapshots = nodes.map((n) => ({
        id: n.id,
        nodeType: n.type ?? "unknown",
        agent: n.claimedBy?.[0] ?? "",
        description: n.payload ?? "",
        status: n.status === "done" ? "complete" : n.status === "claimed" ? "pending" : n.status,
        parentId: n.parentId,
      }));
      sendJson(res, 200, { data: nodeSnapshots });
    } catch (err) {
      sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
    }
  }

  private handleAgents(res: ServerResponse): void {
    try {
      const pool = this.engine.pool;
      const stats = pool.getPoolStats();
      sendJson(res, 200, { data: stats });
    } catch (err) {
      sendProblem(res, 500, "Internal Error", err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Helpers ──────────────────────────────────────────

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
