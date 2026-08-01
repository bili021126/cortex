// @ci: unit
/**
 * @cortex/client — HTTP 客户端守护测试（spec 阶段三 B5/B7）
 *
 * 守护事实：
 *   B7 deleteMemory：DELETE /api/v1/memory/:id（daemon 已有路由、protocol 已有类型）
 *   B5 超时：timeoutMs 配置 → fetch 收到组合 AbortSignal
 *   错误：非 2xx 抛 ProtocolError（RFC7807）
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CortexHttpClient } from "../src/http-client.js";
import { ProtocolError } from "../src/errors.js";

function makeClient(opts?: { timeoutMs?: number }): CortexHttpClient {
  return new CortexHttpClient({ baseUrl: "http://localhost:3210", timeoutMs: opts?.timeoutMs });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** mock global fetch，返回可控响应（json() 模拟真实行为：非 JSON 体抛 SyntaxError） */
function stubFetch(status: number, body: unknown, onCall?: (url: string, init: RequestInit) => void) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    onCall?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: async () => {
        if (typeof body === "string") throw new SyntaxError("Unexpected token I in JSON");
        return body;
      },
    } as Response;
  }));
}

describe("B7: deleteMemory", () => {
  it("调用 DELETE /api/v1/memory/:id", async () => {
    let captured: string | undefined;
    stubFetch(200, { deleted: true }, (url) => { captured = url; });
    await makeClient().deleteMemory("mem-1");
    expect(captured).toBe("http://localhost:3210/api/v1/memory/mem-1");
  });

  it("id 做 URL 编码", async () => {
    let captured: string | undefined;
    stubFetch(200, { deleted: true }, (url) => { captured = url; });
    await makeClient().deleteMemory("a/b c");
    expect(captured).toBe("http://localhost:3210/api/v1/memory/a%2Fb%20c");
  });
});

describe("B5: 超时与 AbortSignal", () => {
  it("配置 timeoutMs 时 fetch 收到 AbortSignal", async () => {
    let signal: AbortSignal | undefined;
    stubFetch(200, { data: {} }, (_url, init) => { signal = init.signal; });
    await makeClient({ timeoutMs: 5000 }).getHealth();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
  });

  it("未配置 timeoutMs 时 fetch 无 signal", async () => {
    let signal: AbortSignal | undefined;
    stubFetch(200, { data: {} }, (_url, init) => { signal = init.signal; });
    await makeClient().getHealth();
    expect(signal).toBeUndefined();
  });
});

describe("错误处理", () => {
  it("非 2xx 抛 ProtocolError（携带 ProblemDetails）", async () => {
    stubFetch(404, { type: "https://cortex.dev/errors/not-found", title: "Not Found", status: 404 });
    const err = await makeClient().getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProtocolError);
    const pe = err as ProtocolError;
    expect(pe.problem.status).toBe(404);
    expect(pe.problem.title).toBe("Not Found");
  });

  it("非 JSON 错误体回退兜底 ProblemDetails", async () => {
    stubFetch(500, "Internal Server Error");
    const err = await makeClient().getHealth().catch((e: unknown) => e) as ProtocolError;
    expect(err.problem.status).toBe(500);
  });
});
