/* eslint-disable no-console */
import type { LlmMessage, LlmToolCall, LlmResponse, ToolDef, LlmAdapterConfig, SafeErrorReporter } from "@cortex/shared";
import { SimpleCircuitBreaker } from "@cortex/resilience";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getRateLimiter } from "./rate-limiter.js";
import { accumulateToolCalls, finalizeToolCalls, type StreamToolCallAccumulator } from "./tool-call-stream.js";

// ─── Adapter ─────────────────────────────────────────────────────

/**
 * DeepSeek API adapter.
 * Supports real API calls and Mock injection (for testing).
 * Built-in LRU cache -- identical requests return cached response, saving API cost.
 * Built-in retry -- auto-retry on network error or 5xx (max 3 times), 30s timeout.
 *
 * Constitution v2.5.2 scoping: LlmAdapter is an independent @cortex/llm package.
 * Zero runtime dependency on Engine, only depends on @cortex/shared types.
 */
export class LlmAdapter {
  private config: LlmAdapterConfig;
  private _mockRespond: ((messages: LlmMessage[], tools?: ToolDef[]) => Promise<LlmResponse>) | null = null;
  private _cache = new Map<string, { response: LlmResponse; ts: number }>();
  private _cacheEnabled = false;
  private _cacheMode: "exact" | "fingerprint" = "exact";
  private _cacheHits = 0;
  private _cacheMisses = 0;
  private _safeReporter: SafeErrorReporter | null = null;
  private static readonly MAX_CACHE = 500;
  /** Cache TTL: entries older than this will be evicted on hit (ms). Default 10 minutes. */
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 1000;
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  // ── 断路器：保护 DeepSeek API 熔断止损 ──
  // 连续 5 次失败 → OPEN（快速失败，跳过 retry）
  // 熔断 30s 后 → HALF_OPEN（试探一次）
  private _circuitBreaker: SimpleCircuitBreaker;

  // ── 审计日志 ──
  private static _auditEnabled = false;
  private static _auditLogPath: string | null = null;
  private static _auditQueue: string[] = [];
  private static _auditDraining = false;

  /** 启用 API 调用审计日志。日志写入 .cortex/logs/api-calls.jsonl */
  static enableAudit(logDir?: string): void {
    LlmAdapter._auditEnabled = true;
    const dir = logDir ?? path.resolve(process.cwd(), ".cortex", "logs");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    LlmAdapter._auditLogPath = path.join(dir, "api-calls.jsonl");
  }

  /** 计算 Key 指纹——sha256 前 12 位，仅输出指纹不缓存明文 */
  private _keyFingerprint(): string {
    return crypto.createHash("sha256").update(this.config.apiKey).digest("hex").slice(0, 12);
  }

  private _auditLog(entry: Record<string, unknown>): void {
    if (!LlmAdapter._auditEnabled || !LlmAdapter._auditLogPath) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    LlmAdapter._auditQueue.push(line);
    if (!LlmAdapter._auditDraining) {
      LlmAdapter._auditDraining = true;
      void this._drainAudit();
    }
  }

  private async _drainAudit(): Promise<void> {
    while (LlmAdapter._auditQueue.length > 0) {
      const batch = LlmAdapter._auditQueue.splice(0, LlmAdapter._auditQueue.length);
      try {
        const auditPath = LlmAdapter._auditLogPath;
        if (!auditPath) return;
        await fs.promises.appendFile(auditPath, batch.join(""), "utf-8");
      } catch {
        // 审计日志写入失败不阻塞主流程
      }
    }
    LlmAdapter._auditDraining = false;
    // 防止竞态：draining 期间新推入的条目未被处理
    if (LlmAdapter._auditQueue.length > 0) {
      LlmAdapter._auditDraining = true;
      void this._drainAudit();
    }
  }

  constructor(config: LlmAdapterConfig) {
    this.config = config;

    // ── 初始化断路器：5 次连续失败熔断，30s 后试探 ──
    this._circuitBreaker = new SimpleCircuitBreaker({
      name: `llm-${config.label ?? 'unknown'}`,
      threshold: 5,
      halfOpenAfterMs: 30_000,
    });
  }

  /** Enable/disable LLM response cache (saves cost during testing) */
  setCacheEnabled(on: boolean): void {
    this._cacheEnabled = on;
    if (!on) this._cache.clear();
  }

  /**
   * Set cache mode:
   * - "exact": exact match, sha256(model + all messages text + tools)
   * - "fingerprint": structural fingerprint, history part extracted as (speaker+bucket) instead of full text
   *   Suitable for multi-turn dialogs with same structure but different wording (e.g. roundtable meetings)
   */
  setCacheMode(mode: "exact" | "fingerprint"): void {
    this._cacheMode = mode;
  }

  /** Cache hit statistics */
  get cacheStats(): { hits: number; misses: number; rate: string } {
    const total = this._cacheHits + this._cacheMisses;
    return {
      hits: this._cacheHits,
      misses: this._cacheMisses,
      rate: total === 0 ? "0%" : `${((this._cacheHits / total) * 100).toFixed(1)}%`,
    };
  }

  /** Serialize cache to JSON string (for persistence) */
  saveCache(): string {
    const obj: Record<string, { response: LlmResponse; ts: number }> = {};
    for (const [k, v] of this._cache) obj[k] = v;
    return JSON.stringify(obj);
  }

  /** Restore cache from JSON string */
  loadCache(json: string): void {
    try {
      const obj = JSON.parse(json) as Record<string, { response: LlmResponse; ts: number }>;
      for (const [k, v] of Object.entries(obj)) {
        if (this._cache.size >= LlmAdapter.MAX_CACHE) break;
        this._cache.set(k, v);
      }
    } catch (e) {
      // Cache file corrupted, report but continue running
      this._safeReporter?.({ source: "LlmAdapter.loadCache", error: e, severity: "silent", hint: "cache file corrupted, ignored" });
    }
  }

  /** Get current cache entry count */
  get cacheSize(): number {
    return this._cache.size;
  }

  /** Clear cache */
  clearCache(): void {
    this._cache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  /** Inject SafeErrorReporter (injected uniformly by bootstrap at upper layer) */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /** Inject Mock responder -- testing only */
  injectMock(fn: (messages: LlmMessage[], tools?: ToolDef[]) => Promise<LlmResponse>): void {
    this._mockRespond = fn;
  }

  /** Get chat model name */
  get chatModel(): string {
    if (!this.config.chatModel) throw new Error("LlmAdapter: chatModel is required but not configured");
    return this.config.chatModel;
  }

  /** Get reasoner model name (MetaAgent specific). Falls back to chatModel if not set. */
  get reasonerModel(): string {
    return this.config.reasonerModel ?? this.config.chatModel ?? "deepseek-v4-flash";
  }

  /** Send chat request, returns text or tool calls. Returns cached response on hit. */
  async chat(
    model: string,
    messages: LlmMessage[],
    tools?: ToolDef[],
    reasoningEffort?: "high" | "max",
  ): Promise<LlmResponse> {
    if (this._mockRespond) {
      return await this._mockRespond(messages, tools);
    }

    // ── Cache check ──
    const cacheKey = this._cacheKey(model, messages, tools, reasoningEffort);
    if (this._cacheEnabled) {
      const hit = this._cache.get(cacheKey);
      if (hit) {
        if (Date.now() - hit.ts < LlmAdapter.CACHE_TTL_MS) {
          this._cacheHits++;
          // @fix P2-8 -- LRU: touch entry on hit, move to Map tail (Map insertion order, tail = most recent)
          this._cache.delete(cacheKey);
          this._cache.set(cacheKey, hit);
          return hit.response;
        }
        this._cache.delete(cacheKey);
      }
      this._cacheMisses++;
    }

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => _serializeMessage(m)),
      temperature: 0.0,
      max_tokens: 32768,
    };

    const effort = reasoningEffort ?? this.config.reasoningEffort;
    if (effort) {
      body.reasoning_effort = effort;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const t0 = Date.now();
    let status = 0;
    let reqId: string | undefined;

    // ── 权限准入 ──
    const limiter = getRateLimiter();
    const label = this.config.label ?? "unknown";
    const fp = this._keyFingerprint();
    const limitCheck = await limiter.check(label, fp);
    if (!limitCheck.allowed) {
      throw new Error(`[RateLimit] ${limitCheck.reason}`);
    }

    try {
      // ── 请求 + 读取响应体（含一次 body-read 重试）──
      const MAX_BODY_READ_RETRIES = 1;
      let bodyReadAttempt = 0;
      let response: LlmResponse | null = null;

      while (bodyReadAttempt <= MAX_BODY_READ_RETRIES) {
        try {
          const res = await this._circuitBreaker.call(
            () => this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.config.apiKey}`,
              },
              body: JSON.stringify(body),
            }),
          );
          status = res.status;
          reqId = res.headers.get("x-request-id") ?? res.headers.get("x-ds-request-id") ?? undefined;

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`LLM API error ${res.status}: ${errText}`);
          }

          const json = (await res.json()) as {
            choices: Array<{
              message: {
                content: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  id: string;
                  function: { name: string; arguments: string };
                }>;
              };
            }>;
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          };

          const msg = json.choices[0]?.message;
          if (!msg) throw new Error("LLM returned no choices");

          const toolCalls: LlmToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          }));

          response = {
            content: msg.content,
            tool_calls: toolCalls,
            reasoning_content: msg.reasoning_content ?? undefined,
            usage: json.usage ? { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens } : undefined,
          };

          if (this._cacheEnabled) {
            if (this._cache.size >= LlmAdapter.MAX_CACHE) {
              const oldest = this._cache.keys().next().value;
              if (oldest) this._cache.delete(oldest);
            }
            this._cache.set(cacheKey, { response, ts: Date.now() });
          }

          this._auditLog({
            key: this._keyFingerprint(),
            model,
            status,
            duration_ms: Date.now() - t0,
            messages_count: messages.length,
            tool_count: tools?.length ?? 0,
            req_id: reqId,
            prompt_tokens: json.usage?.prompt_tokens ?? 0,
            completion_tokens: json.usage?.completion_tokens ?? 0,
            total_tokens: json.usage?.total_tokens ?? 0,
            error: null,
          });

          // 记录 token 消耗（权限配额追踪，异步 fire-and-forget）
          void limiter.recordTokens(fp, json.usage?.total_tokens ?? 0);

          return response;
        } catch (bodyReadErr) {
          const errMsg = bodyReadErr instanceof Error ? bodyReadErr.message : String(bodyReadErr);
          const isBodyReadFailure = /terminated|aborted|connection reset|network error|fetch failed/i.test(errMsg);

          if (isBodyReadFailure && bodyReadAttempt < MAX_BODY_READ_RETRIES) {
            bodyReadAttempt++;
            const delay = LlmAdapter.RETRY_BASE_MS * Math.pow(2, bodyReadAttempt);
            console.warn(`  🔄 [LLM] 响应体读取失败 (${errMsg.slice(0, 80)})——${delay}ms 后重试 (${bodyReadAttempt}/${MAX_BODY_READ_RETRIES})`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          // 不可重试或重试已用完——包装为友好错误
          throw new Error(
            isBodyReadFailure
              ? `LLM API 连接中断（服务器返回 200 但响应体读取失败: ${errMsg}）。请重试。`
              : errMsg,
            { cause: bodyReadErr },
          );
        }
      }

      // 理论上不会到这里（循环内必定 return 或 throw），但 TypeScript 需要
      throw new Error("LLM chat: 意外的内部状态");
    } catch (e) {
      this._auditLog({
        key: this._keyFingerprint(),
        model,
        status: status || -1,
        duration_ms: Date.now() - t0,
        messages_count: messages.length,
        tool_count: tools?.length ?? 0,
        req_id: reqId,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        error: (e as Error).message.slice(0, 200),
      });
      throw e;
    }
  }

  async chatStream(
    model: string,
    messages: LlmMessage[],
    tools: ToolDef[] | undefined,
    onChunk: (content: string, reasoning?: string) => void,
    reasoningEffort?: "high" | "max",
  ): Promise<LlmResponse> {
    if (this._mockRespond) {
      const resp = await this._mockRespond(messages, tools);
      if (resp.content) onChunk(resp.content, resp.reasoning_content);
      return resp;
    }

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => _serializeMessage(m)),
      temperature: 0.0,
      max_tokens: 32768,
      stream: true,
    };

    const effort = reasoningEffort ?? this.config.reasoningEffort;
    if (effort) {
      body.reasoning_effort = effort;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const t0 = Date.now();
    let status = 0;

    // ── 权限准入 ──
    const limiter = getRateLimiter();
    const label = this.config.label ?? "unknown";
    const fp = this._keyFingerprint();
    const limitCheck = await limiter.check(label, fp);
    if (!limitCheck.allowed) {
      throw new Error(`[RateLimit] ${limitCheck.reason}`);
    }

    try {
      const res = await this._circuitBreaker.call(
        () => this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        }),
      );
      status = res.status;

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LLM API error ${res.status}: ${errText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("LLM streaming not supported");

      let sse: SseStreamState;
      try {
        sse = await _readSseStream(reader, onChunk);
      } finally {
        reader.releaseLock();
      }

      const toolCalls = finalizeToolCalls(sse.collectedToolCalls) as LlmToolCall[];

      const response: LlmResponse = {
        content: sse.fullContent || null,
        tool_calls: toolCalls,
        reasoning_content: sse.fullReasoning || undefined,
        usage: sse.streamUsage,
      };

      this._auditLog({
        key: this._keyFingerprint(),
        model,
        status,
        duration_ms: Date.now() - t0,
        messages_count: messages.length,
        tool_count: tools?.length ?? 0,
        stream: true,
        stream_degraded: sse.degraded,
        error: null,
      });

      // 流式调用消耗配额（异步 fire-and-forget）
      const totalTokens = (sse.streamUsage?.prompt_tokens ?? 0) + (sse.streamUsage?.completion_tokens ?? 0);
      void limiter.recordTokens(fp, totalTokens);

      return response;
    } catch (e) {
      this._auditLog({
        key: this._keyFingerprint(),
        model,
        status: status || -1,
        duration_ms: Date.now() - t0,
        messages_count: messages.length,
        tool_count: tools?.length ?? 0,
        stream: true,
        error: (e as Error).message.slice(0, 200),
      });
      throw e;
    }
  }

  private _cacheKey(
    model: string,
    messages: LlmMessage[],
    tools?: ToolDef[],
    reasoningEffort?: "high" | "max",
  ): string {
    if (this._cacheMode === "fingerprint") {
      const parts = messages.map((m) => {
        const role = m.role ?? "unknown";
        const contentPreview = typeof m.content === "string" ? m.content.slice(0, 100) : "";
        return `${role}:${contentPreview.length}`;
      });
      return crypto
        .createHash("sha256")
        .update(model + parts.join("|") + (reasoningEffort ?? "") + JSON.stringify(tools ?? []))
        .digest("hex");
    }

    // exact mode
    return crypto
      .createHash("sha256")
      .update(model + JSON.stringify(messages) + JSON.stringify(tools ?? []) + (reasoningEffort ?? ""))
      .digest("hex");
  }

  private async _fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
    const controller = new AbortController();
    // 双保险——AbortController.signal（标准通道）+ Promise.race（硬兜底）
    // Windows Node.js 下 AbortController.signal 在 TCP 层面可能不生效，
    // Promise.race 确保无论如何超时后都会抛出。
    const id = attempt === 1 ? "" : ` (重试#${attempt - 1})`;
    console.log(`  🌐 [LLM] 请求${id}...`);

    const timeout = setTimeout(() => {
      console.log(`  ⏰ [LLM] 超时 ${LlmAdapter.REQUEST_TIMEOUT_MS / 1000}s——触发 abort`);
      controller.abort();
    }, LlmAdapter.REQUEST_TIMEOUT_MS);

    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        fetch(url, { ...options, signal: controller.signal }),
        new Promise<never>((_, reject) => {
          hardTimeout = setTimeout(
            () => reject(new Error(`LLM API timeout after ${LlmAdapter.REQUEST_TIMEOUT_MS / 1000}s (硬兜底)`)),
            LlmAdapter.REQUEST_TIMEOUT_MS + 5000, // 比 AbortController 多 5s 兜底
          );
        }),
      ]);
      console.log(`  🌐 [LLM] 响应——状态码 ${res.status}`);
      if (!res.ok && (res.status >= 500 || res.status === 429) && attempt < LlmAdapter.MAX_RETRIES) {
        const retryAfter = res.headers.get("Retry-After");
        const serverDelay = retryAfter ? parseInt(retryAfter) * 1000 : 0;
        const delay = Math.max(LlmAdapter.RETRY_BASE_MS * Math.pow(2, attempt - 1), serverDelay);
        console.log(`  🔄 [LLM] ${res.status} 错误——${delay}ms 后重试 (${attempt}/${LlmAdapter.MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        return await this._fetchWithRetry(url, options, attempt + 1);
      }
      return res;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ [LLM] fetch 异常: ${errMsg.slice(0, 200)}`);
      if (attempt < LlmAdapter.MAX_RETRIES) {
        const delay = LlmAdapter.RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.log(`  🔄 [LLM] 网络异常——${delay}ms 后重试 (${attempt}/${LlmAdapter.MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        return await this._fetchWithRetry(url, options, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (hardTimeout) clearTimeout(hardTimeout);
    }
  }
}

// ─── Helper: SSE stream reader ────────────────────────────────────

interface SseStreamState {
  fullContent: string;
  fullReasoning: string;
  collectedToolCalls: ReadonlyArray<StreamToolCallAccumulator>;
  streamUsage?: { prompt_tokens: number; completion_tokens: number };
  /** 流中断降级（有部分内容可返回）时为 true */
  degraded: boolean;
}

/** 从 ReadableStream 读取 SSE 行，累积 content / reasoning / tool_calls */
async function _readSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (content: string, reasoning?: string) => void,
): Promise<SseStreamState> {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let fullReasoning = "";
  let collectedToolCalls: ReadonlyArray<StreamToolCallAccumulator> = [];
  let streamUsage: { prompt_tokens: number; completion_tokens: number } | undefined;

  let skippedChunks = 0;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed?.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") break outer;

        try {
          const chunk = JSON.parse(data);

          if (chunk.usage) {
            streamUsage = {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
            };
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullContent += delta.content;
            onChunk(delta.content);
          }

          if (delta.reasoning_content) {
            fullReasoning += delta.reasoning_content;
            onChunk("", delta.reasoning_content);
          }

          if (delta.tool_calls) {
            collectedToolCalls = accumulateToolCalls(collectedToolCalls, delta.tool_calls);
          }
        } catch {
          skippedChunks++;
        }
      }
    }
  } catch (e) {
    if (fullContent || fullReasoning || collectedToolCalls.length > 0) {
      console.warn(`[LlmAdapter] chatStream 流中断，返回部分内容: ${String(e).slice(0, 200)}`);
      return { fullContent, fullReasoning, collectedToolCalls, streamUsage, degraded: true };
    }
    throw e;
  }

  if (skippedChunks > 0) {
    console.warn(`[LlmAdapter] 流式解析跳过 ${skippedChunks} 个异常 SSE chunk`);
  }
  return { fullContent, fullReasoning, collectedToolCalls, streamUsage, degraded: false };
}

// ─── Helper: serialize message ───────────────────────────────────

function _serializeMessage(m: LlmMessage): Record<string, unknown> {
  const base: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
  if (m.tool_calls && m.tool_calls.length > 0) {
    base.tool_calls = m.tool_calls.map((tc) => ({
      id: tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }
  if (m.name) base.name = m.name;
  if (m.reasoning_content) base.reasoning_content = m.reasoning_content;
  return base;
}
