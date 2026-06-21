/**
 * @cortex/config — RLM 递归拆解 & DENSITY 密度压缩常量
 *
 * 思考执行体系总纲 §四/§六 对应的所有硬编码阈值统一收容于此。
 *
 * @module constants/rlm
 * @layer root
 */
/** decompose 的最小信心阈值——低于此值回退到直接执行 */
export declare const RLM_MIN_CONFIDENCE = 0.6;
/** 子任务拆解的最大递归深度 */
export declare const RLM_MAX_DEPTH = 3;
/** 复杂度阈值：payload 字符数低于此值不触发拆解 */
export declare const RLM_MIN_COMPLEXITY_CHARS = 200;
/** light 密度压缩最大字符数 */
export declare const DENSITY_LIGHT_MAX_CHARS = 150;
/** medium 密度压缩最大字符数 */
export declare const DENSITY_MEDIUM_MAX_CHARS = 500;
//# sourceMappingURL=rlm.d.ts.map