// ============================================================
// @cortex/engine/core/loop-strategy-registry —— 循环策略注册表
//
// @layer 规划-执行层
// @role 事轴内化——四策略注册表 + canHandle 规则路由
//
// 职责：
//   1. 注册所有可用的循环策略（react/direct/decompose/jury）
//   2. 规则路由：根据任务特征自动选择策略
//   3. 策略顾问上下文：为 MetaAgent 提供策略描述
//
// 设计：docs/core/循环策略注册表设计.md
// ============================================================

import type { TaskNode } from "@cortex/shared";
import type { IStep } from "@cortex/scheduler";

/**
 * 循环策略定义——描述一个可插拔的执行策略。
 */
export interface LoopStrategy {
  /** 策略名——对应 TaskNode.preferredStrategy 和 resolvePipeline 的 case */
  name: "react" | "direct" | "decompose" | "jury";
  /** 人类可读描述——给 MetaAgent/策略顾问看的 */
  description: string;
  /** 规则路由：返回 true 表示此策略适合处理该任务 */
  canHandle: (task: TaskNode) => boolean;
  /** 对应的管道步骤 */
  pipeline: IStep[];
}

/**
 * 循环策略注册表——策略选择和顾问上下文的单一真相源。
 *
 * 三条使用路径：
 *   1. 规则路由（零 LLM 成本）：selectByRule(task) → 匹配第一个 canHandle 为 true 的策略
 *   2. 策略顾问（LLM 辅助）：getAdvisorContext() → 注入 MetaAgent prompt
 *   3. 直接查询：get(name) → 查询单个策略定义
 */
export class LoopStrategyRegistry {
  private map = new Map<string, LoopStrategy>();
  /** 默认管道（由外部通过 setter 注入，打破对 memory-bridge 的反向依赖） */
  static defaultPipeline: IStep[] = [];
  /** 直接管道（由外部通过 setter 注入） */
  static directPipeline: IStep[] = [];

  /** 注入默认管道（替换数组内容以保留引用） */
  static setDefaultPipeline(pipeline: IStep[]): void {
    LoopStrategyRegistry.defaultPipeline.length = 0;
    LoopStrategyRegistry.defaultPipeline.push(...pipeline);
  }

  /** 注入直接管道 */
  static setDirectPipeline(pipeline: IStep[]): void {
    LoopStrategyRegistry.directPipeline.length = 0;
    LoopStrategyRegistry.directPipeline.push(...pipeline);
  }

  register(s: LoopStrategy): void {
    this.map.set(s.name, s);
  }

  /** 规则路由——按注册顺序匹配，返回第一个 canHandle 为 true 的策略 */
  selectByRule(task: TaskNode): LoopStrategy | null {
    for (const s of this.map.values()) {
      if (s.canHandle(task)) {
        // eslint-disable-next-line no-console
        console.log(`[TRACE dispatch] LoopStrategyRegistry.selectByRule: matched=${s.name} payloadLen=${task.payload.length} tags=[${task.tags.join(",")}] preferredStrategy=${task.preferredStrategy ?? "(none)"}`);
        return s;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[TRACE dispatch] LoopStrategyRegistry.selectByRule: noMatch → fallback=react payloadLen=${task.payload.length} tags=[${task.tags.join(",")}] preferredStrategy=${task.preferredStrategy ?? "(none)"}`);
    return null; // 调用方回退到 "react"
  }

  /** 给策略顾问用的上下文文本——可直接注入 MetaAgent prompt */
  getAdvisorContext(): string {
    return [...this.map.values()]
      .map(s => `- **${s.name}**: ${s.description}`)
      .join("\n");
  }

  /** 查询单个策略 */
  get(name: string): LoopStrategy | undefined {
    return this.map.get(name);
  }

  /** 所有已注册策略名 */
  list(): string[] {
    return [...this.map.keys()];
  }
}

// ─── 默认策略注册 ───────────────────────────────────

const TOOL_DEPENDENCY_TAGS = ["browser", "playwright", "shell", "git", "http", "file-io"] as const;

export const loopStrategyRegistry = new LoopStrategyRegistry();

// 1. Direct — 单步确定性任务
loopStrategyRegistry.register({
  name: "direct",
  description: "单次 LLM 调用，适合纯文本生成和简单分类（payload < 200 字且无工具依赖）",
  canHandle: (task) => {
    const hasToolDeps = task.tags.some(t => TOOL_DEPENDENCY_TAGS.includes(t as typeof TOOL_DEPENDENCY_TAGS[number]));
    return !hasToolDeps && task.payload.length < 200;
  },
  pipeline: LoopStrategyRegistry.directPipeline,
});

// 2. Decompose — 大任务天然可分解
loopStrategyRegistry.register({
  name: "decompose",
  description: "RLM 分治模式，适合超过 500 字的大任务或审计/扫描/迁移类任务",
  canHandle: (task) => {
    if (task.payload.length > 500) return true;
    if (task.isRlmSubtask === true) return true;
    const decomposeTags = ["audit", "scan", "migration"] as const;
    return task.tags.some(t => decomposeTags.includes(t as typeof decomposeTags[number]));
  },
  pipeline: LoopStrategyRegistry.defaultPipeline, // 未来替换为 DECOMPOSE_PIPELINE
});

// 3. Jury — 多视角交叉验证
loopStrategyRegistry.register({
  name: "jury",
  description: "多视角并行采样+审校，适合需要交叉验证的任务（宪法审查、安全检查）",
  canHandle: (task) => task.needsMultiPerspective === true,
  pipeline: LoopStrategyRegistry.defaultPipeline, // 未来替换为 JURY_PIPELINE
});

// 4. React — 默认 fallback（不注册 canHandle，作为 selectByRule 返回 null 时的回退）
loopStrategyRegistry.register({
  name: "react",
  description: "标准推理+工具循环，适合有工具依赖的多步任务（默认策略）",
  canHandle: () => false, // 永不匹配，作为 fallback
  pipeline: LoopStrategyRegistry.defaultPipeline,
});
