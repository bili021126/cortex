import type { LlmMessage, LlmToolCall, LlmResponse, ToolDef, LlmAdapterConfig, SafeErrorReporter } from "@cortex/shared";
import * as crypto from "node:crypto";

// ─── 适配器 ─────────────────────────────────────────

/**
 * DeepSeek API 适配器。
 * 支持真实 API 调用和 Mock 注入（用于测试）。
 * 内置 LRU 缓存——相同请求直接返回缓存，省 API 费用。
 * 内置重试——网络异常或 5xx 时自动重试（最多 3 次），30s 超时。
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
  /** 缓存 TTL：超过此时间的条目在命中时将被淘汰（毫秒）。默认 10 分钟。 */
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 1000;
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(config: LlmAdapterConfig) {
    this.config = config;
  }

  /** 开启/关闭 LLM 响应缓存（测试时省钱用） */
  setCacheEnabled(on: boolean): void {
    this._cacheEnabled = on;
    if (!on) this._cache.clear();
  }

  /**
   * 设置缓存模式：
   * - "exact": 精确匹配，sha256(model + 全部 messages 原文 + tools)
   * - "fingerprint": 结构指纹，history 部分提取为 (speaker+bucket) 而非全文
   *   适用于多轮对话中 history 结构相同但措辞不同的场景（如圆桌会议）
   */
  setCacheMode(mode: "exact" | "fingerprint"): void {
    this._cacheMode = mode;
  }

  /** 缓存命中统计 */
  get cacheStats(): { hits: number; misses: number; rate: string } {
    const total = this._cacheHits + this._cacheMisses;
    return {
      hits: this._cacheHits,
      misses: this._cacheMisses,
      rate: total === 0 ? "0%" : `${((this._cacheHits / total) * 100).toFixed(1)}%`,
    };
  }

  /** 将缓存序列化为 JSON 字符串（用于持久化） */
  saveCache(): string {
    const obj: Record<string, { response: LlmResponse; ts: number }> = {};
    for (const [k, v] of this._cache) obj[k] = v;
    return JSON.stringify(obj);
  }

  /** 从 JSON 字符串恢复缓存 */
  loadCache(json: string): void {
    try {
      const obj = JSON.parse(json) as Record<string, { response: LlmResponse; ts: number }>;
      for (const [k, v] of Object.entries(obj)) {
        if (this._cache.size >= LlmAdapter.MAX_CACHE) break;
        this._cache.set(k, v);
      }
    } catch (e) {
      // 缓存文件损坏，上报但继续运行
      this._safeReporter?.({ source: "LlmAdapter.loadCache", error: e, severity: "silent", hint: "cache file corrupted, ignored" });
    }
  }

  /** 获取当前缓存条目数 */
  get cacheSize(): number {
    return this._cache.size;
  }

  /** 清空缓存 */
  clearCache(): void {
    this._cache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  /** 注入 SafeErrorReporter（由 bootstrap 在上层统一注入） */
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /** 注入 Mock 响应器——仅测试用 */
  injectMock(fn: (messages: LlmMessage[], tools?: ToolDef[]) => Promise<LlmResponse>): void {
    this._mockRespond = fn;
  }

  /** 获取 chat 模型名 */
  get chatModel(): string {
    return this.config.chatModel;
  }

  /** 获取推理模型名（MetaAgent 专用） */
  get reasonerModel(): string {
    return this.config.reasonerModel;
  }

  /** 发送聊天请求，返回文本或工具调用。缓存命中时直接返回。 */
  async chat(
    model: string,
    messages: LlmMessage[],
    tools?: ToolDef[],
    reasoningEffort?: "high" | "max",
  ): Promise<LlmResponse> {
    if (this._mockRespond) {
      return this._mockRespond(messages, tools);
    }

    // ── 缓存检查 ──
    const cacheKey = this._cacheKey(model, messages, tools, reasoningEffort);
    if (this._cacheEnabled) {
      const hit = this._cache.get(cacheKey);
      if (hit) {
        // TTL 过期检查：长时间运行（如圆桌会议持续数小时）中早期缓存可能失效
        if (Date.now() - hit.ts < LlmAdapter.CACHE_TTL_MS) {
          this._cacheHits++;
          return hit.response;
        }
        // 过期淘汰
        this._cache.delete(cacheKey);
      }
      this._cacheMisses++;
    }

    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => _serializeMessage(m)),
      temperature: 0.0,
      max_tokens: 32768,  // 长报告（如凝光合规审计、纳西妲架构分析）需更高上限
    };

    // V4-Flash 思考模式：优先用参数传入，回退全局配置
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

    const res = await this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API error ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          reasoning_content?: string | null; // V4-Flash 思考模式
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const msg = json.choices[0]?.message;
    if (!msg) throw new Error("LLM returned no choices");

    const toolCalls: LlmToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    const response: LlmResponse = {
      content: msg.content,
      toolCalls,
      reasoning_content: msg.reasoning_content ?? undefined,
    };

    // ── 写入缓存 ──
    if (this._cacheEnabled) {
      if (this._cache.size >= LlmAdapter.MAX_CACHE) {
        const first = this._cache.keys().next().value;
        if (first) this._cache.delete(first);
      }
      this._cache.set(cacheKey, { response, ts: Date.now() });
    }

    return response;
  }

  /**
   * 流式聊天请求。通过 SSE 逐 token 回调 onChunk，结束后返回完整响应。
   * 用于圆桌会议等需要实时展示发言内容的场景。
   * 注意：流式请求不使用缓存。
   */
  async chatStream(
    model: string,
    messages: LlmMessage[],
    tools: ToolDef[] | undefined,
    onChunk: (text: string) => void,
    reasoningEffort?: "high" | "max",
  ): Promise<LlmResponse> {
    if (this._mockRespond) {
      const resp = await this._mockRespond(messages, tools);
      if (resp.content) onChunk(resp.content);
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

    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM API stream error ${res.status}: ${errText}`);
    }

    if (!res.body) {
      throw new Error("LLM API stream returned no body");
    }

    // 读取 SSE 流
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let reasoningContent = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 最后一行可能不完整，保留到下次循环
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const chunk = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  tool_calls?: Array<{
                    id: string;
                    function: { name: string; arguments: string };
                  }>;
                };
              }>;
            };

            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              onChunk(delta.content);
            }
            if (delta?.reasoning_content) {
              reasoningContent += delta.reasoning_content;
            }
          } catch {
            // 跳过无法解析的行（如心跳注释）
          }
        }
      }

      // 处理 buffer 中剩余的最后一行
      const finalLine = buffer.trim();
      if (finalLine.startsWith("data:") && !finalLine.includes("[DONE]")) {
        try {
          const chunk = JSON.parse(finalLine.slice(5).trim());
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onChunk(delta.content);
          }
          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
          }
        } catch { /* skip */ }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent || null,
      toolCalls: [],
      reasoning_content: reasoningContent || undefined,
    };
  }

  /** 生成缓存键，根据 _cacheMode 分发 */
  private _cacheKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    if (this._cacheMode === "fingerprint") {
      return this._fingerprintKey(model, messages, tools, reasoningEffort);
    }
    return this._exactKey(model, messages, tools, reasoningEffort);
  }

  /** 精确缓存键：sha256(model + 全部 messages 原文 + tools) */
  private _exactKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    const payload = JSON.stringify({ model, messages, tools, reasoningEffort });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  /**
   * 结构指纹缓存键：
   * - system 消息逐字保留（persona prompt / quality rules 不变）
   * - user/assistant 消息解析 history 的结构指纹：
   *   对形如 "[speaker]: name: content" 的行，替换为 "[speaker]:(S|M|L)"
   *   S=<60字, M=60-150字, L=>150字
   * - 非 history 行逐字保留（topic / rules / turn info 不变）
   *
   * 这使得“同一角色说了差不多长度的话”视为等价上下文，
   * 在圆桌等多轮对话中大幅提升缓存命中率。
   */
  private _fingerprintKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    const fpMessages = messages.map((m) => {
      if (m.role === "system") {
        // system 消息不变，逐字保留
        return { role: m.role, content: m.content };
      }
      // user/assistant 消息：解析 history 行，其他行逐字保留
      return { role: m.role, fp: this._messageFingerprint(m.content ?? "") };
    });
    const payload = JSON.stringify({ v: 1, model, messages: fpMessages, tools, reasoningEffort });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  /**
   * 对单条 user/assistant 消息生成结构指纹：
   * - 匹配 history 行模式 "[label]: name: text" → 提取 label + text 长度桶
   * - 非 history 行逐字保留
   */
  private _messageFingerprint(content: string): string {
    const lines = content.split("\n");
    const fpLines = lines.map((line) => {
      // history 行：形如 "[🧊甘雨]: 甘雨: 发言摘要..." 或 "[meta]: meta: summary..."
      const m = line.match(/^\[(.+?)\]:\s*(\S+?):\s*(.*)/);
      if (m) {
        const label = m[1];
        const text = m[3];
        const bucket = text.length < 60 ? "S" : text.length < 150 ? "M" : "L";
        return `[${label}]:${bucket}`;
      }
      // 非 history 行：逐字保留
      return line;
    });
    return fpLines.join("\n");
  }

  /**
   * 带重试和超时的 fetch 封装。
   * 网络错误、超时、5xx、429 自动重试（指数退避），其余 4xx 直接抛错不重试。
   */
  private async _fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= LlmAdapter.MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LlmAdapter.REQUEST_TIMEOUT_MS);
      let retryAfterMs = 0; // 429 Retry-After 解析值，覆盖指数退避
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (res.ok) return res;
        // 429 Rate Limit → 重试，读取 Retry-After 头
        if (res.status === 429) {
          const ra = res.headers.get("Retry-After");
          if (ra) {
            const sec = parseInt(ra, 10);
            if (!isNaN(sec)) retryAfterMs = sec * 1000;
          }
          lastError = new Error(`LLM API rate limited (429)`);
        } else if (res.status >= 400 && res.status < 500) {
          // 其余 4xx 客户端错误 → 不重试，直接抛
          const errText = await res.text().catch(() => "(body unreadable)");
          throw new Error(`LLM API client error ${res.status} (non-retriable): ${errText}`);
        } else {
          // 5xx 服务端错误 → 重试
          lastError = new Error(`LLM API server error ${res.status}: ${await res.text().catch(() => "(body unreadable)")}`);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = new Error(`LLM API timeout after ${LlmAdapter.REQUEST_TIMEOUT_MS / 1000}s`);
        } else if (e instanceof Error && e.message?.startsWith("LLM API client error")) {
          // 不可重试的客户端错误，立即抛出让调用方感知
          throw e;
        } else {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      } finally {
        clearTimeout(timeoutId);
      }
      if (attempt < LlmAdapter.MAX_RETRIES) {
        const exponential = LlmAdapter.RETRY_BASE_MS * Math.pow(2, attempt);
        const delay = Math.max(exponential, retryAfterMs);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    throw lastError ?? new Error("LLM API request failed after all retries");
  }
}

/**
 * 将内部 LlmMessage 转为 OpenAI 兼容的线格式。
 * 关键转换：LlmToolCall.arguments (object) → function.arguments (JSON string)
 * V4-Flash 思考模式：assistant 消息需回传 reasoning_content
 */
function _serializeMessage(m: LlmMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: m.role, content: m.content };

  if (m.tool_call_id) {
    wire.tool_call_id = m.tool_call_id;
  }
  if (m.name) {
    wire.name = m.name;
  }
  // V4-Flash 思考模式：回传推理内容，否则 API 400
  if (m.reasoning_content) {
    wire.reasoning_content = m.reasoning_content;
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    wire.tool_calls = m.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }

  return wire;
}