/**
 * tui/web/api-router.ts — RESTful API 路由（v1 规范化）
 *
 * 提供标准化 REST 端点供浏览器/外部系统查询引擎运行时状态。
 *
 * 规范化要点：
 *   - API 版本化：/api/v1/* 为标准前缀，/api/* 保留向后兼容
 *   - RFC 7807 Problem Details 错误格式
 *   - X-Request-Id 链路追踪
 *   - 严格 HTTP 方法校验（405 + Allow 头）
 *   - 请求体校验（400 + 字段级错误）
 *   - 分页支持（?page=&limit=）
 *   - 资源子路径（/nodes/:id, /agents/:type）
 *
 * @module tui/web/api-router
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import * as crypto from "node:crypto";
import type { HealthCollector, HealthSnapshot } from "@cortex/telemetry";
import type { ITuiEngineBridge, AgentType, ITaskBoard, IAgentPool } from "@cortex/shared";
import { AgentType as AgentTypeEnum } from "@cortex/shared";
import type { StateAggregator } from "./state-aggregator.js";
import type { ConfigAPIHandler } from "./config-api-handler.js";

// ─── 类型 ────────────────────────────────────────

interface RecentEventEntry {
  type: string;
  payload: unknown;
  timestamp: number;
}

/** RFC 7807 Problem Details 错误响应 */
interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{ field: string; message: string }>;
}

/** 分页查询参数 */
interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

/** 分页响应包装 */
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── APIRouter ────────────────────────────────────

export class APIRouter {
  private readonly stateAggregator: StateAggregator;
  private readonly engineBridge: ITuiEngineBridge;
  private readonly taskBoard: ITaskBoard;
  private readonly agentPool: IAgentPool;
  private readonly healthCollector: HealthCollector;
  private readonly configHandler: ConfigAPIHandler | null;
  private recentEvents: RecentEventEntry[] = [];
  private static readonly MAX_RECENT_EVENTS = 100;
  private static readonly DEFAULT_PAGE_LIMIT = 50;
  private static readonly MAX_PAGE_LIMIT = 200;
  /** API 版本标识 */
  private static readonly API_VERSION = "1.0.0";

  constructor(
    stateAggregator: StateAggregator,
    engineBridge: ITuiEngineBridge,
    taskBoard: ITaskBoard,
    agentPool: IAgentPool,
    healthCollector: HealthCollector,
    configHandler?: ConfigAPIHandler,
  ) {
    this.stateAggregator = stateAggregator;
    this.engineBridge = engineBridge;
    this.taskBoard = taskBoard;
    this.agentPool = agentPool;
    this.healthCollector = healthCollector;
    this.configHandler = configHandler ?? null;
  }

  /**
   * 记录事件到最近事件缓存（供 GET /api/v1/events 查询）。
   */
  recordEvent(type: string, payload: unknown): void {
    this.recentEvents.unshift({ type, payload, timestamp: Date.now() });
    if (this.recentEvents.length > APIRouter.MAX_RECENT_EVENTS) {
      this.recentEvents.length = APIRouter.MAX_RECENT_EVENTS;
    }
  }

  /**
   * 处理 HTTP 请求。如果路径被识别则返回 true，否则返回 false。
   * 支持 /api/v1/* 标准前缀和 /api/* 向后兼容前缀。
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const requestId = crypto.randomUUID();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let path = url.pathname;

    // 版本化路由：/api/v1/* 为标准，/api/* 向后兼容
    const isV1 = path.startsWith("/api/v1/");
    const isLegacy = path.startsWith("/api/") && !isV1;
    if (!isV1 && !isLegacy) return false;

    // 标准化路径：去除版本前缀，统一路由
    if (isV1) path = path.slice("/api/v1".length) || "/";
    else path = path.slice("/api".length) || "/";

    // 设置通用响应头
    this._setCommonHeaders(res, requestId);

    // 预检请求
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }

    try {
      // ── 路由分发 ──
      // 资源路由：/nodes, /nodes/:id, /agents, /agents/:type
      if (path === "/state" || path === "/") {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetState(res);
      }

      if (path === "/nodes") {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetNodes(url, res);
      }

      // /nodes/:id — 单节点查询
      const nodeMatch = path.match(/^\/nodes\/([^/]+)$/);
      if (nodeMatch) {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetNodeById(nodeMatch[1] ?? "", res);
      }

      if (path === "/agents") {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetAgents(res);
      }

      // /agents/:type — 按类型查询
      const agentMatch = path.match(/^\/agents\/([^/]+)$/);
      if (agentMatch) {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetAgentByType(agentMatch[1] ?? "", res);
      }

      if (path === "/health") {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleGetHealth(res);
      }

      if (path === "/execute") {
        if (req.method !== "POST") return this._methodNotAllowed(res, "POST");
        return this._handleExecute(req, res);
      }

      if (path === "/events" || path === "/events/recent") {
        if (req.method !== "GET") return this._methodNotAllowed(res, "GET");
        return this._handleRecentEvents(url, res);
      }

      // Config API 委托（/models, /agents, /keys, /tuning, /config/*）
      if (this.configHandler?.handle(path, req.method ?? "GET", req, res)) {
        return true;
      }

      // 未匹配的路由
      return false;
    } catch (err) {
      this._sendProblem(res, {
        type: "https://cortex.dev/errors/internal",
        title: "Internal Server Error",
        status: 500,
        detail: err instanceof Error ? err.message : "An unexpected error occurred",
        instance: requestId,
      });
      return true;
    }
  }

  // ── 通用响应头 ────────────────────────────────────

  private _setCommonHeaders(res: ServerResponse, requestId: string): void {
    if (res.headersSent) return;
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
    // 链路追踪
    res.setHeader("X-Request-Id", requestId);
    // API 版本
    res.setHeader("X-API-Version", APIRouter.API_VERSION);
    // 安全头
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
  }

  // ── 响应工具 ────────────────────────────────────

  private _sendJson(res: ServerResponse, statusCode: number, data: unknown): boolean {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
    return true;
  }

  /** RFC 7807 Problem Details 错误响应 */
  private _sendProblem(res: ServerResponse, problem: ProblemDetails): boolean {
    const body = JSON.stringify(problem);
    res.writeHead(problem.status, { "Content-Type": "application/problem+json; charset=utf-8" });
    res.end(body);
    return true;
  }

  /** 405 Method Not Allowed + Allow 头 */
  private _methodNotAllowed(res: ServerResponse, allowed: string): boolean {
    res.setHeader("Allow", allowed);
    return this._sendProblem(res, {
      type: "https://cortex.dev/errors/method-not-allowed",
      title: "Method Not Allowed",
      status: 405,
      detail: `This endpoint only accepts ${allowed} requests.`,
    });
  }

  /** 解析分页参数 */
  private _parsePagination(url: URL): PaginationParams {
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(
      APIRouter.MAX_PAGE_LIMIT,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? String(APIRouter.DEFAULT_PAGE_LIMIT), 10) || APIRouter.DEFAULT_PAGE_LIMIT),
    );
    return { page, limit, offset: (page - 1) * limit };
  }

  /** 包装分页响应 */
  private _paginate<T>(items: T[], params: PaginationParams): PaginatedResponse<T> {
    const total = items.length;
    const totalPages = Math.ceil(total / params.limit);
    const data = items.slice(params.offset, params.offset + params.limit);
    return {
      data,
      pagination: { page: params.page, limit: params.limit, total, totalPages },
    };
  }

  // ── 端点处理器 ────────────────────────────────────

  /** GET /api/v1/state → 完整 WebUIState */
  private _handleGetState(res: ServerResponse): boolean {
    const state = this.stateAggregator.getSnapshot();
    return this._sendJson(res, 200, { data: state });
  }

  /** GET /api/v1/nodes → TaskBoard 节点列表（分页） */
  private _handleGetNodes(url: URL, res: ServerResponse): boolean {
    const allNodes = this.taskBoard.getAllNodes();
    const params = this._parsePagination(url);

    // 支持状态过滤 ?status=running
    const statusFilter = url.searchParams.get("status");
    let filtered = allNodes;
    if (statusFilter) {
      filtered = allNodes.filter((n) => n.status === statusFilter);
    }

    return this._sendJson(res, 200, this._paginate(filtered, params));
  }

  /** GET /api/v1/nodes/:id → 单节点详情 */
  private _handleGetNodeById(nodeId: string, res: ServerResponse): boolean {
    const allNodes = this.taskBoard.getAllNodes();
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) {
      return this._sendProblem(res, {
        type: "https://cortex.dev/errors/not-found",
        title: "Node Not Found",
        status: 404,
        detail: `No task node with id '${nodeId}' exists.`,
      });
    }
    return this._sendJson(res, 200, { data: node });
  }

  /** GET /api/v1/agents → AgentPool 全量状态 */
  private _handleGetAgents(res: ServerResponse): boolean {
    const agentTypes = Object.values(AgentTypeEnum).filter(
      (v): v is AgentType => typeof v === "string",
    ) as AgentType[];
    const result: Record<string, unknown> = {};

    for (const agentType of agentTypes) {
      const statuses = this.agentPool.getStatuses(agentType as AgentType);
      result[agentType] = statuses;
    }

    return this._sendJson(res, 200, { data: result });
  }

  /** GET /api/v1/agents/:type → 按类型查询 Agent 状态 */
  private _handleGetAgentByType(agentType: string, res: ServerResponse): boolean {
    const validTypes = Object.values(AgentTypeEnum) as string[];
    if (!validTypes.includes(agentType)) {
      return this._sendProblem(res, {
        type: "https://cortex.dev/errors/not-found",
        title: "Agent Type Not Found",
        status: 404,
        detail: `Unknown agent type '${agentType}'. Valid types: ${validTypes.join(", ")}`,
      });
    }
    const statuses = this.agentPool.getStatuses(agentType as AgentType);
    return this._sendJson(res, 200, { data: { agentType, statuses } });
  }

  /** GET /api/v1/health → 健康快照 */
  private _handleGetHealth(res: ServerResponse): boolean {
    const snapshot: HealthSnapshot = this.healthCollector.snapshot();
    return this._sendJson(res, 200, { data: snapshot });
  }

  /** POST /api/v1/execute → 触发执行（含请求体校验） */
  private _handleExecute(req: IncomingMessage, res: ServerResponse): boolean {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // 请求体大小限制：1MB
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        req.destroy();
        if (!res.headersSent) {
          this._sendProblem(res, {
            type: "https://cortex.dev/errors/payload-too-large",
            title: "Payload Too Large",
            status: 413,
            detail: "Request body exceeds 1MB limit.",
          });
        }
      }
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      this._handleExecuteAsync(res, body).catch((err) => {
        if (!res.headersSent) {
          this._sendProblem(res, {
            type: "https://cortex.dev/errors/internal",
            title: "Internal Server Error",
            status: 500,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      });
    });
    req.on("error", (err) => {
      if (!res.headersSent) {
        this._sendProblem(res, {
          type: "https://cortex.dev/errors/bad-request",
          title: "Bad Request",
          status: 400,
          detail: `Failed to read request body: ${err.message}`,
        });
      }
    });
    return true;
  }

  private async _handleExecuteAsync(res: ServerResponse, body: string): Promise<void> {
    // 请求体校验
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body || "{}") as Record<string, unknown>;
    } catch {
      this._sendProblem(res, {
        type: "https://cortex.dev/errors/bad-request",
        title: "Invalid JSON",
        status: 400,
        detail: "Request body must be valid JSON.",
        errors: [{ field: "body", message: "Invalid JSON syntax" }],
      });
      return;
    }

    // 字段校验：input 必须为非空字符串
    const input = payload.input;
    if (typeof input !== "string" || input.trim().length === 0) {
      this._sendProblem(res, {
        type: "https://cortex.dev/errors/validation",
        title: "Validation Error",
        status: 422,
        detail: "Field 'input' is required and must be a non-empty string.",
        errors: [{ field: "input", message: "Required: non-empty string" }],
      });
      return;
    }

    const result = await this.engineBridge.executeToolCall("execute", { input });
    this._sendJson(res, 200, { data: result });
  }

  /** GET /api/v1/events → 最近事件（分页 + 类型过滤） */
  private _handleRecentEvents(url: URL, res: ServerResponse): boolean {
    const params = this._parsePagination(url);

    // 支持类型过滤 ?type=node.start
    const typeFilter = url.searchParams.get("type");
    let filtered = this.recentEvents;
    if (typeFilter) {
      filtered = this.recentEvents.filter((e) => e.type.startsWith(typeFilter));
    }

    return this._sendJson(res, 200, this._paginate(filtered, params));
  }
}
