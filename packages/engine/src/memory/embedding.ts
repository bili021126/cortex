/**
 * 语义嵌入客户端 — 基于 @xenova/transformers (all-MiniLM-L6-v2)。
 *
 * 架构原则：
 * - 模型单例懒加载（首次调用自动下载 ~80MB ONNX 模型到 HF cache）
 * - 384d 归一化向量输出（余弦相似度计算零开销）
 * - 零 API 成本，WASM 本地推理（Node.js 20+）
 * - 不强制依赖：import 本模块时才触发模型加载
 *
 * @module memory/embedding
 */

import { EMBEDDING_DIM } from "./schema.js";

// ── 类型 ──────────────────────────────────────

type EmbeddingPipeline = (text: string) => Promise<number[]>;

// ── 单例状态 ──────────────────────────────────

let _pipeline: EmbeddingPipeline | null = null;
let _loading: Promise<EmbeddingPipeline> | null = null;

// ── 懒加载 ────────────────────────────────────

async function _ensurePipeline(): Promise<EmbeddingPipeline> {
  if (_pipeline) return _pipeline;

  // 防止并发调用重复加载
  if (_loading) return _loading;

  _loading = (async (): Promise<EmbeddingPipeline> => {
    const { pipeline } = await import("@xenova/transformers");
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
    _pipeline = async (text: string): Promise<number[]> => {
      // 截断过长文本（MiniLM max 256 tokens, ~1800 chars）
      const truncated = text.length > 2000 ? text.slice(0, 2000) : text;
      const result = await extractor(truncated, {
        pooling: "mean",
        normalize: true,
      });
      const data = result.data as Float32Array;
      return Array.from(data);
    };
    return _pipeline;
  })();

  const pipe = await _loading;
  _loading = null;
  return pipe;
}

// ── 公开 API ──────────────────────────────────

/**
 * 为单条文本生成 384d 语义嵌入向量。
 *
 * 首次调用时自动下载 ONNX 模型（~80MB），
 * 后续调用复用已加载模型。
 *
 * @returns 384d 归一化向量（L2 norm = 1）
 */
export async function embedText(text: string): Promise<number[]> {
  const pipe = await _ensurePipeline();
  const vec = await pipe(text);
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(
      `[embedding] 维度不匹配: 期望 ${EMBEDDING_DIM}, 实际 ${vec.length}`,
    );
  }
  return vec;
}

/**
 * 批量嵌入，减少 pipeline 调用开销。
 *
 * MiniLM 推理快（~5-10ms/text），<100 条顺序处理即可。
 * 不需要真正 batch（transformers.js 暂不支持 batch_size 参数）。
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await _ensurePipeline();
  const results: number[][] = [];
  for (const text of texts) {
    const vec = await pipe(text);
    if (vec.length === EMBEDDING_DIM) {
      results.push(vec);
    }
  }
  return results;
}

/**
 * 检查模型是否已加载（用于测试/诊断，不触发加载）。
 */
export function isModelLoaded(): boolean {
  return _pipeline !== null;
}
