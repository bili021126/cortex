/**
 * tui/web/index.ts — 统一入口
 *
 * 导出 startWebUI / stopWebUI 供 @cortex/cli 或外部调用者使用。
 *
 * @module tui/web
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { IPipelineObserver, ITuiEngineBridge, ITaskBoard, IAgentPool } from "@cortex/shared";
import { PipelinePriority } from "@cortex/shared";
import type { TuiEventBus } from "../event-bus.js";
import type { ObservableEvent } from "@cortex/shared";
import type { PanoramaTracker, HealthCollector } from "@cortex/telemetry";
import { WSGateway } from "./gateway.js";
import { StateAggregator } from "./state-aggregator.js";
import { APIRouter } from "./api-router.js";

// ─── 获取 static 目录路径 ─────────────────────────

function getStaticDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  return path.resolve(currentDir, "static");
}

// ─── 创建静态文件服务 ─────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
function createStaticHandler(): (url: URL, res: import("http").ServerResponse) => boolean {
  const staticDir = getStaticDir();

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return (url: URL, res: import("http").ServerResponse): boolean => {
    // 只处理根路径和 /static/* 路径
    let filePath: string;
    if (url.pathname === "/" || url.pathname === "/index.html") {
      filePath = path.join(staticDir, "index.html");
    } else {
      // 支持 /static/ 前缀
      const relative = url.pathname.startsWith("/static/")
        ? url.pathname.slice("/static/".length)
        : null;
      if (relative === null) return false;
      filePath = path.join(staticDir, relative);
    }

    // 安全校验：确保解析后的路径在 staticDir 内
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(staticDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }

    try {
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        return false;
      }

      const ext = path.extname(resolved).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      };
      const contentType = mimeTypes[ext] ?? "application/octet-stream";
      const content = fs.readFileSync(resolved);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return true;
    } catch {
      return false;
    }
  };
}

// ─── startWebUI ───────────────────────────────────

export interface StartWebUIOptions {
  port?: number;
  observer: IPipelineObserver;
  tuiEventBus?: TuiEventBus;
  taskBoard: ITaskBoard;
  agentPool: IAgentPool;
  engineBridge?: ITuiEngineBridge;
  panoramaTracker?: PanoramaTracker;
  healthCollector?: HealthCollector;
}

export interface StartWebUIResult {
  gateway: WSGateway;
  stop: () => Promise<void>;
}

/**
 * 启动 WebUI 服务器（HTTP + WebSocket）。
 *
 * @param options 配置参数
 * @returns gateway 实例和 stop 函数
 */
export async function startWebUI(options: StartWebUIOptions): Promise<StartWebUIResult> {
  const envPort = process.env["CORTEX_WEBUI_PORT"];
  const port = options.port ?? (envPort ? parseInt(envPort, 10) : 3001);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }

  // ── 状态聚合层 ──
  const stateAggregator = new StateAggregator(
    options.taskBoard,
    options.agentPool,
    // Core-3: 泛型擦除——待接口泛型化
    options.panoramaTracker ?? null as unknown as PanoramaTracker,
    // Core-3: 泛型擦除——待接口泛型化
    options.healthCollector ?? null as unknown as HealthCollector,
  );

  // ── API 路由 ──
  const apiRouter = new APIRouter(
    stateAggregator,
    // Core-3: 泛型擦除——待接口泛型化
    options.engineBridge ?? null as unknown as ITuiEngineBridge,
    options.taskBoard,
    options.agentPool,
    // Core-3: 泛型擦除——待接口泛型化
    options.healthCollector ?? null as unknown as HealthCollector,
  );

  // ── 静态文件处理 ──
  const serveStatic = createStaticHandler();

  // ── WS Gateway ──
  const gateway = new WSGateway(port);

  // ── 桥接 PipelineObserver → WebSocket ──
  gateway.bridgeObserver(options.observer);

  // ── 桥接 TuiEventBus → WebSocket ──
  if (options.tuiEventBus) {
    gateway.bridgeTuiEvents(options.tuiEventBus);
  }

  // ── PipelineObserver → StateAggregator（增量更新） ──
  const pipelineHandler = (event: ObservableEvent): void => {
    stateAggregator.onPipelineEvent(event);
    apiRouter.recordEvent(event.type, event.payload);
    // PanoramaTracker 事件流喂入——消除生产实现零调用点（2026-06 全量审计修复）
    options.panoramaTracker?.onEvent(event);
  };
  options.observer.on(PipelinePriority.CRITICAL, pipelineHandler);
  options.observer.on(PipelinePriority.HIGH, pipelineHandler);
  options.observer.on(PipelinePriority.NORMAL, pipelineHandler);

  // ── 启动 ──
  await gateway.start();

  // ── StateAggregator → WebSocket（定时 + 事件驱动推送）──
  // 必须在 gateway.start() 之后注册，避免 subscribe 定时器在 WS 未就绪时触发 broadcast
  stateAggregator.subscribe((state) => {
    gateway.broadcast("state", state);
  });

  // ── 修改 HTTP 服务器：在 gateway 的 server 上注入静态和 API 处理 ──
  // gateway 内部创建 http.Server，start() 后 server 才可用。
  // WSGateway 的 http.createServer 回调只处理 WS 升级。
  // 我们需要让 http server 同时处理 WS 升级 + HTTP API + 静态文件。
  //
  // 方案：start 后补一个 request listener（通过 server.on("request", ...)）
  if (gateway.server) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    gateway.server.on("request", (req: import("http").IncomingMessage, res: import("http").ServerResponse) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      // WebSocket 升级请求由 gateway 的 'upgrade' 事件处理，此处跳过
      if (req.headers.upgrade?.toLowerCase() === "websocket") {
        return;
      }

      // CORS 预检
      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }

      // 先尝试 API 路由
      if (apiRouter.handle(req, res)) return;

      // 再尝试静态文件
      if (serveStatic(url, res)) return;

      // 404
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });
  }

  // ── 构造 stop ──
  const stop = async (): Promise<void> => {
    options.observer.off(PipelinePriority.CRITICAL, pipelineHandler);
    options.observer.off(PipelinePriority.HIGH, pipelineHandler);
    options.observer.off(PipelinePriority.NORMAL, pipelineHandler);
    stateAggregator.dispose();
    await gateway.stop();
  };

  return { gateway, stop };
}