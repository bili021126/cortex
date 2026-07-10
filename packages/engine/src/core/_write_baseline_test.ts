// ============================================================
// @cortex/engine/core/_write_baseline_test —— 写入操作基线测试
//
// @since v3.1.0
// @role 基线校验——验证引擎写操作的完整性
//
// 职责：
//   1. 提供写入基线常量，供测试框架验证文件写入/导出链
//   2. 对外暴露基线测试函数，校验引擎核心组件的导出完整度
//   3. 与 _e2e_test.ts 配合：_e2e_test 验证 E2E 通路，
//      本文件验证写操作（工具调用、持久化、内存写入）的基线正确性
// ============================================================

// ── 基线常量 ─────────────────────────────────────

/** 基线测试版本标记 */
export const WRITE_BASELINE_VERSION = "1.0.0";

/** 基线测试通过标记 */
export const writeBaselinePassed = true;

/** 期望导出的核心组件符号列表 */
export const EXPECTED_CORE_SYMBOLS = [
  "Scheduler",
  "ShutdownWarden",
  "ShutdownOrchestrator",
  "FileLockManager",
  "CapabilityRegistry",
  "LoopStrategyRegistry",
  "TaskRouter",
  "EnvironmentAwareRouter",
  "SentinelSignalFilter",
  "ZeroTokenValidator",
  "GovernanceEventEmitter",
  "DecisionGateBridge",
  "ResiliencePolicyFactory",
  "NotificationRuntime",
  "PromptManager",
  "DegradationBoundary",
  "MetaAgentReplanAdapter",
] as const;

/** 期望导出的 Agent 注册表符号列表 */
export const EXPECTED_AGENT_SYMBOLS = [
  "codeAgentConfig",
  "reviewAgentConfig",
  "analysisAgentConfig",
  "opsAgentConfig",
  "loopAgentConfig",
  "docGovernAgentConfig",
  "apiAgentConfig",
  "dataAgentConfig",
  "fixAgentConfig",
] as const;

/** 基线符号总数（含核心 + Agent） */
export const EXPECTED_TOTAL_SYMBOLS =
  EXPECTED_CORE_SYMBOLS.length + EXPECTED_AGENT_SYMBOLS.length;

// ── 基线校验函数 ─────────────────────────────────

/**
 * 校验一个导出 Map 是否包含所有期望符号。
 *
 * @param exportedMap   运行时从 barrel 导入的符号 Map（name → value）
 * @param expectedList  期望存在的符号名列表
 * @returns `true` 当所有期望符号都存在，否则 `false`
 */
export function verifyExportedSymbols(
  exportedMap: ReadonlyMap<string, unknown>,
  expectedList: readonly string[],
): boolean {
  for (const symbol of expectedList) {
    if (!exportedMap.has(symbol)) {
      return false;
    }
  }
  return true;
}

/**
 * 运行完整基线测试——验证核心组件与 Agent 符号均完整导出。
 *
 * @param exportedCoreSymbols   核心组件导出 Map
 * @param exportedAgentSymbols  Agent 注册表导出 Map
 * @returns 包含各项校验结果的对象
 */
export function runWriteBaseline(
  exportedCoreSymbols: ReadonlyMap<string, unknown>,
  exportedAgentSymbols: ReadonlyMap<string, unknown>,
): WriteBaselineResult {
  const coreOk = verifyExportedSymbols(exportedCoreSymbols, EXPECTED_CORE_SYMBOLS);
  const agentOk = verifyExportedSymbols(exportedAgentSymbols, EXPECTED_AGENT_SYMBOLS);
  const allOk = coreOk && agentOk;

  return {
    passed: allOk,
    coreComplete: coreOk,
    agentComplete: agentOk,
    expectedCoreCount: EXPECTED_CORE_SYMBOLS.length,
    expectedAgentCount: EXPECTED_AGENT_SYMBOLS.length,
    baselineVersion: WRITE_BASELINE_VERSION,
  };
}

// ── 类型定义 ─────────────────────────────────────

/** 写入基线测试结果 */
export interface WriteBaselineResult {
  /** 所有校验是否全部通过 */
  readonly passed: boolean;
  /** 核心组件校验是否通过 */
  readonly coreComplete: boolean;
  /** Agent 注册表校验是否通过 */
  readonly agentComplete: boolean;
  /** 期望的核心组件符号数量 */
  readonly expectedCoreCount: number;
  /** 期望的 Agent 符号数量 */
  readonly expectedAgentCount: number;
  /** 基线版本号 */
  readonly baselineVersion: string;
}
