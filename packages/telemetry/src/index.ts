// ============================================================
// @cortex/telemetry —— 运行时遥测与可观测性套件
//
// @file-overview
// 本文档是 @cortex/telemetry 的桶导出，定义遥测采集、采样、
// 批处理和注册机制的完整类型与实现。
//
// @module-convention 模块化铁律（§四 —— Barrel 铁律）
// 1. 凡 src/ 下新增公开类型/接口/类，必须在本文件追加 export * 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/telemetry 包名导入。
// 3. 收益：文件合并/拆分/重命名——只要 barrel 出口不变，所有引用方无感。
//
// @宪法一致性
// - §十三 接口隔离：ITelemetryCollector / ICollectorRegistry / Sampler / Batcher
//   各自独立接口，无瑞士军刀接口
// - §十四 Strategy 模式：Sampler / Batcher 均为策略接口 + 多种实现
// - §十四 Factory 模式：CollectorRegistry.registerFactory() 惰性初始化
// - §十四 Adapter 模式：ConsoleCollector / FileCollector 适配同一 ITelemetryCollector 接口
// - §十 禁止 any：所有公开类型使用具体 interface
// - §十三 readonly 优先：TelemetryData / TelemetryBatch 等共享数据字段均为 readonly
// ============================================================

// ─── 核心类型 ───────────────────────────────────────
export type {
  TelemetryTag,
  TelemetryData,
  CollectResult,
  ITelemetryCollector,
  CollectorFactory,
  CollectorRegistration,
  ICollectorRegistry,
  SamplerDecision,
  Sampler,
  TelemetryBatch,
  Batcher,
} from "./types.js";

// ─── Collector 实现 ─────────────────────────────────
export { ConsoleCollector } from "./console-collector.js";
export type { ConsoleCollectorOptions } from "./console-collector.js";

export { FileCollector } from "./file-collector.js";
export type { FileCollectorOptions } from "./file-collector.js";

// ─── Collector 注册表 ──────────────────────────────
export { CollectorRegistry } from "./collector-registry.js";

// ─── 采样策略 ──────────────────────────────────────
export { RateSampler } from "./sampler.js";
export { ThresholdSampler } from "./sampler.js";

// ─── 批处理策略 ────────────────────────────────────
export { SizeBatcher } from "./batcher.js";
export { TimeBatcher } from "./batcher.js";
