import type { MemoryEntry } from '@cortex/shared';

// scene 和 persona 类型——后续可从 shared 导入精确定义
type RetrievalScene = string;
type PersonaId = string;

interface PredictiveEncoding {
  content: string;
  embedding: number[];
  relevancePredict: {
    scenes: RetrievalScene[];
    personas: PersonaId[];
    decayCurve: number[];        // 简单线性衰减 [1.0, 0.8, 0.6, ...]
  };
}

export class PredictiveEncoder {
  // 规则驱动的 scene 推断——后续 Phase 可升级为 LLM 驱动
  private static SCENE_RULES: Record<string, RetrievalScene[]> = {
    'code-repair': ['code-repair', 'code-review', 'architecture'],
    'code-review': ['code-review', 'architecture'],
    'architecture': ['architecture'],
    'general': ['general'],
  };

  encode(
    entry: MemoryEntry,
    context: { scene: RetrievalScene; persona: PersonaId; taskType?: string }
  ): PredictiveEncoding {
    const scene = context.scene || 'general';
    return {
      content: entry.summary,
      embedding: entry.embedding ?? [],
      relevancePredict: {
        scenes: PredictiveEncoder.SCENE_RULES[scene] ?? ['general'],
        personas: [context.persona || 'cyrene'],
        decayCurve: this.defaultDecay(entry.weight ?? 1.0),
      },
    };
  }

  private defaultDecay(weight: number, steps = 10): number[] {
    return Array.from({ length: steps }, (_, i) => weight * Math.max(0, 1 - i / steps));
  }
}
