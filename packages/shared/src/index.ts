// ============================================================
// @cortex/shared —— Cortex 类型中枢（Public API Surface）
//
// 【Public API】
//   本文件导出的所有类型/枚举/常量为跨包公开契约。
//   所有外部消费者应从 @cortex/shared 导入，非子路径。
//
// 【领域分桶】
//   按包依赖方向分组：agent / task / memory / infra / fs-adapter / toolkit
//   消费者按需只导入需要的桶。
// - toolkit.ts/infra.ts/cli-adapter.ts/file-lock-manager.ts/skill-registry.ts:
//   工具/基础设施/CLI/文件锁/技能注册的辅助类型
// - fs-adapter.ts: 文件系统适配器接口（纳西妲增强建议：解耦 Toolkit 与 Node.js API）
//
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
// ============================================================

export * from "./agent.js";
export * from "./task.js";
export * from "./memory.js";
export * from "./toolkit.js";
export * from "./cli-adapter.js";
export * from "./infra.js";
export * from "./skill-registry.js";
export * from "./fs-adapter.js";
export * from "./modification-record.js";
export * from "./doc-registry.js";
export * from "./amendment.js";
export * from "./tui-bridge.js";
