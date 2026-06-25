import type { IMemoryStore } from '@cortex/shared';
import { DomainGateController } from './domain-gate.js';
import { PredictiveEncoder } from './predictive-encoder.js';
import { PredictiveRetriever } from './predictive-retriever.js';

export class MemoryWorldModel {
  public encoder: PredictiveEncoder;
  public retriever: PredictiveRetriever;
  public domainGate: DomainGateController;

  constructor(memoryStore: IMemoryStore) {
    this.domainGate = new DomainGateController();
    this.encoder = new PredictiveEncoder();
    this.retriever = new PredictiveRetriever(memoryStore, this.domainGate);
  }
}
