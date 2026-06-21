/**
 * @cortex/config — 管线上下文常量
 *
 * 控制调度管线事件注入 MetaAgent prompt 时的截断长度和数量上限。
 * 从 engine/core/meta-agent.ts 硬编码中抽离到此。
 *
 * @layer root
 * @since v2.5.41
 */
/** 管线上下文注入的单条输出截断长度 */
export declare const PIPELINE_CTX_MAX_OUTPUT_LEN = 500;
/** 管线上下文注入的单条错误截断长度 */
export declare const PIPELINE_CTX_MAX_ERROR_LEN = 300;
/** plan() 注入提示词时的最近事件上限 */
export declare const PIPELINE_CTX_RECENT_LIMIT = 20;
/** _pipelineContext 数组硬上限，超出时截半 */
export declare const PIPELINE_CTX_HARD_CAP = 200;
/** 内存记忆条目软上限，超出时按 lastAccessedAt 升序 archive */
export declare const DEFAULT_MAX_TOTAL_MEMORIES = 10000;
/** 浏览器默认视口尺寸 */
export declare const BROWSER_DEFAULT_VIEWPORT: {
    readonly width: 1280;
    readonly height: 720;
};
/** CLI 内部错误退出码 */
export declare const CLI_EXIT_INTERNAL_ERROR = 8;
/** CLI 确认拒绝退出码 */
export declare const CLI_EXIT_CONFIRM_DENIED = 6;
/** CLI 成功退出码 */
export declare const CLI_EXIT_SUCCESS = 0;
/** Windows UTF-8 代码页切换命令 */
export declare const WINDOWS_CHCP_UTF8 = "chcp 65001";
/** CLI REPL plan 模式单节点输出截断长度 */
export declare const CLI_REPL_PLAN_OUTPUT_MAX_LEN = 600;
//# sourceMappingURL=pipeline.d.ts.map