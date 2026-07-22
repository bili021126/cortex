/**
 * tui/web/config-api-handler.ts — Config REST API 处理器
 *
 * 处理配置管理面的 CRUD 端点：
 *   /models, /agents, /keys, /tuning, /config/validate, /config/version
 *
 * 设计原则：
 *   - 所有写操作通过 ConfigStore（内置 schema 校验，校验失败 → 422）
 *   - 密钥永远不以明文返回（只返回 envVar 名称 + masked 标记）
 *   - 错误统一用 RFC 7807 ProblemDetails 格式
 *   - 不匹配的路径返回 false，交回 APIRouter 继续路由
 *
 * @module tui/web/config-api-handler
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ModelStore,
  KeyStore,
  AgentManifestStore,
  TuningStore,
} from "@cortex/config";
import { validateSafe, CONFIG_DOMAINS } from "@cortex/config";
import type {
  ProblemDetails,
  CreateModelRequest,
  CreateKeyRequest,
  PatchTuningRequest,
  ConfigValidateRequest,
} from "@cortex/protocol";
import { PROTOCOL_VERSION } from "@cortex/protocol";

// ─── ConfigAPIHandler ────────────────────────────────

export class ConfigAPIHandler {
  constructor(
    private readonly modelStore: ModelStore,
    private readonly keyStore: KeyStore,
    private readonly agentStore: AgentManifestStore,
    private readonly tuningStore: TuningStore,
  ) {}

  /**
   * 尝试处理请求。匹配则处理并返回 true，否则返回 false。
   * 注意：调用前 path 已去除 /api/v1 或 /api 前缀。
   */
  handle(path: string, method: string, req: IncomingMessage, res: ServerResponse): boolean {
    try {
      // ── /models ──
      if (path === "/models") {
        if (method === "GET") return this._listModels(res);
        if (method === "POST") return this._awaitBody(req, (body) => this._createModel(body, res));
        return this._methodNotAllowed(res, "GET, POST");
      }

      const modelMatch = path.match(/^\/models\/([^/]+)$/);
      if (modelMatch) {
        const id = decodeURIComponent(modelMatch[1] ?? "");
        if (method === "PATCH") return this._awaitBody(req, (body) => this._patchModel(id, body, res));
        if (method === "DELETE") return this._deleteModel(id, res);
        return this._methodNotAllowed(res, "PATCH, DELETE");
      }

      // ── /agents ──
      if (path === "/agents") {
        if (method === "GET") return this._listAgents(res);
        return this._methodNotAllowed(res, "GET");
      }

      const agentMatch = path.match(/^\/agents\/([^/]+)$/);
      if (agentMatch) {
        const id = decodeURIComponent(agentMatch[1] ?? "");
        if (method === "PATCH") return this._awaitBody(req, (body) => this._patchAgent(id, body, res));
        return this._methodNotAllowed(res, "PATCH");
      }

      // ── /keys ──
      if (path === "/keys") {
        if (method === "GET") return this._listKeys(res);
        if (method === "POST") return this._awaitBody(req, (body) => this._createKey(body, res));
        return this._methodNotAllowed(res, "GET, POST");
      }

      const keyMatch = path.match(/^\/keys\/([^/]+)$/);
      if (keyMatch) {
        const id = decodeURIComponent(keyMatch[1] ?? "");
        if (method === "DELETE") return this._deleteKey(id, res);
        return this._methodNotAllowed(res, "DELETE");
      }

      // ── /tuning ──
      if (path === "/tuning") {
        if (method === "GET") return this._getTuning(res);
        if (method === "PATCH") return this._awaitBody(req, (body) => this._patchTuning(body, res));
        return this._methodNotAllowed(res, "GET, PATCH");
      }

      // ── /config/validate ──
      if (path === "/config/validate") {
        if (method === "POST") return this._awaitBody(req, (body) => this._validateConfig(body, res));
        return this._methodNotAllowed(res, "POST");
      }

      // ── /config/version ──
      if (path === "/config/version") {
        if (method === "GET") return this._configVersion(res);
        return this._methodNotAllowed(res, "GET");
      }

      return false;
    } catch (err) {
      this._sendProblem(res, {
        type: "https://cortex.dev/errors/internal",
        title: "Internal Server Error",
        status: 500,
        detail: err instanceof Error ? err.message : "Config API error",
      });
      return true;
    }
  }

  // ─── Models ────────────────────────────────────────

  private _listModels(res: ServerResponse): boolean {
    const models = this.modelStore.listModels();
    return this._sendJson(res, 200, { data: models });
  }

  private _createModel(body: unknown, res: ServerResponse): boolean {
    const req = body as CreateModelRequest;
    if (!req.key || typeof req.key !== "string") {
      return this._validationError(res, "key", "Required: non-empty string");
    }
    if (!req.entry || typeof req.entry !== "object") {
      return this._validationError(res, "entry", "Required: model entry object");
    }
    try {
      this.modelStore.addModel(req.key, req.entry as never);
      return this._sendJson(res, 201, { data: { key: req.key } });
    } catch (err) {
      return this._conflict(res, err);
    }
  }

  private _patchModel(id: string, body: unknown, res: ServerResponse): boolean {
    try {
      this.modelStore.updateModel(id, body as Partial<Record<string, unknown>> as never);
      return this._sendJson(res, 200, { data: this.modelStore.getModel(id) });
    } catch (err) {
      return this._notFoundOrConflict(res, err);
    }
  }

  private _deleteModel(id: string, res: ServerResponse): boolean {
    try {
      this.modelStore.removeModel(id);
      res.writeHead(204);
      res.end();
      return true;
    } catch (err) {
      return this._notFoundOrConflict(res, err);
    }
  }

  // ─── Agents ────────────────────────────────────────

  private _listAgents(res: ServerResponse): boolean {
    const agents = this.agentStore.read();
    return this._sendJson(res, 200, { data: agents });
  }

  private _patchAgent(id: string, body: unknown, res: ServerResponse): boolean {
    try {
      // AgentManifestStore 使用 update() 做浅合并
      this.agentStore.update({ [id]: body } as never);
      return this._sendJson(res, 200, { data: this.agentStore.read() });
    } catch (err) {
      return this._notFoundOrConflict(res, err);
    }
  }

  // ─── Keys（脱敏） ──────────────────────────────────

  private _listKeys(res: ServerResponse): boolean {
    const raw = this.keyStore.read() as unknown as Record<string, unknown>;
    // 脱敏：只返回结构信息，不返回任何可能的密钥值
    const keys = raw.keys ?? raw;
    const masked = this._maskKeys(keys);
    return this._sendJson(res, 200, { data: masked });
  }

  private _createKey(body: unknown, res: ServerResponse): boolean {
    const req = body as CreateKeyRequest;
    if (!req.key || typeof req.key !== "string") {
      return this._validationError(res, "key", "Required: non-empty string");
    }
    try {
      const current = this.keyStore.read() as unknown as Record<string, unknown>;
      const keys = (current.keys ?? current) as Record<string, unknown>;
      keys[req.key] = req.entry;
      this.keyStore.write(current as never);
      return this._sendJson(res, 201, { data: { key: req.key } });
    } catch (err) {
      return this._conflict(res, err);
    }
  }

  private _deleteKey(id: string, res: ServerResponse): boolean {
    try {
      const current = this.keyStore.read() as unknown as Record<string, unknown>;
      const keys = (current.keys ?? current) as Record<string, unknown>;
      if (!keys[id]) {
        return this._sendProblem(res, {
          type: "https://cortex.dev/errors/not-found",
          title: "Key Not Found",
          status: 404,
          detail: `No key with id '${id}' exists.`,
        });
      }
      delete keys[id];
      this.keyStore.write(current as never);
      res.writeHead(204);
      res.end();
      return true;
    } catch (err) {
      return this._notFoundOrConflict(res, err);
    }
  }

  // ─── Tuning ────────────────────────────────────────

  private _getTuning(res: ServerResponse): boolean {
    const tuning = this.tuningStore.read();
    return this._sendJson(res, 200, { data: tuning });
  }

  private _patchTuning(body: unknown, res: ServerResponse): boolean {
    const req = body as PatchTuningRequest;
    try {
      if (req.path && req.value !== undefined) {
        // 点路径更新：如 "execution.reactMaxLoops" → 15
        const current = this.tuningStore.read() as unknown as Record<string, unknown>;
        const tuning = (current.tuning ?? current) as Record<string, Record<string, unknown>>;
        const [group, param] = req.path.split(".");
        if (group && param) {
          const g = tuning[group];
          if (g) g[param] = req.value;
        }
        this.tuningStore.write(current as never);
      } else if (req.group && req.params) {
        // 整组覆盖
        const current = this.tuningStore.read() as unknown as Record<string, unknown>;
        const tuning = (current.tuning ?? current) as Record<string, Record<string, unknown>>;
        tuning[req.group] = { ...tuning[req.group], ...req.params };
        this.tuningStore.write(current as never);
      } else {
        return this._validationError(res, "body", "Provide either {path, value} or {group, params}");
      }
      return this._sendJson(res, 200, { data: this.tuningStore.read() });
    } catch (err) {
      return this._notFoundOrConflict(res, err);
    }
  }

  // ─── Validate / Version ────────────────────────────

  private _validateConfig(body: unknown, res: ServerResponse): boolean {
    const req = body as ConfigValidateRequest;
    if (!req.domain || typeof req.domain !== "string") {
      return this._validationError(res, "domain", "Required: config domain name");
    }
    const result = validateSafe(req.domain, req.data);
    return this._sendJson(res, 200, {
      data: {
        ok: result.ok,
        errors: result.ok ? [] : (result.errors ?? []).map((e) => ({
          path: typeof e === "string" ? "" : (e as { path?: string }).path ?? "",
          message: typeof e === "string" ? e : (e as { message: string }).message,
        })),
      },
    });
  }

  private _configVersion(res: ServerResponse): boolean {
    return this._sendJson(res, 200, {
      data: {
        version: PROTOCOL_VERSION,
        domains: CONFIG_DOMAINS.map((d) => d.name),
      },
    });
  }

  // ─── 工具方法 ──────────────────────────────────────

  private _maskKeys(keys: unknown): Record<string, { label?: string; envVar?: string; masked: true }> {
    if (keys === null || typeof keys !== "object" || Array.isArray(keys)) return {};
    const result: Record<string, { label?: string; envVar?: string; masked: true }> = {};
    for (const [k, v] of Object.entries(keys as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        const entry = v as Record<string, unknown>;
        result[k] = {
          label: typeof entry.label === "string" ? entry.label : undefined,
          envVar: typeof entry.envVar === "string" ? entry.envVar : undefined,
          masked: true,
        };
      }
    }
    return result;
  }

  /** 收集请求体（Promise 化） */
  private _awaitBody(req: IncomingMessage, handler: (body: unknown) => boolean): boolean {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        // 1MB 限制
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        const body = raw ? JSON.parse(raw) : {};
        handler(body);
      } catch {
        // JSON 解析失败在 handler 外部处理不了，这里静默
      }
    });
    // 返回 true 表示已接管（异步处理）
    return true;
  }

  private _sendJson(res: ServerResponse, status: number, data: unknown): boolean {
    if (res.headersSent) return true;
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(body);
    return true;
  }

  private _sendProblem(res: ServerResponse, problem: ProblemDetails): boolean {
    if (res.headersSent) return true;
    const body = JSON.stringify(problem);
    res.writeHead(problem.status, { "Content-Type": "application/problem+json; charset=utf-8" });
    res.end(body);
    return true;
  }

  private _methodNotAllowed(res: ServerResponse, allow: string): boolean {
    res.setHeader("Allow", allow);
    return this._sendProblem(res, {
      type: "https://cortex.dev/errors/method-not-allowed",
      title: "Method Not Allowed",
      status: 405,
      detail: `Allowed methods: ${allow}`,
    });
  }

  private _validationError(res: ServerResponse, field: string, message: string): boolean {
    return this._sendProblem(res, {
      type: "https://cortex.dev/errors/validation",
      title: "Validation Failed",
      status: 422,
      errors: [{ field, message }],
    });
  }

  private _conflict(res: ServerResponse, err: unknown): boolean {
    return this._sendProblem(res, {
      type: "https://cortex.dev/errors/validation",
      title: "Conflict",
      status: 422,
      detail: err instanceof Error ? err.message : "Operation failed",
    });
  }

  private _notFoundOrConflict(res: ServerResponse, err: unknown): boolean {
    const msg = err instanceof Error ? err.message : "Operation failed";
    if (msg.includes("不存在")) {
      return this._sendProblem(res, {
        type: "https://cortex.dev/errors/not-found",
        title: "Not Found",
        status: 404,
        detail: msg,
      });
    }
    return this._conflict(res, err);
  }
}
