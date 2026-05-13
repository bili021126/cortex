# ═══ Cortex CLI — 接口设计文档 ═══

> **设计依据**：  
> `analysis_report.md`（包依赖与架构分析）  
> `webui/analysis_report.md`（Monorepo 分析报告）  
> `drift-detector-design.md`（配置漂移探测器设计）  
> `drift-review.md`（审查缺陷记录）  
>
> **版本**：v1.0  
> **状态**：设计定稿，待圆桌审议

---

## 一、设计目标

基于分析报告中的 monorepo 治理场景，CLI 工具需覆盖以下治理能力：

| 能力 | 分析报告依据 | 优先级 |
|------|------------|--------|
| **版本漂移检测** | 报告 §四 — 版本冲突分析、§七 R1/R2 | P0 |
| **依赖关系分析** | 报告 §二 — 包依赖关系图、§三 — 循环依赖扫描 | P1 |
| **架构合规检查** | 报告 §五 — 6 种架构模式、§七 R3（未组合化 Agent） | P2 |
| **报告生成** | 报告 §六 — 包间 API 面、§八 — 总结 | P1 |

---

## 二、命令结构与参数

### 2.1 顶层命令

```
cortex <command> [options]
```

### 2.2 命令树

```
cortex
├── scan                          # 扫描项目信息
│   ├── --format <type>           # 输出格式: text | json (默认 text)
│   ├── --output <path>           # 输出到文件（可选）
│   ├── --filter <glob>           # 过滤包路径（可选）
│   └── --verbose                 # 显示详细信息（可选）
│
├── check                         # 合规检查
│   ├── drift                     # 检测版本漂移
│   │   ├── --json                # JSON 输出（可选）
│   │   ├── --output <path>       # 输出到文件（可选）
│   │   ├── --ignore <dep>...     # 忽略指定依赖（可重复）
│   │   ├── --strict              # 开放版本（* / latest）也告警
│   │   └── --fail-on <level>     # 失败阈值: drift | warn | all (默认 drift)
│   │
│   ├── cycles                    # 检测循环依赖
│   │   ├── --json
│   │   ├── --depth <n>           # BFS 深度限制 (默认 10)
│   │   └── --include-dev         # 包含 devDependencies
│   │
│   ├── lint                      # 检查 ESLint 配置完整性
│   │   ├── --json
│   │   └── --fix                 # 自动补全缺失的 eslint 声明（可选）
│   │
│   └── architecture              # 架构合规检查
│       ├── --json
│       ├── --check-deprecated    # 检查废弃 API 使用
│       └── --check-composition   # 检查 Agent 组合化迁移状态
│
├── report                        # 生成综合报告
│   ├── --format <type>           # text | json | markdown (默认 markdown)
│   ├── --output <path>           # 输出文件路径（必填）
│   ├── --sections <list>         # 报告章节（逗号分隔）
│   │   # 可选: dependencies, cycles, drifts, lint, architecture, all
│   └── --template <path>         # 自定义报告模板（可选）
│
├── init                          # 初始化配置文件
│   └── --force                   # 覆盖已有配置
│
└── --help                        # 显示帮助
    --version                     # 显示版本
```

### 2.3 参数规范总表

| 参数 | 类型 | 短名 | 默认值 | 适用范围 | 说明 |
|------|------|------|--------|---------|------|
| `--format` | `text \| json \| markdown` | `-f` | `text` | `scan`, `report` | 输出格式 |
| `--json` | `boolean` | `-j` | `false` | `check.*` | JSON 输出开关 |
| `--output` | `string` | `-o` | `stdout` | `scan`, `check.*`, `report` | 输出文件路径 |
| `--filter` | `glob` | — | `packages/*` | `scan` | 过滤扫描范围 |
| `--verbose` | `boolean` | `-v` | `false` | `scan` | 显示额外信息 |
| `--ignore` | `string[]` | `-i` | `[]` | `check.drift` | 忽略的依赖名（可重复） |
| `--strict` | `boolean` | `-s` | `false` | `check.drift` | 开放版本也告警 |
| `--fail-on` | `drift \| warn \| all` | — | `drift` | `check.drift` | 退出码触发阈值 |
| `--depth` | `number` | `-d` | `10` | `check.cycles` | BFS 遍历深度 |
| `--include-dev` | `boolean` | — | `false` | `check.cycles` | 含 devDependencies |
| `--fix` | `boolean` | — | `false` | `check.lint` | 自动修复 |
| `--check-deprecated` | `boolean` | — | `false` | `check.architecture` | 检查废弃 API |
| `--check-composition` | `boolean` | — | `false` | `check.architecture` | 检查组合化状态 |
| `--sections` | `string` | — | `all` | `report` | 报告的章节筛选 |
| `--template` | `string` | — | 内置模板 | `report` | 自定义 EJS 模板路径 |
| `--force` | `boolean` | — | `false` | `init` | 覆盖已有配置 |

---

## 三、数据模型

### 3.1 核心类型定义

```typescript
/* ═══ 3.1.1 包信息 ═══ */

/** 包元数据 */
interface PackageInfo {
  /** 包名（如 "@cortex/engine"） */
  name: string;
  /** 包标识（如 "engine"） */
  id: string;
  /** 版本 */
  version: string;
  /** package.json 路径（相对于项目根） */
  filePath: string;
  /** 是否为根包 */
  isRoot: boolean;
  /** 是否为工作空间包 */
  isWorkspace: boolean;
  /** layer 层级（0=shared, 1=llm/testing, 2=engine） */
  layer: number;
}

/* ═══ 3.1.2 依赖条目 ═══ */

/** 单个依赖的出现记录 */
interface DependencyEntry {
  /** 依赖名（如 "typescript"） */
  depName: string;
  /** 所属包标识（如 "engine"） */
  pkgId: string;
  /** 所属包包名 */
  pkgName: string;
  /** 文件路径 */
  filePath: string;
  /** 依赖段 */
  section: "dependencies" | "devDependencies" | "peerDependencies";
  /** 版本声明（已 trim） */
  version: string;
  /** 是否为 workspace:* 协议 */
  isWorkspaceStar: boolean;
  /** 是否为开放版本（* / latest） */
  isOpenVersion: boolean;
  /** 是否为 workspace 协议（含 workspace:^x.y.z） */
  isWorkspaceProtocol: boolean;
}

/* ═══ 3.1.3 漂移检测 ═══ */

/** 按依赖名分组的条目集合 */
interface DependencyGroup {
  /** 依赖名 */
  depName: string;
  /** 所有出现条目 */
  entries: DependencyEntry[];
  /** 去重后的版本集合 */
  uniqueVersions: string[];
  /** 是否漂移 */
  hasDrift: boolean;
  /** 是否包含开放版本 */
  hasOpenVersion: boolean;
  /** 严重程度 */
  severity: "clean" | "warn" | "drift";
}

/** 单条漂移记录 */
interface DriftItem {
  /** 依赖名 */
  dependency: string;
  /** 出现次数 */
  occurrences: number;
  /** 包标识 → 版本声明的映射 */
  versions: Record<string, string>;
  /** 推荐统一版本 */
  recommended: string;
  /** 建议理由 */
  reason: string;
  /** 严重程度 */
  severity: "warn" | "drift";
}

/* ═══ 3.1.4 循环依赖检测 ═══ */

/** 单条循环依赖记录（包级别） */
interface CycleItem {
  /** 循环路径（如 ["engine", "llm", "shared", "engine"]） */
  path: string[];
  /** 涉及的包 */
  packages: string[];
  /** 类型 */
  type: "package" | "file";
  /** 是否为 import type（编译期擦除） */
  isTypeOnly: boolean;
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high";
}

/* ═══ 3.1.5 架构合规 ═══ */

/** Agent 组合化迁移状态 */
interface AgentMigrationStatus {
  /** Agent 类型名 */
  agentType: string;
  /** 旧类路径 */
  legacyClass: string | null;
  /** 新工厂路径 */
  factoryConfig: string | null;
  /** 迁移状态: migrated | dual | legacy | pending */
  status: "migrated" | "dual" | "legacy" | "pending";
}

/** ESLint 配置完整性检查结果 */
interface LintCompletenessItem {
  /** 包标识 */
  pkgId: string;
  /** 包名 */
  pkgName: string;
  /** 是否有 lint script */
  hasLintScript: boolean;
  /** 是否声明了 eslint 依赖 */
  hasEslintDep: boolean;
  /** 是否通过 root hoisting 获取 */
  reliesOnHoisting: boolean;
  /** 建议操作 */
  suggestion: string;
}

/* ═══ 3.1.6 报告元数据 ═══ */

/** 报告元信息 */
interface ReportMeta {
  /** 扫描时间（ISO 8601） */
  scannedAt: string;
  /** 扫描的文件数 */
  filesScanned: number;
  /** 检查的依赖项数（去重后） */
  dependenciesChecked: number;
  /** 总体状态 */
  status: "clean" | "drift" | "warn" | "error";
  /** CLI 版本 */
  cliVersion: string;
  /** 项目根路径 */
  projectRoot: string;
}

/* ═══ 3.1.7 综合输出 ═══ */

/** check.drift 的输出 */
interface CheckDriftOutput {
  meta: ReportMeta;
  /** 所有依赖的快照 */
  dependencies: Record<string, {
    versions: Record<string, string>;
    drift: boolean;
    severity: "clean" | "warn" | "drift";
  }>;
  /** 漂移列表 */
  drifts: DriftItem[];
}

/** check.cycles 的输出 */
interface CheckCyclesOutput {
  meta: ReportMeta;
  /** 包级循环依赖 */
  packageCycles: CycleItem[];
  /** 文件级循环引用 */
  fileCycles: CycleItem[];
  /** 是否有循环依赖 */
  hasCycles: boolean;
}

/** check.lint 的输出 */
interface CheckLintOutput {
  meta: ReportMeta;
  /** 各包 ESLint 配置检查 */
  packages: LintCompletenessItem[];
  /** 缺失 eslint 的包列表 */
  missingEslint: string[];
  /** 建议的补全操作 */
  fixesSuggested: string[];
}

/** check.architecture 的输出 */
interface CheckArchitectureOutput {
  meta: ReportMeta;
  /** Agent 组合化迁移状态 */
  agentMigrations: AgentMigrationStatus[];
  /** 已迁移比例 */
  migrationProgress: number; // 0~1
  /** 废弃 API 使用情况 */
  deprecatedUsages: Array<{
    symbol: string;
    location: string;
    suggestion: string;
  }>;
}

/** report 的综合输出（markdown 格式） */
interface ReportOutput {
  meta: ReportMeta;
  /** 包清单 */
  packages: PackageInfo[];
  /** 依赖关系 */
  dependencyGraph: {
    edges: Array<{ from: string; to: string; type: string }>;
  };
  /** 漂移检测结果（可选） */
  drifts?: CheckDriftOutput;
  /** 循环依赖检测结果（可选） */
  cycles?: CheckCyclesOutput;
  /** 架构合规结果（可选） */
  architecture?: CheckArchitectureOutput;
}

/* ═══ 3.1.8 配置文件（cortex.config.json） ═══ */

/** 项目级 CLI 配置 */
interface CortexConfig {
  /** 配置版本 */
  $schema?: string;
  /** 扫描选项 */
  scan?: {
    /** 过滤模式 */
    filter?: string;
    /** 默认输出格式 */
    format?: "text" | "json";
  };
  /** 漂移检测选项 */
  drift?: {
    /** 忽略的依赖列表 */
    ignore?: string[];
    /** 严格模式 */
    strict?: boolean;
    /** 失败阈值 */
    failOn?: "drift" | "warn" | "all";
  };
  /** 循环检测选项 */
  cycles?: {
    /** 默认深度 */
    depth?: number;
    /** 包含 devDependencies */
    includeDev?: boolean;
  };
  /** 报告选项 */
  report?: {
    /** 默认输出格式 */
    format?: "text" | "json" | "markdown";
    /** 默认章节 */
    sections?: string[];
  };
}
```

### 3.2 类型约束与校验规则

| 字段 | 校验规则 | 违反处理 |
|------|---------|---------|
| `DependencyEntry.version` | 必须 trim，不允许前后空格 | 在 `collectDependencies()` 中强制 trim |
| `DependencyGroup.hasDrift` | 单出现不构成漂移 | `entries.length <= 1` → `hasDrift = false` |
| `DriftItem.recommended` | 三级优先级：多数派 > 最高版本 > 根版本优先 | 按 §四 推荐策略执行 |
| `ReportMeta.status` | 有 `drift` 项 → `"drift"`；仅有 `warn` → `"warn"` | 下游按此决定退出码 |

---

## 四、推荐策略（Drift 检测）

### 4.1 推荐版本优先级

当检测到漂移时，按以下三级优先级选择推荐版本：

```
第 1 优先：多数派版本
  出现次数最多的版本。平票时进入第 2 优先。

第 2 优先：最高版本
  按 semver 数字部分比较（major * 10000 + minor * 100 + patch）。
  仍平票时进入第 3 优先。

第 3 优先：根版本优先
  如果 root package.json 中有该依赖，优先采纳根版本。
```

### 4.2 特殊版本处理

| 版本模式 | 处理方式 | 输出标记 |
|---------|---------|---------|
| `workspace:*` | 不视为漂移；多个包一致使用时跳过检测 | `[workspace]` |
| `workspace:^x.y.z` | 视为普通版本，与 `workspace:*` 不同即漂移 | `[workspace]` |
| `*` / `latest` | 非严格模式下标记但不告警；`--strict` 模式下告警 | `[开放版本]` |
| 带空格版本 | 强制 trim，trim 后若仍不一致则告警 | 正常显示 |

### 4.3 退出码规范

| 状态 | 退出码 | 触发条件 |
|------|--------|---------|
| 干净 | `0` | 无任何问题 |
| 有漂移 | `1` | 检测到版本不一致（`severity === "drift"`） |
| 有警告 | `0`（`--fail-on=drift` 时）/ `1`（`--fail-on=warn` 时） | 仅有开放版本等警告 |
| 扫描异常 | `2` | 文件读取失败、JSON 解析错误、路径不存在 |

---

## 五、输出格式规范

### 5.1 终端人类可读输出（text 格式）

```
═══ <检查项> 报告 ═══
扫描范围: N 个文件（根 + M 包）
检查依赖: K 项（去重）

✅ 未发现版本漂移（所有同名依赖版本一致）

─── 快照摘要 ───
依赖名               出现次数    版本              涉及包
───────────────────────────────────────────────────────
typescript            4          ^5.7.0            engine, llm, shared, testing
...
```

**漂移存在时的差异：**

```
❌ 发现 2 处版本漂移:

  1. typescript
     engine: ^5.7.0    packages/engine/package.json
     shared: ^5.6.0    packages/shared/package.json   ← 偏移
     → 建议统一为 ^5.7.0（多数派版本 3/4）

  2. vitest
     root: ^2.0.0      package.json                   ← 偏移
     engine: ^2.1.0    packages/engine/package.json
     → 建议统一为 ^2.1.0（根版本为旧，引擎版本为新）
```

**格式规则：**
- 表头使用 `═══`（三层）和 `───`（三层）分隔
- 表格列宽基于内容动态计算（不硬编码）
- 漂移项编号用 `N.` 格式
- `← 偏移` 标记仅标注与推荐版本不同的包
- CJK 字符按双倍宽度计算对齐

### 5.2 JSON 输出格式（json 格式）

```json
{
  "meta": {
    "scanned_at": "2026-01-20T10:30:00Z",
    "files_scanned": 5,
    "dependencies_checked": 28,
    "status": "clean",
    "cli_version": "1.0.0",
    "project_root": "/path/to/project"
  },
  "dependencies": {
    "typescript": {
      "versions": {
        "engine": "^5.7.0",
        "llm": "^5.7.0",
        "shared": "^5.7.0",
        "testing": "^5.7.0"
      },
      "drift": false,
      "severity": "clean"
    }
  },
  "drifts": []
}
```

**有漂移时的 `drifts` 数组：**

```json
{
  "drifts": [
    {
      "dependency": "typescript",
      "occurrences": 4,
      "versions": {
        "engine": "^5.7.0",
        "llm": "^5.7.0",
        "shared": "^5.6.0",
        "testing": "^5.7.0"
      },
      "recommended": "^5.7.0",
      "reason": "多数派版本（3/4）",
      "severity": "drift"
    }
  ]
}
```

**JSON 输出键名规则：**
- 顶层字段使用 `snake_case`（如 `scanned_at`、`files_scanned`）
- 嵌套字段保持语义清晰，统一 `snake_case`
- 数组字段使用复数名词（`drifts`、`versions`）

### 5.3 Markdown 报告格式（report 命令）

```markdown
# Cortex Monorepo 治理报告

> 生成时间：2026-01-20T10:30:00Z
> CLI 版本：1.0.0

---

## 一、包清单

| 包名 | 版本 | 层级 | 路径 |
|------|------|------|------|
| @cortex/shared | 0.1.0 | 0 | packages/shared |

## 二、依赖关系

...

## 三、漂移检测

...

## 四、循环依赖

...

## 五、架构合规

...
```

---

## 六、输入规范

### 6.1 命令行参数

遵循 POSIX 约定：
- 长选项使用 `--` 前缀（如 `--json`）
- 短选项使用 `-` 前缀（如 `-j`）
- 多值参数使用重复（如 `--ignore typescript --ignore vitest`）
- 布尔选项不接值（出现即 true）
- 选项与值之间用空格分隔（`--output ./report.json`）

### 6.2 配置文件

路径：项目根目录下 `cortex.config.json`（由 `cortex init` 生成）

```json
{
  "$schema": "./node_modules/@cortex/cli/schema.json",
  "scan": {
    "filter": "packages/*",
    "format": "text"
  },
  "drift": {
    "ignore": [],
    "strict": false,
    "failOn": "drift"
  },
  "cycles": {
    "depth": 10,
    "includeDev": false
  },
  "report": {
    "format": "markdown",
    "sections": ["dependencies", "drifts", "cycles"]
  }
}
```

**优先级**：命令行参数 > 配置文件 > 默认值

### 6.3 被扫描的输入文件

| 文件 | 必选 | 说明 |
|------|------|------|
| `package.json`（根） | ✅ | 根包依赖声明 |
| `packages/*/package.json` | ✅ | 各子包依赖声明 |
| `packages/*/src/**/*.ts` | 视命令而定 | `check.cycles` 需要 |
| `pnpm-workspace.yaml` | ❌ | 仅验证工作空间配置 |
| `cortex.config.json` | ❌ | CLI 配置（可选） |

---

## 七、错误处理规范

### 7.1 异常场景与响应

| 场景 | HTTP类比 | 终端输出 | JSON输出 | 退出码 |
|------|---------|---------|---------|--------|
| 正常完成，无问题 | 200 | 正常报告 | `{ meta: { status: "clean" } }` | 0 |
| 检测到漂移 | 200（有内容） | 报告含漂移项 | `{ meta: { status: "drift" }, drifts: [...] }` | 1 |
| 文件不存在 | 404 | `💥 文件未找到: <path>` | `{ meta: { status: "error" } }` | 2 |
| JSON 解析失败 | 400 | `💥 解析失败: <path> — <reason>` | `{ meta: { status: "error" } }` | 2 |
| 路径权限不足 | 403 | `💥 无权限读取: <path>` | `{ meta: { status: "error" } }` | 2 |
| 无效参数 | 400 | `💥 未知选项: --xxx` | 不输出 JSON（参数解析错误） | 2 |

### 7.2 错误信息格式

```
💥 <错误类型>: <具体描述>
[详细说明/建议操作（可选）]
```

JSON 模式下的错误输出：

```json
{
  "meta": {
    "scanned_at": "2026-01-20T10:30:00Z",
    "files_scanned": 0,
    "dependencies_checked": 0,
    "status": "error",
    "cli_version": "1.0.0",
    "project_root": "/path/to/project"
  },
  "error": {
    "code": "FILE_NOT_FOUND",
    "message": "文件未找到: packages/missing/package.json",
    "suggestion": "请检查路径是否正确，或运行 cortex scan --filter 缩小范围"
  },
  "dependencies": {},
  "drifts": []
}
```

### 7.3 假阳性禁止原则

依据分析报告 §七 R4-R7（设计接受的低风险项）和 NG-2026-0509-Persist-False-Positive 判例：

| 场景 | 是否告警 | 理由 |
|------|---------|------|
| `import type` 循环引用 | ❌ 不告警 | 编译期擦除，零运行时开销 |
| `workspace:*` 一致使用 | ❌ 不告警 | 协议本身保证一致性 |
| 单出现依赖 | ❌ 不告警 | 无比较对象，不构成漂移 |
| 版本字符串含空格 | ✅ 告警（但 trim 后正常则转为干净） | 格式问题，不是内容问题 |
| `*` / `latest` 非严格模式 | ❌ 不告警（标记为 `[开放版本]`） | 设计约定 |

---

## 八、与现有架构的衔接

### 8.1 零内部依赖约束

依据分析报告 §五.1 分层架构 + drift-detector-design §6.1：

```
CLI 工具 → 仅使用 Node.js 内置模块 (fs, path, process)
         → 不引入任何 @cortex/* 包
         → 不依赖 pnpm / npm API
```

### 8.2 CI 流程位置

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ drift    │ ──→ │ build    │ ──→ │ typecheck│ ──→ │ test     │ ──→ │ lint     │
│ detect   │     │          │     │          │     │          │     │          │
└──────────┘     └──────────┘     └──────────┘     └──────────┘     └──────────┘
    P0               P0              P0               P0              P0
```

漂移检测置于 build 之前：版本不一致可能在 build 阶段暴露为难以诊断的编译错误。

### 8.3 与治理体系的关系

| 治理机制 | 衔接方式 |
|---------|---------|
| 宪法 §十四 编译时治理 | CLI 的 `check` 命令作为 CI 门禁一环 |
| DocGovernAgent 审计 | `report` 命令的输出写入 DocGovern 分区 |
| 圆桌会议材料清单 | `report` 命令生成会议材料 |
| 钟离（StrategistAgent） | CLI 提供依赖一致性维度的战略评估数据 |

---

## 九、与现有实现的差异对照

此设计对现有 `tools/configuration-drift.ts` 的扩展与修正：

| 项目 | 现有实现 | 本设计 | 说明 |
|------|---------|-------|------|
| 版本字符串 | 未 trim | ✅ 强制 trim | 修复审查缺陷 1 |
| 推荐策略 | 多数派 + 最高版本 | ✅ 增加根版本优先 | 修复审查缺陷 2 |
| `*` / `latest` 处理 | 完全跳过 | ✅ 标记但不告警（`--strict` 可告警） | 修复审查缺陷 3 |
| JSON 键名 | camelCase | ✅ snake_case | 对齐设计文档 |
| 输出格式 | text + json | ✅ text + json + markdown | 扩展 |
| 子命令 | 无（单文件入口） | ✅ `scan` / `check` / `report` / `init` | 扩展 |
| 配置文件 | 无 | ✅ `cortex.config.json` | 扩展 |
| 循环依赖检测 | 无 | ✅ `check.cycles` | 新增 |
| 架构合规检查 | 无 | ✅ `check.architecture` | 新增 |
| 列宽 | 硬编码 | ✅ 动态计算 | 健壮性提升 |

---

## 十、附录：使用示例

### 10.1 基础用法

```bash
# 扫描项目
cortex scan

# 检测版本漂移（终端输出）
cortex check drift

# 检测版本漂移（JSON 输出到文件）
cortex check drift --json --output ./reports/drift.json

# 检测循环依赖
cortex check cycles --depth 5 --include-dev

# 检查 ESLint 配置完整性
cortex check lint

# 生成综合报告
cortex report --format markdown --output ./reports/governance-report.md

# 使用配置文件 + 忽略指定依赖
cortex check drift --ignore "@types/node" --ignore "uuid"
```

### 10.2 配置文件示例

```bash
# 初始化配置文件
cortex init

# 使用配置文件运行（配置文件 cortex.config.json 自动加载）
cortex check drift
```

### 10.3 CI 集成示例

```yaml
# .github/workflows/ci.yml
jobs:
  governance:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npx cortex check drift --json --output drift-report.json
      - run: |
          if [ $? -eq 1 ]; then
            echo "❌ 检测到版本漂移，请查看 drift-report.json"
            exit 1
          fi
```

---

*奉行文书不需要序言。——久岐忍*
