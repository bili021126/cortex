// ============================================================
// 🌿 Cortex 技能注册表 — ExecutionContext 实现
// 设计：纳西妲 | 实现：阿贝多
//
// @moved-from projects/solo-flight/src/context/execution-context.ts
// ============================================================

import type {
  SkillId,
  SkillInput,
  SkillResult,
  ExecutionContext,
  ServiceContainer,
  Logger,
} from './types.js';

export class DefaultExecutionContext implements ExecutionContext {
  readonly input: SkillInput;
  readonly services: ServiceContainer;
  readonly logger: Logger;
  readonly signal: AbortSignal;
  readonly store: Map<string, unknown>;
  readonly getDependencyResult: <T>(skillId: SkillId) => Promise<SkillResult<T>>;

  constructor(params: {
    input: SkillInput;
    services: ServiceContainer;
    logger: Logger;
    signal?: AbortSignal;
    store?: Map<string, unknown>;
    getDependencyResult: <T>(skillId: SkillId) => Promise<SkillResult<T>>;
  }) {
    this.input = params.input;
    this.services = params.services;
    this.logger = params.logger;
    this.signal = params.signal ?? new AbortController().signal;
    this.store = params.store ?? new Map();
    this.getDependencyResult = params.getDependencyResult;
  }
}
