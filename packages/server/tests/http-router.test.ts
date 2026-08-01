// @ci: unit
/**
 * @cortex/server — HTTP 路由形状守护测试（spec 阶段三 C2/C3/C4/C5）
 *
 * 守护事实：
 *   C2 POST /execute：daemon 补齐 execute（G10）——缺 input 422；成功 200 { data: { output } }
 *   C3 GET /agents：语义统一为 Record<string, string[]>（非 pool stats）
 *   C4 GET /nodes：分页形状 { data, pagination }
 *   C5 GET /capabilities：daemon 能力面声明
 */
import { describe, it, expect } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpRouter } from "../src/http/router.js";
import type { EngineHost } from "../src/engine-host.js";
import { SessionManager } from "../src/session-manager.js";
import type { ChatExecutor } from "../src/chat-executor.js";

/** 构造最小 mock EngineHost（router 仅用到 board/pool/healthCollector/toolkitInstance） */
function makeEngine(overrides: Record<string, unknown> = {}): EngineHost {
  const base = {
    board: {
      getAllNodes: () => [
        { id: "n1", type: "analysis", claimedBy: ["cyrene"], payload: "task-1", status: "done", parentId: null },
        { id: "n2", type: "code", claimedBy: [], payload: "task-2", status: "pending", parentId: "n1" },
        { id: "n3", type: "code", claimedBy: [], payload: "task-3", status: "running", parentId: null },
      ],
    },
    pool: {
      getStatuses: (type: string) => (type === "analysis" ? ["awake", "active"] : ["created"]),
    },
    healthCollector: { snapshot: () => ({ timestamp: 0, totalDegradations: 0, bySource: {}, byLevel: {}, recentSources: [], degradedSince: null }) },
    toolkitInstance: {
      execute: async ({ toolName, params }: { toolName: string; params: { input: string } }) =>
        toolName === "execute" ? { success: true, output: `ok:${params.input}` } : { success: false, error: "unknown" },
    },
  };
  return { ...base, ...overrides } as unknown as EngineHost;
}

function makeRouter(engine?: EngineHost): HttpRouter {
  return new HttpRouter(
    engine ?? makeEngine(),
    new SessionManager(),
    {} as unknown as ChatExecutor,
  );
}

/** 把 handle() 包成可直接断言的伪请求/响应 */
function call(
  router: HttpRouter,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: path,
      headers: { host: "localhost" },
      on: (ev: string, cb: (chunk?: Buffer) => void) => {
        if (ev === "data" && body !== undefined) cb(Buffer.from(JSON.stringify(body), "utf-8"));
        if (ev === "end") cb();
      },
    } as unknown as IncomingMessage;

    const chunks: Buffer[] = [];
    const res = {
      writeHead: (status: number) => { res.statusCode = status; },
      statusCode: 0,
      end: (chunk?: unknown) => {
        if (chunk) chunks.push(Buffer.from(String(chunk)));
        try {
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf-8")) });
        } catch {
          reject(new Error("响应非 JSON"));
        }
      },
      headersSent: false,
    } as unknown as ServerResponse & { statusCode: number };

    const matched = router.handle(req, res);
    if (!matched) resolve({ status: 404, json: {} });
  });
}

describe("C2: POST /api/v1/execute（daemon 补齐）", () => {
  it("合法 input 返回 200 { data: { output } }", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/api/v1/execute", { input: "hello" });
    expect(r.status).toBe(200);
    expect((r.json as { data: { output: string } }).data.output).toBe("ok:hello");
  });

  it("缺 input 返回 422", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/api/v1/execute", {});
    expect(r.status).toBe(422);
  });

  it("input 非字符串返回 422", async () => {
    const router = makeRouter();
    const r = await call(router, "POST", "/api/v1/execute", { input: 42 });
    expect(r.status).toBe(422);
  });
});

describe("C3: GET /api/v1/agents（语义统一）", () => {
  it("返回 Record<string, string[]>（非 pool stats）", async () => {
    const router = makeRouter();
    const r = await call(router, "GET", "/api/v1/agents");
    expect(r.status).toBe(200);
    const data = (r.json as { data: Record<string, string[]> }).data;
    expect(data.analysis).toEqual(["awake", "active"]);
    expect(data.code).toEqual(["created"]);
  });
});

describe("C4: GET /api/v1/nodes（分页形状对齐）", () => {
  it("返回 { data, pagination } 结构", async () => {
    const router = makeRouter();
    const r = await call(router, "GET", "/api/v1/nodes");
    expect(r.status).toBe(200);
    const body = r.json as { data: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 3, totalPages: 1 });
  });

  it("page/limit 参数生效", async () => {
    const router = makeRouter();
    const r = await call(router, "GET", "/api/v1/nodes?page=2&limit=1");
    const body = r.json as { data: unknown[]; pagination: { page: number; total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.total).toBe(3);
  });
});

describe("C5: GET /api/v1/capabilities（能力发现）", () => {
  it("daemon 能力面：通用 + daemon 专化，events/config 为 false", async () => {
    const router = makeRouter();
    const r = await call(router, "GET", "/api/v1/capabilities");
    expect(r.status).toBe(200);
    const caps = (r.json as { data: { server: string; api: Record<string, boolean>; wsChannels: string[] } }).data;
    expect(caps.server).toBe("daemon");
    expect(caps.api.chat).toBe(true);
    expect(caps.api.execute).toBe(true);
    expect(caps.api.events).toBe(false);
    expect(caps.api.config).toBe(false);
    expect(caps.wsChannels).toContain("notification");
  });

  it("未匹配路由返回 false（调用方得 404）", async () => {
    const router = makeRouter();
    const r = await call(router, "GET", "/api/v1/not-exist");
    expect(r.status).toBe(404);
  });
});
