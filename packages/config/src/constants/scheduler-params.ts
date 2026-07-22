/** Scheduler 调度参数 */
export const SCHEDULER_MAX_REPLAN_PER_NODE = 3;
export const SCHEDULER_MAX_TOTAL_REPLANS = 10;
export const SCHEDULER_ROUND_TIMEOUT_MS = 300_000;

/** WorkerPool 队列上限——超出时新任务被立即拒绝 */
export const WORKER_POOL_MAX_QUEUE = 100;

/** task-board claim lease——claimed 节点超时自动回收为 pending */
export const CLAIM_LEASE_MS = 120_000;

/** 单节点 dispatch 超时——与 reactLoopTimeoutMs 取 min */
export const NODE_DISPATCH_TIMEOUT_MS = 120_000;

/** executeAll 全局超时默认值 */
export const EXECUTE_ALL_TIMEOUT_MS = 300_000;
