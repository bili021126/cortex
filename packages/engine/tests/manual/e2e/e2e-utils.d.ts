/**
 * e2e-utils.ts — E2E 测试共享工具
 *
 * 解决所有 E2E 测试的共性坑位：
 *   1. Windows .env 需清除 \r 后解析
 *   2. stdout 缓冲导致日志延迟——使用 stderr.write 强制刷新
 *   3. DeepSeek API 端点 /chat/completions（非 /v1/...）
 *   4. LlmAdapter 正确构造（非手搓，含 tool_choice 支持）
 *   5. 项目根路径 —— 向上搜索 cortex-agents.json
 */
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
/** 强制刷新到 stderr（不受 stdout 缓冲影响） */
export declare function log(msg: string): void;
/** 从指定目录加载 .env 到 process.env（处理 \r\n 换行符） */
export declare function loadEnv(dir: string): void;
/** 向上搜索项目根（sentinel: cortex-cognition.json——沙箱屏蔽 cortex-agents.json） */
export declare function findProjectRoot(startDir?: string): string;
/** 创建标准 LlmAdapter（从 .env 加载密钥） */
export declare function createE2eAdapter(): LlmAdapter;
/** 标准 E2E 引导：找到根 → 加载 .env → 创建适配器和工具包 */
export declare function e2eBootstrap(): {
    root: string;
    llm: LlmAdapter;
    toolkit: Toolkit;
};
//# sourceMappingURL=e2e-utils.d.ts.map