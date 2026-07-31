/** ReAct 硬检测参数 */
/**
 * P1-1 单源：REACT_MAX_LOOPS 唯一定义在本文件（与 tuning.json reactMaxLoops=32 对齐）。
 * engine-defaults.ts 从 constants/index 引用本常量作为编译期兜底，
 * 运行时仍可由 tuning.json 的 reactMaxLoops 覆盖（loadEngineDefaults 优先级更高）。
 */
export const REACT_MAX_LOOPS = 32;
export const REACT_CONTEXT_HARD_LIMIT = 128_000; // 上下文硬阈值（tuning.json 真相源 128000）
export const REACT_FORCE_WRITE_LOOP = 1;         // 首次强制写盘轮数
export const REACT_HARD_REMINDER_LOOP = 5;        // 每N轮追加一次提醒
