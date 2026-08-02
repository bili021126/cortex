/**
 * model-routers —— 调度四抽象之实现（由 scheduling-implementations.ts 拆分，2026-06-20 SCH-1）。
 *
 * 拆分自原 1457 行单文件：strategies / drivers / execution-models / model-routers。
 */

import { type TaskNode } from "@cortex/shared";
import type { IModelRouter, ModelTier } from "./scheduling-types.js";
import { VALID_TIERS } from "@cortex/config";

export class FixedModelRouter implements IModelRouter {
  readonly name = "fixed";

  async route(_node: TaskNode, _agentType: string, defaultModel: string): Promise<string> {
    return defaultModel;
  }
}

/**
 * 路由决策——由 SemanticModelRouter.route() 产出，可被 onDecision 回调消费。
 * 用于调试、成本分析和可观测性。
 */
export interface RouteDecision {
  nodeId: string;
  agentType: string;
  floorTier: ModelTier;
  assessedTier: ModelTier;
  effectiveTier: ModelTier;
  source: "recommended" | "classifier" | "classifier-cached" | "fallback";
  model: string;
  ms: number;
}

/**
 * SemanticModelRouter —— 语义驱动的模型路由，只能升级不可降级。
 *
 * **设计原则**
 * - **A 路径（甘雨标注）**：MetaAgent 规划时在 TaskNode 上设 `recommendedTier`，零成本
 * - **B 路径（LLM 分类）**：router 内置轻量 LLM 调用，对任务语义做三选一分类
 * - **Floor 保护**：Agent 注册模型所属 tier 作为最低保障线——路由只能在此基础上提高，绝不降低
 * - **降级螺旋截断**：去除所有 payload 长度等机械启发式，避免语义错判
 * - **分类器缓存**：payload 哈希为 key，避免相同/相似任务重复调用 LLM
 * - **可观测性**：通过 onDecision 回调暴露路由决策详情
 *
 * **路由优先级**
 * 1. node.recommendedTier 已设 → 直接使用（甘雨已理解任务语义）
 * 2. 缓存命中 → 复用历史分类结果
 * 3. LLM 三选一分类 → "这个任务需要 fast/standard/thinking？"
 * 4. 分类失败/超时 → 重试 → 保守回退 standard
 * 5. 最终 = max(agentFloor, assessed) —— 只能升级，不可降级
 *
 * @since v2.6.6 从 ComplexityBasedRouter 重建——六层启发式 → 语义路由 + floor
 */
export class SemanticModelRouter implements IModelRouter {
  readonly name = "semantic";

  /** 模型名 → tier 反向映射（用于计算 agent floor） */
  private readonly _modelTier: Map<string, ModelTier> = new Map();

  /** Agent 模型注册表——懒获取（Scheduler 构造时 models 尚未填充） */
  private readonly _modelsGetter: () => Map<string, string>;

  /** 分类器缓存：payload 哈希 → { tier, at }。LRU 淘汰，防止无界增长 */
  private readonly _cache = new Map<number, { tier: ModelTier; at: number }>();
  private static readonly CACHE_MAX = 500;

  /** P2 fix: in-flight 分类 Promise 去重——相同 payload 并发请求复用同一次分类，防 thundering herd */
  private readonly _classifyInFlight = new Map<number, Promise<ModelTier>>();

  /** 分类器超时（ms） */
  private readonly _classifierTimeoutMs: number;

  /** 分类器重试次数（不含首次） */
  private readonly _classifierRetries: number;

  /** 路由决策回调——用于可观测性 */
  private readonly _onDecision?: (d: RouteDecision) => void;

  /**
   * @param options.catalog 模型目录——key 为 ModelTier，value 为模型标识符。未配置的 tier 回退到 defaultModel。
   * @param options.modelsOrGetter Agent 类型 → 注册模型的 Map，或获取该 Map 的懒函数。用于计算 Agent floor。
   * @param options.classifier 可选——LLM 分类器，(payload: string) => Promise<ModelTier>。
   * @param options.classifierTimeoutMs 分类器单次调用超时（ms），默认 3000。
   * @param options.classifierRetries 分类器失败后重试次数，默认 1（共 2 次尝试）。
   * @param options.onDecision 可选——路由决策回调，用于可观测性/调试/成本分析。
   */
  constructor(options: {
    catalog: Partial<Record<ModelTier, string>>;
    modelsOrGetter?: Map<string, string> | (() => Map<string, string>);
    classifier?: (payload: string) => Promise<ModelTier>;
    classifierTimeoutMs?: number;
    classifierRetries?: number;
    onDecision?: (d: RouteDecision) => void;
  }) {
    const {
      catalog,
      modelsOrGetter,
      classifier,
      classifierTimeoutMs = 3000,
      classifierRetries = 1,
      onDecision,
    } = options;

    this.catalog = catalog;
    this.classifier = classifier;
    this._modelsGetter = typeof modelsOrGetter === "function"
      ? modelsOrGetter
      : () => modelsOrGetter ?? new Map();
    this._classifierTimeoutMs = classifierTimeoutMs;
    this._classifierRetries = classifierRetries;
    this._onDecision = onDecision;

    // 构建模型名 → tier 反向映射
    for (const [tier, modelName] of Object.entries(catalog)) {
      if (modelName) this._modelTier.set(modelName, tier as ModelTier);
    }
  }

  private readonly catalog: Partial<Record<ModelTier, string>>;
  private readonly classifier?: (payload: string) => Promise<ModelTier>;

  async route(node: TaskNode, agentType: string, defaultModel: string): Promise<string> {
    const t0 = Date.now();

    // ── Floor：Agent 注册模型所属 tier 作为最低保障线 ──
    const agentModel = this._modelsGetter().get(agentType) ?? defaultModel;
    const floorTier = this._modelTier.get(agentModel) ?? "standard";

    // ── Assess：语义判断任务所需 tier ──
    const { tier: assessedTier, source } = await this._assessTier(node.payload, node.recommendedTier);

    // ── Effective：max(floor, assessed) —— 只能升级不可降级 ──
    const effectiveTier = _maxTier(floorTier, assessedTier);
    const model = this.catalog[effectiveTier] ?? defaultModel;

    // ── 可观测性 ──
    this._onDecision?.({
      nodeId: node.id,
      agentType,
      floorTier,
      assessedTier,
      effectiveTier,
      source,
      model,
      ms: Date.now() - t0,
    });

    return model;
  }

  /**
   * 判断任务语义 tier。
   * @returns tier + 来源标记
   */
  private async _assessTier(
    payload: string,
    recommendedTier?: string,
  ): Promise<{ tier: ModelTier; source: RouteDecision["source"] }> {
    // A 路径：甘雨已在规划时标注 → 零成本
    if (recommendedTier && VALID_TIERS.has(recommendedTier)) {
      return { tier: recommendedTier as ModelTier, source: "recommended" };
    }

    // 缓存命中？
    const hash = _hashStr(payload);
    const cached = this._cache.get(hash);
    if (cached) {
      // P2 fix: 命中缓存时刷新访问时间——真 LRU（原实现命中不更新时间戳，实际为 FIFO）
      cached.at = Date.now();
      return { tier: cached.tier, source: "classifier-cached" };
    }

    // B 路径：LLM 语义分类（带超时 + 重试 + 并发去重）
    if (this.classifier) {
      const tier = await this._classify(payload, hash);
      if (tier) return { tier, source: "classifier" };
    }

    // 保守回退：不猜了
    return { tier: "standard", source: "fallback" };
  }

  /**
   * 执行一次语义分类（带超时 + 重试），并对相同 payload 的并发分类请求去重。
   * @returns 分类得到的合法 tier；全部失败/超时返回 undefined（调用方回退 standard）
   */
  private async _classify(payload: string, hash: number): Promise<ModelTier | undefined> {
    // P2 fix: thundering herd——相同 payload 并发时复用同一次分类 Promise，等待其落定
    const existing = this._classifyInFlight.get(hash);
    if (existing) {
      const tier = await existing.catch(() => undefined);
      if (tier && VALID_TIERS.has(tier)) {
        this._cache.set(hash, { tier, at: Date.now() });
        return tier;
      }
      return undefined;
    }

    // 发起分类任务并登记去重，完成后释放
    const task = this._classifyTask(payload).finally(() => {
      this._classifyInFlight.delete(hash);
    });
    this._classifyInFlight.set(hash, task);

    const tier = await task.catch(() => undefined);
    if (tier && VALID_TIERS.has(tier)) {
      // LRU 淘汰：超过上限时删除最旧的条目
      if (this._cache.size >= SemanticModelRouter.CACHE_MAX) {
        const oldest = [...this._cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) this._cache.delete(oldest[0]);
      }
      this._cache.set(hash, { tier, at: Date.now() });
      return tier;
    }
    return undefined;
  }

  /** 分类器核心——超时 + 重试循环；全部失败时抛错由 _classify 捕获回退 */
  private async _classifyTask(payload: string): Promise<ModelTier> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const classifier = this.classifier!;
    for (let attempt = 0; attempt <= this._classifierRetries; attempt++) {
      try {
        const tier = await _withTimeout(
          classifier(payload),
          this._classifierTimeoutMs,
        );
        if (VALID_TIERS.has(tier)) return tier;
      } catch {
        // 超时或异常——重试或回退
        console.error(`[scheduler] classifier timeout/error at attempt ${attempt}`);
      }
    }
    throw new Error("classifier failed after retries");
  }

  /**
   * 静态工厂：创建一个基于 LlmCallable 的简单分类器。
   * 用 flash 模型做语义三选一，适合绝大多数场景。
   *
   * @param llm LLM 调用入口（通常来自 MetaAgent.llm.chat）
   * @param model 分类用的模型名，默认 "deepseek-v4-flash"
   */
  static createSimpleClassifier(
    llm: (model: string, messages: Array<{ role: string; content: string }>) => Promise<string>,
    model = "deepseek-v4-flash",
  ): (payload: string) => Promise<ModelTier> {
    return async (payload: string): Promise<ModelTier> => {
      const resp = await llm(model, [{
        role: "system",
        content: [
          "You are the Cortex model router. Classify tasks into exactly one tier.",
          "- fast: trivial confirmations, comment changes, simple lookups",
          "- standard: everyday coding, reviews, moderate complexity",
          "- thinking: architecture analysis, deep refactors, constitution audits, multi-file reasoning",
          "Output ONLY one word: fast, standard, or thinking.",
        ].join("\n"),
      }, {
        role: "user",
        content: payload.slice(0, 2000),
      }]);
      const tier = resp.trim().toLowerCase();
      return VALID_TIERS.has(tier) ? tier as ModelTier : "standard";
    };
  }
}

/** 合法 tier 值集合（用于校验甘雨标注和分类器输出）
 * 单源定义 @cortex/config/constants/tiers */

/** Tier 排序：fast < standard < thinking */
const TIER_ORDER: Record<ModelTier, number> = { fast: 0, standard: 1, thinking: 2 };

function _maxTier(a: ModelTier, b: ModelTier): ModelTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/** 简单字符串哈希（DJB2）——用于分类器缓存 key */
function _hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** 为 Promise 加超时——超时时 reject。timer 在 p 完成时即清理 */
function _withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    p.then((v) => { clearTimeout(timer!); return v; }),
    timeoutPromise,
  ]);
}

