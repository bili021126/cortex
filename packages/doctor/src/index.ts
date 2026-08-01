// ============================================================
// @cortex/doctor —— Monorepo 健康诊断套件
//
// @file-overview
// 本文件是 @cortex/doctor 的桶导出（barrel export），公开
// 健康诊断的全部公共 API。所有消费者应通过 import { ... }
// from '@cortex/doctor' 引入，禁止直接导入 src/ 下各子模块。
//
// @module-convention 模块化铁律
// 1. 凡 src/ 下新增公开类型/函数/类，必须在本文件追加 export 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/doctor 包名导入。
// 3. 违反者：导入路径越写越长，终至不可维护。
//
// @contract
// - HealthChecker: 核心健康检查入口，注册/编排检查器管线
// - doctor(): 便捷工厂函数，一键诊断
// - IChecker: 检查器接口，所有自定义检查器需实现
// - /types: 全部公开类型（Finding, CheckResult, HealthReport 等）
// ============================================================

// ── 核心入口 ──
export { HealthChecker, doctor } from "./checker.js";

// ── 观测层检查器（spec S2-8）──
export { AuditTrailChecker, AUDIT_SPAN_ID_OPTION } from "./audit-checker.js";

// ── 类型导出 ──
export type {
  FindingSeverity,
  Finding,
  CheckResult,
  CheckerOptions,
  IChecker,
  HealthReport,
  DoctorOptions,
  PackageMeta,
} from "./types.js";

// ── 常量导出 ──
export { HEALTH_GRADE, REQUIRED_PKG_FIELDS } from "./types.js";
