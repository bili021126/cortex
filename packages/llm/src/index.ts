// ============================================================
// @cortex/llm —— LLM 适配层
//
// @file-overview
// 本文档是 @cortex/llm 的桶导出。
// 宪法 v2.5.2 裁定：独立为 @cortex/llm 包，零 Engine 运行时依赖，
// 仅依赖 @cortex/shared 类型。
//
// @contract LlmAdapter 契约
// - chat(taskNode, model): 向 LLM 发起 chat completion 请求
// - 输入：TaskNode（含 tags/payload/context） + model 名称
// - 输出：string（LLM 原始响应文本）
// - 异常：网络失败/Key 无效/速率限制时抛出 Error
// - 幂等：实例无状态，同一输入可多次调用无副作用
//
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
// ============================================================

export { LlmAdapter } from "./llm-adapter.js";
