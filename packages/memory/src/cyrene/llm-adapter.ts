// ============================================================
// Cyrene-Agent 记忆系统 — 简易 LLM 适配器（适配版）
//
// 替代 Cyrene-Agent 中的 ../orchestrator/vendors + ../token-usage-store。
// 支持 OpenAI 兼容 API（DeepSeek / OpenAI / 任何兼容端点）。
// 无 Electron/IPC 依赖。
// ============================================================

export interface LLMConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface LLMResponse {
  text: string
  usage?: { input: number; output: number }
}

/** 简化版 token 用量计数器（内存 + 回调通知） */
let totalInputTokens = 0
let totalOutputTokens = 0

export function resetTokenUsage(): void {
  totalInputTokens = 0
  totalOutputTokens = 0
}

export function getTokenUsage(): { input: number; output: number } {
  return { input: totalInputTokens, output: totalOutputTokens }
}

export function recordUsage(input: number, output: number, _count = 1): void {
  totalInputTokens += input
  totalOutputTokens += output
}

/**
 * 调用 OpenAI 兼容的 LLM API。
 * 支持 /chat/completions 端点。
 *
 * 重试策略：默认 2 次重试（总 3 次调用），适用于可重试错误：
 *   - HTTP 429 / 5xx 服务侧错误
 *   - AbortError / 网络错误（fetch 抛出）
 *   - 4xx 其它错误到终不重试
 * 退避：300ms 基线，每次 ×2（300 → 600 → 1200ms）
 */
export async function callLLM(
  messages: LLMMessage[],
  config: LLMConfig,
  maxTokens = 500,
  timeoutMs = 30000,
  retries = 2,
): Promise<LLMResponse> {
  if (!config.apiKey) throw new Error("missing api key")

  let lastErr: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await _callLLMOnce(messages, config, maxTokens, timeoutMs)
    } catch (err) {
      lastErr = err
      if (!_isRetryable(err) || attempt === retries) break
      const backoff = 300 * Math.pow(2, attempt)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 判断错误是否可重试 */
function _isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message || ""
  // AbortError —— 超时，可重试
  if (err.name === "AbortError") return true
  // fetch 网络层异常 —— TypeError / “fetch failed”
  if (err.name === "TypeError" || /fetch failed|network|ECONN|EAI_AGAIN/i.test(msg)) return true
  // HTTP 429 / 5xx
  const m = /^HTTP (\d+)$/.exec(msg)
  if (m) {
    const code = parseInt(m[1] ?? "", 10)
    return code === 429 || (code >= 500 && code < 600)
  }
  return false
}

async function _callLLMOnce(
  messages: LLMMessage[],
  config: LLMConfig,
  maxTokens: number,
  timeoutMs: number,
): Promise<LLMResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const endpoint = config.baseUrl.replace(/\/+$/, "") + "/chat/completions"

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: maxTokens,
        stream: false,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as Record<string, unknown>
      const errMsg = (errorData as { error?: { message?: string } }).error?.message
      throw new Error(errMsg || `HTTP ${response.status}`)
    }

    const data = await response.json() as {
      choices: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    const text = data.choices?.[0]?.message?.content ?? ""
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : { input: 0, output: 0 }

    if (usage.input > 0 || usage.output > 0) {
      recordUsage(usage.input, usage.output, 1)
    }

    return { text, usage }
  } finally {
    clearTimeout(timer)
  }
}

/** 从 JSON 文件加载模型配置 */
export function loadModelSettingsFromFile(
  filePath: string,
  fs: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: BufferEncoding) => string },
  defaults: LLMConfig,
): LLMConfig {
  try {
    if (!fs.existsSync(filePath)) return defaults
    const raw = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(raw) as Partial<LLMConfig>
    return {
      provider: typeof parsed.provider === "string" && parsed.provider.trim() ? parsed.provider.trim() : defaults.provider,
      baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : defaults.baseUrl,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : defaults.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
    }
  } catch {
    return defaults
  }
}

// ── JSON 提取工具函数 ──

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim()
}

/** 从文本中提取 JSON 对象数组（容错：截断、markdown 包裹） */
export function extractJsonArray(raw: string): unknown[] | null {
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim()
  const start = text.indexOf("[")
  if (start === -1) return null
  text = text.slice(start)

  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed } catch { /* fall through */ }

  // 截断救场：逐个捞取完整对象
  const results: unknown[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== "{") { i++; continue }
    let depth = 0, inStr = false, esc = false, j = i
    for (; j < text.length; j++) {
      const c = text[j]
      if (esc) { esc = false; continue }
      if (c === "\\") { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === "{") depth++
      else if (c === "}") { depth--; if (depth === 0) break }
    }
    if (depth !== 0) break
    try { const obj = JSON.parse(text.slice(i, j + 1)); if (obj && typeof obj === "object") results.push(obj) } catch { /* skip */ }
    i = j + 1
  }
  return results.length > 0 ? results : null
}

/** 从文本中提取单个 JSON 对象 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = stripThinkBlocks(raw)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}
