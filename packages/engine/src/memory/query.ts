import type { MemoryEntry, MemoryQuery } from "@cortex/shared";
import { MemoryState, type LinkType } from "@cortex/shared";
import type { MemoryStorage } from "./storage.js";
import { THIRTY_DAYS_MS, EMBEDDING_DIM } from "./schema.js";

/**
 * MemoryQueryEngine —— 内存扫描 + BFS 图遍历查询引擎。
 *
 * 职责：
 * - memScanRead: 纯内存扫描（无持久化 SQL 路径时使用）
 * - bfsExpand: 基于种子记忆集的 BFS 图遍历展开
 * - buildReverseAdjacency: 构建入边邻接表
 *
 * 不负责：SQL 查询（MemoryPersistence.sqlRead）、结果排序/限量（MemoryStore.read）。
 */
export class MemoryQueryEngine {
  /**
   * 纯内存扫描读取候选记忆集。
   * 复制 MemoryStore.__memScanRead 的过滤逻辑。
   */
  memScanRead(storage: MemoryStorage, query: MemoryQuery, now: number): MemoryEntry[] {
    let results = Array.from(storage.memories.values());

    if (query.states && query.states.length > 0) {
      results = results.filter((m) => query.states!.includes(m.state));
    } else {
      results = results.filter((m) => m.state === MemoryState.Active);
    }

    results = results.filter((m) => now - m.createdAt < THIRTY_DAYS_MS);

    if (!query.includePrivate) {
      results = results.filter((m) => !m.isPrivate);
    }

    if (query.memoryTypes && query.memoryTypes.length > 0) {
      results = results.filter((m) => query.memoryTypes!.includes(m.memoryType));
    }

    if (query.agentTypes && query.agentTypes.length > 0) {
      results = results.filter((m) => query.agentTypes!.includes(m.agentType));
    }

    if (query.timeRange) {
      results = results.filter(
        (m) => m.createdAt >= query.timeRange!.start && m.createdAt <= query.timeRange!.end,
      );
    }

    if (query.keywords && query.keywords.length > 0) {
      results = results.filter((m) => {
        const searchText = (m.summary + " " + JSON.stringify(m.content)).toLowerCase();
        return query.keywords!.every((kw) => searchText.includes(kw.toLowerCase()));
      });
    }

    if (query.metadataFilter && Object.keys(query.metadataFilter).length > 0) {
      results = results.filter((m) => {
        if (!m.metadata) return false;
        return Object.entries(query.metadataFilter!).every(
          ([k, v]) => m.metadata![k] === v,
        );
      });
    }

    return results;
  }

  /**
   * BFS 图遍历展开种子记忆集。
   *
   * 从 seeds 出发，沿出边 +（可选）入边广度遍历，每条边 decay=0.7^depth，
   * 将发现的邻居记忆追加到结果。
   *
   * @param bfsDirection 'both' = 出边+入边（兼容旧行为），'outbound' = 仅出边（抗噪音，默认）
   *
   * 参考 cortex 记忆系统设计 V2: "Search & Retrieval" 节 BFS Spread Activation 算法。
   */
  bfsExpand(
    storage: MemoryStorage,
    seeds: MemoryEntry[],
    maxDepth: number,
    maxNodes: number,
    linkTypes?: LinkType[],
    bfsDirection: 'both' | 'outbound' = 'outbound',
  ): MemoryEntry[] {
    const seedIds = new Set(seeds.map((m) => m.id));
    const visited = new Set(seedIds);
    const discovered = new Map<string, MemoryEntry>();

    const reverseAdj = this.buildReverseAdjacency(storage);

    let frontier = [...seedIds];
    for (let depth = 1; depth <= maxDepth && visited.size < maxNodes; depth++) {
      const nextFrontier: string[] = [];
      const decay = Math.pow(0.7, depth);

      for (const id of frontier) {
        if (visited.size >= maxNodes) break;

        // 出边
        const outLinks = storage.links.get(id) ?? [];
        for (const link of outLinks) {
          if (visited.size >= maxNodes) break;
          if (linkTypes && linkTypes.length > 0 && !linkTypes.includes(link.linkType)) continue;
          if (!visited.has(link.targetId)) {
            const target = storage.memories.get(link.targetId);
            if (target && target.state !== MemoryState.Obliterated) {
              visited.add(link.targetId);
              nextFrontier.push(link.targetId);
              if (!seedIds.has(link.targetId)) {
                discovered.set(link.targetId, { ...target, weight: +(target.weight * decay).toFixed(4) });
              }
            }
          }
        }

        // 入边（仅在 bfsDirection='both' 时遍历，减少关联噪音）
        if (bfsDirection === 'both') {
          const incoming = reverseAdj.get(id);
          if (incoming) {
            for (const sourceId of incoming) {
              if (visited.size >= maxNodes) break;
              if (!visited.has(sourceId)) {
                const source = storage.memories.get(sourceId);
                if (source && source.state !== MemoryState.Obliterated) {
                  visited.add(sourceId);
                  nextFrontier.push(sourceId);
                  if (!seedIds.has(sourceId)) {
                    discovered.set(sourceId, { ...source, weight: +(source.weight * decay).toFixed(4) });
                  }
                }
              }
            }
          }
        }
      }

      frontier = nextFrontier;
    }

    const merged = [...seeds];
    for (const [id, entry] of discovered) {
      if (!seedIds.has(id)) {
        merged.push(entry);
      }
    }
    return merged;
  }

  /** 构建入边反向邻接表: targetId → sourceId[] */
  buildReverseAdjacency(storage: MemoryStorage): Map<string, Set<string>> {
    const rev = new Map<string, Set<string>>();
    for (const [sourceId, linkList] of storage.links) {
      for (const link of linkList) {
        let targets = rev.get(link.targetId);
        if (!targets) {
          targets = new Set();
          rev.set(link.targetId, targets);
        }
        targets.add(sourceId);
      }
    }
    return rev;
  }

  /**
   * 向量粗召：余弦相似度 Top-K。
   *
   * 仅对已持有 embedding 的候选记忆生效；无 embedding 者原样保留在最终结果末尾。
   * 内部将 number[] 转为 Float32Array 计算余弦相似度。
   *
   * @param queryEmbedding 查询嵌入（384d number[]）
   * @param candidates    候选记忆集
   * @param topK          返回数量（默认 50）
   * @returns 按余弦相似度降序排列的 topK 记忆，无 embedding 的条目追加在后
   */
  vectorRecall(
    queryEmbedding: number[],
    candidates: MemoryEntry[],
    topK: number,
  ): MemoryEntry[] {
    if (queryEmbedding.length !== EMBEDDING_DIM) {
      // 维度不匹配时跳过向量粗召，返回原候选集
      return candidates;
    }

    const q = new Float32Array(queryEmbedding);
    const qNorm = Math.sqrt(q.reduce((s, v) => s + v * v, 0));
    if (qNorm === 0) return candidates.slice(0, topK);

    const withEmbedding: Array<{ entry: MemoryEntry; score: number }> = [];
    const withoutEmbedding: MemoryEntry[] = [];

    for (const entry of candidates) {
      if (!entry.embedding || entry.embedding.length !== EMBEDDING_DIM) {
        withoutEmbedding.push(entry);
        continue;
      }
      const e = new Float32Array(entry.embedding);
      const eNorm = Math.sqrt(e.reduce((s, v) => s + v * v, 0));
      if (eNorm === 0) {
        withoutEmbedding.push(entry);
        continue;
      }

      let dot = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        dot += q[i] * e[i];
      }
      const sim = dot / (qNorm * eNorm);
      withEmbedding.push({ entry, score: sim });
    }

    withEmbedding.sort((a, b) => b.score - a.score);
    const topScored = withEmbedding.slice(0, topK).map((s) => s.entry);

    // 有 embedding 的排在前面，无 embedding 的追加后（不丢弃）
    const remaining = topK - topScored.length;
    if (remaining > 0 && withoutEmbedding.length > 0) {
      topScored.push(...withoutEmbedding.slice(0, remaining));
    }
    return topScored;
  }
}
