// @ci: unit
// ============================================================
// @cortex/server — HTTP 面安全约束守护（2026-09-26 新增）
//
// 守护背景：本 daemon 的 HTTP 面包含 `POST /api/v1/execute`，
// 它把请求体的 `input` 直接交给 `toolkit.execute({toolName:"execute"})`
// ——即任意代码执行。而它此前：
//   · 无条件下发 `Access-Control-Allow-Origin: *`
//   · 为**任意来源**回 `OPTIONS` 预检 204
// 两者叠加 = **驱动式 RCE**：用户开着 daemon 时访问任意网页，
// 该页即可预检通过并提交执行请求。HTTP 侧也没有任何鉴权
// （对比 WS 侧早在 R12-P0-3 就有令牌）。
//
// 本测试用**真实 http.Server**发真实请求，而不是只测纯函数——
// 只测纯函数证明不了「处理器真的调了它」。
// ============================================================

import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { createRequire } from "node:module";
import { applyRequestSecurity } from "../src/daemon.js";

const require_ = createRequire(import.meta.url);
void require_;

/** 起一个真实 http.Server，处理器只做安全校验 + 200 应答 */
async function withServer(
  boundToLoopback: boolean,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    if (!applyRequestSecurity(req, res, boundToLoopback, "req-test")) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** 发原始请求并取回状态码与感兴趣的响应头 */
async function raw(
  base: string,
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const url = new URL(path, base);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const servers: (() => void)[] = [];
afterEach(() => {
  servers.length = 0;
});

describe("HTTP 安全头 —— 不再对任意来源放行", () => {
  it("**不**下发 Access-Control-Allow-Origin: *（回归守护）", async () => {
    await withServer(true, async (base) => {
      const r = await raw(base, "/api/v1/health", {
        origin: "https://evil.example",
        host: "127.0.0.1",
      });
      expect(r.headers["access-control-allow-origin"]).not.toBe("*");
    });
  });

  it("恶意来源不下发 ACAO（跨源读取与预检随即被浏览器拦下）", async () => {
    await withServer(true, async (base) => {
      const r = await raw(base, "/api/v1/health", {
        origin: "https://evil.example",
        host: "127.0.0.1",
      });
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  it("本机来源回显自身（为将来的本地 WebUI 留路）", async () => {
    await withServer(true, async (base) => {
      const r = await raw(base, "/api/v1/health", {
        origin: "http://127.0.0.1:5173",
        host: "127.0.0.1",
      });
      expect(r.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
      expect(r.headers["vary"]).toBe("Origin");
    });
  });

  it("恶意来源的 OPTIONS 预检拿不到 ACAO —— 驱动式 RCE 路径被切断", async () => {
    await withServer(true, async (base) => {
      const r = await raw(
        base,
        "/api/v1/execute",
        {
          origin: "https://evil.example",
          host: "127.0.0.1",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
        "OPTIONS",
      );
      // 预检拿到 204 但没有 ACAO —— 浏览器判定预检失败
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  it("无 Origin 头（Node 客户端）不受影响，仍正常应答", async () => {
    await withServer(true, async (base) => {
      const r = await raw(base, "/api/v1/health", { host: "127.0.0.1" });
      expect(r.status).toBe(200);
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    });
  });
});

describe("Host 头校验 —— 挡 DNS rebinding", () => {
  it("绑定 loopback 时，非本机 Host 被 403 拒绝", async () => {
    await withServer(true, async (base) => {
      const r = await raw(base, "/api/v1/health", { host: "evil.example" });
      expect(r.status).toBe(403);
      expect(r.body).toContain("Forbidden Host");
    });
  });

  it.each(["127.0.0.1", "127.0.0.1:3210", "localhost", "localhost:3210", "[::1]:3210"])(
    "绑定 loopback 时，本机 Host 被接受: %s",
    async (host) => {
      await withServer(true, async (base) => {
        const r = await raw(base, "/api/v1/health", { host });
        expect(r.status).toBe(200);
      });
    },
  );

  it("绑定非 loopback 时不校验 Host（合法域名无法预知，由启动告警兜底）", async () => {
    await withServer(false, async (base) => {
      const r = await raw(base, "/api/v1/health", { host: "cortex.internal" });
      expect(r.status).toBe(200);
    });
  });
});
