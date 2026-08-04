/**
 * @cortex/client — HTTP 客户端
 *
 * 类型化 REST 客户端，每个 API 端点一个方法。
 * 使用 global fetch（Node 20+ / Browser / Tauri 均内置）。
 */

import type {
  WebUIState,
  TaskNodeSnapshot,
  HealthSnapshot,
  PaginatedResponse,
  SingleResponse,
  ModelEntryDTO,
  KeyEntryMaskedDTO,
  TuningConfigDTO,
  CreateModelRequest,
  PatchModelRequest,
  CreateKeyRequest,
  PatchTuningRequest,
  ConfigValidateRequest,
  ConfigValidateResponse,
  ConfigVersionResponse,
  ProblemDetails,
  EventRecord,
  ChatResponseData,
  MemoryEntryDTO,
  MemoryWriteRequest,
  SessionDTO,
  SessionListResponse,
  CreateSessionRequest,
  DeleteSessionResponse,
  MemoryDeleteResponse,
  DaemonHealthSnapshot,
  ServerCapabilities,
} from "@cortex/protocol";
import type { HttpClientConfig } from "./types.js";
import { ProtocolError } from "./errors.js";

export class CortexHttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  // ─── 状态查询 ──────────────────────────────────────

  async getState(): Promise<WebUIState> {
    const res = await this.request<SingleResponse<WebUIState>>("GET", "/api/v1/state");
    return res.data;
  }

  async getNodes(opts?: { page?: number; limit?: number; status?: string }): Promise<PaginatedResponse<TaskNodeSnapshot>> {
    const params = new URLSearchParams();
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.status) params.set("status", opts.status);
    const qs = params.toString();
    return await this.request<PaginatedResponse<TaskNodeSnapshot>>("GET", `/api/v1/nodes${qs ? `?${qs}` : ""}`);
  }

  async getNode(id: string): Promise<TaskNodeSnapshot> {
    const res = await this.request<SingleResponse<TaskNodeSnapshot>>("GET", `/api/v1/nodes/${encodeURIComponent(id)}`);
    return res.data;
  }

  async getAgents(): Promise<Record<string, string[]>> {
    const res = await this.request<SingleResponse<Record<string, string[]>>>("GET", "/api/v1/agents");
    return res.data;
  }

  async getHealth(): Promise<HealthSnapshot> {
    const res = await this.request<SingleResponse<HealthSnapshot>>("GET", "/api/v1/health");
    return res.data;
  }

  async execute(input: string): Promise<unknown> {
    const res = await this.request<SingleResponse<unknown>>("POST", "/api/v1/execute", { input });
    return res.data;
  }

  async getEvents(opts?: { page?: number; limit?: number; type?: string }): Promise<PaginatedResponse<EventRecord>> {
    const params = new URLSearchParams();
    if (opts?.page) params.set("page", String(opts.page));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.type) params.set("type", opts.type);
    const qs = params.toString();
    return await this.request<PaginatedResponse<EventRecord>>("GET", `/api/v1/events${qs ? `?${qs}` : ""}`);
  }

  // ─── Config API ────────────────────────────────────

  async getModels(): Promise<Record<string, ModelEntryDTO>> {
    const res = await this.request<SingleResponse<Record<string, ModelEntryDTO>>>("GET", "/api/v1/models");
    return res.data;
  }

  async createModel(req: CreateModelRequest): Promise<void> {
    await this.request("POST", "/api/v1/models", req);
  }

  async patchModel(id: string, patch: PatchModelRequest): Promise<void> {
    await this.request("PATCH", `/api/v1/models/${encodeURIComponent(id)}`, patch);
  }

  async deleteModel(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/models/${encodeURIComponent(id)}`);
  }

  async patchAgentConfig(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.request("PATCH", `/api/v1/agents/${encodeURIComponent(id)}`, patch);
  }

  async getKeys(): Promise<Record<string, KeyEntryMaskedDTO>> {
    const res = await this.request<SingleResponse<Record<string, KeyEntryMaskedDTO>>>("GET", "/api/v1/keys");
    return res.data;
  }

  async createKey(req: CreateKeyRequest): Promise<void> {
    await this.request("POST", "/api/v1/keys", req);
  }

  async deleteKey(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/keys/${encodeURIComponent(id)}`);
  }

  async getTuning(): Promise<TuningConfigDTO> {
    const res = await this.request<SingleResponse<TuningConfigDTO>>("GET", "/api/v1/tuning");
    return res.data;
  }

  async patchTuning(req: PatchTuningRequest): Promise<void> {
    await this.request("PATCH", "/api/v1/tuning", req);
  }

  async validateConfig(req: ConfigValidateRequest): Promise<ConfigValidateResponse> {
    const res = await this.request<SingleResponse<ConfigValidateResponse>>("POST", "/api/v1/config/validate", req);
    return res.data;
  }

  async getConfigVersion(): Promise<ConfigVersionResponse> {
    const res = await this.request<SingleResponse<ConfigVersionResponse>>("GET", "/api/v1/config/version");
    return res.data;
  }

  // ─── Chat / Memory / Session API ───────────────────

  /** 非流式对话 */
  async chat(input: string, opts?: { agent?: string; mode?: string }): Promise<string> {
    const res = await this.request<SingleResponse<ChatResponseData>>("POST", "/api/v1/chat", { input, ...opts });
    return res.data.output;
  }

  /** 搜索记忆 */
  async searchMemory(query: string, opts?: { kind?: string; limit?: number }): Promise<MemoryEntryDTO[]> {
    const params = new URLSearchParams({ query });
    if (opts?.kind) params.set("kind", opts.kind);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const res = await this.request<PaginatedResponse<MemoryEntryDTO>>("GET", `/api/v1/memory?${params}`);
    return res.data;
  }

  /** 写入记忆 */
  async writeMemory(entry: MemoryWriteRequest): Promise<MemoryEntryDTO> {
    const res = await this.request<SingleResponse<MemoryEntryDTO>>("POST", "/api/v1/memory", entry);
    return res.data;
  }

  /** 删除记忆（B7：补齐 daemon 已有路由 DELETE /api/v1/memory/:id） */
  async deleteMemory(id: string): Promise<void> {
    await this.request<MemoryDeleteResponse>("DELETE", `/api/v1/memory/${encodeURIComponent(id)}`);
  }

  /** 获取会话列表 */
  async getSessions(): Promise<SessionDTO[]> {
    const res = await this.request<SessionListResponse>("GET", "/api/v1/sessions");
    return res.data;
  }

  /** 创建会话 */
  async createSession(req?: CreateSessionRequest): Promise<SessionDTO> {
    const res = await this.request<SingleResponse<SessionDTO>>("POST", "/api/v1/sessions", req ?? {});
    return res.data;
  }

  /** 删除会话 */
  async deleteSession(id: string): Promise<void> {
    await this.request<DeleteSessionResponse>("DELETE", `/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  /** Daemon 健康检查 */
  async getDaemonHealth(): Promise<DaemonHealthSnapshot> {
    const res = await this.request<SingleResponse<DaemonHealthSnapshot>>("GET", "/api/v1/daemon/health");
    return res.data;
  }

  /** 能力发现（C5）——连接任意服务端后先探测能力面（共面 + 专化声明） */
  async getCapabilities(): Promise<ServerCapabilities> {
    const res = await this.request<SingleResponse<ServerCapabilities>>("GET", "/api/v1/capabilities");
    return res.data;
  }

  // ─── 内部 ──────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    // B5：外部 signal + 配置/调用级超时——组合信号，远端挂起不再永久阻塞
    const signals: AbortSignal[] = [];
    if (opts?.signal) signals.push(opts.signal);
    const timeoutMs = opts?.timeoutMs ?? this.config.timeoutMs;
    if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
    const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!res.ok) {
      await this._handleError(res);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    return await (res.json() as Promise<T>);
  }

  private async _handleError(res: Response): Promise<never> {
    let problem: ProblemDetails;
    try {
      problem = await res.json() as ProblemDetails;
    } catch {
      problem = {
        type: "https://cortex.dev/errors/internal",
        title: res.statusText || "Error",
        status: res.status,
      };
    }
    throw new ProtocolError(problem);
  }
}
