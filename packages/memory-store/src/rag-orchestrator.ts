// ============================================================
// @cortex/memory-store/rag-orchestrator —— RAG 查询编排
//
// Phase 1 流程：
//   1. memoryStore.query(question) → 检索相关 chunk
//   2. 组装 prompt（问题 + 检索结果）
//   3. llmAdapter.chat(prompt) → LLM 回答
//   4. 返回 { answer, sources }
//
// 不支持 PDF 解析——仅 .txt/.md。PDF 解析留 Phase 2。
// ============================================================

import type { IMemoryStore, MemoryEntry, MemoryQuery } from "@cortex/shared";
import type { LlmAdapter } from "@cortex/llm";
import type { ContextBuilder} from "./context-builder.js";
import {   } from "./context-builder.js";

// ─── 类型 ──────────────────────────────────────────────

export interface RagResult {
  answer: string;
  sources: RagSource[];
  tokenUsage: { prompt: number; completion: number };
}

export interface RagSource {
  file: string;
  chunk: number;
  content: string;
  score: number;
}

export interface RagQueryOptions {
  maxSources?: number;
  domain?: string;
}

// ─── 默认提示词模板 ────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `你是一个基于记忆库的知识问答助手。
请根据提供的上下文信息回答用户问题。
如果上下文信息不足以回答问题，请如实说明"没有足够的信息来回答这个问题"。
不要编造信息。引用来源时标注 [来源: 文件名]（chunk N）。`;

const DEFAULT_USER_TEMPLATE = `## 上下文信息

{{CONTEXT}}

## 用户问题

{{QUESTION}}

请基于以上上下文回答问题。`;

// ─── RagOrchestrator ───────────────────────────────────

export class RagOrchestrator {
  constructor(
    private readonly memoryStore: IMemoryStore,
    private readonly llmAdapter: LlmAdapter,
    private readonly contextBuilder: ContextBuilder,
  ) {}

  /**
   * 执行 RAG 查询。
   *
   * @param question  用户问题
   * @param opts      可选参数：maxSources、domain
   * @returns         包含回答和来源引用
   */
  async query(question: string, opts?: RagQueryOptions): Promise<RagResult> {
    const maxSources = opts?.maxSources ?? 5;
    const domain = opts?.domain;

    // 1. 检索相关记忆
    const query: MemoryQuery = {
      keywords: this._extractKeywords(question),
      limit: maxSources,
    };
    if (domain) {
      query.domainGate = { allow: [domain] };
    }

    const entries = await this.memoryStore.read(query);

    // 2. 从 entries 提取来源信息
    const sources = this._extractSources(entries, maxSources);

    // 3. 组装 prompt
    const contextText = sources
      .map((s) => `[来源: ${s.file}]（chunk ${s.chunk}）:\n${s.content}`)
      .join("\n\n---\n\n");

    const userPrompt = DEFAULT_USER_TEMPLATE
      .replace("{{CONTEXT}}", contextText || "（无相关上下文）")
      .replace("{{QUESTION}}", question);

    // 4. 调用 LLM
    const resp = await this.llmAdapter.chat(
      this.llmAdapter.chatModel,
      [
        { role: "system", content: DEFAULT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    );

    return {
      answer: resp.content ?? "",
      sources,
      tokenUsage: {
        prompt: resp.usage?.prompt_tokens ?? 0,
        completion: resp.usage?.completion_tokens ?? 0,
      },
    };
  }

  /**
   * 从 MemoryEntry[] 中提取来源信息。
   */
  private _extractSources(entries: MemoryEntry[], maxSources: number): RagSource[] {
    const sources: RagSource[] = [];

    for (const entry of entries) {
      if (sources.length >= maxSources) break;

      const blob = entry.content_blob ?? {};
      const file = String(blob.source ?? entry.source.agentType ?? "unknown");
      const chunk = Number(blob.chunkIndex ?? 0);
      const content = String(blob.content ?? entry.summary ?? "");
      const score = entry.weight / 10; // weight 范围 0-10，归一化

      sources.push({ file, chunk, content, score });
    }

    return sources;
  }

  /**
   * 从问题中提取关键词（简单切词）。
   * Phase 1 不做 NLP——只做空格分割 + 过滤短词。
   */
  private _extractKeywords(question: string): string[] {
    const words = question
      .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return words.slice(0, 20); // 最多 20 个关键词
  }
}