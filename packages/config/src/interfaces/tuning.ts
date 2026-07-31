/**
 * @cortex/config — 调参配置接口
 *
 * L4·环境变量+调参层。所有可调的运行时参数，按域分组。
 *
 * @module interfaces/tuning
 * @layer root — 零依赖，纯类型层
 */

/** 单个环境变量定义 */
export interface EnvVarEntry {
  /** 默认值 */
  default: string | null;
  /** 描述 */
  desc: string;
}

/** 执行参数——P1-5 收敛：仅 reactMaxLoops 有消费点，其余 7 字段已删除 */
export interface ExecutionTuning {
  reactMaxLoops: number;
}

/** 信任参数 */
export interface TrustTuning {
  baseScore: number;
  autoApproveL2: number;
  autoApproveL3: number;
  l0l1Bonus: number;
  l2Penalty: number;
  l3Penalty: number;
  bypassTtlMs: number;
}

/** 验证参数 */
export interface VerificationTuning {
  cacheTtlMs: number;
  barrelMaxSize: number;
  tsFileMaxSize: number;
}

/** 记忆参数 */
export interface MemoryTuning {
  bm25K1: number;
  bm25B: number;
  vectorDedupThreshold: number;
  staleFreezeDays: number;
  frozenObliterateDays: number;
  maintenanceWeightThreshold: number;
}

/** RLM 参数 */
export interface RlmTuning {
  maxDepth: number;
  minComplexityChars: number;
  minConfidence: number;
}

/** 调参分组——P1-5 收敛：scheduling 分组 4 字段均无消费点，已删除 */
export interface TuningParams {
  execution: ExecutionTuning;
  trust: TrustTuning;
  verification: VerificationTuning;
  memory: MemoryTuning;
  rlm: RlmTuning;
}

/** tuning.json 顶层结构 */
export interface TuningConfig {
  /** 环境变量定义 */
  env: Record<string, EnvVarEntry>;
  /** 调参分组 */
  tuning: TuningParams;
}
