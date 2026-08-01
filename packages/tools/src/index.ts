/**
 * index.ts — @cortex/tools 公开 API
 *
 * 导出 monorepo 分析工具与配置漂移探测器
 *
 * 用法（CLI）:
 *   npx tsx packages/tools/src/configuration-drift.ts [--json]
 *   npx tsx packages/tools/src/monorepo-analyzer.ts [--json] [--verbose]
 *
 * 用法（API）:
 *   import { detectDrift, collectDependencies } from '@cortex/tools';
 *   import { analyzeMonorepo, detectCycles } from '@cortex/tools';
 */

// ── 配置漂移探测器 ──
export { collectDependencies, detectDrift } from './configuration-drift.js';
export type {
  DepEntry,
  DepGroup,
  DriftItem as DriftItem,
  ReportMeta,
  JsonReport as DriftJsonReport,
} from './configuration-drift.js';

// ── Tool 层回滚注册表 ──
export { ToolRollbackRegistry, toolRollbackRegistry } from './rollback-registry.js';

// ── Monorepo 分析器 ──
export {
  findProjectRoot,
  collectPackages,
  collectDeps,
  buildEdges,
  detectCycles,
  detectDrifts,
  detectLayerViolations,
  generateDot,
  generateMermaid,
  computeLayers,
  scanSrcImports,
  detectUndeclaredImports,
} from './monorepo-analyzer.js';
export type {
  PkgInfo,
  Edge,
  CycleInfo,
  LayerViolation,
  AnalyzerOutput,
  AnalyzerMeta,
} from './monorepo-analyzer.js';

// ── 依赖分层契约（Cortex 专用真相源） ──
export { CORTEX_LAYER_CONTRACT, LAYER_NAMES } from './layer-contract.js';
