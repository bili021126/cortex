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

export type {
  DepEntry,
  DepGroup,
  DriftItem as DriftItem,
  ReportMeta,
  JsonReport as DriftJsonReport,
} from './configuration-drift.js';

export type {
  PkgInfo,
  Edge,
  CycleInfo,
  AnalyzerOutput,
  AnalyzerMeta,
} from './monorepo-analyzer.js';
