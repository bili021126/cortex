/**
 * search-backend.ts —— 搜索后端抽象与具体实现
 *
 * 定义统一的 SearchBackend 接口，以及 McpSearchBackend (MCP协议)
 * 和 DdgSearchBackend (DuckDuckGo HTML 抓取) 两种实现。
 *
 * @layer platform —— 被 SearchAggregator 使用
 */

import { McpClient, type McpServerConfig, type McpToolDef } from "./mcp-client.js";

// ─── 数据类型 ──────────────────────────────────────

/** 单条搜索结果 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** 来源后端标识, e.g. "brave" | "tavily" | "ddg" */
  source: string;
}

/** 搜索后端接口 */
export interface SearchBackend {
  readonly id: string;
  readonly enabled: boolean;
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}

// ─── UA 池 (与 Toolkit 共享) ──────────────────────

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

// ─── McpSearchBackend ──────────────────────────────

/**
 * 基于 MCP 协议的搜索后端。
 * 封装 McpClient，自动发现搜索工具并路由搜索请求。
 */
export class McpSearchBackend implements SearchBackend {
  readonly id: string;
  readonly enabled: boolean;
  private client: McpClient;
  private _searchToolName: string | null = null;
  private _started = false;

  constructor(config: McpServerConfig) {
    this.id = config.id;
    this.enabled = config.enabled;
    this.client = new McpClient(config);
  }

  /** 启动 MCP Server 子进程并完成初始化握手 */
  async start(): Promise<void> {
    if (this._started || !this.enabled) return;
    await this.client.start();

    // 自动发现搜索工具
    const searchTool = this.client.findSearchTool();
    if (searchTool) {
      this._searchToolName = searchTool.name;
    } else {
      // 回退到硬编码搜索——尝试已知工具名
      const tools = this.client.listTools();
      const toolNames = tools.map((t: McpToolDef) => t.name);
      if (toolNames.includes("brave_web_search")) this._searchToolName = "brave_web_search";
      else if (toolNames.includes("brave_local_search")) this._searchToolName = "brave_local_search";
      else if (toolNames.includes("tavily_search")) this._searchToolName = "tavily_search";
      else if (toolNames.includes("search")) this._searchToolName = "search";
      else if (toolNames.length > 0) this._searchToolName = toolNames[0]; // 最后一个 fallback
    }

    this._started = true;
  }

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    if (!this._started) throw new Error(`MCP backend "${this.id}" not started`);
    if (!this._searchToolName) throw new Error(`MCP backend "${this.id}" has no search tool`);

    const raw = await this.client.callTool(this._searchToolName, {
      query,
      count: maxResults,
    });

    return this._parseResult(raw, maxResults);
  }

  async stop(): Promise<void> {
    await this.client.stop();
    this._started = false;
  }

  /** MCP Server 名称（来自 initialize 响应） */
  get serverName(): string {
    return this.client.serverName;
  }

  /** 将 MCP tool/call 返回的 JSON 字符串解析为 SearchResult[] */
  private _parseResult(rawJson: string, maxResults: number): SearchResult[] {
    try {
      const parsed = JSON.parse(rawJson);
      // 常见格式: { results: [{ title, url, description/snippet }] } 或 { web: { results: [...] } }
      const candidates = parsed?.results ?? parsed?.web?.results ?? parsed?.data ?? [];
      if (!Array.isArray(candidates)) return [];

      return candidates.slice(0, maxResults).map((item: Record<string, unknown>) => ({
        title: String(item.title ?? item.name ?? ""),
        url: String(item.url ?? item.link ?? ""),
        snippet: String(item.snippet ?? item.description ?? item.summary ?? ""),
        source: this.id,
      })).filter((r: SearchResult) => r.title && r.url);
    } catch {
      // 非 JSON 返回值，尝试当纯文本处理
      return [];
    }
  }
}

// ─── DdgSearchBackend ──────────────────────────────

/**
 * DuckDuckGo HTML 搜索后端 (内置, 零 API Key)。
 * 从 Toolkit 中提取的独立实现。
 */
export class DdgSearchBackend implements SearchBackend {
  readonly id = "ddg";
  readonly enabled = true;
  private _uaRound = 0;
  private _timeout: number;
  private _maxRetries: number;

  constructor(timeout = 15_000, maxRetries = 2) {
    this._timeout = timeout;
    this._maxRetries = maxRetries;
  }

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    let lastError = "";

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const ua = UA_POOL[(this._uaRound + attempt) % UA_POOL.length];
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`;
        const resp = await fetch(ddgUrl, {
          headers: {
            "User-Agent": ua,
            "Accept": "text/html",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(this._timeout),
        });

        if (!resp.ok) {
          lastError = `HTTP ${resp.status}`;
          if (attempt < this._maxRetries && (resp.status === 429 || resp.status >= 500)) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          return [];
        }

        const html = await resp.text();
        const results = this._parseDDGResults(html, maxResults);
        this._uaRound = (this._uaRound + 1) % UA_POOL.length;
        return results;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg.slice(0, 80);
        if (attempt < this._maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    // 所有重试耗尽: 静默返回空 (DDG 是 fallback，不应阻断其他后端的成功结果)
    void lastError;
    return [];
  }

  /** 解析 DuckDuckGo HTML 搜索结果页 */
  private _parseDDGResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    const resultBlockRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    while ((match = resultBlockRe.exec(html)) !== null && results.length < maxResults) {
      const rawHref = match[1] ?? "";
      const rawTitle = match[2] ?? "";
      const rawSnippet = match[3] ?? "";

      let url = rawHref;
      const uddgMatch = rawHref.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { url = decodeURIComponent(uddgMatch[1]); } catch { url = rawHref; }
      }
      if (url.startsWith("//")) url = "https:" + url;

      const title = rawTitle.replace(/<[^>]*>/g, "").trim();
      const snippet = rawSnippet.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

      if (title && url) {
        results.push({ title, url, snippet: snippet || "(无摘要)", source: "ddg" });
      }
    }
    return results;
  }
}
