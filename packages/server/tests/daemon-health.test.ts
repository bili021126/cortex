// @ci: unit
/**
 * @cortex/server — daemon 健康端点守护测试
 *
 * S1-5 守护：GET /api/v1/daemon/health 必须返回健康采集器的真实快照
 * （totalDegradations 非恒 0），engineReady 用真实存在性判断，
 * 禁止回退到硬编码零 + 恒 true。
 */

import { describe, it, expect, vi } from "vitest";
import { HttpRouter } from "../src/http/router.js";
import { SessionManager } from "../src/session-manager.js";
import type { EngineHost } from "../src/engine-host.js";
import type { ChatExecutor } from "../src/chat-executor.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/** 构造最小可路由请求 */
function makeRequest(path: string): IncomingMessage {
  return {
    url: path,
    method: "GET",
    headers: { host: "localhost" },
  } as unknown as IncomingMessage;
}

/** 收集 sendJson 输出的 mock 响应 */
function makeResponse(): { res: ServerResponse; body: () => unknown } {
  const chunks: string[] = [];
  const res = {
    headersSent: false,
    writeHead: vi.fn(),
    end: vi.fn((chunk: string) => {
      chunks.push(chunk);
    }),
  } as unknown as ServerResponse;
  return {
    res,
    body: () => JSON.parse(chunks.join("")) as Record<string, unknown>,
  };
}

/** 构造 router（注入 fake engine——只提供 healthCollector 面） */
function makeRouter(engine: Partial<EngineHost>): HttpRouter {
  const sessionManager = new SessionManager();
  return new HttpRouter(
    engine as unknown as EngineHost,
    sessionManager,
    {} as unknown as ChatExecutor,
  );
}

describe("GET /api/v1/daemon/health", () => {
  it("返回健康采集器真实快照（totalDegradations 非恒 0）", () => {
    const snapshot = {
      timestamp: 1700000000000,
      totalDegradations: 3,
      bySource: { engine: 2, scheduler: 1 },
      byLevel: { L2: 3 },
      recentSources: ["engine", "scheduler"],
      degradedSince: 1699999999000,
    };
    const { res, body } = makeResponse();
    const router = makeRouter({
      healthCollector: { snapshot: () => snapshot } as unknown as EngineHost["healthCollector"],
    });

    const matched = router.handle(makeRequest("/api/v1/daemon/health"), res);

    expect(matched).toBe(true);
    const data = body().data as Record<string, unknown>;
    expect(data.totalDegradations).toBe(3);
    expect(data.bySource).toEqual({ engine: 2, scheduler: 1 });
    expect(data.degradedSince).toBe(1699999999000);
  });

  it("engineReady 反映 healthCollector 真实存在性（存在 → true）", () => {
    const { res, body } = makeResponse();
    const router = makeRouter({
      healthCollector: { snapshot: () => ({}) } as unknown as EngineHost["healthCollector"],
    });

    router.handle(makeRequest("/api/v1/daemon/health"), res);

    const data = body().data as { daemon: Record<string, unknown> };
    expect(data.daemon.engineReady).toBe(true);
    expect(data.daemon.pid).toBe(process.pid);
  });

  it("engineReady 反映 healthCollector 真实存在性（缺失 → false）", () => {
    const { res, body } = makeResponse();
    // 不提供 healthCollector——snapshot 走降级零值，但 engineReady 必须为 false
    const router = makeRouter({});

    router.handle(makeRequest("/api/v1/daemon/health"), res);

    const data = body().data as { daemon: Record<string, unknown> };
    expect(data.daemon.engineReady).toBe(false);
    expect(data.totalDegradations).toBe(0); // 降级快照为零值，但 daemon 存在性不再伪装
  });

  it("daemon 段包含 pid/uptimeMs/activeSessions", () => {
    const { res, body } = makeResponse();
    const router = makeRouter({
      healthCollector: { snapshot: () => ({}) } as unknown as EngineHost["healthCollector"],
    });

    router.handle(makeRequest("/api/v1/daemon/health"), res);

    const data = body().data as { daemon: Record<string, unknown> };
    expect(data.daemon.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(data.daemon.activeSessions).toBe(0);
    expect(data.daemon.version).toBeDefined();
  });
});
