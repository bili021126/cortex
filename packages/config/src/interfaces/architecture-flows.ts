/**
 * @cortex/config — 架构流映射配置接口
 *
 * 「五流六层 ↔ 代码落点」的单一真相源。
 * 与 `packages/tools/src/layer-contract.ts` 正交：
 *   - layer-contract 回答「这个包在依赖 DAG 的哪一层」（依赖约束）
 *   - 本接口回答「这段代码属于哪条行为流」（行为归属）
 *
 * @module interfaces/architecture-flows
 * @layer root — 零依赖，纯类型层
 */

/** 单条流（或基础设施层）的映射条目 */
export interface ArchitectureFlow {
  /** 流标识（interaction / governance / planning-execution / skill-tool / memory / infrastructure） */
  id: string;
  /** 中文名 */
  name: string;
  /** 对应六层中的哪一层 */
  layer: string;
  /** 这条流回答的「做什么」——一句话 */
  question: string;
  /**
   * 代码落点。可为目录或单文件，仓库根相对路径。
   * 门禁强制：每条路径必须真实存在，且必须落在某个真实包内。
   */
  directories: string[];
  /** 约束这条流的七原则（名称须在 principles 名单内） */
  principles: string[];
}

/** 架构流映射配置 */
export interface ArchitectureFlowsConfig {
  flows: ArchitectureFlow[];
  /** 七原则全集——flows[].principles 只能从此取 */
  principles: string[];
  /** 六层全集——flows[].layer 只能从此取 */
  layers: string[];
  /**
   * 已知未归类的模块目录。
   * 门禁断言：实际计算出的「未被任何流认领的 src 顶层子目录」必须与此列表相等——
   * 新增模块若未归类，门禁即红（双向对齐，防静默漂移）。
   */
  knownUnassigned: string[];
  _description?: string;
  _generatedAt?: string;
  _sources?: Record<string, string>;
  _knownGaps?: string[];
}
