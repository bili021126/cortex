import type { MemoryEntry, IMemoryStore, MemoryQuery } from '@cortex/shared';
import type { DomainGateController } from './domain-gate.js';

type RetrievalScene = string;

export class PredictiveRetriever {
  private memoryStore: IMemoryStore;
  private domainGate: DomainGateController;
  private currentScene: RetrievalScene = 'general';

  constructor(memoryStore: IMemoryStore, domainGate: DomainGateController) {
    this.memoryStore = memoryStore;
    this.domainGate = domainGate;
  }

  onSceneChange(from: RetrievalScene, to: RetrievalScene): void {
    this.currentScene = to;
    const predicted = this.predictRelevant(to);
    // 预热：对预测可能需要的条目做一次轻量查询（触发缓存/解冻）
    if (predicted.length > 0) {
      this.memoryStore.read(
        {} as MemoryQuery,
        'HCA'
      ).catch(() => { /* 预热失败不应阻断 */ });
    }
  }

  predictRelevant(_scene: RetrievalScene): MemoryEntry[] {
    // Phase 6 基础版：按 scene 和当前激活域做简单过滤
    const _activeDomains = this.domainGate.getActiveDomains();
    return []; // 返回空——预热动作已由 read() 触发
                // 完整实现需要 MemoryStore 支持 relevancePredict 查询
                // Phase 6 留骨架，Phase 6+ 对接 CognitionEngine 的 relevance 字段
  }

  getCurrentScene(): RetrievalScene {
    return this.currentScene;
  }
}
