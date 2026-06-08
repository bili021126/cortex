# @cortex/doctor — Monorepo Health Diagnosis Suite

> **作者**：纳西妲（AnalysisAgent）
> **版本**：v0.1.0-draft
> **状态**：draft
> **关联宪法版本**：v2.5.41

---

## 目录

1. [Q1: 现有体系缺什么？](#q1-现有体系缺什么)
2. [Q2: @cortex/doctor 的定位是什么？](#q2-cortexdoctor-的定位是什么)
3. [Q3: 价值在哪里？](#q3-价值在哪里)
4. [架构设计](#架构设计)
5. [API 设计](#api-设计)
6. [检查器管线](#检查器管线)
7. [健康评分模型](#健康评分模型)
8. [CI 集成方案](#ci-集成方案)
9. [与现有工具的关系](#与现有工具的关系)
10. [文件结构](#文件结构)
11. [实施路线图](#实施路线图)

---

## Q1: 现有体系缺什么？

### 1.1 工具包现有能力回顾

`@cortex/tools` 已提供两个强有力的分析工具：

| 工具 | 能力 | 输出 |
|------|------|------|
| **monorepo-analyzer** | 依赖图构建、循环依赖检测、版本漂移检测、分层计算、Dot/Mermaid 可视化 | `AnalyzerOutput`（包清单、边、循环、漂移、层级） |
| **configuration-drift** | 同名依赖跨包版本一致性检测、推荐版本算法（多数派/最高版本/根版本优先） | `DepGroup[]` 或 `JsonReport`（漂移列表） |

### 1.2 缺口分析

虽然现有工具能回答「依赖关系是什么」「哪些版本不一致」，但 monorepo 的健康管理远不止依赖分析。以下六个维度当前完全空白：

#### 缺口①：统一健康诊断入口

当前没有一个命令或 API 能回答**「这个 monorepo 现在健康吗？」**。开发者需要：
1. 手动运行 `monorepo-analyzer` 看循环依赖
2. 手动运行 `configuration-drift` 看版本漂移
3. 手动 `pnpm ls --depth` 看冗余依赖
4. 手动 `npx tsc --noEmit` 看编译健康
5. 手动 `npx vitest run` 看测试健康

没有一个统一入口聚合这些信号。

#### 缺口②：健康评分与趋势追踪

当前工具只做**检出（detection）**，不做**量化（quantification）**和**追踪（tracking）**：
- 无法回答「相比上周，项目健康度是改善了还是恶化了？」
- 无法设置健康基线——CI 中「健康分低于 80 阻断」
- 无法识别健康趋势——某项指标持续恶化时自动告警

#### 缺口③：修复指引与 remediation

当前工具只报告**「有什么问题」**，不回答**「怎么修」**：
- monorepo-analyzer 报告循环依赖但不给出拆解建议
- configuration-drift 报告版本不一致但不提供自动修复命令
- 开发者需要自行理解问题根因并手动修复

#### 缺口④：跨包配置一致性检查

monorepo 的健康不仅取决于依赖关系，还取决于各包配置的一致性：
- `tsconfig.json` 的 `compilerOptions` 是否一致（target/module/strict 等）
- 各包的 `package.json` 脚本命名规范是否统一
- ESLint 配置是否对齐
- `vitest.config` 的配置模式是否一致
- 各包的公开 API surface 是否过度膨胀

这些跨包配置的一致性检查，现有工具完全不覆盖。

#### 缺口⑤：构建与依赖性能审计

monorepo 随包数量增长，构建性能会逐渐退化：
- 哪些包是「构建瓶颈」（被最多包依赖）？
- 是否存在「肥胖依赖」（被少量引用但体积巨大的依赖）？
- `node_modules` 中是否存在重复依赖（非 workspace 协议的同名包）？
- 构建缓存命中率趋势如何？

#### 缺口⑥：文档与测试覆盖率关联检测

宪法 §十五·三 要求「公开接口最小化」——但谁在检查公开接口是否有测试覆盖？
- 新增的 `public` 方法是否有对应的单元测试？
- `src/` 下每个模块是否有对应的 `tests/` 文件？
- 文档覆盖率（JSDoc 注释比例）是否低于阈值？

---

## Q2: @cortex/doctor 的定位是什么？

### 2.1 一句话定位

> **`@cortex/doctor` 是 monorepo 的统一健康诊断套件——聚合多维度检查器，产出可量化的健康评分、趋势追踪和修复指引，填补现有分析工具从「检出」到「诊疗」的最后一公里。**

### 2.2 定位边界

```
                    ┌──────────────────────────────────────────┐
                    │           Monorepo 健康观测站              │
                    ├──────────────────────────────────────────┤
                    │                                          │
┌──────────────────┐│  ┌──────────────────────────────────┐    │
│  @cortex/tools    ││  │  @cortex/doctor                   │    │
│                   ││  │                                   │    │
│ monorepo-analyzer ││  │  HealthChecker（统一入口）         │    │
│  依赖图/循环/分层 ││  │  ├─ DependencyChecker             │    │
│                   ││  │  │  (包装 monorepo-analyzer)     │    │
│ configuration-    ││  │  ├─ ConfigConsistencyChecker      │    │
│ drift             ││  │  ├─ BuildPerformanceChecker       │    │
│  版本一致性       ││  │  ├─ ApiSurfaceChecker             │    │
└──────────────────┘│  │  ├─ TestCoverageChecker            │    │
                    │  │  ├─ DocCoverageChecker             │    │
                    │  │  └─ DepHealthChecker               │    │
                    │  │                                   │    │
                    │  │  HealthScore（健康评分模型）        │    │
                    │  │  TrendTracker（趋势追踪）          │    │
                    │  │  RemediationGuide（修复指引）      │    │
                    │  │  CiGateIntegration（CI 门禁集成）  │    │
                    │  └──────────────────────────────────┘    │
                    │                                          │
                    └──────────────────────────────────────────┘
```

### 2.3 职责清单

#### ✅ 属于本包职责

| 职责 | 说明 |
|------|------|
| **统一健康诊断入口** | 单次调用执行全部检查器，聚合输出结构化健康报告 |
| **健康评分** | 基于可配置权重模型，为整个 monorepo 计算 0-100 健康分 |
| **子评分** | 每个检查域独立评分（依赖健康/配置一致性/API 表面/测试覆盖/文档覆盖/构建性能） |
| **趋势追踪** | 跨 run 健康评分写入文件，支持与基线比较（恶化/改善/持平） |
| **修复指引** | 每个检查发现自动生成修复建议——包括命令、代码修改提示、参考文档链接 |
| **CI 门禁集成** | 健康分低于阈值阻断 CI；特定检查发现 P0 问题阻断 CI |
| **配置一致性检查** | 跨包 tsconfig/package.json 脚本/ESLint/vitest 配置一致性 |
| **API Surface 审计** | 各包公开导出数量、变化趋势、未使用导出检测 |
| **构建性能诊断** | 构建瓶颈包识别、依赖肥胖度分析、冗余 workspace 依赖检测 |
| **测试覆盖关联检测** | 模块-测试文件映射完整性、public API 测试覆盖 |
| **文档覆盖检测** | JSDoc 覆盖率统计、模块级文档存在性检查 |

#### ❌ 不属于本包职责

| 职责 | 归属 |
|------|------|
| 依赖图构建与可视化 | `@cortex/tools` monorepo-analyzer |
| 循环依赖检测 | `@cortex/tools` monorepo-analyzer |
| 版本漂移检测 | `@cortex/tools` configuration-drift |
| 包结构层计算 | `@cortex/tools` monorepo-analyzer |
| 配置文件修改 | 开发者手动或 CI 脚本 |
| 自动修复代码 | `@cortex/doctor` 只生成指引，不自动修改 |
| ESLint 代码风格检查 | ESLint 自身 |
| 类型检查 | `tsc --noEmit` |
| 测试运行 | `vitest run` |

### 2.4 依赖方向

```
@cortex/doctor
  ├── 依赖: @cortex/tools（monorepo-analyzer + configuration-drift 作为数据源）
  ├── 依赖: @cortex/shared（类型定义）
  ├── 依赖: node:fs / node:path（文件读取）
  ├── 依赖: (可选) cli-table3（终端表格输出，已在 @cortex/data 中使用）
  └── 被依赖: @cortex/cli（doctor 子命令）
  └── 被依赖: CI 脚本（pnpm doctor 入口）
```

---

## Q3: 价值在哪里？

### 3.1 直接价值（开发者体验）

| 价值点 | 场景 | 收益 |
|-------|------|------|
| **一键健康诊断** | `pnpm doctor` 一条命令获得完整健康报告 | 从运行多个工具的 2 分钟缩短到 5 秒 |
| **量化健康基线** | CI 中 `health < 80 → fail` | 防止渐进式恶化不被感知 |
| **修复不再靠猜** | 每个发现附带 `suggestion` 字段 | 减少排查根因的认知成本 |
| **趋势可见** | 每周 CI 自动记录健康分 | 团队可观测 monorepo 健康的长期演化 |

### 3.2 间接价值（系统质量）

| 价值点 | 当前问题 | 解决后状态 |
|-------|---------|-----------|
| **配置一致性** | 各包 tsconfig 可能 target 不一致、strict 设置差异 | 自动检测并报告差异点 |
| **API 表面控制** | 新增 public 导出无感知 | 每次提交可感知 API surface 变化 |
| **测试覆盖感知** | 新增模块可能忘记加测试 | 模块-测试映射检查预警 |
| **构建性能退化** | 依赖膨胀慢速不可感知 | 构建瓶颈自动识别 |

### 3.3 与现有工具的协同价值

| 协同 | 效果 |
|------|------|
| monorepo-analyzer 输出 → doctor 的 DependencyChecker 输入 | 复用已有的依赖分析成果，不重复造轮 |
| configuration-drift 输出 → doctor 的 DepHealthChecker 输入 | 版本漂移数据在健康报告中统一呈现 |
| doctor 健康报告 → 凝光审计材料 | 治理审计可引用量化健康数据作为决策依据 |
| doctor 趋势追踪 → CI 门禁 | 健康退化自动阻断，无需人工巡检 |

---

## 架构设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    @cortex/doctor 架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CLI 入口 (pnpm doctor)                                     │
│    ↓                                                        │
│  HealthChecker                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  检查器管线 (Checker Pipeline)                       │   │
│  │                                                     │   │
│  │  ┌──────────────────┐  ┌──────────────────┐        │   │
│  │  │ DependencyChecker │  │ConfigConsistency │        │   │
│  │  │ (包装 monorepo-  │  │Checker           │        │   │
│  │  │  analyzer)       │  │ (tsconfig/pkg     │        │   │
│  │  └────────┬─────────┘  │  scripts/eslint)  │        │   │
│  │           │            └────────┬──────────┘        │   │
│  │           ▼                     ▼                   │   │
│  │  ┌──────────────────┐  ┌──────────────────┐        │   │
│  │  │ BuildPerformance │  │ ApiSurfaceChecker │        │   │
│  │  │ Checker          │  │ (export 审计)     │        │   │
│  │  └────────┬─────────┘  └────────┬──────────┘        │   │
│  │           │                     ▼                   │   │
│  │  ┌──────────────────┐  ┌──────────────────┐        │   │
│  │  │ TestCoverage     │  │ DocCoverage      │        │   │
│  │  │ Checker          │  │ Checker          │        │   │
│  │  └────────┬─────────┘  └────────┬──────────┘        │   │
│  │           │                     ▼                   │   │
│  │  ┌──────────────────┐  ┌──────────────────┐        │   │
│  │  │ DepHealthChecker │  │  ... 可扩展       │        │   │
│  │  │ (配置漂移+冗余)  │  │                   │        │   │
│  │  └──────────────────┘  └──────────────────┘        │   │
│  └─────────────────────────────────────────────────────┘   │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              聚合层 (Aggregator)                     │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │   │
│  │  │ HealthScore  │ │ TrendTracker │ │Remediation │  │   │
│  │  │ (健康评分    │ │ (趋势比较    │ │Guide       │  │   │
│  │  │  模型)       │ │  与基线)     │ │(修复指引)  │  │   │
│  │  └──────────────┘ └──────────────┘ └────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              输出格式化 (Formatter)                  │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │   │
│  │  │ TextReport   │ │ JsonReport   │ │ HtmlReport │  │   │
│  │  │ (终端可读)   │ │ (CI 可消费)  │ │ (看板用)   │  │   │
│  │  └──────────────┘ └──────────────┘ └────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 检查器管线设计原则

1. **独立可组合**：每个 Checker 可以独立运行，也可以作为管线的一部分聚合执行
2. **数据源复用**：DependencyChecker 直接复用 `@cortex/tools` 的分析结果，不重新扫描
3. **渐进式输出**：每个 Checker 产出标准化的 `CheckResult`，聚合层只做汇总不做二次分析
4. **可插拔**：新增检查器只需实现 `IChecker` 接口并注册到 `CHECKER_REGISTRY` 数组
5. **零副作用**：检查器只读不写，不修改任何文件。趋势追踪文件写入由 Aggregator 统一管理

### 4.3 检查器管线执行顺序

```
Phase 1: 数据收集（并行）
  ├── DependencyChecker    ← 调用 monorepo-analyzer（复用其 collectPackages/collectDeps）
  ├── ConfigConsistencyChecker ← 扫描所有 tsconfig.json / package.json
  └── ApiSurfaceChecker   ← 扫描所有 src/index.ts barrel 导出来源

Phase 2: 深度分析（依赖于 Phase 1 结果）
  ├── BuildPerformanceChecker  ← 依赖 DependencyChecker 的包层级数据
  ├── DepHealthChecker         ← 依赖 DependencyChecker 的依赖列表
  └── TestCoverageChecker      ← 依赖 ApiSurfaceChecker 的导出列表

Phase 3: 聚合与输出
  ├── HealthScore.calculate(allResults)
  ├── TrendTracker.compare(score, baseline)
  ├── RemediationGuide.generate(findings)
  └── Formatter.format(report)
```

---

## API 设计

### 5.1 核心类型

```typescript
// ============================================================
// 健康检查结果类型
// ============================================================

/** 检查发现严重等级——与宪法 §8.1 SafeErrorReporter 对齐 */
export type FindingSeverity = "fatal" | "error" | "warning" | "info";

/** 单个检查发现 */
export interface Finding {
  /** 唯一标识（如 "DEP-CYCLE-001"） */
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
// 健康评分类型
// ============================================================

/** 健康域枚举 */
export enum HealthDomain {
  Dependency = "dependency",       // 依赖健康
  ConfigConsistency = "config",    // 配置一致性
  BuildPerformance = "build",      // 构建性能
  ApiSurface = "api-surface",      // API 表面
  TestCoverage = "test-coverage",  // 测试覆盖
  DocCoverage = "doc-coverage",    // 文档覆盖
  DepVersion = "dep-version",      // 版本一致性（来自 configuration-drift）
}

/** 健康域权重配置 */
export interface HealthWeightConfig {
  [HealthDomain.Dependency]: number;       // 默认 25
  [HealthDomain.ConfigConsistency]: number; // 默认 15
  [HealthDomain.BuildPerformance]: number;  // 默认 10
  [HealthDomain.ApiSurface]: number;        // 默认 15
  [HealthDomain.TestCoverage]: number;      // 默认 20
  [HealthDomain.DocCoverage]: number;       // 默认 5
  [HealthDomain.DepVersion]: number;        // 默认 10
}

/** 健康评分结果 */
export interface HealthScoreResult {
  /** 总分（0-100） */
  total: number;
  /** 各域得分 */
  domains: Record<HealthDomain, number>;
  /** 各域权重 */
  weights: HealthWeightConfig;
  /** 评分等级 */
  grade: "A" | "B" | "C" | "D" | "F";
}

// ============================================================
// 趋势追踪类型
// ============================================================

/** 趋势记录——单次健康检查的快照 */
export interface TrendRecord {
  /** 时间戳（ISO 8601） */
  timestamp: string;
  /** runId（与 MemoryStore 的 sessionId 对齐） */
  runId: string;
  /** 总分 */
  totalScore: number;
  /** 各域得分 */
  domainScores: Record<HealthDomain, number>;
  /** git commit hash（可选） */
  commitHash?: string;
  /** git 分支名（可选） */
  branch?: string;
}

/** 趋势比较结果 */
export interface TrendComparison {
  /** 本次记录 */
  current: TrendRecord;
  /** 基线记录 */
  baseline: TrendRecord;
  /** 总分变化 */
  delta: number;
  /** 各域变化 */
  domainDeltas: Record<HealthDomain, number>;
  /** 趋势方向 */
  direction: "improved" | "declined" | "stable";
}

// ============================================================
// 修复指引类型
// ============================================================

/** 修复动作 */
export interface RemediationAction {
  /** 关联的发现 ID */
  findingId: string;
  /** 动作类型 */
  type: "command" | "edit" | "manual";
  /** 描述 */
  description: string;
  /** 可执行的命令（type=command 时有效） */
  command?: string;
  /** 代码编辑建议（type=edit 时有效） */
  editSuggestion?: string;
  /** 参考文件路径 */
  filePath?: string;
}

// ============================================================
// 完整健康报告
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

  /** 健康评分（可选——仅 --score 开启时计算） */
  score?: HealthScoreResult;

  /** 趋势比较（可选——仅 --trend 开启时计算） */
  trend?: TrendComparison;

  /** 修复指引（可选——仅 --remediate 开启时计算） */
  remediations?: RemediationAction[];

  /** 总体状态 */
  status: "healthy" | "warning" | "unhealthy" | "error";
}

// ============================================================
// CLI 选项类型
// ============================================================

/** CLI 配置选项 */
export interface DoctorOptions {
  /** 输出格式 */
  format: "text" | "json" | "html";
  /** 是否计算健康评分 */
  score: boolean;
  /** 是否与基线比较趋势 */
  trend: boolean;
  /** 是否生成修复指引 */
  remediate: boolean;
  /** 仅运行指定检查器（逗号分隔） */
  only?: string;
  /** 跳过指定检查器（逗号分隔） */
  skip?: string;
  /** 健康分阈值（低于此值 CI 阻断） */
  threshold?: number;
  /** 基线文件路径（趋势比较用） */
  baseline?: string;
  /** 输出文件路径 */
  output?: string;
  /** 是否输出所有发现（含 info 级别） */
  verbose: boolean;
}
```

### 5.2 接口定义

```typescript
// ============================================================
// IChecker — 所有检查器必须实现的接口
// ============================================================

export interface IChecker {
  /** 检查器唯一名称 */
  readonly name: string;

  /** 检查器描述 */
  readonly description: string;

  /** 执行检查 */
  check(projectRoot: string, options?: CheckerOptions): Promise<CheckResult>;

  /** 检查器是否需要 monorepo-analyzer 的输出作为前置条件 */
  readonly needsAnalyzerOutput: boolean;

  /** 检查器支持的配置选项 */
  readonly supportedOptions: string[];
}

export interface CheckerOptions {
  verbose?: boolean;
  [key: string]: unknown;
}

// ============================================================
// IHealthAggregator — 聚合层接口
// ============================================================

export interface IHealthAggregator {
  /** 计算健康评分 */
  calculateScore(results: CheckResult[], weights?: Partial<HealthWeightConfig>): HealthScoreResult;

  /** 比较趋势 */
  compareTrend(
    current: TrendRecord,
    baselinePath?: string,
  ): Promise<TrendComparison>;

  /** 写入趋势记录 */
  persistRecord(record: TrendRecord, projectRoot: string): Promise<string>;

  /** 加载基线记录 */
  loadBaseline(projectRoot: string, baselinePath?: string): Promise<TrendRecord | null>;

  /** 生成修复指引 */
  generateRemediations(findings: Finding[]): RemediationAction[];
}

// ============================================================
// IHealthFormatter — 输出格式化接口
// ============================================================

export interface IHealthFormatter {
  format(report: HealthReport): string;
}

// ============================================================
// HealthChecker — 统一入口
// ============================================================

export interface IHealthChecker {
  /** 执行完整健康检查 */
  diagnose(projectRoot?: string, options?: Partial<DoctorOptions>): Promise<HealthReport>;

  /** 注册自定义检查器 */
  registerChecker(checker: IChecker): void;

  /** 获取已注册的所有检查器 */
  getCheckers(): IChecker[];

  /** 运行指定检查器（跳过其他） */
  runOnly(checkers: string[], projectRoot?: string): Promise<HealthReport>;
}
```

### 5.3 检查器实现明细

#### DependencyChecker（依赖健康检查器）

```typescript
export class DependencyChecker implements IChecker {
  name = "dependency";
  description = "基于 monorepo-analyzer 的依赖图健康检查";
  needsAnalyzerOutput = true;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 调用 @cortex/tools 的 collectPackages + collectDeps + buildEdges + detectCycles
    // 2. 分析结果：
    //    - 循环依赖 → fatal
    //    - 跨层反向依赖（低层依赖高层）→ error
    //    - 依赖深度过深（>3 层传递依赖）→ warning
    // 3. 产出 Finding 列表
    // 4. 计算依赖健康子评分
  }
}
```

#### ConfigConsistencyChecker（配置一致性检查器）

```typescript
export class ConfigConsistencyChecker implements IChecker {
  name = "config-consistency";
  description = "跨包 tsconfig / package.json 脚本 / ESLint / vitest 配置一致性检查";
  needsAnalyzerOutput = false;

  async check(projectRoot: string): Promise<CheckResult> {
    // tsconfig 一致性检查项：
    //   - target (es2022 vs esnext)
    //   - module (nodenext vs esnext)
    //   - strict 是否统一开启
    //   - strictNullChecks 是否一致
    //
    // package.json 脚本一致性：
    //   - 是否都有 build / typecheck / test / lint 脚本
    //   - 脚本命名模式是否统一（kebab-case vs camelCase）
    //
    // 偏差点 → error/warning
  }
}
```

#### ApiSurfaceChecker（API 表面审计器）

```typescript
export class ApiSurfaceChecker implements IChecker {
  name = "api-surface";
  description = "各包公开导出数量、变化趋势、未使用导出检测";
  needsAnalyzerOutput = false;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 扫描每个包 src/index.ts 的 export 语句
    // 2. 统计每个包的公开导出数量
    // 3. 与上次趋势记录比较变化
    // 4. 检测：
    //    - 单包导出 > 30 → warning（建议模块拆分）
    //    - 导出类型中 mixed (type + value) 比例
    //    - 纯类型导出 vs 运行时导出比例
  }
}
```

#### BuildPerformanceChecker（构建性能诊断器）

```typescript
export class BuildPerformanceChecker implements IChecker {
  name = "build-performance";
  description = "构建瓶颈包识别、依赖肥胖度分析";
  needsAnalyzerOutput = true;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 复用 monorepo-analyzer 的 computeLayers 结果
    // 2. 识别：
    //    - 被最多包依赖的「瓶颈包」→ warning（该包变更触发最多重编译）
    //    - 低层包（layer=0）的体积 → 低层包应轻量
    //    - 外部依赖数量异常 → warning
    //    - workspace 协议 vs 外部依赖比例
  }
}
```

#### TestCoverageChecker（测试覆盖关联检测器）

```typescript
export class TestCoverageChecker implements IChecker {
  name = "test-coverage";
  description = "模块-测试文件映射完整性、public API 测试覆盖";
  needsAnalyzerOutput = false;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 扫描所有 src/**/*.ts（不含 index.ts 和 .d.ts）
    // 2. 扫描所有 tests/**/*.test.ts
    // 3. 构建模块-测试映射
    //    - src/foo.ts → tests/foo.test.ts（期望）
    //    - src/bar/baz.ts → tests/bar/baz.test.ts（期望）
    // 4. 检测：
    //    - 无对应测试的 src 模块 → warning
    //    - 单个测试文件测试超过 3 个模块 → info（建议拆分）
    // 5. 统计覆盖率基线
  }
}
```

#### DocCoverageChecker（文档覆盖检测器）

```typescript
export class DocCoverageChecker implements IChecker {
  name = "doc-coverage";
  description = "JSDoc 覆盖率统计、模块级文档存在性检查";
  needsAnalyzerOutput = false;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 扫描所有 src/**/*.ts
    // 2. 统计：
    //    - 有 JSDoc 注释的 export 函数/类比例
    //    - 模块级注释（文件顶部 @description/@module）比例
    //    - 参数类型已由 TypeScript 覆盖，不要求 @param
    // 3. export 函数/类无 JSDoc → warning
    // 4. 文件无顶部模块注释 → info
  }
}
```

#### DepHealthChecker（依赖健康检查器）

```typescript
export class DepHealthChecker implements IChecker {
  name = "dep-version";
  description = "版本一致性（复用 configuration-drift）+ 冗余依赖检测";
  needsAnalyzerOutput = false;

  async check(projectRoot: string): Promise<CheckResult> {
    // 1. 调用 @cortex/tools 的 collectDependencies + detectDrift
    // 2. 版本漂移 → error（直接映射 configuration-drift 的输出）
    // 3. 额外检测：
    //    - 同一外部依赖在多包中以不同版本声明（非 workspace 协议）
    //    - 根 package.json 中声明但未被任何子包使用的依赖
    //    - devDependencies 中声明但在生产依赖也出现的包
  }
}
```

### 5.4 默认权重配置

```typescript
export const DEFAULT_HEALTH_WEIGHTS: HealthWeightConfig = {
  [HealthDomain.Dependency]: 25,        // 循环依赖最致命
  [HealthDomain.ConfigConsistency]: 15, // 配置不一致影响可维护性
  [HealthDomain.BuildPerformance]: 10,  // 构建性能退化渐进式
  [HealthDomain.ApiSurface]: 15,        // API 表面控制是宪法要求
  [HealthDomain.TestCoverage]: 20,      // 测试覆盖是质量基线
  [HealthDomain.DocCoverage]: 5,        // 文档覆盖重要性较低
  [HealthDomain.DepVersion]: 10,        // 版本一致性
};

/** 健康等级阈值 */
export const HEALTH_GRADE_THRESHOLDS = {
  A: 90,   // 优秀
  B: 75,   // 良好
  C: 60,   // 及格
  D: 40,   // 较差
  // F: < 40  // 糟糕
};
```

### 5.5 CLI 入口设计

```typescript
// 用法示例

// 完整健康检查（终端报告）
// $ pnpm doctor

// JSON 输出（CI 使用）
// $ pnpm doctor --json

// 带健康评分
// $ pnpm doctor --score

// 带趋势比较（与上次检查比较）
// $ pnpm doctor --trend

// 带修复指引
// $ pnpm doctor --remediate

// 完整模式
// $ pnpm doctor --score --trend --remediate --json --output health-report.json

// 仅运行指定检查器
// $ pnpm doctor --only dependency,api-surface

// 跳过指定检查器
// $ pnpm doctor --skip build-performance

// 设置 CI 门禁阈值（低于 70 分退出码 1）
// $ pnpm doctor --score --threshold 70

// 与指定基线比较
// $ pnpm doctor --trend --baseline .doctor/baseline.json
```

---

## 健康评分模型

### 6.1 评分算法

```
总分 = Σ(域评分 × 域权重) / Σ(域权重)

域评分计算：
  每个检查域的基础分 = 100
  每项 fatal 发现   -30 分
  每项 error 发现   -15 分
  每项 warning 发现  -5 分
  每项 info 发现     -1 分
  域评分 = max(0, 基础分 - 扣分)
```

### 6.2 等级划分

| 等级 | 分值范围 | 含义 | CI 行为 |
|------|---------|------|---------|
| A | 90-100 | 优秀 | 通过 |
| B | 75-89 | 良好 | 通过（建议关注 warning） |
| C | 60-74 | 及格 | 通过（需人工审查） |
| D | 40-59 | 较差 | **阻断**（除非特批） |
| F | 0-39 | 糟糕 | **阻断** |

### 6.3 单域阻断规则

即使总分达标，以下单项发现也直接导致整体 `unhealthy`：

| 条件 | 阻断级别 |
|------|---------|
| 存在任何 `fatal` 发现 | ❌ unhealthy |
| 存在循环依赖 | ❌ unhealthy |
| 存在配置漂移（error 级别） | ⚠️ 至少 warning |
| API surface 单月增长 > 20% | ⚠️ warning |

---

## CI 集成方案

### 7.1 门禁集成

```yaml
# .github/workflows/health.yml
name: Monorepo Health Check
on: [pull_request]
jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm doctor --score --trend --json --threshold 75
```

### 7.2 退出码约定

| 退出码 | 含义 |
|--------|------|
| 0 | 健康（无 fatal/error，总分 ≥ threshold） |
| 1 | 不健康（存在 fatal/error，或总分 < threshold） |
| 2 | 异常（扫描失败、配置错误等） |

与 `monorepo-analyzer` 和 `configuration-drift` 的退出码约定保持完全一致。

### 7.3 趋势历史存储

趋势记录写入 `.doctor/history.jsonl`（每行一个 JSON 记录，追加写入）：

```jsonl
{"timestamp":"2026-06-01T00:00:00.000Z","runId":"run-abc123","totalScore":92,"domainScores":{"dependency":100,"config":85,"build":90,"api-surface":88,"test-coverage":95,"doc-coverage":70,"dep-version":100},"commitHash":"a1b2c3d","branch":"main"}
{"timestamp":"2026-06-08T00:00:00.000Z","runId":"run-def456","totalScore":88,"domainScores":{"dependency":95,"config":85,"build":90,"api-surface":82,"test-coverage":95,"doc-coverage":70,"dep-version":100},"commitHash":"e4f5g6h","branch":"main"}
```

---

## 与现有工具的关系

### 8.1 职能对比

| 维度 | monorepo-analyzer | configuration-drift | @cortex/doctor |
|------|-------------------|---------------------|----------------|
| **核心定位** | 依赖图分析 | 版本一致性 | 健康诊断 |
| **范围** | 包结构/依赖/循环/分层 | 同名依赖的版本声明 | 多维度健康检查 |
| **分析深度** | 静态结构分析 | 字符串比较 | 聚合分析+评分+趋势 |
| **输出** | 分析报告 + 可视化 | 漂移清单 | 健康报告 + 评分 + 修复指引 |
| **可执行动作** | 检测 | 检测（不自动修） | 检测 + 指引修复 |
| **CI 集成** | 退出码 0/1/2 | 退出码 0/1/2 | 退出码 0/1/2 + 阈值门禁 |
| **趋势追踪** | ❌ | ❌ | ✅ |
| **健康评分** | ❌ | ❌ | ✅ |
| **修复指引** | ❌ | ❌ | ✅ |

### 8.2 复用关系

```
@cortex/doctor
  │
  ├── DependencyChecker.check()
  │     └── 调用 @cortex/tools 的 collectPackages() / collectDeps() / buildEdges() / detectCycles()
  │
  ├── DepHealthChecker.check()
  │     └── 调用 @cortex/tools 的 collectDependencies() / detectDrift()
  │
  ├── BuildPerformanceChecker.check()
  │     └── 调用 @cortex/tools 的 computeLayers()
  │
  └── ConfigConsistencyChecker.check()
        └── 读取 @cortex/config 的常量（如常量化的配置路径）
```

### 8.3 边界声明

`@cortex/doctor` **不取代** `@cortex/tools` 中的任何工具。它是在现有分析工具之上的**聚合层**和**增强层**：

- 分析能力归属 `@cortex/tools`——doctor 不重新实现依赖图构建、循环检测、版本漂移检测
- 诊断增强归属 `@cortex/doctor`——健康评分、趋势追踪、修复指引、配置一致性、API surface 审计等
- 两者的关系是**消费与被消费**，而非竞争

---

## 文件结构

```
packages/doctor/
├── DESIGN.md                     ← 本文档
├── README.md                     ← 使用说明
├── package.json                  ← @cortex/doctor
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                  ← 桶导出
│   ├── types.ts                  ← 核心类型（HealthReport / Finding / CheckResult 等）
│   ├── health-checker.ts         ← HealthChecker 主入口（IHealthChecker 实现）
│   ├── checker-registry.ts       ← CHECKER_REGISTRY 注册表
│   │
│   ├── checkers/                 ← 各检查器实现
│   │   ├── dependency-checker.ts     ← DependencyChecker
│   │   ├── config-consistency.ts     ← ConfigConsistencyChecker
│   │   ├── api-surface.ts            ← ApiSurfaceChecker
│   │   ├── build-performance.ts      ← BuildPerformanceChecker
│   │   ├── test-coverage.ts          ← TestCoverageChecker
│   │   ├── doc-coverage.ts           ← DocCoverageChecker
│   │   └── dep-version.ts            ← DepHealthChecker
│   │
│   ├── aggregator/               ← 聚合层
│   │   ├── health-score.ts       ← 健康评分模型
│   │   ├── trend-tracker.ts      ← 趋势追踪
│   │   └── remediation.ts        ← 修复指引生成
│   │
│   ├── formatters/               ← 输出格式化
│   │   ├── text-formatter.ts     ← 终端可读报告
│   │   ├── json-formatter.ts     ← JSON 格式（CI 消费）
│   │   └── html-formatter.ts     ← HTML 看板（可选）
│   │
│   ├── cli.ts                    ← CLI 入口（doctor 命令）
│   ├── defaults.ts               ← 默认配置常量
│   └── utils.ts                  ← 通用工具函数
│
├── tests/
│   ├── fixtures/                 ← 测试夹具
│   │   ├── mock-monorepo/        ← 模拟 monorepo 结构
│   │   │   ├── package.json
│   │   │   ├── packages/
│   │   │   │   ├── pkg-a/package.json
│   │   │   │   ├── pkg-a/src/index.ts
│   │   │   │   ├── pkg-b/package.json
│   │   │   │   └── pkg-b/src/index.ts
│   │   │   └── tsconfig.json
│   │   └── history.jsonl         ← 模拟趋势历史
│   │
│   ├── health-checker.test.ts
│   ├── checkers/
│   │   ├── dependency-checker.test.ts
│   │   ├── config-consistency.test.ts
│   │   ├── api-surface.test.ts
│   │   ├── build-performance.test.ts
│   │   ├── test-coverage.test.ts
│   │   └── doc-coverage.test.ts
│   ├── aggregator/
│   │   ├── health-score.test.ts
│   │   ├── trend-tracker.test.ts
│   │   └── remediation.test.ts
│   └── formatters/
│       ├── text-formatter.test.ts
│       └── json-formatter.test.ts
│
└── .doctor/                      ← 趋势历史存储目录（运行时生成）
    └── .gitkeep
```

---

## 实施路线图

### Phase 1 — 核心基础设施（优先级 P0）

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M1 | 包脚手架 + 核心类型定义 + IChecker 接口 | 0.5 人日 |
| M2 | HealthChecker 主入口 + 检查器管线框架 | 0.5 人日 |
| M3 | CLI 入口 + text/json 格式化器 | 0.5 人日 |
| M4 | DependencyChecker（包装 monorepo-analyzer） | 0.5 人日 |
| M5 | DepHealthChecker（包装 configuration-drift） | 0.3 人日 |
| M6 | 健康评分模型 + 测试 | 0.5 人日 |
| **合计** | **Phase 1 可交付** | **2.8 人日** |

Phase 1 完成后即可产出基础健康报告——覆盖依赖健康、版本一致性、健康评分三大核心维度。

### Phase 2 — 深度检查器（优先级 P1）

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M7 | ConfigConsistencyChecker | 1.0 人日 |
| M8 | ApiSurfaceChecker | 1.0 人日 |
| M9 | TestCoverageChecker | 1.0 人日 |
| **合计** | **Phase 2 可交付** | **3.0 人日** |

### Phase 3 — 增强功能（优先级 P2）

| 里程碑 | 内容 | 预估 |
|--------|------|------|
| M10 | 趋势追踪（TrendTracker + .doctor/history.jsonl） | 1.0 人日 |
| M11 | 修复指引生成（RemediationGuide） | 0.5 人日 |
| M12 | CI 门禁集成文档 + GitHub Actions workflow 模板 | 0.5 人日 |
| M13 | BuildPerformanceChecker | 0.5 人日 |
| M14 | DocCoverageChecker | 0.5 人日 |
| M15 | HTML 格式化器（看板） | 0.5 人日 |
| **合计** | **Phase 3 可交付** | **3.5 人日** |

### 总计

| 阶段 | 人日 | 累计 | 交付价值 |
|------|------|------|---------|
| Phase 1 | 2.8 | 2.8 | 基础健康诊断 + 评分 |
| Phase 2 | 3.0 | 5.8 | 配置/API/测试深度检查 |
| Phase 3 | 3.5 | 9.3 | 趋势/修复/CI 门禁 |

---

## 附录：宪法关联

| 宪法条款 | 关联的 @cortex/doctor 能力 |
|---------|--------------------------|
| §三 物理包结构 | DependencyChecker 验证包依赖方向是否严格遵循宪法定义的依赖表 |
| §五 15.3 公开接口最小化 | ApiSurfaceChecker 审计各包公开导出，检测接口膨出 |
| §五 15.2 目录嵌套约束 | 未来可在 doctor 中增加目录嵌套深度检查器 |
| §十四·一 测试门禁自声明 | TestCoverageChecker 验证 `// @ci:` 标注存在性 |
| §二 原则七·子约束8 硬编码禁令 | ConfigConsistencyChecker 检查各包是否从 `@cortex/config` 引入常量而非硬编码 |
| §三 config 包职责 | 配置一致性检查的参考权威源 |

---

## 附录：终端输出示例

```
═══ @cortex/doctor — Monorepo Health Diagnosis ═══

📋 扫描时间: 2026-06-01 12:00:00 UTC
📋 项目路径: D:/cortex
📋 扫描包数: 12
📋 总耗时: 1,234ms

─── 1. 依赖健康 (dependency) ─────────────────
  ✅ 无循环依赖
  ✅ 依赖方向合规（全部遵循宪法定义方向）
  ℹ️ 被依赖最多的包: engine (被 2 包依赖)
  评分: 100/100

─── 2. 配置一致性 (config-consistency) ────────
  ❌ tsconfig.json target 不一致:
      预期: es2022
      实际: packages/parser -> esnext
  ⚠️ packages/notification package.json 缺少 lint 脚本
  评分: 78/100

─── 3. API 表面 (api-surface) ────────────────
  ✅ 总导出数: 142（较上次 +3）
  ℹ️ 导出最多的包: engine (58 个导出)
  ⚠️ 建议关注: shared 包导出 44 个，考虑拆分
  评分: 85/100

─── 4. 测试覆盖 (test-coverage) ──────────────
  ⚠️ 4 个 src 模块缺少对应测试文件:
      packages/engine/src/utils.ts
      packages/config/src/loader.ts
  ℹ️ 10/12 包有测试目录
  评分: 82/100

─── 5. 版本一致性 (dep-version) ──────────────
  ✅ 无版本漂移（全部 workspace:* 或一致外部版本）
  评分: 100/100

─── 6. 构建性能 (build-performance) ──────────
  ℹ️ 构建瓶颈包: engine（layer 0，重构影响全部上行包）
  ℹ️ 外部依赖数: 24（正常范围内）
  评分: 90/100

─── 7. 文档覆盖 (doc-coverage) ──────────────
  ⚠️ JSDoc 覆盖率: 62%（低于建议阈值 70%）
  ℹ️ 11/12 包有模块级注释
  评分: 65/100

═══ 健康评分 ═══
  总分: 86/100 → 等级 B（良好）
  趋势: ↑ +3（较上次基线改善）

═══ 修复建议 ═══
  1. [config-consistency] tsconfig target 不一致
     → 统一为 es2022: pnpm doctor --fix target
     → 参考: packages/parser/tsconfig.json 第 5 行

  2. [config-consistency] notification 缺少 lint 脚本
     → 在 package.json scripts 中添加 "lint": "eslint src/"

  3. [test-coverage] 4 个模块无测试文件
     → 为每个模块创建 tests/<module>.test.ts

═══ 总体状态 ═══
  健康 ✅ （总分 86 ≥ 阈值 75，无 fatal/error）
═══════════════════════════════════════════════════
```

---

*文档结束。本设计文档由纳西妲（AnalysisAgent）基于对母项目 12 个现有包、`@cortex/tools` 两个分析工具、宪法 v2.5.41 以及 `@cortex/skill-validator` 定位文档的全面分析产出。*
