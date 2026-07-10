/**
 * tui/web/api-router.ts — HTTP API 路由
 *
 * 提供 REST 端点供浏览器查询引擎运行时状态。
 * 所有端点返回 JSON，支持 CORS（localhost）。
 *
 * @module tui/web/api-router
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ITaskBoard, IAgentPool } from "@cortex/scheduler";
import type { HealthCollector, HealthSnapshot } from "@cortex/telemetry";
import type { ITuiEngineBridge, AgentType } from "@cortex/shared";
import { AgentType as AgentTypeEnum } from "@cortex/shared";
import type { StateAggregator, WebUIState } from "./state-aggregator.js";

// ─── 最近事件缓存 ────────────────────────────────

interface RecentEventEntry {
  type: string;
  payload: unknown;
  timestamp: number;
}

// ─── APIRouter ────────────────────────────────────

export class APIRouter {
  private readonly stateAggregator: StateAggregator;
  private readonly engineBridge: ITuiEngineBridge;
  private readonly taskBoard: ITaskBoard;
  private readonly agentPool: IAgentPool;
  private readonly healthCollector: HealthCollector;
  private recentEvents: RecentEventEntry[] = [];
  private static readonly MAX_RECENT_EVENTS = 100;

  constructor(
    stateAggregator: StateAggregator,
    engineBridge: ITuiEngineBridge,
    taskBoard: ITaskBoard,
    agentPool: IAgentPool,
    healthCollector: HealthCollector,
  ) {
    this.stateAggregator = stateAggregator;
    this.engineBridge = engineBridge;
    this.taskBoard = taskBoard;
    this.agentPool = agentPool;
    this.healthCollector = healthCollector;
  }

  /**
   * 记录事件到最近事件缓存（供 GET /api/events/recent 查询）。
   */
  recordEvent(type: string, payload: unknown): void {
    this.recentEvents.unshift({ type, payload, timestamp: Date.now() });
    if (this.recentEvents.length > APIRouter.MAX_RECENT_EVENTS) {
      this.recentEvents.length = APIRouter.MAX_RECENT_EVENTS;
    }
  }

  /**
   * 处理 HTTP 请求。如果路径被识别则返回 true，否则返回 false。
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    // CORS 头（允许 localhost 跨域）
    this._setCorsHeaders(res);

    // 预检请求
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    try {
      switch (path) {
        case "/api/state":
          return this._handleGetState(res);

        case "/api/nodes":
          return this._handleGetNodes(res);

        case "/api/agents":
          return this._handleGetAgents(res);

        case "/api/health":
          return this._handleGetHealth(res);

        case "/api/execute":
          if (req.method === "POST") {
            return this._handleExecute(req, res);
          }
          return this._sendError(res, 405, "Method Not Allowed");

        case "/api/events/recent":
          return this._handleRecentEvents(res);

        default:
          return false;
      }
    } catch (err) {
      this._sendError(res, 500, err instanceof Error ? err.message : "Internal Server Error");
      return true;
    }
  }

  // ── 私有方法 ────────────────────────────────────

  private _setCorsHeaders(res: ServerResponse): void {
    // 如果响应头已发送，跳过设置
    if (res.headersSent) return;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  private _sendJson(res: ServerResponse, statusCode: number, data: unknown): boolean {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
    return true;
  }

  private _sendError(res: ServerResponse, statusCode: number, message: string): boolean {
    return this._sendJson(res, statusCode, { error: message });
  }

  /** GET /api/state → 完整 WebUIState */
  private _handleGetState(res: ServerResponse): boolean {
    const state = this.stateAggregator.getSnapshot();
    return this._sendJson(res, 200, state);
  }

  /** GET /api/nodes → TaskBoard 节点列表 */
  private _handleGetNodes(res: ServerResponse): boolean {
    const allNodes = this.taskBoard.getAllNodes();
    return this._sendJson(res, 200, allNodes);
  }

  /** GET /api/agents → AgentPool 状态 */
  private _handleGetAgents(res: ServerResponse): boolean {
    const agentTypes = Object.values(AgentTypeEnum).filter(
      (v): v is AgentType => typeof v === "string",
    ) as AgentType[];
    const result: Record<string, unknown> = {};

    for (const agentType of agentTypes) {
      const statuses = this.agentPool.getStatuses(agentType as AgentType);
      result[agentType] = statuses;
    }

    return this._sendJson(res, 200, result);
  }

  /** GET /api/health → 健康快照 */
  private _handleGetHealth(res: ServerResponse): boolean {
    const snapshot: HealthSnapshot = this.healthCollector.snapshot();
    return this._sendJson(res, 200, snapshot);
  }

  /** POST /api/execute → 触发执行 */
  private _handleExecute(req: IncomingMessage, res: ServerResponse): boolean {
    // 读取请求体
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf-8");
    });

    // 使用 void 操作符忽略 Promise 返回值
    void this._handleExecuteAsync(req, res, body);
    return true;
  }

  private async _handleExecuteAsync(req: IncomingMessage, res: ServerResponse, body: string): Promise<void> {
    try {
      const payload = JSON.parse(body || "{}");
      const input = String(payload.input ?? "");
      const result = await this.engineBridge.executeToolCall(
        "execute",
        { input },
      );
      this._sendJson(res, 200, result);
    } catch (err) {
      this._sendError(
        res,
        500,
        err instanceof Error ? err.message : "Execute failed",
      );
    }
  }

  /** GET /api/events/recent → 最近 N 个事件 */
  private _handleRecentEvents(res: ServerResponse): boolean {
    return this._sendJson(res, 200, this.recentEvents);
  }
}
