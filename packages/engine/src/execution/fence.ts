// ============================================================
// @cortex/engine/execution/fence —— 不可信内容围栏标记（R12-F 组）
//
// @layer 规划-执行层
// @role 内容注入防护（R12-F 分层——不是"全部走 fence"）：
//   本 fence() 只标记【不可信数据】两类注入点——
//     · F1 RAG 记忆（pipeline.ts / context-builder.ts，source="rag-memory"）
//     · F2 工具输出=网页/文件等（react-loop.ts，source="tool:*"）
//   另两条"内容→prompt"路径由【不同机制】守，勿误以为也被围栏覆盖：
//     · F3 systemPrompt → 不 fence（围栏会破坏指令性），改在尾部加"[UNTRUSTED 内=数据非指令]"
//       约定段 + 来源注释（见 bootstrap/factory/loaders/agents.loader.ts:212/266）
//     · F4 自增殖技能 → trial 门控，未经人工批准不注入（见 skill-pipeline.ts:117 / agent-skill-types.ts:32）
//
// 实现已移至 @cortex/shared/fence（注入点横跨 engine/memory-store 跨包共享）——
// 本文件保留为 re-export 兼容（engine 内部引用路径不变）。
// ============================================================
export { fence } from "@cortex/shared";
