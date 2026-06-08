# @cortex/doctor — 健康检查模式与技能文档

> **提炼者**：莫娜（AnalysisAgent）  
> **来源**：`@cortex/doctor` 包实现（checker.ts / types.ts / doctor.test.ts）  
> **版本**：v0.1.0  
> **目的**：从实际实现中萃取可复用的健康检查模式、架构决策与编程技能，供后续包（如 `@cortex/doctor` 的未来检查器、治理工具、审计脚本）直接借鉴。

---

## 目录

1. [模式一：检查器管线（Checker Pipeline）](#模式一检查器管线checker-pipeline)
2. [模式二：检查器接口契约（IChecker Contract）](#模式二检查器接口契约ichecker-contract)
3. [模式三：发现等级与扣分评分模型](#模式三发现等级与扣分评分模型)
4. [模式四：注册表 + 同名覆盖（Pluggability）](#模式四注册表--同名覆盖pluggability)
5. [模式五：only/skip 过滤器](#模式五onlyskip-过滤器)
6. [模式六：统一状态推导（Status Derivation）](#模式六统一状态推导status-derivation)
7. [模式七：防御性扫描（Defensive Scanning）](#模式七防御性扫描defensive-scanning)
8. [模式八：并行执行管线（Parallel Pipeline）](#模式八并行执行管线parallel-pipeline)
9. [模式九：夹具式测试（Fixture-based Testing）](#模式九夹具式测试fixture-based-testing)
10. [模式十：桶导出与模块公约（Barrel Export Convention）](#模式十桶导出与模块公约barrel-export-convention)
11. [附录：模式速查表](#附录模式速查表)

---

## 模式一：检查器管线（Checker Pipeline）

### 问题

一个健康诊断系统需要运行多个检查项（package.json 合规、定位文档存在性、测试标注合规……），每个检查项独立但输出需要统一聚合。如果逐一手动调用，调用方代码将充满重复编排逻辑。

### 解决方案

**`HealthChecker` 作为管线引擎**，持有 `IChecker[]` 数组，通过 `diagnose()` 方法统一编排执行，输出标准化的 `HealthReport`。

```
┌─────────────────────────────────────────────┐
│              HealthChecker                   │
│  ┌───────────────────────────────────────┐  │
│  │  checkers: IChecker[]                 │  │
│  │                                       │  │
│  │  [PackageJsonChecker,                 │  │
│  │   PositioningDocChecker,              │  │
│  │   TestHeaderChecker,                  │  │
│  │   ...]                                │  │
│  └───────────────────────────────────────┘  │
│                    │                         │
│         diagnose() │                         │
│                    ▼                         │
│  ┌───────────────────────────────────────┐  │
│  │  for each checker → await check()     │  │
│  │  aggregate into HealthReport          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 关键代码

```typescript
export class HealthChecker {
  private checkers: IChecker[];

  constructor() {
    this.checkers = [
      new PackageJsonChecker(),
      new PositioningDocChecker(),
      new TestHeaderChecker(),
    ];
  }

  async diagnose(projectRoot?: string, options?: Partial<DoctorOptions>): Promise<HealthReport> {
    const root = projectRoot ?? process.cwd();
    // 1. 解析 only/skip 过滤器
    // 2. 过滤检查器
    // 3. 扫描包元信息
    // 4. 并行执行所有检查器
    const results = await Promise.all(
      activeCheckers.map((checker) => checker.check(root, options).catch(handleError)),
    );
    // 5. 汇总状态
    // 6. 返回 HealthReport
  }
}
```

### 适用场景

- 任何需要**多维度检查 + 统一输出**的系统（代码审计、配置校验、CI 门禁）
- 检查项独立（无交叉依赖）或可并行执行
- 未来需要新增检查维度而不修改现有代码

### 变体

- **有依赖的管线**：若检查器 B 依赖检查器 A 的结果，分阶段执行（Phase 1 → Phase 2），如 DESIGN.md 中所述 `DependencyChecker → BuildPerformanceChecker`

---

## 模式二：检查器接口契约（IChecker Contract）

### 问题

多个检查器需要遵循同一套协议，以便管线引擎统一调度。如果每个检查器有自己的执行签名和返回格式，聚合层将无法通用化。

### 解决方案

**`IChecker` 接口**定义两个只读属性和一个异步方法，所有检查器实现此接口。

```typescript
export interface IChecker {
  /** 检查器唯一名称（如 "package-json"） */
  readonly name: string;

  /** 检查器描述（一行，用于 CLI 帮助和报告） */
  readonly description: string;

  /** 执行检查，返回标准化的 CheckResult */
  check(projectRoot: string, options?: CheckerOptions): Promise<CheckResult>;
}

export interface CheckerOptions {
  verbose?: boolean;
  projectRoot?: string;
  [key: string]: unknown;  // 扩展点
}
```

### 关键约束

| 约束 | 原因 |
|------|------|
| `name` 为 kebab-case 字符串 | 用作 CLI `--only` / `--skip` 过滤的标识符 |
| `check()` 返回 `Promise<CheckResult>` | 支持异步 I/O（文件读取、外部工具调用） |
| `CheckResult` 包含 `score: number \| null` | 评分模型统一消费 |
| `CheckerOptions` 留有 `[key: string]: unknown` | 不同检查器可传递自定义参数 |

### 实现示例

```typescript
class PackageJsonChecker implements IChecker {
  readonly name = "package-json";
  readonly description = "检查各包 package.json 的必须字段存在性和类型正确性";

  async check(projectRoot: string, _options?: CheckerOptions): Promise<CheckResult> {
    // 实现逻辑...
    const findings: Finding[] = [];
    // ...
    return {
      checker: this.name,
      passed: findings.filter(f => f.severity === "error" || f.severity === "fatal").length === 0,
      findings,
      summary: computeSummary(findings),
      score: passed ? 100 : Math.max(0, 100 - summary.error * 15),
      durationMs: Date.now() - startTime,
    };
  }
}
```

### 适用场景

- 任何需要**插件化/可扩展检查**的系统
- 希望消费方不感知具体检查器实现，只面向接口编程

---

## 模式三：发现等级与扣分评分模型

### 问题

健康检查不能只回答「过/不过」，需要量化健康程度，支持趋势追踪和阈值门禁。如果没有评分模型，CI 无法设置「健康分低于 80 阻断」的精细化策略。

### 解决方案

**四级发现等级 + 扣分制评分模型**：

```typescript
export type FindingSeverity = "fatal" | "error" | "warning" | "info";
```

**评分算法（每个检查器独立计算）**：

| 等级 | 扣分 | 含义 |
|------|------|------|
| `fatal` | 直接 0 分 | 系统级故障（检查器崩溃） |
| `error` | -15 分/项 | 必须修复（字段缺失、标注不合规） |
| `warning` | -10 分/项 | 建议修复（定位文档缺失） |
| `info` | -1 分/项 | 参考信息 |

```
域评分 = max(0, 100 - Σ(各项扣分))
```

### 关键代码

```typescript
function computeSummary(findings: Finding[]): CheckResult["summary"] {
  let fatal = 0, error = 0, warning = 0, info = 0;
  for (const f of findings) {
    switch (f.severity) {
      case "fatal":   fatal++;   break;
      case "error":   error++;   break;
      case "warning": warning++; break;
      case "info":    info++;    break;
    }
  }
  return { fatal, error, warning, info, total: findings.length };
}

// 每个检查器计算自己的评分
score: passed ? 100 : Math.max(0, 100 - summary.error * 15);
```

### 全局状态推导

```typescript
// 基于所有检查器的所有发现推导总体状态
if (hasFatal)   status = "unhealthy";
else if (hasError) status = "unhealthy";
else if (hasWarning) status = "warning";
else status = "healthy";
```

| 状态 | 条件 | CI 行为 |
|------|------|---------|
| `healthy` | 无 fatal/error/warning | ✅ 通过 |
| `warning` | 仅有 warning，无 error/fatal | ⚠️ 通过（需审查） |
| `unhealthy` | 存在任何 fatal 或 error | ❌ 阻断 |

### 适用场景

- 任何需要**量化输出**的检查/审计系统
- CI 门禁中需要**分级阈值**（如 warning 不阻断，error 阻断）
- 趋势追踪需要**可比较的数值基线**

---

## 模式四：注册表 + 同名覆盖（Pluggability）

### 问题

内置检查器无法覆盖所有场景，用户需要添加自定义检查器，甚至替换内置检查器的行为。

### 解决方案

**`registerChecker()` 注册表模式**：支持新增检查器，也支持同名覆盖。

```typescript
registerChecker(checker: IChecker): void {
  const existing = this.checkers.findIndex((c) => c.name === checker.name);
  if (existing >= 0) {
    this.checkers[existing] = checker;  // 同名覆盖
  } else {
    this.checkers.push(checker);        // 新增
  }
}
```

### 使用示例

```typescript
const checker = new HealthChecker();

// 新增自定义检查器
checker.registerChecker({
  name: "tsconfig-check",
  description: "检查 tsconfig 一致性",
  async check(projectRoot) { /* ... */ },
});

// 覆盖内置检查器
checker.registerChecker({
  name: "package-json",  // 同名 → 覆盖
  description: "自定义 package.json 检查",
  async check(projectRoot) { /* ... */ },
});
```

### 设计要点

- **同名覆盖**：允许完全替换内置行为，而非追加（避免重复检查）
- **数组索引替换**：保持数组长度不变，其他检查器不受影响
- **防误用**：没有 `unregisterChecker()`——覆盖即替换，简化心智模型

### 适用场景

- 框架/库需要提供**默认实现 + 自定义扩展**能力
- 不同 monorepo 有不同的合规策略（如有的要求 `lint` 脚本，有的不要求）

---

## 模式五：only/skip 过滤器

### 问题

调试时只想运行单个检查器（如只检查 package.json），或者 CI 中某些阶段需要跳过某些检查器。如果每次都要修改注册逻辑，效率低且容易出错。

### 解决方案

**在 `diagnose()` 选项中提供 `only` 和 `skip` 字符串参数**，用逗号分隔检查器名称。

```typescript
async diagnose(projectRoot?: string, options?: Partial<DoctorOptions>): Promise<HealthReport> {
  const only = options?.only;
  const skip = options?.skip;

  // 解析 only 过滤器
  const onlyNames = only
    ? only.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // 解析 skip 过滤器
  const skipNames = skip
    ? skip.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // 应用过滤
  let activeCheckers = this.checkers;
  if (onlyNames) {
    activeCheckers = activeCheckers.filter((c) => onlyNames!.includes(c.name));
  }
  if (skipNames) {
    activeCheckers = activeCheckers.filter((c) => !skipNames!.includes(c.name));
  }

  // 空列表 → 返回空报告
  if (activeCheckers.length === 0) {
    return { /* 空健康报告 */ };
  }
}
```

### 优先级规则

```
only 优先于 skip
only 为空/不设置 → 不过滤
skip 为空/不设置 → 不过滤
only + skip 同时设置 → only 先过滤，skip 再剔除
only 为空字符串 → 返回空报告（无检查器执行）
```

### CLI 映射

```
pnpm doctor --only package-json           # 只检查 package.json
pnpm doctor --skip positioning-doc        # 跳过定位文档检查
pnpm doctor --only package-json,test-header  # 多检查器
```

### 适用场景

- CLI 工具需要**精准控制执行范围**
- 调试/开发阶段只关注特定维度
- CI 分阶段执行（Phase 1 只跑轻量检查，Phase 2 跑深度检查）

---

## 模式六：统一状态推导（Status Derivation）

### 问题

多个检查器各有 `passed` 布尔值和 findings 列表，但消费方（CLI / CI 脚本）需要一个**单一的总体状态**来判断通过/阻断。

### 解决方案

**基于最严重发现推导总体状态**，而非机械地汇总各检查器的 `passed`。

```typescript
const allFindings = results.flatMap((r) => r.findings);
const hasFatal   = allFindings.some((f) => f.severity === "fatal");
const hasError   = allFindings.some((f) => f.severity === "error");
const hasWarning = allFindings.some((f) => f.severity === "warning");

let status: HealthReport["status"];
if (hasFatal)        status = "unhealthy";
else if (hasError)   status = "unhealthy";
else if (hasWarning) status = "warning";
else                 status = "healthy";
```

### 设计决策

| 决策 | 理由 |
|------|------|
| flatMap 聚合所有 findings | 不按检查器加权，一个包的 error 就应全局 unhealthy |
| warning 不升级为 unhealthy | warning 是建议性而非强制，阻断太严苛 |
| 不取各检查器 passed 的 AND | 如果某个检查器没有运行（被 skip），不应影响状态 |
| 不设 passing 中间态 | 只有三个清晰状态，避免模棱两可 |

### 适用场景

- 任何**聚合多维度结果**的报告系统
- CI 门禁需要**明确通过/阻断决策**

---

## 模式七：防御性扫描（Defensive Scanning）

### 问题

实际运行中，项目结构可能不完整（无 `packages/` 目录、`package.json` 非 JSON、文件权限不足等）。如果扫描代码抛出未捕获异常，整个管线崩溃，无法输出任何报告。

### 解决方案

**每个 I/O 操作都 try-catch，失败时优雅降级**，而非传播异常。

```typescript
function scanPackages(projectRoot: string): PackageMeta[] {
  // 防御点 1: packages 目录不存在 → 返回空数组
  let entryNames: string[];
  try {
    entryNames = fs.readdirSync(packagesDir);
  } catch {
    return results;  // 优雅降级
  }

  for (const name of entryNames) {
    // 防御点 2: stat 失败 → 跳过
    try { stat = fs.statSync(pkgPath); } catch { continue; }

    // 防御点 3: 读取 package.json 失败 → 记录问题而非崩溃
    try {
      const parsed = JSON.parse(raw);
      // ...
    } catch (err) {
      pkgJsonIssues.push(`无法解析 package.json: ${errMsg}`);
    }
  }
}
```

### 同样应用于检查器级别

```typescript
// 在 diagnose() 中，每个检查器的错误被捕获并转为 fatal Finding
const results = await Promise.all(
  activeCheckers.map((checker) =>
    checker.check(root).catch((err) => {
      return {
        checker: checker.name,
        passed: false,
        findings: [{
          id: `CHECKER-ERR-${checker.name}`,
          severity: "fatal",
          title: `${checker.name} 检查器执行异常`,
          message: `错误: ${errMsg}`,
          // ...
        }],
        score: 0,
        // ...
      };
    }),
  ),
);
```

### 防御点清单

| 场景 | 处理方式 |
|------|---------|
| `packages/` 目录不存在 | 返回空数组，不报错 |
| 目录中混入非目录文件 | `!stat.isDirectory()` → `continue` |
| 目录中无 `package.json` | `!fs.existsSync(pkgJsonPath)` → `continue` |
| `package.json` 内容非 JSON | 记录到 `pkgJsonIssues`，不崩溃 |
| 目录不可读 | `catch { continue }` |
| 子包名重复 | 当前实现允许重复（后续可加 dedup） |
| 检查器执行抛异常 | 转为 fatal Finding，不中断其他检查器 |

### 适用场景

- 所有**文件系统扫描**操作
- 对外部数据（用户配置、第三方文件）的解析
- 分布式系统中部分组件不可用时的降级

---

## 模式八：并行执行管线（Parallel Execution）

### 问题

多个检查器相互独立（无数据依赖），如果串行执行，总耗时 = Σ 各检查器耗时。当检查器数量增多时，诊断速度线性下降。

### 解决方案

**用 `Promise.all` 并行执行所有检查器**，总耗时 ≈ max(各检查器耗时)。

```typescript
const startTime = Date.now();
const results = await Promise.all(
  activeCheckers.map((checker) =>
    checker.check(root, { verbose, projectRoot: root })
      .catch((err) => createErrorResult(checker, err)),
  ),
);
const totalDuration = Date.now() - startTime;
```

### 适用条件

| 条件 | 说明 |
|------|------|
| ✅ 检查器之间无数据依赖 | 当前所有内置检查器独立扫描文件系统 |
| ✅ 文件系统并发读安全 | Node.js `fs` 模块线程安全 |
| ✅ 无共享可变状态 | 每个检查器内部状态隔离 |
| ❌ 有依赖的检查器（Phase 2） | 需要 `await Promise.all(phase1)` → `await Promise.all(phase2)` |

### 性能收益

```
串行: 150ms + 120ms + 80ms = 350ms
并行: max(150ms, 120ms, 80ms) ≈ 150ms（57% 提升）
```

### 注意事项

- `Promise.all` 的 fail-fast 行为被 `.catch()` 兜底，不会因为一个检查器失败就中断所有
- 耗时统计使用 `Date.now()` 而非 `performance.now()`——对于 >50ms 的操作精度足够，且避免 `perf_hooks` 额外依赖

### 适用场景

- 独立检查/分析任务的编排
- 批量文件扫描
- 任何「分治再聚合」的工作流

---

## 模式九：夹具式测试（Fixture-based Testing）

### 问题

健康检查的核心逻辑依赖于文件系统结构（`packages/` 下有子包、`package.json` 内容、测试文件标注等）。如果静态定义 fixtures 文件，测试之间可能相互干扰，且无法灵活构造各种边界场景。

### 解决方案

**每个测试用例在 `os.tmpdir()` 中动态创建临时 monorepo，测试结束后销毁**。

```typescript
function createFixtureMonorepo(): { root: string; destroy: () => void } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
  fs.mkdirSync(path.join(baseDir, "packages"), { recursive: true });
  return {
    root: baseDir,
    destroy: () => fs.rmSync(baseDir, { recursive: true, force: true }),
  };
}

function addPackage(root: string, name: string, overrides?: {
  useExactPkgJson?: boolean;
  hasPositioningDoc?: boolean;
  pkgJson?: Record<string, unknown>;
  testFiles?: Array<{ name: string; content: string }>;
}): void {
  // 1. 创建包目录
  // 2. 写入 package.json（合并/覆盖模式）
  // 3. 可选创建 PACKAGE_POSITIONING.md
  // 4. 可选创建测试文件
}
```

### 测试生命周期

```typescript
describe("HealthChecker", () => {
  let fixture: ReturnType<typeof createFixtureMonorepo>;

  beforeEach(() => { fixture = createFixtureMonorepo(); });
  afterEach(() => { fixture.destroy(); });

  it("检测缺少 name 字段的包", async () => {
    addPackage(fixture.root, "no-name", {
      useExactPkgJson: true,
      pkgJson: { /* 故意缺失 name */ },
    });
    const report = await new HealthChecker().diagnose(fixture.root);
    expect(report.checks.find(c => c.checker === "package-json")!.passed).toBe(false);
  });
});
```

### 设计要点

| 特性 | 说明 |
|------|------|
| **`useExactPkgJson` 模式** | `true` = 完全替代默认值（测试缺失字段），`false` = 合并（测试覆盖） |
| **默认值** | `hasPositioningDoc` 默认 `true`，减少测试样板代码 |
| **dsync 销毁** | `fs.rmSync(dir, { recursive: true, force: true })` 确保清理 |
| **路径独立** | 每个 `beforeEach` 创建新目录，测试间完全隔离 |
| **生产代码也调用** | `scanPackages()` 内部同样 `fs.readdirSync`——测试验证真实 I/O 路径 |

### 适用场景

- 任何**依赖于文件系统结构**的检查/扫描代码
- 需要构造多种「合法/不合法」项目结构的测试
- 避免 mock 文件系统——真实 I/O 更接近生产环境

---

## 模式十：桶导出与模块公约（Barrel Export Convention）

### 问题

一个包有多个源文件，如果消费者直接 `import { ... } from '../src/checker'`，导入路径会越来越深，重构时改动面大。没有统一的导出公约，新成员不知道在哪里公开类型。

### 解决方案

**单一桶文件（`index.ts`）作为所有公开 API 的唯一出口**，配合模块级注释声明公约。

```typescript
// index.ts — 桶导出

// ── 核心入口 ──
export { HealthChecker, doctor } from "./checker.js";

// ── 类型导出 ──
export type {
  FindingSeverity, Finding, CheckResult,
  CheckerOptions, IChecker, HealthReport,
  DoctorOptions, PackageMeta,
} from "./types.js";

// ── 常量导出 ──
export { HEALTH_GRADE, REQUIRED_PKG_FIELDS } from "./types.js";
```

### 模块公约（写在文件顶部）

```typescript
// @module-convention 模块化铁律
// 1. 凡 src/ 下新增公开类型/函数/类，必须在本文件追加 export 行。
// 2. 测试文件禁止 ../src/ 相对导入——只用 @cortex/doctor 包名导入。
// 3. 违反者：导入路径越写越长，终至不可维护。
```

### 其他文件级公约

```typescript
// checker.ts
// @module-convention
// 1. 所有检查器通过 registerChecker 注册，管线自动编排。
// 2. 禁止空 catch 块——异常必须记录上下文再抛出/吞没。
// 3. 禁止使用 var——统一 const/let。
// 4. 禁止裸 console.warn——使用 Finding 机制上报警告。

// types.ts
// @module-convention
// 1. 本文件仅定义类型/接口/枚举——不含实现逻辑。
// 2. 类型命名统一使用 PascalCase，枚举成员使用 SCREAMING_SNAKE_CASE。
// 3. 所有类型字段均标注 JSDoc，确保生成 .d.ts 后消费者可获完整提示。
```

### 设计要点

- **`.js` 后缀**：ESM 模式下 `import` 必须带后缀
- **`type` 关键字**：`export type { ... }` 确保编译时被擦除，不产生 runtime 代码
- **公约写在文件顶部**：开发者打开文件第一眼看到约束，比写在 README 中更有效
- **`package.json exports` 映射**：确保 `@cortex/doctor` 解析到 `./dist/index.js`

### 适用场景

- 所有 TypeScript 包（尤其是 monorepo 中的内部包）
- 任何需要**约束团队成员导入规范**的场景

---

## 附录：模式速查表

| # | 模式 | 核心思想 | 文件位置 | 复用建议 |
|---|------|---------|---------|---------|
| 1 | **检查器管线** | `HealthChecker` 编排多个 `IChecker` | `checker.ts` | 任何多维度检查系统 |
| 2 | **接口契约** | `IChecker` 定义 name/description/check() | `types.ts` | 插件化系统的基础设施 |
| 3 | **发现等级 + 评分** | fatal/error/warning/info + 扣分制 | `checker.ts` `computeSummary()` | 量化审计输出的标准方式 |
| 4 | **注册表模式** | `registerChecker()` 支持新增和同名覆盖 | `checker.ts` `registerChecker()` | 框架级扩展点设计 |
| 5 | **only/skip 过滤** | 字符串逗号分隔 → 数组过滤 | `checker.ts` `diagnose()` | CLI 工具的通用过滤范式 |
| 6 | **状态推导** | 基于最严重发现推导 unhealthy/warning/healthy | `checker.ts` `diagnose()` | 聚合报告的通用状态机 |
| 7 | **防御性扫描** | 每个 I/O 都 try-catch，优雅降级 | `checker.ts` `scanPackages()` | 所有文件系统扫描代码 |
| 8 | **并行执行** | `Promise.all` 并行独立检查器 | `checker.ts` `diagnose()` | 独立的 I/O 密集型任务 |
| 9 | **夹具测试** | 临时目录 + 动态构建项目结构 | `doctor.test.ts` | 依赖文件系统的测试 |
| 10 | **桶导出公约** | 单一 index.ts + 模块级注释约束 | `index.ts` | 所有 TypeScript 包 |

---

## 模式关系图

```
                    ┌──────────────────────┐
                    │   桶导出公约 (10)      │ ← 包级组织规范
                    └──────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │  检查器接口契约 (2)    │ ← 基础设施
                    └──────────────────────┘
                              │
                    ┌────────┴────────┐
                    ▼                 ▼
          ┌──────────────────┐  ┌──────────────────┐
          │ 注册表模式 (4)    │  │ only/skip 过滤 (5)│ ← 扩展与控制
          └──────────────────┘  └──────────────────┘
                    │                 │
                    └──────┬──────────┘
                           ▼
                  ┌──────────────────┐
                  │ 检查器管线 (1)    │ ← 编排核心
                  └──────────────────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
          ┌──────────┐┌──────────┐┌──────────┐
          │并行执行(8)││防御扫描(7)││状态推导(6)│ ← 执行层
          └──────────┘└──────────┘└──────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │发现等级+评分 (3)  │ ← 量化输出
                  └──────────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  夹具测试 (9)     │ ← 质量保障
                  └──────────────────┘
```

---

*本文档由莫娜（AnalysisAgent）基于 `@cortex/doctor` 的实现代码（checker.ts / types.ts / index.ts / doctor.test.ts）以及设计文档（DESIGN.md / PACKAGE_POSITIONING.md）综合分析提炼。每个模式均从实际代码中抽象而来，附带适用场景和复用建议，供 monorepo 内其他包和治理工具直接采纳。*
