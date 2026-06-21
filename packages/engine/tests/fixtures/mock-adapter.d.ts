/**
 * 共享测试夹具 —— 消除跨测试文件的 mock 复制粘贴。
 *
 * 使用方式：
 *   import { mockLlmAdapter, mockStuckAdapter, makeTestNode } from "../fixtures/mock-adapter.js";
 */
import { LlmAdapter } from "@cortex/llm";
import type { TaskNode } from "@cortex/shared";
/** 标准成功 mock：一次调用即返回最终答案 */
export declare function mockLlmAdapter(output?: string): LlmAdapter;
/** 无限循环 mock：永远返回 toolCall（用于测试 maxLoops 耗尽） */
export declare function mockStuckAdapter(): LlmAdapter;
/** 崩溃 mock：每次调用都抛错 */
export declare function mockCrashAdapter(errorMsg?: string): LlmAdapter;
/** 工具调后用 mock：先返回 toolCall，再返回最终答案 */
export declare function mockToolThenFinalAdapter(toolCall: {
    name: string;
    arguments: Record<string, unknown>;
}, finalOutput?: string): LlmAdapter;
/** 快捷构造 TaskNode（默认值填充） */
export declare function makeTestNode(overrides?: Partial<TaskNode>): TaskNode;
//# sourceMappingURL=mock-adapter.d.ts.map