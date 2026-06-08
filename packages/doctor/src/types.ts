// ============================================================
// @cortex/doctor —— 健康诊断核心类型定义
//
// @file-overview
// 本文件定义 @cortex/doctor 的全部公开类型——包括检查发现
// (Finding)、检查结果 (CheckResult)、健康报告 (HealthReport)
// 以及检查器接口 (IChecker)。所有 barrel 导出通过 index.ts 汇聚。
//
// @module-convention
// 1. 本文件仅定义类型/接口/枚举——不含实现逻辑。
// 2. 类型命名统一使用 PascalCase，枚举成员使用 SCREAMING_SNAKE_CASE。
// 3. 所有类型字段均标注 JSDoc，确保生成 .d.ts 后消费者可获完整提示。
// ============================================================

// ============================================================
// 检查发现与结果
// ============================================================

/** 检查发现严重等级——与宪法 §8.1 SafeErrorReporter 对齐 */
export type FindingSeverity = "fatal" | "error" | "warning" | "info";

/** 单个检查发现 */
export interface Finding {
  /** 唯一标识（如 "PKG-FIELD-001"） */
  id: string;
  /** 严重等级 */
  severity: FindingSeverity;
  /** 所属检查器 */
  checker: string;
  /** 标题（一行摘要） */
  title: string;
  /** 详细描述 */
  message: string;
  /** 涉及的文件路径列表 */
  files: string[];
  /** 修复建议（可选——null = 无自动修复方案） */
  suggestion: string | null;
  /** 参考链接（可选——指向宪法条款或设计文档） */
  reference?: string;
}

/** 检查器产出——单个检查器的完整结果 */
export interface CheckResult {
  /** 检查器名称 */
  checker: string;
  /** 是否通过（errors + fatals = 0） */
  passed: boolean;
  /** 所有发现 */
  findings: Finding[];
  /** 快捷统计 */
  summary: {
    fatal: number;
    error: number;
    warning: number;
    info: number;
    total: number;
  };
  /** 检查器子评分（0-100，null = 该检查域不适合评分） */
  score: number | null;
  /** 检查耗时（ms） */
  durationMs: number;
}

// ============================================================
// 检查器接口
// ============================================================

/** 检查器配置选项 */
export interface CheckerOptions {
  /** 是否输出详细信息 */
  verbose?: boolean;
  /** 项目根目录 */
  projectRoot?: string;
  /** 额外扩展选项 */
  [key: string]: unknown;
}

/** 检查器接口——所有检查器必须实现此接口 */
export interface IChecker {
  /** 检查器唯一名称 */
  readonly name: string;

  /** 检查器描述 */
  readonly description: string;

  /** 执行检查 */
  check(projectRoot: string, options?: CheckerOptions): Promise<CheckResult>;
}

// ============================================================
// 健康报告
// ============================================================

/** 健康报告——输出格式的根对象 */
export interface HealthReport {
  /** 元信息 */
  meta: {
    scannedAt: string;
    projectRoot: string;
    runId: string;
    durationMs: number;
    packageCount: number;
  };

  /** 各检查器结果 */
  checks: CheckResult[];

  /** 总体状态 */
  status: "healthy" | "warning" | "unhealthy" | "error";
}

/** CLI 配置选项 */
export interface DoctorOptions {
  /** 输出格式 */
  format: "text" | "json";
  /** 仅运行指定检查器（逗号分隔） */
  only?: string;
  /** 跳过指定检查器（逗号分隔） */
  skip?: string;
  /** 健康分阈值（低于此值 CI 阻断） */
  threshold?: number;
  /** 输出文件路径 */
  output?: string;
  /** 是否输出所有发现（含 info 级别） */
  verbose?: boolean;
}

// ============================================================
// 包元信息——用于健康检查的中间数据结构
// ============================================================

/** 扫描到的单个包元信息 */
export interface PackageMeta {
  /** 包名（@cortex/xxx） */
  name: string;
  /** 包路径（相对于项目根） */
  path: string;
  /** 绝对路径 */
  absolutePath: string;
  /** 是否有 PACKAGE_POSITIONING.md */
  hasPositioningDoc: boolean;
  /** package.json 字段检查结果 */
  pkgJsonIssues: string[];
  /** 测试文件首行标注检查结果 */
  testHeaderIssues: string[];
}

// ============================================================
// 健康常量
// ============================================================

/** 健康评分等级 */
export const HEALTH_GRADE = {
  A: 90,
  B: 75,
  C: 60,
  D: 40,
} as const;

/** package.json 必检字段列表 */
export const REQUIRED_PKG_FIELDS = [
  "name",
  "version",
  "private",
  "type",
  "scripts",
  "scripts.build",
  "scripts.typecheck",
  "scripts.test",
] as const;
