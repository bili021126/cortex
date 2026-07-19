// ============================================================
// @cortex/memory-store/ingest-pipeline —— 文件/文本摄入管线
//
// Phase 1：纯规则分块（滑动窗口），不支持 PDF。
// 每个 chunk 写入 MemoryStore，携带 domain、来源文件、chunk 序号。
// ============================================================

import type { IMemoryStore, MemoryWriteInput } from "@cortex/shared";
import type { IEmbeddingService } from "./embedding.js";
import * as fs from "node:fs/promises";

// ─── 类型 ──────────────────────────────────────────────

export interface IngestOptions {
  domain?: string;
  source: string;         // 来源文件路径
  chunkSize?: number;     // 默认 500 字符
  overlap?: number;       // 默认 50 字符
}

// ─── IngestPipeline ────────────────────────────────────

export class IngestPipeline {
  constructor(
    private readonly memoryStore: IMemoryStore,
    private readonly embeddingService?: IEmbeddingService,
  ) {}

  /**
   * 从文件读取并摄入。
   * @returns 写入的 chunk 数
   */
  async ingestFile(filePath: string, opts: IngestOptions): Promise<number> {
    const content = await fs.readFile(filePath, "utf-8");
    return await this.ingestText(content, opts);
  }

  /**
   * 摄入纯文本。
   * @returns 写入的 chunk 数
   */
  async ingestText(text: string, opts: IngestOptions): Promise<number> {
    if (!text || text.trim().length === 0) return 0;

    const chunkSize = opts.chunkSize ?? 500;
    const overlap = opts.overlap ?? 50;
    const domain = opts.domain ?? "general";
    const source = opts.source;

    const chunks = this.chunkText(text, chunkSize, overlap);
    for (let i = 0; i < chunks.length; i++) {
      const input: MemoryWriteInput = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        source: { agentType: "code" as any, taskId: "ingest-pipeline" },
        domain,
        kind: "Skill",
        isFact: true,
        summary: `[${source}] chunk ${i + 1}/${chunks.length}`,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        semantic_gist: chunks[i]!.slice(0, 200),
        content_blob: {
          source,
          chunkIndex: i,
          totalChunks: chunks.length,
          content: chunks[i],
        },
      };
      await this.memoryStore.write(input);
    }

    return chunks.length;
  }

  /**
   * 简单滑动窗口分块。
   * 不引入 NLP 分句——纯按字符位置。
   */
  private chunkText(text: string, size: number, overlap: number): string[] {
    if (size <= 0) size = 500;
    if (overlap < 0) overlap = 0;
    if (overlap >= size) overlap = Math.floor(size / 2);

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end));
      if (end >= text.length) break;
      start += size - overlap;
    }

    return chunks;
  }
}
