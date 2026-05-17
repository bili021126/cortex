import type { LlmMessage, LlmToolCall, LlmResponse, ToolDef, LlmAdapterConfig, SafeErrorReporter } from "@cortex/shared";
import * as crypto from "node:crypto";

// 鈹€鈹€鈹€ 閫傞厤鍣?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * DeepSeek API 閫傞厤鍣ㄣ€?
 * 鏀寔鐪熷疄 API 璋冪敤鍜?Mock 娉ㄥ叆锛堢敤浜庢祴璇曪級銆?
 * 鍐呯疆 LRU 缂撳瓨鈥斺€旂浉鍚岃姹傜洿鎺ヨ繑鍥炵紦瀛橈紝鐪?API 璐圭敤銆?
 * 鍐呯疆閲嶈瘯鈥斺€旂綉缁滃紓甯告垨 5xx 鏃惰嚜鍔ㄩ噸璇曪紙鏈€澶?3 娆★級锛?0s 瓒呮椂銆?
 *
 * 瀹硶 v2.5.2 瑁佸畾锛歀lmAdapter 鐙珛涓?@cortex/llm 鍖呫€?
 * 闆?Engine 杩愯鏃朵緷璧栵紝浠呬緷璧?@cortex/shared 绫诲瀷銆?
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
  /** 缂撳瓨 TTL锛氳秴杩囨鏃堕棿鐨勬潯鐩湪鍛戒腑鏃跺皢琚窐姹帮紙姣锛夈€傞粯璁?10 鍒嗛挓銆?*/
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_BASE_MS = 1000;
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(config: LlmAdapterConfig) {
    this.config = config;
  }

  /** 寮€鍚?鍏抽棴 LLM 鍝嶅簲缂撳瓨锛堟祴璇曟椂鐪侀挶鐢級 */
  setCacheEnabled(on: boolean): void {
    this._cacheEnabled = on;
    if (!on) this._cache.clear();
  }

  /**
   * 璁剧疆缂撳瓨妯″紡锛?
   * - "exact": 绮剧‘鍖归厤锛宻ha256(model + 鍏ㄩ儴 messages 鍘熸枃 + tools)
   * - "fingerprint": 缁撴瀯鎸囩汗锛宧istory 閮ㄥ垎鎻愬彇涓?(speaker+bucket) 鑰岄潪鍏ㄦ枃
   *   閫傜敤浜庡杞璇濅腑 history 缁撴瀯鐩稿悓浣嗘帾杈炰笉鍚岀殑鍦烘櫙锛堝鍦嗘浼氳锛?
   */
  setCacheMode(mode: "exact" | "fingerprint"): void {
    this._cacheMode = mode;
  }

  /** 缂撳瓨鍛戒腑缁熻 */
  get cacheStats(): { hits: number; misses: number; rate: string } {
    const total = this._cacheHits + this._cacheMisses;
    return {
      hits: this._cacheHits,
      misses: this._cacheMisses,
      rate: total === 0 ? "0%" : `${((this._cacheHits / total) * 100).toFixed(1)}%`,
    };
  }

  /** 灏嗙紦瀛樺簭鍒楀寲涓?JSON 瀛楃涓诧紙鐢ㄤ簬鎸佷箙鍖栵級 */
  saveCache(): string {
    const obj: Record<string, { response: LlmResponse; ts: number }> = {};
    for (const [k, v] of this._cache) obj[k] = v;
    return JSON.stringify(obj);
  }

  /** 浠?JSON 瀛楃涓叉仮澶嶇紦瀛?*/
  loadCache(json: string): void {
    try {
      const obj = JSON.parse(json) as Record<string, { response: LlmResponse; ts: number }>;
      for (const [k, v] of Object.entries(obj)) {
        if (this._cache.size >= LlmAdapter.MAX_CACHE) break;
        this._cache.set(k, v);
      }
    } catch (e) {
      // 缂撳瓨鏂囦欢鎹熷潖锛屼笂鎶ヤ絾缁х画杩愯
      this._safeReporter?.({ source: "LlmAdapter.loadCache", error: e, severity: "silent", hint: "cache file corrupted, ignored" });
    }
  }

  /** 鑾峰彇褰撳墠缂撳瓨鏉＄洰鏁?*/
  get cacheSize(): number {
    return this._cache.size;
  }

  /** 娓呯┖缂撳瓨 */
  clearCache(): void {
    this._cache.clear();
    this._cacheHits = 0;
    this._cacheMisses = 0;
  }

  /** 娉ㄥ叆 SafeErrorReporter锛堢敱 bootstrap 鍦ㄤ笂灞傜粺涓€娉ㄥ叆锛?*/
  setSafeReporter(reporter: SafeErrorReporter): void {
    this._safeReporter = reporter;
  }

  /** 娉ㄥ叆 Mock 鍝嶅簲鍣ㄢ€斺€斾粎娴嬭瘯鐢?*/
  injectMock(fn: (messages: LlmMessage[], tools?: ToolDef[]) => Promise<LlmResponse>): void {
    this._mockRespond = fn;
  }

  /** 鑾峰彇 chat 妯″瀷鍚?*/
  get chatModel(): string {
    return this.config.chatModel;
  }

  /** 鑾峰彇鎺ㄧ悊妯″瀷鍚嶏紙MetaAgent 涓撶敤锛?*/
  get reasonerModel(): string {
    return this.config.reasonerModel;
  }

  /** 鍙戦€佽亰澶╄姹傦紝杩斿洖鏂囨湰鎴栧伐鍏疯皟鐢ㄣ€傜紦瀛樺懡涓椂鐩存帴杩斿洖銆?*/
  async chat(
    model: string,
    messages: LlmMessage[],
    tools?: ToolDef[],
    reasoningEffort?: "high" | "max",
  ): Promise<LlmResponse> {
    if (this._mockRespond) {
      return this._mockRespond(messages, tools);
    }

    // 鈹€鈹€ 缂撳瓨妫€鏌?鈹€鈹€
    const cacheKey = this._cacheKey(model, messages, tools, reasoningEffort);
    if (this._cacheEnabled) {
      const hit = this._cache.get(cacheKey);
      if (hit) {
        if (Date.now() - hit.ts < LlmAdapter.CACHE_TTL_MS) {
          this._cacheHits++;
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
          reasoning_content?: string | null;
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

    if (this._cacheEnabled) {
      if (this._cache.size >= LlmAdapter.MAX_CACHE) {
        const first = this._cache.keys().next().value;
        if (first) this._cache.delete(first);
      }
      this._cache.set(cacheKey, { response, ts: Date.now() });
    }

    return response;
  }

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
      throw new Error(`LLM API stream error ${res.status}: ${errText}`);
    }

    if (!res.body) {
      throw new Error("LLM API stream returned no body");
    }

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
            // 璺宠繃鏃犳硶瑙ｆ瀽鐨勮
          }
        }
      }

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
        } catch { /* SSE chunk may contain non-JSON keepalive comments or truncation; skip */ }
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

  private _cacheKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    if (this._cacheMode === "fingerprint") {
      return this._fingerprintKey(model, messages, tools, reasoningEffort);
    }
    return this._exactKey(model, messages, tools, reasoningEffort);
  }

  private _exactKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    const payload = JSON.stringify({ model, messages, tools, reasoningEffort });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  private _fingerprintKey(model: string, messages: LlmMessage[], tools?: ToolDef[], reasoningEffort?: string): string {
    const fpMessages = messages.map((m) => {
      if (m.role === "system") {
        return { role: m.role, content: m.content };
      }
      return { role: m.role, fp: this._messageFingerprint(m.content ?? "") };
    });
    const payload = JSON.stringify({ v: 1, model, messages: fpMessages, tools, reasoningEffort });
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  private _messageFingerprint(content: string): string {
    const lines = content.split("\n");
    const fpLines = lines.map((line) => {
      const m = line.match(/^\[(.+?)\]:\s*(\S+?):\s*(.*)/);
      if (m) {
        const label = m[1];
        const text = m[3];
        const bucket = text.length < 60 ? "S" : text.length < 150 ? "M" : "L";
        return `[${label}]:${bucket}`;
      }
      return line;
    });
    return fpLines.join("\n");
  }

  private async _fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= LlmAdapter.MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LlmAdapter.REQUEST_TIMEOUT_MS);
      let retryAfterMs = 0;
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (res.ok) return res;
        if (res.status === 429) {
          const ra = res.headers.get("Retry-After");
          if (ra) {
            const sec = parseInt(ra, 10);
            if (!isNaN(sec)) retryAfterMs = sec * 1000;
          }
          lastError = new Error(`LLM API rate limited (429)`);
        } else if (res.status >= 400 && res.status < 500) {
          const errText = await res.text().catch(() => "(body unreadable)");
          throw new Error(`LLM API client error ${res.status} (non-retriable): ${errText}`);
        } else {
          lastError = new Error(`LLM API server error ${res.status}: ${await res.text().catch(() => "(body unreadable)")}`);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = new Error(`LLM API timeout after ${LlmAdapter.REQUEST_TIMEOUT_MS / 1000}s`);
        } else if (e instanceof Error && e.message?.startsWith("LLM API client error")) {
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

function _serializeMessage(m: LlmMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: m.role, content: m.content };

  if (m.tool_call_id) {
    wire.tool_call_id = m.tool_call_id;
  }
  if (m.name) {
    wire.name = m.name;
  }
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
