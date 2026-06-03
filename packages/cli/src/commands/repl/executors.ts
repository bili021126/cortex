 
/**
 * repl/executors.ts — REPL 执行器桶导出。
 *
 * 从单一 872 行文件重构为按功能拆分的子模块：
 *   - state.ts          共享会话历史状态
 *   - chat-executor.ts   Chat 模式（任务/闲聊分流）
 *   - talk-executor.ts   Talk 模式（昔涟独聊）
 *   - social-executor.ts Trio（三人对话）+ Party（群聊）
 *   - plan-executor.ts   Plan 模式（甘雨规划+三省审议）
 *
 * 外部调用方通过此桶导入，内部子模块仅作实现细节。
 */

export { clearTalkHistory } from "./executors/state.js";

export { executeChatInput } from "./executors/chat-executor.js";
export { executeTalkInput } from "./executors/talk-executor.js";
export { executeTrioInput, executePartyInput } from "./executors/social-executor.js";
export { executePlanInput, formatPlanTree, handlePlanCommand } from "./executors/plan-executor.js";
