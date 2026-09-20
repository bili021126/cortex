/**
 * @cortex/cli — daemon-client
 *
 * CLI 熔炼（daemon-first）共享 HTTP 客户端：命令优先直连 daemon REST，
 * 不可达 / 非 2xx / 解析失败 → 返回 null，由调用方回落本地 EngineBridge。
 * 统一超时与错误吞掉策略，避免每个命令各写一份 fetch+try/catch。
 */

const DAEMON_BASE = process.env["CORTEX_DAEMON_URL"] ?? "http://127.0.0.1:3210";

export interface DaemonRequestInit {
  method?: "GET" | "POST" | "DELETE" | "PUT";
  body?: string;
  timeoutMs?: number;
}

/** 请求 daemon 并解析 JSON；任何失败（不可达/非2xx/坏 JSON）→ null（触发调用方本地回落）。 */
export async function daemonFetchJson<T = unknown>(
  path: string,
  init: DaemonRequestInit = {},
): Promise<T | null> {
  try {
    const res = await fetch(DAEMON_BASE + path, {
      method: init.method ?? "GET",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 4000),
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as T | null;
  } catch {
    return null;
  }
}
