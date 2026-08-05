/**
 * @cortex/server — CortexDaemon
 *
 * Top-level daemon orchestrator. Manages engine lifecycle, HTTP/WS servers,
 * session management, and graceful shutdown.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { EngineHost } from "./engine-host.js";
import { SessionManager } from "./session-manager.js";
import { ChatExecutor } from "./chat-executor.js";
import { RemoteGateBridge } from "./gate-bridge.js";
import { WSGateway } from "./ws/gateway.js";
import { handleChatCommand } from "./ws/chat-channel.js";
import { handleGateCommand } from "./ws/gate-channel.js";
import { HttpRouter } from "./http/router.js";
import { StateAggregator } from "./http/state-handler.js";
import { PROTOCOL_VERSION, isWSClientCommand } from "@cortex/protocol";
import type { Socket } from "node:net";
import type {
  WSSystemShutdownEvent,
  WSDaemonStatusEvent,
  WSConfigEvent,
  WSSystemErrorEvent,
} from "@cortex/protocol";
import { PipelinePriority } from "@cortex/shared";
import type { ObservableEvent } from "@cortex/shared";
import { bridgeNotifications, handleNotificationAck } from "./notification-bridge.js";

/** Daemon configuration options */
export interface DaemonOptions {
  port?: number;
  host?: string;
  projectRoot: string;
  workspaceRoot?: string;
}

const PID_FILE_NAME = ".cortex-daemon.pid";

/** system.status 心跳间隔（ms） */
const STATUS_HEARTBEAT_MS = 5000;

export class CortexDaemon {
  private readonly options: Required<Pick<DaemonOptions, "port" | "host">> & DaemonOptions;
  private engine: EngineHost | null = null;
  private sessionManager: SessionManager | null = null;
  private chatExecutor: ChatExecutor | null = null;
  private gateBridge: RemoteGateBridge | null = null;
  private wsGateway: WSGateway | null = null;
  private httpServer: http.Server | null = null;
  private stateAggregator: StateAggregator | null = null;
  private startedAt = 0;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  /** S2-11: 通知→WS 桥接的解除订阅函数（stop 时调用防泄漏） */
  private _unbridgeNotifications: (() => void) | null = null;
  /** R11-25：observer 三个优先级处理器的卸载函数（stop 时移除防泄漏/重复累积） */
  private _unregisterObservers: (() => void) | null = null;

  constructor(options: DaemonOptions) {
    this.options = {
      port: 3210,
      host: "127.0.0.1",
      ...options,
    };
  }

  async start(): Promise<void> {
    const pidPath = this.pidFilePath();

    // Check for stale PID file
    if (fs.existsSync(pidPath)) {
      const existingPid = fs.readFileSync(pidPath, "utf-8").trim();
      if (existingPid && this.isProcessAlive(Number(existingPid))) {
        throw new Error(
          `[cortex-daemon] another daemon is already running (PID ${existingPid}). ` +
          `Remove ${pidPath} if stale.`,
        );
      }
      // Stale PID file — remove it
      fs.unlinkSync(pidPath);
    }

    // Bootstrap engine
    this.engine = await EngineHost.create({
      projectRoot: this.options.projectRoot,
      workspaceRoot: this.options.workspaceRoot,
    });

    // Create session manager + chat executor + gate bridge
    this.sessionManager = new SessionManager();
    this.gateBridge = new RemoteGateBridge((channel, data) => {
      this.wsGateway?.broadcast(channel, data);
    });
    this.chatExecutor = new ChatExecutor(this.engine, this.gateBridge);

    // Wire gate bridge into ConfirmGate
    const gate = this.engine.gate;
    if (gate && typeof gate.setBridge === "function") {
      gate.setBridge(this.gateBridge);
    }

    // State aggregator
    this.stateAggregator = new StateAggregator(
      this.engine.board,
      this.engine.pool,
      this.engine.healthCollector,
    );

    // Bridge pipeline observer events → WS + state aggregator
    const observer = this.engine.observer;
    if (observer) {
      const handler = (event: ObservableEvent): void => {
        this.wsGateway?.broadcast("pipeline", {
          type: event.type,
          priority: event.priority,
          payload: event.payload,
          timestamp: event.timestamp,
          requestId: event.requestId,
          notificationType: event.notificationType,
        });
        this.stateAggregator?.onPipelineEvent(event);
      };
      observer.on(PipelinePriority.CRITICAL, handler);
      observer.on(PipelinePriority.HIGH, handler);
      observer.on(PipelinePriority.NORMAL, handler);
      // R11-25：保留三个优先级处理器的卸载函数——stop 时移除（此前仅解除通知桥，处理器闭包保留已 dispose 对象，重启累积重复处理器）
      this._unregisterObservers = () => {
        observer.off(PipelinePriority.CRITICAL, handler);
        observer.off(PipelinePriority.HIGH, handler);
        observer.off(PipelinePriority.NORMAL, handler);
      };
    }

    // S2-11: 通知消费端接线——Urgent/Important 通道通知经 WS 推送（落地可查）
    const pipe = this.engine.notificationPipe;
    if (pipe) {
      this._unbridgeNotifications = bridgeNotifications(pipe, (channel, data) => {
        this.wsGateway?.broadcast(channel, data);
      });
    }

    // Create WS gateway
    // R12-P0-3：WS 连接令牌——env 未配置时随机生成（stderr 提示）——desktop 需经 IPC/env 同步后携带
    const wsToken = process.env["CORTEX_DAEMON_WS_TOKEN"] ?? crypto.randomUUID();
    if (!process.env["CORTEX_DAEMON_WS_TOKEN"]) {
      process.stderr.write(`[daemon] WS 鉴权令牌未配置——已随机生成（需同步给 desktop 客户端）: ${wsToken}\n`);
      // R13-N3：令牌写文件同步（desktop 启动后读取——env 未配置时也能连接）
      try { fs.writeFileSync(path.join(process.cwd(), ".cortex-daemon.ws-token"), wsToken, "utf-8"); } catch { /* 写令牌文件失败不阻断 */ }
    }
    this.wsGateway = new WSGateway({
      authToken: wsToken,
      onCommand: (connId, msg) => {
        this.handleWsCommand(connId, msg);
      },
    });

    // Create HTTP server with router
    const router = new HttpRouter(this.engine, this.sessionManager, this.chatExecutor, this.options.projectRoot);

    this.httpServer = new http.Server();

    // HTTP request handler
    this.httpServer.on("request", (req, res) => {
      const requestId = crypto.randomUUID();
      res.setHeader("X-Request-Id", requestId);
      res.setHeader("X-API-Version", PROTOCOL_VERSION);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const handled = router.handle(req, res);
      if (!handled) {
        res.writeHead(404, { "Content-Type": "application/problem+json" });
        res.end(JSON.stringify({
          type: "https://cortex.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: `No route for ${req.method} ${req.url}`,
          instance: requestId,
        }));
      }
    });

    // WS upgrade handler
    this.httpServer.on("upgrade", (req, socket, head) => {
      this.wsGateway?.handleUpgrade(req, socket as Socket, head);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      if (!this.httpServer) {
        reject(new Error("Daemon: httpServer not initialized"));
        return;
      }
      this.httpServer.listen(this.options.port, this.options.host, () => resolve());
    });

    // Write PID file
    fs.writeFileSync(pidPath, String(process.pid), "utf-8");

    // Start session GC
    this.sessionManager.startGC();

    // Start state heartbeat
    this.stateAggregator.subscribe((state) => {
      this.wsGateway?.broadcast("state", state);
    });

    this.startedAt = Date.now();

    // 首次状态快照 + 定期心跳
    this.broadcastStatus();
    this.statusTimer = setInterval(() => this.broadcastStatus(), STATUS_HEARTBEAT_MS);

    // 配置变更 → 广播 config.changed
    this.engine.onConfigChange((domain) => this.broadcastConfigChanged(domain));
  }

  async stop(): Promise<void> {
    // Stop status heartbeat
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }

    // Broadcast shutdown notification
    this.wsGateway?.broadcast("system", { type: "system.shutdown", reason: "daemon stopping" } satisfies WSSystemShutdownEvent["data"]);

    // Cancel all active chat sessions
    if (this.sessionManager) {
      for (const session of this.sessionManager.list()) {
        this.sessionManager.destroy(session.id);
      }
      this.sessionManager.stopGC();
    }

    // Cancel all gate pending requests
    this.gateBridge?.cancelAll();

    // Stop state aggregator
    this.stateAggregator?.dispose();

    // Shutdown engine
    if (this.engine) {
      await this.engine.shutdown();
      this.engine = null;
    }

    // S2-11: 解除通知→WS 订阅（防 handler 累积泄漏）
    this._unbridgeNotifications?.();
    this._unbridgeNotifications = null;

    // R11-25：移除三个 observer 优先级处理器（此前 stop 仅解除通知桥——处理器闭包保留已 dispose 对象，重启累积重复处理器）
    this._unregisterObservers?.();
    this._unregisterObservers = null;

    // Close WS gateway
    await this.wsGateway?.stop();
    this.wsGateway = null;

    // Close HTTP server
    if (this.httpServer) {
      const server = this.httpServer;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      this.httpServer = null;
    }

    // Remove PID file
    this.cleanupPidSync();
  }

  /**
   * Synchronously remove PID file (for Windows process.on("exit") handler).
   * Safe to call multiple times.
   */
  cleanupPidSync(): void {
    const pidPath = this.pidFilePath();
    try {
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  get uptime(): number {
    return this.startedAt > 0 ? Date.now() - this.startedAt : 0;
  }

  get activeSessions(): number {
    return this.sessionManager?.list().length ?? 0;
  }

  // ── Private ──────────────────────────────────────────

  /** 广播 daemon 状态快照（system.status） */
  private broadcastStatus(): void {
    if (!this.wsGateway) return;
    let chatModel = "unknown";
    let reasonerModel = "unknown";
    try {
      chatModel = this.engine?.llm.chatModel ?? "unknown";
      reasonerModel = this.engine?.llm.reasonerModel ?? "unknown";
    } catch {
      // 无可用 LLM 适配器——保持 "unknown"
    }
    this.wsGateway.broadcast("system", {
      type: "system.status",
      pid: process.pid,
      uptimeMs: this.uptime,
      version: PROTOCOL_VERSION,
      engineReady: this.engine != null,
      activeSessions: this.activeSessions,
      chatModel,
      reasonerModel,
      contextWindowUsed: 0,
    } satisfies WSDaemonStatusEvent["data"]);
  }

  /** 广播配置变更通知（config.changed） */
  private broadcastConfigChanged(domain: string, key?: string): void {
    this.wsGateway?.broadcast("config", {
      type: "config.changed",
      domain,
      key,
      timestamp: Date.now(),
    } satisfies WSConfigEvent["data"]);
  }

  private handleWsCommand(connId: string, msg: unknown): void {
    // A2：入站校验——isWSClientCommand 结构性守卫替换类型断言。
    // 非法命令不再静默：回 system.error 错误帧 + console.warn（可观测链路）。
    if (!isWSClientCommand(msg)) {
      const rawType = (() => {
        if (typeof msg === "object" && msg !== null) {
          return String((msg as { type?: unknown }).type ?? "(missing)");
        }
        return typeof msg;
      })();
      console.warn(`[daemon] 非法 WS 命令被拒: ${rawType}`);
      this.wsGateway?.sendTo(connId, "system", {
        type: "system.error",
        message: `非法 WS 命令被拒: ${rawType}`,
        reason: "isWSClientCommand 校验失败",
      } satisfies WSSystemErrorEvent["data"]);
      return;
    }
    const cmd = msg;

    switch (cmd.type) {
      case "chat.start":
      case "chat.cancel":
        if (this.sessionManager && this.chatExecutor) {
          handleChatCommand(cmd, this.sessionManager, this.chatExecutor, (channel, data) => {
            this.wsGateway?.sendTo(connId, channel, data);
          });
        }
        break;
      case "gate.resolve":
        // R12-P0-3：来源校验——只有订阅了 gate 频道的连接才能代批（防无鉴权代批 L2/L3）
        if (this.gateBridge) {
          if (this.wsGateway?.hasChannel(connId, "gate")) {
            handleGateCommand(cmd, this.gateBridge);
          } else {
            console.warn(`[daemon] 拒绝 gate.resolve——连接 ${connId} 未订阅 gate 频道（来源校验）`);
          }
        }
        break;
      case "notification.ack":
        // S2-12: ack 回路——客户端应答 urgent 通知，回执确认结果
        if (this.engine) {
          this.wsGateway?.sendTo(
            connId,
            "notification",
            handleNotificationAck(this.engine.notificationPipe, cmd.requestId, cmd.approved),
          );
        }
        break;
      default:
        // S1-6：未知 WS 命令不再静默——console.warn 经 console-bridge →
        // ErrorReported → 哨兵/通知链路，保证可观测
        console.warn(
          `[daemon] 未知 WS 命令类型: ${String((cmd as { type?: unknown }).type ?? "(missing)")}`,
        );
        break;
    }
  }

  private pidFilePath(): string {
    return path.join(this.options.projectRoot, PID_FILE_NAME);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
