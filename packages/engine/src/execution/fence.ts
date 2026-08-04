// ============================================================
// @cortex/engine/execution/fence —— 不可信内容围栏标记（R12-F 组）
//
// @layer 规划-执行层
// @role 内容注入防护——五条"内容→prompt"路径统一标记
//
// 实现已移至 @cortex/shared/fence（注入点横跨 engine/memory-store 跨包共享）——
// 本文件保留为 re-export 兼容（engine 内部引用路径不变）。
// ============================================================
export { fence } from "@cortex/shared";
