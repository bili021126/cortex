// ============================================================
// cognitive-engine.ts —— 认知行为引擎
//
// @frozen 2026-07 — 全量图景审计确认：已实例化但 sort.mode==="cognitive"
// 路径不可达（ContextManager 未注入，planning 策略无法触发）。
// 代码保留供未来激活，当前不维护不评审。
//
// 让记忆系统具备类人认知模式：
//   (a) 贝叶斯相关性评分 —— P(relevant | query, context, task)
//   (b) 傅里叶启发式时间衰减 —— 周期性回忆强化
//   (c) 艾宾浩斯遗忘曲线 —— 基于记忆强度的自然遗忘
//   (d) 联想链式激活 —— 沿 link 图扩散 (Spreading Activation)
//   (e) 情绪加权 —— 情感色彩调节记忆唤起
//   (f) 边界回归 —— 自适应相关阈值
//   (g) 综合认知评分 —— 多维度融合排序
//
// @design 所有评分函数均为纯函数式（无副作用），状态由外部管理
// @since Core-3 — 混合检索 + 认知建模
// ============================================================

import type { MemoryEntry, MemoryLink } from "@cortex/shared";
import { clamp } from "@cortex/shared";

// ── 类型 ──────────────────────────────────────

/** 认知引擎配置 */
export interface CognitiveConfig {
  // 综合评分权重
  weightHybrid: number;       // 混合检索权重 (默认 0.35)
  weightBayesian: number;     // 贝叶斯相关性权重 (默认 0.30)
  weightDecay: number;        // 时间衰减权重 (默认 0.20)
  weightLink: number;         // 联想链激活权重 (默认 0.15)

  // 贝叶斯参数
  bayesianPriorStrength: number;   // 先验强度 (0..1, 默认 0.3)
  bayesianKeywordMatchWeight: number; // 关键词匹配似然权重 (默认 0.5)
  bayesianRecencyWeight: number;   // 近因效应似然权重 (默认 0.3)
  bayesianAccessFreqWeight: number; // 访问频率似然权重 (默认 0.2)

  // 傅里叶衰减参数
  fourierLambda: number;      // 衰减率 (默认 0.001, 约 1155 天半衰期)
  fourierAlpha: number;       // 谐波振幅 (默认 0.15)
  fourierOmega: number;       // 谐波频率 (默认 2π/86400000, 即每日周期)
  fourierPhi: number;         // 谐波相位偏移 (默认 0)

  // 遗忘曲线参数
  forgettingStrengthBase: number;  // 基础记忆强度 (默认 30 天)
  forgettingAccessMultiplier: number; // 每次访问强度增幅 (默认 5 天)

  // 联想激活参数
  spreadingDepth: number;     // 最大扩散深度 (默认 3)
  spreadingDepthDecay: number; // 每跳衰减率 (默认 0.5)
  spreadingMinScore: number;  // 激活最小值 (默认 0.001)

  // 情绪加权参数
  emotionalAmplification: number;  // 情绪唤起放大系数 (默认 0.1)

  // 边界回归参数
  boundaryEma: number;        // EMA 平滑因子 (默认 0.1)
  boundaryMinScore: number;   // 最低阈值 (默认 0.01)
}

/** 认知评分结果 */
export interface CognitiveScore {
  entry: MemoryEntry;
  hybridScore: number;
  bayesianScore: number;
  decayScore: number;
  linkScore: number;
  emotionalBonus: number;
  finalScore: number;
}

/** 联想链式激活节点 */
export interface ActivatedNode {
  entry: MemoryEntry;
  activation: number;
  depth: number;
  sourceId: string; // 从哪个节点激活的
}

// ── 默认配置 ─────────────────────────────────

export const DEFAULT_COGNITIVE_CONFIG: CognitiveConfig = {
  weightHybrid: 0.35,
  weightBayesian: 0.30,
  weightDecay: 0.20,
  weightLink: 0.15,

  bayesianPriorStrength: 0.3,
  bayesianKeywordMatchWeight: 0.5,
  bayesianRecencyWeight: 0.3,
  bayesianAccessFreqWeight: 0.2,

  fourierLambda: 0.001,
  fourierAlpha: 0.15,
  fourierOmega: (2 * Math.PI) / 86400000,
  fourierPhi: 0,

  forgettingStrengthBase: 30,
  forgettingAccessMultiplier: 5,

  spreadingDepth: 3,
  spreadingDepthDecay: 0.5,
  spreadingMinScore: 0.001,

  emotionalAmplification: 0.1,

  boundaryEma: 0.1,
  boundaryMinScore: 0.01,
};

// ── 数学工具 ─────────────────────────────────

/** Sigmoid 归一化: 1 / (1 + e^(-x)) */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ── 贝叶斯相关性评分 ─────────────────────────

/**
 * 朴素贝叶斯相关性评分。
 *
 * P(relevant | query, entry) ∝ P(relevant) * Π P(feature_i | relevant)
 *
 * 特征:
 *   - keywordMatch: 查询词出现在 memory.summary/semantic_gist 中的比例
 *   - recency:      最近访问时间的近因效应
 *   - accessFreq:   访问频率（accessCount 归一化）
 *
 * 平滑: 加一平滑避免零概率
 */
export function bayesianRelevanceScore(
  entry: MemoryEntry,
  queryText: string,
  now: number,
  maxAccessCount: number,
  config: CognitiveConfig,
): number {
  const { bayesianPriorStrength, bayesianKeywordMatchWeight, bayesianRecencyWeight, bayesianAccessFreqWeight } = config;

  // ── 先验 P(relevant) ──
  const prior = bayesianPriorStrength;

  // ── 似然 P(features | relevant) ──

  // ① 关键词匹配
  const kwLikelihood = computeKeywordMatchLikelihood(entry, queryText);

  // ② 近因 (Laplace 平滑)
  const MS_PER_HOUR = 3600000;
  const ageHours = (now - entry.lastAccessedAt) / MS_PER_HOUR;
  const recencyLikelihood = 1 / (1 + Math.log1p(Math.max(0, ageHours)));

  // ③ 访问频率
  const accessLikelihood = maxAccessCount > 0
    ? (entry.accessCount + 1) / (maxAccessCount + 2)
    : 0.5;

  // ── 加权乘积 ──
  const likelihood =
    kwLikelihood * bayesianKeywordMatchWeight +
    recencyLikelihood * bayesianRecencyWeight +
    accessLikelihood * bayesianAccessFreqWeight;

  // ── 后验 ∝ prior * likelihood ──
  const posterior = prior * likelihood;

  // H5 fix: sigmoid 中心从 0.5 改为 prior，拉伸因子加大。
  // 原公式 posterior≤0.3 时 sigmoid((x-0.5)*10) 被永久压制在 [0.007,0.12]，无区分力。
  // 新公式：posterior=prior → 0.5（基线），posterior→1 → 接近 1（强信号）。
  return clamp(sigmoid((posterior - prior) * 20), 0, 1);
}

/** 关键词匹配似然 */
function computeKeywordMatchLikelihood(entry: MemoryEntry, queryText: string): number {
  if (!queryText) return 0.5;
  const qTokens = tokenizeSimple(queryText);
  if (qTokens.length === 0) return 0.5;

  const searchText = (entry.summary + " " + entry.semantic_gist).toLowerCase();
  let matches = 0;
  for (const t of qTokens) {
    if (searchText.includes(t)) matches++;
  }
  return matches / qTokens.length;
}

/** 简单分词 */
function tokenizeSimple(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。.!！?、；;："''()（）【】[\]{}<>]+/)
    .filter((t) => t.length > 0);
}

// ── 傅里叶启发式时间衰减 ─────────────────────

/**
 * 带谐波的指数衰减函数——模拟周期性记忆强化。
 *
 * decay(t) = exp(-λt) * (1 + α·sin(ωt + φ))
 *
 * 其中:
 *   t = 距上次访问的时间 (毫秒)
 *   λ = 衰减率 (fourierLambda)
 *   α = 谐波振幅 (fourierAlpha)
 *   ω = 谐波频率 (fourierOmega, 默认每日周期)
 *   φ = 相位偏移 (fourierPhi)
 *
 * 效果: 每天某些时刻（如早上）记忆权重自动小幅回升。
 */
export function fourierTimeDecay(
  tMs: number,
  config: CognitiveConfig,
): number {
  const { fourierLambda, fourierAlpha, fourierOmega, fourierPhi } = config;

  // t 转换为天（浮点精度）
  const tDays = tMs / 86400000;

  // 指数衰减基底
  const expDecay = Math.exp(-fourierLambda * tDays);

  // 谐波调制: 振幅不能过大以保持衰减为主
  const harmonic = 1 + fourierAlpha * Math.sin(fourierOmega * tMs + fourierPhi);

  // 合成
  const decay = expDecay * harmonic;

  // 谐波可能使值 >1，裁剪
  return clamp(decay, 0, 1 + fourierAlpha);
}

/**
 * 计算"时间衰减奖励"——越近期越高。
 * 将衰减值映射为加分（0 = 很久没访问, 1 = 刚访问过）。
 */
export function timeDecayScore(
  entry: MemoryEntry,
  now: number,
  config: CognitiveConfig,
): number {
  const tMs = Math.max(0, now - entry.lastAccessedAt);
  return fourierTimeDecay(tMs, config);
}

// ── 艾宾浩斯遗忘曲线 ─────────────────────────

/**
 * 艾宾浩斯遗忘曲线: R = e^{-t / S}
 *
 * 其中:
 *   t = 距创建/上次访问的时间 (天)
 *   S = 记忆强度 = strengthBase + accessCount * accessMultiplier
 *
 * accessCount 体现间隔重复效应——被访问越多，遗忘越慢。
 */
export function ebbinghausRetention(
  entry: MemoryEntry,
  now: number,
  config: CognitiveConfig,
): number {
  const { forgettingStrengthBase, forgettingAccessMultiplier } = config;

  const tDays = Math.max(0, now - entry.lastAccessedAt) / 86400000;
  const S = forgettingStrengthBase + entry.accessCount * forgettingAccessMultiplier;

  if (S <= 0) return 0;
  return Math.exp(-tDays / S);
}

// ── 联想链式激活 (Spreading Activation) ────────

/**
 * 沿记忆 link 图扩散激活。
 *
 * 算法: BFS 遍历 → 激活值 = sourceActivation × depthDecay^depth
 *
 * @param sourceScore  源记忆的激活值（混合/贝叶斯分）
 * @param getLinks     查询指定 memoryId 的出边函数
 * @param getEntry     查询指定 memoryId 的记忆
 * @param config       认知配置
 * @returns 被激活的节点列表（不含源节点）
 */
export function spreadingActivation(
  sourceId: string,
  sourceScore: number,
  getLinks: (id: string) => MemoryLink[],
  getEntry: (id: string) => MemoryEntry | undefined,
  config: CognitiveConfig,
): ActivatedNode[] {
  const { spreadingDepth, spreadingDepthDecay, spreadingMinScore } = config;
  const activated: ActivatedNode[] = [];
  const visited = new Set<string>([sourceId]);

  // BFS 队列: [id, depth, accumulatedScore]
  const queue: Array<{ id: string; depth: number; score: number }> = [{ id: sourceId, depth: 0, score: sourceScore }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= spreadingDepth) continue;

    const links = getLinks(current.id);
    for (const link of links) {
      const targetId = link.targetId;
      if (visited.has(targetId)) continue;
      visited.add(targetId);

      // 激活值: 沿深度指数衰减
      const depthFactor = Math.pow(spreadingDepthDecay, current.depth + 1);
      const activation = sourceScore * depthFactor;

      if (activation < spreadingMinScore) continue;

      const targetEntry = getEntry(targetId);
      if (!targetEntry) continue;

      activated.push({
        entry: targetEntry,
        activation,
        depth: current.depth + 1,
        sourceId: current.id,
      });

      queue.push({ id: targetId, depth: current.depth + 1, score: activation });
    }
  }

  return activated;
}

/**
 * 计算关联奖励: 一个 entry 在激活列表中的 link 激活值。
 * 如果 entry 在激活列表中，返回其激活值；否则为 0。
 */
export function computeLinkBonus(
  entryId: string,
  activatedNodes: ActivatedNode[],
): number {
  const node = activatedNodes.find((n) => n.entry.id === entryId);
  return node ? node.activation : 0;
}

// ── 情绪加权 ─────────────────────────────────

/**
 * 情绪唤起奖励。
 *
 * emotionalSalience ∈ [-1, 1]:
 *   -1 = 强烈负面 (高唤起)
 *    0 = 中性
 *   +1 = 强烈正面 (高唤起)
 *
 * 高唤起记忆（正面或负面）在评分时获得轻微加分。
 */
export function emotionalBonus(
  emotionalSalience: number | undefined,
  config: CognitiveConfig,
): number {
  if (emotionalSalience === undefined || emotionalSalience === 0) return 0;
  const { emotionalAmplification } = config;

  // |salience| 越大加分越多，±1 时满分
  return Math.abs(emotionalSalience) * emotionalAmplification;
}

// ── 边界回归 ─────────────────────────────────

/**
 * 在线边界回归——自适应阈值管理。
 *
 * 基于 EMA 跟踪最近批次中被保留条目的最低分，
 * 低于当前阈值的记忆不再进入高优先级层。
 */
export class BoundaryRegressor {
  private _threshold: number;
  private readonly _ema: number;
  private readonly _minScore: number;

  constructor(initialThreshold = 0.15, ema = 0.1, minScore = 0.01) {
    this._threshold = initialThreshold;
    this._ema = ema;
    this._minScore = minScore;
  }

  get threshold(): number {
    return this._threshold;
  }

  /**
   * 根据一批结果更新阈值。
   * 取被保留条目中的最低分，EMA 更新。
   */
  update(scores: number[]): void {
    if (scores.length === 0) return;

    const observedMin = Math.min(...scores);
    // 被裁切边界为 observedMin - 一个小余量
    const margin = Math.min(0.03, observedMin * 0.2);
    const boundary = Math.max(0, observedMin - margin);

    // EMA 更新
    this._threshold = this._threshold + this._ema * (boundary - this._threshold);
    this._threshold = Math.max(this._minScore, Math.min(0.95, this._threshold));
  }

  /** 低于阈值者过滤掉 */
  filter<T extends { finalScore: number }>(items: T[]): T[] {
    return items.filter((item) => item.finalScore >= this._threshold);
  }

  /** 重置 */
  reset(threshold?: number): void {
    this._threshold = threshold ?? 0.15;
  }
}

// ── 综合认知评分 ─────────────────────────────

/**
 * CognitiveEngine —— 认知评分的统一入口。
 *
 * 对一批候选记忆执行全维度评分:
 *   finalScore = hybridScore × w1 + bayesianScore × w2 + decayScore × w3 + linkBonus × w4 + emotionalBonus
 *
 * 其中 linkBonus 来自联想链式激活（源记忆激活扩散到关联记忆）。
 */
export class CognitiveEngine {
  readonly config: CognitiveConfig;
  private _boundaryRegressor: BoundaryRegressor;

  constructor(config: Partial<CognitiveConfig> = {}) {
    this.config = { ...DEFAULT_COGNITIVE_CONFIG, ...config };
    this._boundaryRegressor = new BoundaryRegressor(
      this.config.boundaryMinScore + 0.05,
      this.config.boundaryEma,
      this.config.boundaryMinScore,
    );
  }

  get boundaryRegressor(): BoundaryRegressor {
    return this._boundaryRegressor;
  }

  /**
   * 对单条记忆执行全维度评分。
   *
   * @param entry           记忆条目
   * @param hybridScore     来自混合检索的 hybridScore ∈ [0,1]
   * @param queryText       查询文本（用于贝叶斯相关性）
   * @param now             当前时间戳
   * @param maxAccessCount  最大访问次数（用于归一化）
   * @param linkBonus       联想激活奖励
   * @returns CognitiveScore
   */
  scoreEntry(
    entry: MemoryEntry,
    hybridScore: number,
    queryText: string,
    now: number,
    maxAccessCount: number,
    linkBonus: number,
  ): CognitiveScore {
    const { config } = this;

    // 贝叶斯
    const bayesian = bayesianRelevanceScore(entry, queryText, now, maxAccessCount, config);

    // 时间衰减奖励
    const decay = timeDecayScore(entry, now, config);

    // 情绪加分
    const emotional = emotionalBonus(
      (entry as MemoryEntry & { emotionalSalience?: number }).emotionalSalience,
      config,
    );

    // 综合评分
    const { weightHybrid, weightBayesian, weightDecay, weightLink } = config;
    const final =
      hybridScore * weightHybrid +
      bayesian * weightBayesian +
      decay * weightDecay +
      linkBonus * weightLink +
      emotional;

    return {
      entry,
      hybridScore,
      bayesianScore: bayesian,
      decayScore: decay,
      linkScore: linkBonus,
      emotionalBonus: emotional,
      finalScore: clamp(final, 0, 1),
    };
  }

  /**
   * 批量评分 + 排序。
   *
   * @param entries         候选记忆列表
   * @param hybridScores    每条记忆的混合检索分 { id → hybridScore }
   * @param queryText       查询文本
   * @param now             当前时间戳
   * @param getLinks        获取链接的函数（用于联想激活）
   * @param getEntry        获取记忆的函数
   * @param sourceEntryIds  源记忆 ID 列表——只有这些记忆的 link 图被展开
   * @returns 按 finalScore 降序排列的认知评分结果
   */
  scoreAndRank(
    entries: MemoryEntry[],
    hybridScores: Map<string, number>,
    queryText: string,
    now: number,
    getLinks: (id: string) => MemoryLink[],
    getEntry: (id: string) => MemoryEntry | undefined,
  ): CognitiveScore[] {
    if (entries.length === 0) return [];

    const maxAccessCount = Math.max(1, ...entries.map((e) => e.accessCount));

    // ① 联想链式激活: 高分源记忆扩散到关联记忆
    const sourceEntryIds = entries.map((e) => e.id);
    const activatedMap = new Map<string, number>(); // entryId → totalActivation

    const topHybridEntries = [...entries]
      .sort((a, b) => (hybridScores.get(b.id) ?? 0) - (hybridScores.get(a.id) ?? 0))
      .slice(0, 5); // Top-5 源记忆扩散

    for (const source of topHybridEntries) {
      const srcScore = hybridScores.get(source.id) ?? 0;
      if (srcScore < 0.1) continue;

      const activated = spreadingActivation(
        source.id,
        srcScore,
        getLinks,
        getEntry,
        this.config,
      );

      for (const act of activated) {
        // 只计入也在 candidates 中的记忆（裁切后的激活值）
        if (sourceEntryIds.includes(act.entry.id) || entries.some((e) => e.id === act.entry.id)) {
          const current = activatedMap.get(act.entry.id) ?? 0;
          activatedMap.set(act.entry.id, current + act.activation);
        }
      }
    }

    // ② 逐条目评分
    const scored = entries.map((entry) => {
      const hybridScore = hybridScores.get(entry.id) ?? 0;
      const linkBonus = activatedMap.get(entry.id) ?? 0;
      return this.scoreEntry(entry, hybridScore, queryText, now, maxAccessCount, linkBonus);
    });

    // ③ 排序
    scored.sort((a, b) => b.finalScore - a.finalScore);

    // ④ 更新边界回归
    const finalScores = scored.map((s) => s.finalScore);
    this._boundaryRegressor.update(finalScores);

    return scored;
  }

  /**
   * 边界回归过滤: 移除低于阈值的记忆。
   */
  boundaryFilter(scored: CognitiveScore[]): CognitiveScore[] {
    return this._boundaryRegressor.filter(scored);
  }

  /**
   * 计算艾宾浩斯遗忘率（用于判断记忆是否需要淘汰）。
   */
  isForgotten(entry: MemoryEntry, now: number, threshold = 0.05): boolean {
    return ebbinghausRetention(entry, now, this.config) < threshold;
  }
}
