// @ci: unit
// ============================================================
// @cortex/server —— 请求体上限 413 守护
//
// 背景（2026-09-26）：readBody 早有 1 MB 上限，但超限时只抛
// `new Error("Payload too large")`，而各调用方把它当成 JSON 解析失败
// 或内部错误处理——于是超限请求返回 500/400，与 PACKAGE_POSITIONING.md
// 声明的「413 体积限制」不符。**有上限、状态码错。**
//
// 现在 readBody(req, res) 在超限时直接回 413（RFC 7807 problem+json）。
//
// 本测试用**真实 http.Server** 发真实大请求，而不是只单测 readBody ——
// 因为要验的正是「真实 socket 上响应能不能发出去」：超限路径里有
// req.destroy()，若销毁早于响应刷出，客户端就收不到 413。
// 这是只有真连接才暴露得出来的事。
// ============================================================

import { describe, it, expect } from "vitest";
import * as http from "node:http";
import { readBody, MAX_BODY_BYTES, DRAIN_LIMIT_BYTES } from "../src/http/router.js";

/**
 * 起一个真实 http.Server：处理器按真实 handler 的形状写——
 * readBody 成功回 200，失败则按各 handler catch 的既有写法回 500
 * （readBody 已在超限时自行回了 413，后续写入应被 headersSent 守卫吃掉）。
 */
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req, res);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ length: raw.length }));
    })().catch(() => {
      // 与真实 handler 的 catch 同形：sendProblem/sendJson 都有 headersSent 守卫，
      // 所以超限时（readBody 已回过 413）这里不该再写响应。
      if (res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Error" }));
    });
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

interface Probe {
  status: number;
  contentType: string;
  body: string;
  socketError: string | null;
}

/**
 * 发一个 POST 并取回响应。
 *
 * 超限路径服务端会 destroy 请求——客户端可能在收到响应之后才看到 socket 错误，
 * 所以「已收到响应」优先：一旦 resolve 就不再被后续 error 覆盖。
 */
function post(base: string, body: string): Promise<Probe> {
  const url = new URL("/api/v1/probe", base);
  return new Promise((resolve) => {
    let settled = false;
    const done = (p: Probe): void => {
      if (settled) return;
      settled = true;
      resolve(p);
    };
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            contentType: String(res.headers["content-type"] ?? ""),
            body: text,
            socketError: null,
          }),
        );
        res.on("error", (err) =>
          done({ status: res.statusCode ?? 0, contentType: "", body: text, socketError: String(err) }),
        );
      },
    );
    req.on("error", (err) => done({ status: 0, contentType: "", body: "", socketError: String(err) }));
    req.end(body);
  });
}

describe("请求体上限 —— 超限回 413（RFC 7807）", () => {
  it("超过 1 MB 的请求体返回 413 + application/problem+json", async () => {
    await withServer(async (base) => {
      const oversize = "x".repeat(MAX_BODY_BYTES + 64 * 1024);
      const r = await post(base, oversize);

      expect(r.status, `未收到 413，而是 ${r.status}（socketError=${r.socketError ?? "无"}）`).toBe(413);
      expect(r.contentType).toContain("application/problem+json");
      const parsed = JSON.parse(r.body) as { title?: string; status?: number };
      expect(parsed.title).toBe("Payload Too Large");
      expect(parsed.status).toBe(413);
    });
  });

  it("上限之内的请求体正常 200（对照，证明不是一律拒绝）", async () => {
    await withServer(async (base) => {
      const r = await post(base, JSON.stringify({ hello: "world" }));
      expect(r.status).toBe(200);
      expect(r.body).toContain('"length"');
    });
  });

  it("恰好等于上限的请求体放行（边界不在上限本身）", async () => {
    await withServer(async (base) => {
      const exact = "y".repeat(MAX_BODY_BYTES);
      const r = await post(base, exact);
      expect(r.status).toBe(200);
    });
  });

  it("远超丢弃上限的上传不会把连接拖住（有界资源）", async () => {
    await withServer(async (base) => {
      const huge = "z".repeat(DRAIN_LIMIT_BYTES + 2 * MAX_BODY_BYTES);
      const started = Date.now();
      const r = await post(base, huge);
      const elapsed = Date.now() - started;

      // 关键断言是「有结果」而非某个具体状态：超过 DRAIN_LIMIT 后服务端会主动断开，
      // 而 413 早在超过 MAX_BODY 时就已经发出——客户端是先读到响应还是先看到
      // 连接被断，取决于时序。这里只钉两件确定的事：
      //   ① 不挂起（有界资源的意义所在）；
      //   ② 若收到了状态码，必须是 413，不能是别的。
      expect(r.status === 413 || r.socketError !== null, `未收到 413 也无连接错误：status=${r.status}`).toBe(true);
      if (r.status !== 0) {
        expect(r.status).toBe(413);
      }
      expect(elapsed, `耗时 ${elapsed}ms，疑似被超大上传拖住`).toBeLessThan(5000);
    });
  });
});
