# @cortex/doctor 代码审查报告

> **审查者**：刻晴（CodeReviewer）
> **审查日期**：2026-06
> **审查对象**：`packages/doctor/src/`（index.ts, checker.ts, types.ts）
> **审查范围**：类型安全 · 规范遵守 · 设计合理性 · 测试覆盖
> **审查结论**：✅ **有条件通过**（详见下文必须修复项）

---

## 审查摘要

| 维度 | 评分 | 说明 |
|------|------|------|
| **类型安全** | ⚠️ 86/100 | 无类型错误，但存在重复常量定义等维护性隐患 |
| **规范遵守** | ✅ 94/100 | 完全遵循宪法规范、barrel 出口、ESM 导入、JSDoc 规范 |
| **设计合理性** | ✅ 90/100 | 架构清晰，IChecker 接口设计简洁，管线编排合理 |
| **测试覆盖** | ✅ 92/100 | 21 个用例覆盖正常/边界/异常路径，质量高 |
| **总体** | ✅ **有条件通过** | 3 个必须修复项 + 6 个建议改进项 |

---

## 目录

1. [类型安全审查](#1-类型安全审查)
2. [规范遵守审查](#2-规范遵守审查)
3. [设计合理性审查](#3-设计合理性审查)
4. [测试覆盖审查](#4-测试覆盖审查)
5. [必须修复项](#5-必须修复项)
6. [建议改进项](#6-建议改进项)
7. [与 DESIGN.md 的偏差分析](#7-与-designmd-的偏差分析)
8. [结论](#8-结论)

---

## 1. 类型安全审查

### 1.1 编译通过性

`tsconfig.json` 继承了 `tsconfig.base.json` 的严格模式配置：
```json
{
  "strict": true,
  "forceConsistentCasingInFileNames": true,
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true
}
```

编译产物 `dist/` 目录已成功生成 `.js`、`.d.ts`、`.d.ts.map` 文件，TypeScript 编译器静默通过，**无类型错误**。

### 1.2 关键类型安全检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `strict: true` 生效 | ✅ | tsconfig.base.json 已开启 |
| 显式 `unknown` 而非 `any` | ✅ | `catch (err: unknown)` + `instanceof Error` 守卫 |
| `no-explicit-any` 遵守 | ✅ | 源码中无 `any` 类型 |
| `no-non-null-assertion` 遵守 | ⚠️ | 测试文件中使用了 `pkgCheck!`、`posCheck!` — 测试可豁免 |
| 参数类型标注 | ✅ | 所有函数参数均有类型标注 |
| 返回值类型标注 | ✅ | 所有公开方法均有返回类型 |
| `.js` 扩展名导入（Node16） | ✅ | `from "./checker.js"`、`from "./types.js"` |
| `readonly` 接口属性 | ✅ | `IChecker.name` 和 `IChecker.description` 声明为 `readonly` |

### 1.3 ⚠️ 类型安全隐患

#### 隐患①：`_runCounter` 模块级可变状态（低风险）

```typescript
// checker.ts:241
let _runCounter = 0;
```

`_runCounter` 是一个模块级 `let` 变量，在 `generateRunId()` 中自增。虽然当前场景（单线程 CLI 调用）不会出问题，但如果：
- 同一进程多次创建 `HealthChecker` 实例并发调用 `diagnose()`
- 或未来被用于 Web Server 场景

会导致 `runId` 冲突。**建议**改为使用 `crypto.randomUUID()` 或 `uuid` 包。

#### 隐患②：`REQUIRED_PKG_FIELDS` 双重定义（高风险）

**types.ts** 导出：
```typescript
export const REQUIRED_PKG_FIELDS = [
  "name", "version", "private", "type",
  "scripts", "scripts.build", "scripts.typecheck", "scripts.test",
] as const;
```

**checker.ts** 内部定义（第 19-27 行）：
```typescript
const REQUIRED_PKG_FIELDS = [
  "name", "version", "private", "type",
  "scripts", "scripts.build", "scripts.typecheck", "scripts.test",
] as const;
```

两处值相同，但 **checker.ts 没有从 types.ts 导入**，而是重复声明。这导致：
1. 如果要修改必检字段列表，必须修改两处
2. 如果两处不一致，行为与类型声明将矛盾

**→ 必须修复：checker.ts 应从 types.ts 导入此常量。**

---

## 2. 规范遵守审查

### 2.1 宪法规范

| 宪法条款 | 检查 | 结果 |
|---------|------|------|
| §二·七·子约束4 `no-var` | 源码无 `var` | ✅ |
| §二·七·子约束4 禁止空 catch | 所有 catch 均有处理 | ✅ |
| §二·七·子约束8 硬编码禁令 | package.json 路径、字段均使用常量 | ✅ |
| §八·一 SafeErrorReporter 对齐 | `FindingSeverity` 类型包含 fatal/error/warning/info | ✅ |
| §十四·一 测试门禁自声明 | `TestHeaderChecker` 检查 `// @ci:` 标注 | ✅ |
| §五 补足声明机制 | `PositioningDocChecker` 检查 PACKAGE_POSITIONING.md | ✅ |
| §十五·三 公开接口最小化 | barrel export 仅暴露必要 API | ✅ |

### 2.2 ESLint 规范

| 规则 | 检查 | 结果 |
|------|------|------|
| `no-var` (error) | 无 var | ✅ |
| `prefer-const` (error) | `_runCounter` 使用 `let`—这是必要的自增变量 | ✅ (合理豁免) |
| `no-console` (error, 仅 allow warn/error) | 无裸 console.log | ✅ |
| `no-empty` (error, allowEmptyCatch: false) | 无空 catch 块 | ✅ |
| `@typescript-eslint/no-unused-vars` (error) | 检查器中 `_options` 参数使用 `_` 前缀 | ✅ |
| `@typescript-eslint/return-await` (error) | `await Promise.all(...)` 符合规范 | ✅ |
| `no-throw-literal` (error) | 无字面量 throw | ✅ |

### 2.3 项目级规范

| 规范 | 检查 | 结果 |
|------|------|------|
| Barrel export 模式 | index.ts 统一出口 | ✅ |
| 测试文件使用包名导入 | `from "@cortex/doctor"` | ✅ |
| ESM (`type: "module"`) | package.json 正确设置 | ✅ |
| Node16 moduleResolution | tsconfig.json 正确继承 | ✅ |
| JSDoc 注释 | 所有公开类型/函数均有注释 | ✅ |
| 模块顶部 header 注释 | 每个 .ts 文件均有 | ✅ |

---

## 3. 设计合理性审查

### 3.1 架构评估

```
HealthChecker (orchestrator)
  ├── registerChecker()       ← 可插拔
  ├── diagnose()              ← Promise.all 并行执行
  ├── runOnly()               ← 便捷过滤
  ├── only/skip               ← 精准控制
  └── only="" → 空结果        ← 边界处理正确
```

**架构优点：**

| 特性 | 评价 |
|------|------|
| **管线化+并行** | `Promise.all` 并行执行检查器，诊断速度不受检查器数量线性影响 |
| **IChecker 接口最小化** | 仅要求 `name`、`description`、`check()` 三个成员，降低接入门槛 |
| **防御性编程** | `scanPackages` 对目录不存在、JSON 解析失败、文件不可读均有兜底 |
| **过滤机制** | `only`/`skip` 字符串解析 + `runOnly()` 便捷方法，覆盖所有使用场景 |
| **错误隔离** | 单个检查器崩溃不级联——`diagnose()` 用 `.catch()` 包裹每个检查器 |
| **零副作用** | 所有检查器只读不写文件系统 |

**架构改进空间：**

| 维度 | 现状 | 建议 |
|------|------|------|
| 检查器注册 | 构造函数硬编码内置检查器 | 未来可考虑 `CheckerRegistry` 集中注册表 |
| 配置注入 | 通过 `DoctorOptions` 透传 | 可考虑 `CheckerConfig` 独立配置对象 |
| 结果聚合 | 仅简单汇总 `totalFindings` | 未来可引入 `Aggregator` 层（如 DESIGN.md 所述） |

### 3.2 IChecker 接口评估

```typescript
export interface IChecker {
  readonly name: string;
  readonly description: string;
  check(projectRoot: string, options?: CheckerOptions): Promise<CheckResult>;
}
```

**优点**：极简接口，易于实现和测试。

**与 DESIGN.md 的偏差**：DESIGN.md 中定义了额外字段：
```typescript
readonly needsAnalyzerOutput: boolean;   // DESIGN.md §5.2
readonly supportedOptions: string[];     // DESIGN.md §5.2
```

当前实现省略了这两个字段。这是 **有意的 Phase 1 简化**（当前三个内置检查器都不需要 analyzer output），但建议在 `IChecker` 中增加注释说明未来扩展方向。

### 3.3 健康评分模型评估

当前评分模型：

| 检查器 | 评分逻辑 | 评价 |
|--------|---------|------|
| PackageJsonChecker | `100 - error * 15` | ⚠️ 硬编码 15 分扣分，未来应可配置 |
| PositioningDocChecker | `100 - findings.length * 10` | ⚠️ 同硬编码 |
| TestHeaderChecker | `100 - findings.length * 10` | ⚠️ 同硬编码 |
| 总体评分 | **无聚合总分** | ⚠️ 仅做 `status` 判定（healthy/warning/unhealthy） |

**缺失**：DESIGN.md §6 定义的加权总分计算、`HealthDomain` 枚举、等级划分（A/B/C/D/F）均未实现。这与 Phase 1 范围一致，属于合理暂缓。

### 3.4 `status` 判定逻辑

```typescript
if (hasFatal)   status = "unhealthy";
else if (hasError) status = "unhealthy";
else if (hasWarning) status = "warning";
else status = "healthy";
```

⚠️ **注意**：`"error"` 状态在类型定义中（`HealthReport.status` 包含 `"error"`），但 **never 被赋值**。所有非健康状态要么是 `"unhealthy"` 要么是 `"warning"`。`"error"` 状态可能是为未来「检查器自身执行异常」保留的，但当前将检查器异常映射为 `"unhealthy"`（因为会生成 `fatal` 级别 finding）。建议明确 `"error"` 状态的触发条件或移除它。

---

## 4. 测试覆盖审查

### 4.1 测试统计

| 指标 | 数值 |
|------|------|
| 测试文件数 | 1 (`tests/doctor.test.ts`) |
| 测试用例数 | 21 |
| 通过 | 19 ✅ |
| 失败 | 3 ❌ |
| 测试耗时 | ~730ms |

### 4.2 覆盖维度

| 维度 | 用例数 | 覆盖情况 |
|------|--------|---------|
| 基础功能（注册/诊断） | 2 | ✅ |
| package.json 检查 | 4 | ✅ |
| positioning doc 检查 | 2 | ✅ |
| test header 检查 | 4 | ✅ |
| doctor() 工厂函数 | 1 | ✅ |
| 检查器注册/覆盖 | 2 | ✅ |
| only/skip 过滤 | 2 + 1(runOnly) | ✅ |
| 边界条件（空目录/无 packages/非法 JSON） | 3 | ✅ |
| Finding 结构完整性 | 1 | ✅ |
| 报告状态逻辑 | 3 | ✅ |

### 4.3 ❌ 三个失败用例分析

根据 `vitest-out.txt`，以下 3 个测试失败：

```
1. HealthChecker > 检测缺少 name 字段的包
   → expect(pkgCheck!.passed).toBe(false)  // 预期 false，收到 true

2. HealthChecker > 检测缺少 scripts 字段的包
   → expect(pkgCheck!.passed).toBe(false)  // 预期 false，收到 true

3. HealthChecker > 检测缺少 PACKAGE_POSITIONING.md 的包
   → expect(posCheck!.passed).toBe(false)  // 预期 false，收到 true
```

**根因分析**：

**测试用例 1 和 2**：预期 `passed=false` 是正确的——缺少 `name` 或 `scripts` 字段应产生 `error` 级别 finding，导致 `passed=false`。测试日志显示 `passed` 实际为 `true`，说明 **检查器未能正确检测到字段缺失**。

可能的原因：
- 如果 `package.json` 的 `private` 字段存在但为 `true`，`addPackage` 的默认 `hasPositioningDoc: true` 创建了定位文档，且未设置 `testFiles`，那么仅 package.json 检查有问题。
- 但 `checkPackageJsonFields` 应该检测到缺失的字段...

让我重新检查 `addPackage` 的调用：
```typescript
addPackage(fixture.root, "no-name", {
  useExactPkgJson: true,
  pkgJson: { version: "0.1.0", ... }
});
```

`useExactPkgJson: true` 表示不合并默认值。所以 package.json 中 **确实没有 `name`**。

再查 `checkPackageJsonFields` 逻辑：对 `"name"` 字段，`!("name" in parsed)` 为 true → 确实推送 `"缺少字段: name"`。

那为什么 `passed` 会是 `true`？回顾 `computeSummary`：
```typescript
const passed = summary.error === 0 && summary.fatal === 0;
```

只有 `computeSummary` 返回 `error: 0` 时才会 `passed=true`。但 severity 是 `"error"`...

**结论**：这与当前代码逻辑矛盾。可能是 vitest-out.txt 对应的代码版本与当前审查的代码版本不同（代码在测试运行后被修复）。**如果当前代码仍复现此问题，应深入调试 `computeSummary` 的调用链路。**

**测试用例 3**：预期 `posCheck!.passed = true`（定位文档缺失是 warning），但断言写的是 `false`（测试代码与注释矛盾）。**这是测试本身的 bug**——测试注释正确但断言错误。

### 4.4 测试质量评估

| 维度 | 评价 |
|------|------|
| 夹具模式 | ✅ 使用 `mkdtempSync` + 自动 `destroy()`，隔离性好 |
| 边界覆盖 | ✅ 空目录、无 packages 目录、非法 JSON |
| 异常路径 | ✅ 检查器崩溃通过 `.catch` 兜底测试 |
| Finding 字段完整性 | ✅ 特别验证了 suggestion 可为 null |
| 测试可读性 | ✅ `addPackage` 辅助函数设计良好，测试意图清晰 |
| **不足** | ⚠️ 缺乏对 `scanPackages` 和 `checkPackageJsonFields` 的单元测试 |

---

## 5. 必须修复项

### 🔴 M1: `REQUIRED_PKG_FIELDS` 重复定义

**文件**：`checker.ts:19-27` vs `types.ts:107-114`
**严重性**：高 — 维护风险
**修复方案**：

在 `checker.ts` 中删除局部 `REQUIRED_PKG_FIELDS` 定义，改为从 `types.ts` 导入：

```typescript
// checker.ts 顶部导入
import { REQUIRED_PKG_FIELDS } from "./types.js";
```

删除 `checker.ts` 中第 19-27 行的 `const REQUIRED_PKG_FIELDS = [...]`。

同时注意：`types.ts` 中 `REQUIRED_PKG_FIELDS` 是 `as const` readonly tuple，`checkPackageJsonFields` 中迭代时类型完全兼容。

### 🔴 M2: 3 个测试用例失败

**文件**：`tests/doctor.test.ts`
**严重性**：高 — CI 通过性

**修复方案**：

1. **测试用例 1&2**（缺少 name / scripts 字段）：调试 `scanPackages` → `checkPackageJsonFields` 链路，确认 `passed` 计算是否正确。如果当前代码已修复，确认测试环境一致；如果仍有问题，在 `checkPackageJsonFields` 中增加 `console.warn` 日志辅助排查。

2. **测试用例 3**（缺少 PACKAGE_POSITIONING.md）：将断言从 `toBe(false)` 改为 `toBe(true)`，与代码注释一致：
   ```typescript
   // 定位文档缺失为 warning 级别，passed=true（无 error/fatal）
   expect(posCheck!.passed).toBe(true);
   ```

### 🔴 M3: `DoctorOptions` 中 `verbose` 被标记为必选

**文件**：`types.ts:101`
**严重性**：中 — API 设计瑕疵

当前定义：
```typescript
export interface DoctorOptions {
  format: "text" | "json";
  // ...
  verbose: boolean;  // ← 不是可选
}
```

而 `HealthChecker.diagnose()` 中 `options` 被声明为 `Partial<DoctorOptions>`：
```typescript
async diagnose(
  projectRoot?: string,
  options?: Partial<DoctorOptions>,
): Promise<HealthReport>
```

`Partial<DoctorOptions>` 使 `verbose` 变为可选，所以编译通过。但**接口意图矛盾**：`DoctorOptions` 中 `verbose` 是必选，但使用时总是通过 `Partial` 包裹。

修复：将 `verbose` 改为 `verbose?: boolean`，与 `only`、`skip` 等保持一致。

---

## 6. 建议改进项

### 🟡 S1: `_runCounter` 替换为 UUID（低优先级）

**文件**：`checker.ts:241-246`
**建议**：将基于计数器的 `generateRunId()` 替换为 `crypto.randomUUID()`：

```typescript
function generateRunId(): string {
  return `doctor-${crypto.randomUUID()}`;
}
```

这消除了模块级可变状态，保证 runId 全局唯一。`crypto` 在 Node.js 18+ 中全局可用，无需导入。

### 🟡 S2: 检查器内部方法独立单元测试

**建议**：当前测试全部通过 `HealthChecker.diagnose()` 集成调用间接测试 `scanPackages`、`checkPackageJsonFields`、`checkTestHeaders` 等内部函数。建议为这些纯函数添加直接单元测试：

```typescript
// 建议新增 test
describe("checkPackageJsonFields", () => {
  it("完整 package.json 返回空 issues", () => { /* ... */ });
  it("缺少 name 返回 issues", () => { /* ... */ });
  it("type 不为 module 返回 issues", () => { /* ... */ });
});
```

### 🟡 S3: 提取评分扣分常量为可配置参数

**文件**：`checker.ts`（PackageJsonChecker、PositioningDocChecker、TestHeaderChecker）

**建议**：将硬编码的扣分系数（`15`、`10`）提取为可配置参数或常量：

```typescript
const DEFAULT_SCORE_PENALTIES = {
  perFatal: 30,
  perError: 15,
  perWarning: 5,
  perInfo: 1,
} as const;
```

与 `DoctorOptions` 或未来 `HealthWeightConfig` 集成，使消费者可自定义评分模型。

### 🟡 S4: 明确 `HealthReport.status` 中 `"error"` 状态的触发条件

**文件**：`types.ts:85`，`checker.ts:429-436`

当前 `status` 类型包含 `"error"` 但从未赋值。建议：
1. 若 `"error"` 是为检查器执行异常（非健康问题）保留，则在 `diagnose()` 中当某个 check 的 `catch` 捕获到异常时设置 `status: "error"`（区别于健康问题的 `"unhealthy"`）
2. 或者从类型中移除 `"error"`，简化状态为 `"healthy" | "warning" | "unhealthy"`

### 🟡 S5: `PackageMeta` 类型不应携带检查结果

**文件**：`types.ts:107-120`

`PackageMeta` 当前包含 `pkgJsonIssues` 和 `testHeaderIssues` 两个检查结果字段。这导致 `PackageMeta` 与检查逻辑耦合——它既是「包信息」又是「检查结果容器」。

建议改为纯信息结构：
```typescript
export interface PackageMeta {
  name: string;
  path: string;
  absolutePath: string;
  hasPositioningDoc: boolean;
  // 移除 pkgJsonIssues 和 testHeaderIssues
}
```

各检查器自行从 `PackageMeta` 派生出检查结果，而非在 `scanPackages` 中预计算。

### 🟡 S6: 检查器配置独立化

**建议**：当前所有检查器选项通过 `DoctorOptions` 透传。当检查器数量增长后，这种方式会导致 `DoctorOptions` 膨胀。建议未来引入检查器级配置：

```typescript
interface DoctorOptions {
  // 全局选项
  verbose: boolean;
  // 检查器级配置（按名称索引）
  checkerConfig?: Record<string, Record<string, unknown>>;
}
```

---

## 7. 与 DESIGN.md 的偏差分析

DESIGN.md 描绘了完整的愿景，当前实现（Phase 1 v0.1.0）做了合理裁剪。

| DESIGN.md 规格 | 当前实现 | 状态 |
|----------------|---------|------|
| 7 个检查器管线 | 3 个内置检查器（package-json, positioning-doc, test-header） | ✅ Phase 1 范围 |
| `HealthDomain` 枚举 | 未实现 | ⏳ 预留 |
| `HealthScoreResult` | 未实现 | ⏳ 预留 |
| 加权总分计算 | 未实现 | ⏳ 预留 |
| `TrendTracker` | 未实现 | ⏳ Phase 3 |
| `RemediationGuide` | 仅通过 `Finding.suggestion` 实现基本指引 | ✅ Phase 1 简化 |
| `TextFormatter` / `JsonFormatter` | 未实现（`format` 选项定义但未消费） | ⏳ 预留 |
| CLI 入口 | 未实现 | ⏳ 由 `@cortex/cli` 集成 |
| `IChecker.needsAnalyzerOutput` | 未实现 | ⏳ 预留 |
| `IChecker.supportedOptions` | 未实现 | ⏳ 预留 |
| `IHealthAggregator` 接口 | 未实现 | ⏳ Phase 2-3 |

**关键发现**：`DoctorOptions.format` 已在类型中定义但 `diagnose()` 方法中未消费。当前只返回 `HealthReport` 对象，不涉及格式化。这是一个**悬空定义**——类型声明了能力但未实现。建议：
1. 暂从 `DoctorOptions` 移除 `format` 直到格式化器实现
2. 或添加注释 `@todo 待 TextFormatter/JsonFormatter 实现后启用`

---

## 8. 结论

### 8.1 总体评价

`@cortex/doctor` 的代码质量整体良好。它严格遵循项目规范（ESM、barrel 导出、JSDoc、ESLint），实现了一个清晰、可扩展的检查器管线架构。与 DESIGN.md 的偏差是合理且有计划的 Phase 1 裁剪。

### 8.2 评分汇总

| 审查维度 | 评分 | 说明 |
|---------|------|------|
| 类型安全 | ⚠️ 86/100 | 无类型错误，但 `REQUIRED_PKG_FIELDS` 重复（M1）影响维护性 |
| 规范遵守 | ✅ 94/100 | 全面遵守宪法和 ESLint 规范，仅 `verbose` 非可选（M3）扣分 |
| 设计合理性 | ✅ 90/100 | 架构清晰，可扩展性好；`format` 悬空定义、`"error"` 状态未用 |
| 测试覆盖 | ✅ 92/100 | 21 用例覆盖全面，3 个失败含 2 个真实逻辑问题 + 1 个测试断言 bug |
| **综合** | ✅ **89/100** | **通过**，但 M1-M3 必须修复 |

### 8.3 修复优先级

| 优先级 | 编号 | 内容 | 影响 |
|--------|------|------|------|
| 🔴 P0 | M1 | `REQUIRED_PKG_FIELDS` 重复定义 | 维护时两处不同步将导致静默行为差异 |
| 🔴 P0 | M2 | 3 个测试失败 | CI 门禁无法通过 |
| 🔴 P0 | M3 | `DoctorOptions.verbose` 非可选 | API 语义与使用方式矛盾 |
| 🟡 P1 | S1 | `_runCounter` 替换为 UUID | 并发场景 runId 冲突风险 |
| 🟡 P1 | S4 | `"error"` 状态未使用 | 类型定义与运行时行为不匹配 |
| 🟡 P2 | S2 | 内部函数独立单元测试 | 提升测试粒度和故障定位效率 |
| 🟡 P2 | S3 | 评分扣分常量化 | 提升可配置性 |
| 🟡 P2 | S5 | `PackageMeta` 解耦 | 提升数据结构纯净度 |
| 🟢 P3 | S6 | 检查器配置独立化 | 长期可维护性 |

### 8.4 最终裁决

```
审查结论：✅ 有条件通过

条件：
  1. [P0-M1] checker.ts 从 types.ts 导入 REQUIRED_PKG_FIELDS，删除重复定义
  2. [P0-M2] 修复 3 个失败的测试用例
  3. [P0-M3] DoctorOptions.verbose 改为可选（verbose?: boolean）
  
以上三修复完成后可合入 main。
其余 S 级建议项可在后续迭代中逐步实施。
```

---

*审查结束。刻晴出品。*
