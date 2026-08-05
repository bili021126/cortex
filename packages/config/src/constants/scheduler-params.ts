/** Scheduler 调度参数 */
export const SCHEDULER_MAX_REPLAN_PER_NODE = 3;
export const SCHEDULER_MAX_TOTAL_REPLANS = 10;
/** 连续降级 drain 次数上限——防无限重规划链 */
export const SCHEDULER_MAX_DEGRADED_DRAINS = 5;
export const SCHEDULER_ROUND_TIMEOUT_MS = 300_000;

/** WorkerPool 队列上限——超出时新任务被立即拒绝 */
export const WORKER_POOL_MAX_QUEUE = 100;

/** task-board claim lease——claimed 节点超时自动回收为 pending */
export const CLAIM_LEASE_MS = 120_000;

/** 单节点 dispatch 超时——与 reactLoopTimeoutMs 取 min */
// R13-harness：env 覆写口（活性用例触发超时路径的前置条件——race 被 120s 下限锁死无法测）
export const NODE_DISPATCH_TIMEOUT_MS = Number(process.env["CORTEX_NODE_DISPATCH_TIMEOUT_MS"]) || 120_000;

/** R12-B3：claim 撞 lease 的重试上限——上限内跳过本轮等回收（崩溃残留不打死），超上限才 failNode（防永久悬置） */
export const CLAIM_RETRY_LIMIT = 3;

/** executeAll 全局超时默认值（A1：与 defaults/engine.json 单源对齐 600s） */
export const EXECUTE_ALL_TIMEOUT_MS = 600_000;
