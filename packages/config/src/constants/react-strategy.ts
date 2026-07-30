/** ReAct 硬检测参数 */
export const REACT_MAX_LOOPS = 64;              // 最大迭代次数
export const REACT_CONTEXT_HARD_LIMIT = 128_000; // 上下文硬阈值（tuning.json 真相源 128000）
export const REACT_FORCE_WRITE_LOOP = 1;         // 首次强制写盘轮数
export const REACT_HARD_REMINDER_LOOP = 5;        // 每N轮追加一次提醒
