// ============================================================
// @cortex/shared —— Cortex v2.0 共享类型定义
//
// @file-overview
// 本文档是 @cortex/shared 的桶导出，定义跨包的类型契约。所有 export *
// 将对应域的完整类型/枚举/常量暴露给 @cortex/engine 和 @cortex/llm。
//
// @module-convention 模块化铁律（昔涟 v2.6 入宪）
// 1. 凡 src/ 下新增公开类型/枚举/常量，必须在本文件追加 export * 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/shared 包名导入。
// 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
// 违反者：导入路径越写越长，终至不可维护。
//
// @contract 类型中枢契约
// - agent.ts: AgentType 枚举、AGENT_TAGS 标签词汇表、状态机、工具权限、
//   技能模板接口、能力协议——是整个 Agent 体系的类型脊梁
// - task.ts: TaskNode、PipelineEventType、PipelinePriority 等任务管线类型
// - memory.ts: MemoryEntry、MemoryState、MemoryQuery 等记忆域类型
// - toolkit.ts/infra.ts/cli-adapter.ts/file-lock-manager.ts/skill-registry.ts:
//   工具/基础设施/CLI/文件锁/技能注册的辅助类型
// - fs-adapter.ts: 文件系统适配器接口（纳西妲增强建议：解耦 Toolkit 与 Node.js API）
//
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
// ============================================================

export * from "./agent.js";
export * from "./agent-display.js";
export * from "./task.js";
export * from "./memory.js";
export * from "./toolkit.js";
export * from "./file-lock-manager.js";
export * from "./cli-adapter.js";
export * from "./infra.js";
export * from "./skill-registry.js";
export * from "./fs-adapter.js";
export * from "./modification-record.js";
export * from "./doc-registry.js";
export * from "./amendment.js";
export * from "./kv-store.js";
export * from "./context-policy.js";
