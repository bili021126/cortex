/**
 * engine/config/engine-defaults.ts — Engine 层独有常量
 *
 * 集中 engine 层所有硬编码常量，消除魔法数字。
 * 同时被 memory-store/schema.ts 和 engine 模块消费。
 *
 * @module engine/config/engine-defaults
 * @since v3.x — 全系统重构
 */
/** 文件锁默认超时（毫秒） */
export declare const DEFAULT_LOCK_TIMEOUT_MS = 30000;
/** 文件锁清理间隔（毫秒） */
export declare const CLEANUP_INTERVAL_MS = 60000;
/** 优雅关闭超时（毫秒） */
export declare const SHUTDOWN_TIMEOUT_MS = 15000;
/** 强制退出延迟（毫秒） */
export declare const SHUTDOWN_FORCE_EXIT_DELAY_MS = 2000;
/** 调度器最大轮数 */
export declare const SCHEDULER_MAX_ROUNDS = 25;
/** 调度器每轮超时（毫秒） */
export declare const SCHEDULER_ROUND_TIMEOUT_MS = 120000;
/** ReAct 最大循环次数 */
export declare const REACT_MAX_LOOPS = 20;
/** 向量维度（384d ONNX） */
export declare const EMBEDDING_DIM = 384;
/** 向量 LRU 缓存容量 */
export declare const EMBEDDING_CACHE_SIZE = 10000;
/** 内容哈希算法 */
export declare const CONTENT_HASH_ALGO = "sha256";
/** 向量去重余弦相似度阈值 */
export declare const VECTOR_DEDUP_THRESHOLD = 0.95;
/** 权重衰减因子 */
export declare const WEIGHT_AGING_FACTOR = 0.95;
/** 过期未访问天数阈值（可归档） */
export declare const STALE_FREEZE_DAYS = 30;
/** 归档后湮灭天数 */
export declare const FROZEN_OBLITERATE_DAYS = 7;
/** maintenance 权重阈值 */
export declare const MAINTENANCE_WEIGHT_THRESHOLD = 0.05;
/** 记忆总数上限（委托 @cortex/config） */
export declare const MAX_TOTAL_MEMORIES = 10000;
/** 记忆模式版本号 */
export declare const SCHEMA_VERSION = 5;
/** 监控时间窗口（毫秒） */
export declare const MONITOR_WINDOW_MS = 60000;
/** 监控告警阈值 */
export declare const MONITOR_THRESHOLD = 10;
export interface EngineDefaults {
    lockTimeoutMs: number;
    cleanupIntervalMs: number;
    shutdownTimeoutMs: number;
    shutdownForceExitDelayMs: number;
    schedulerMaxRounds: number;
    schedulerRoundTimeoutMs: number;
    reactMaxLoops: number;
    embeddingDim: number;
    embeddingCacheSize: number;
    contentHashAlgo: string;
    vectorDedupThreshold: number;
    weightAgingFactor: number;
    staleFreezeDays: number;
    frozenObliterateDays: number;
    maintenanceWeightThreshold: number;
    maxTotalMemories: number;
    schemaVersion: number;
    monitorWindowMs: number;
    monitorThreshold: number;
}
/** Engine 默认配置单例 */
export declare const ENGINE_DEFAULTS: EngineDefaults;
/**
 * 加载引擎默认配置，支持 overrides 和环境变量覆盖。
 *
 * 优先级：overrides 参数 > CORTEX_* 环境变量 > 默认值
 */
export declare function loadEngineDefaults(overrides?: Partial<EngineDefaults>): EngineDefaults;
//# sourceMappingURL=engine-defaults.d.ts.map