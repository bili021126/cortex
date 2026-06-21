/**
 * @cortex/config — 修宪默认值常量
 *
 * @module constants/amendment
 * @layer root
 */
/** 修宪默认超时天数配置 */
export declare const DEFAULT_AMENDMENT_TIMEOUT: {
    /** pending_judgment 超时天数 */
    readonly judgmentTTLDays: 7;
    /** draft 超时天数 */
    readonly draftTTLDays: 14;
    /** 连续超时自动拒绝的阈值 */
    readonly maxStaleCount: 3;
};
//# sourceMappingURL=amendment.d.ts.map