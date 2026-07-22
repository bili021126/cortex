/**
 * layer-contract.ts — Cortex 依赖分层契约（机器可读单一真相源）
 *
 * 声明 29 个 workspace 包的架构层级（L0–L4），供依赖分层门禁校验。
 *
 * 分层规则（PACKAGE_POSITIONING.md 边界原则 §1、§4）:
 *   - 包只能依赖 **同层或更低层** 的包（低层 ← 高层，严格单向）
 *   - 依赖图严格 DAG，无循环
 *
 * 层级按 **真实依赖 DAG** 划分（非概念角色）:
 *   L0 基础       — 类型/配置/无状态工具，被广泛依赖，自身几乎无内部依赖
 *   L1 核心服务   — 单一职责服务，仅依赖 L0
 *   L2 复合服务   — 组合多个 L1/L0 能力
 *   L3 领域/治理  — 领域编排与制度执行
 *   L4 编排/入口  — 运行时内核与用户入口（engine 编排全部下层）
 *
 * ⚠️ 与文档旧版差异：engine 曾被描述为「L1 内核」，但它实际编排
 *    governance / skill-kit / memory-store 等，是真正的顶层编排器，
 *    故归入 L4。本文件以真实依赖为准。
 */

/** 层级名称（索引即层号 L0–L4） */
export const LAYER_NAMES = [
  "L0 基础",
  "L1 核心服务",
  "L2 复合服务",
  "L3 领域/治理",
  "L4 编排/入口",
] as const;

/**
 * 29 包 → 层号映射（单一真相源）。
 *
 * 键为包 id（packages/<id> 目录名，非 @cortex/ 全名）。
 * 新增包时必须在此登记，否则分层门禁的完整性校验会失败。
 */
export const CORTEX_LAYER_CONTRACT: Record<string, number> = {
  // ── L0 基础：类型 / 配置 / 无状态工具 ──
  shared: 0,
  tools: 0,
  config: 0,
  logging: 0,
  resilience: 0,
  telemetry: 0,
  notification: 0,
  parser: 0,
  "fsm-compiler": 0,
  testing: 0,
  "pattern-extractor": 0,
  protocol: 0,
  "design-tokens": 0,

  // ── L1 核心服务：单一职责，仅依赖 L0 ──
  llm: 1,
  doctor: 1,
  scheduler: 1,
  memory: 1,
  "plugin-runner": 1,
  "prompt-kit": 1,
  "context-manager": 1,
  client: 1,

  // ── L2 复合服务：组合 L1/L0 ──
  "memory-store": 2,
  platform: 2,

  // ── L3 领域 / 治理 ──
  governance: 3,
  "skill-kit": 3,

  // ── L4 编排 / 入口 ──
  engine: 4,
  cli: 4,
  desktop: 4,
  server: 4,
};
