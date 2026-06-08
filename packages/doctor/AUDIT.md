# @cortex/doctor 合规审计报告

> **审计人**：凝光（AuditAgent）
> **审计日期**：2025-07-18
> **审计范围**：`@cortex/doctor` 包（v0.1.0）
> **审计类型**：合规审计 + 编码规范检查
> **设计文档**：`DESIGN.md`
> **定位文档**：`PACKAGE_POSITIONING.md`

---

## 审计结论总览

| 检查项 | 状态 | 说明 |
|--------|------|------|
| CI 标注合规 | ✅ 通过 | 测试文件首行 `// @ci: unit` 符合宪法 §十四·一 |
| PACKAGE_POSITIONING.md 完整性 | ✅ 通过 | 三个问题（Q1/Q2/Q3）全部完整回答 |
| 编码规范 — 空 catch | ❌ **违规** | 3 处空 catch 块未记录异常上下文 |
| 编码规范 — var 禁用 | ✅ 通过 | 全量使用 `const`/`let` |
| 编码规范 — 裸 console | ✅ 通过 | 无裸 `console.error`/`console.warn` |
| 导入使用 barrel | ✅ 通过 | 测试文件使用包名导入，index.ts 正确汇聚 |
| 无硬编码魔法数字 | ⚠️ **警告** | 3 处魔法数字未定义为具名常量 |
| 额外发现 | ⚠️ **注意** | `REQUIRED_PKG_FIELDS` 重复定义 |

**总体评级：🟡 有条件通过**（需修复 3 项空 catch 违规 + 提取魔法数字常量）

---

## 1. CI 标注合规（宪法 §十四·一）

### 检查内容
所有测试文件首行必须包含 `// @ci: <type>` 标注，其中 `<type>` ∈ {`unit`, `llm`, `integration`, `e2e`, `manual`}。

### 检查结果

| 文件 | 首行内容 | 合规 |
|-----|---------|------|
| `tests/doctor.test.ts` | `// @ci: unit` | ✅ |

**结论：通过。** 测试文件首行标注符合规范。

---

## 2. PACKAGE_POSITIONING.md 完整性（宪法 §五）

### 检查内容
定位文档必须回答三个核心问题：
- **Q1**: 本包补足了什么？
- **Q2**: 本包的定位是什么？
- **Q3**: 为什么值得合入？

### 检查结果

| 问题 | 是否回答 | 内容摘要 |
|------|---------|---------|
| Q1: 补足什么 | ✅ | 六个维度缺口（统一诊断入口、package.json 字段合规、定位文档存在性、测试门禁自声明、健康评分量化、可扩展检查器管线） |
| Q2: 定位是什么 | ✅ | 统一健康诊断套件——提供合规检查 + 量化评分 + IChecker 管线架构 |
| Q3: 值得合入 | ✅ | 直接价值（秒级合规体检/定位文档门禁/测试标注自声明）+ 架构价值（填补合规空白/可扩展管线）+ 低实施成本 |

**结论：通过。** 三个问题均有完整回答，附录提供实现范围、测试覆盖等信息。

---

## 3. 编码规范检查

### 3.1 空 catch 块 ❌

**文件**: `src/checker.ts`

依据 `checker.ts` 头部自声明模块规约：
> 2. 禁止空 catch 块——异常必须记录上下文再抛出/吞没。

以下 3 处 catch 块违反此规约：

| # | 位置 | 代码 | 问题 |
|---|------|------|------|
| 1 | `scanPackages()` — 读取 packages 目录 | ```ts
try {
  entryNames = fs.readdirSync(packagesDir);
} catch {
  // packages 目录不存在则返回空
  return results;
}
``` | 空 catch，未记录错误上下文。即使预期目录不存在，也应记录 `err` 信息便于调试 |
| 2 | `scanPackages()` — 获取文件状态 | ```ts
try {
  stat = fs.statSync(pkgPath);
} catch {
  continue;
}
``` | 空 catch，跳过不可读目录时不记录原因 |
| 3 | `checkTestHeaders()` — 读取 tests 目录 | ```ts
try {
  testFileNames = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts"));
} catch {
  return issues;
}
``` | 空 catch，读取 tests 目录失败时不记录错误 |

**修复建议**：每个 catch 块至少记录异常信息。示例：
```ts
} catch (err: unknown) {
  // 预期行为：packages 目录不存在
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
    return results;
  }
  // 非预期错误：记录上下文
  console.debug(`scanPackages: 读取 ${packagesDir} 失败`, err instanceof Error ? err.message : String(err));
  return results;
}
```

### 3.2 使用 var ✅

全量检索 `src/` 和 `tests/` 目录，未发现 `var` 关键字。所有变量声明使用 `const` 或 `let`，符合 TypeScript 最佳实践。

### 3.3 裸 console.error / console.warn ✅

全量检索 `src/` 和 `tests/` 目录，未发现裸 `console.error()` 或 `console.warn()` 调用。错误和警告信息全部通过 `Finding` 机制上报，符合模块规约。

**结论：3.1 违规（空catch），3.2 ✅，3.3 ✅**

---

## 4. 导入规范（Barrel 导出）

### 4.1 公开 API 导出

`src/index.ts` 作为 barrel 文件，正确汇聚并导出了所有公开 API：

```typescript
export { HealthChecker, doctor } from "./checker.js";
export type { FindingSeverity, Finding, CheckResult, CheckerOptions, IChecker, HealthReport, DoctorOptions, PackageMeta } from "./types.js";
export { HEALTH_GRADE, REQUIRED_PKG_FIELDS } from "./types.js";
```

✅ 所有公开类型/函数/常量均经由 barrel 导出。

### 4.2 消费者导入

测试文件 `tests/doctor.test.ts` 使用包名导入：
```typescript
import { HealthChecker, doctor } from "@cortex/doctor";
import type { IChecker, CheckResult } from "@cortex/doctor";
```

✅ 测试文件未使用相对路径导入，符合 barrel 规范。

### 4.3 内部模块导入

`src/checker.ts` 从 `./types.js` 导入类型，属于同级目录内部引用，合理。

**结论：通过。**

---

## 5. 魔法数字检查

### 5.1 违规项

| # | 位置 | 代码 | 建议 |
|---|------|------|------|
| 1 | `checker.ts:202` | `100 - summary.error * 15` | `15` 应定义为 `ERROR_PENALTY_POINTS = 15` |
| 2 | `checker.ts:326` | `Math.max(0, 100 - findings.length * 10)` | `10` 应定义为 `WARNING_PENALTY_POINTS = 10` |
| 3 | `checker.ts:286` | `_runCounter.toString(36).padStart(3, "0")` | `36` 和 `3` 应定义为 `RUN_ID_RADIX = 36`、`RUN_ID_PAD = 3` |

### 5.2 可接受项

| 位置 | 值 | 理由 |
|------|----|------|
| `HEALTH_GRADE` (`90/75/60/40`) | 评分等级常量 | 已定义为具名常量 `HEALTH_GRADE` |
| `Math.max(0, ...)` 中的 `0` | 下限值 | 语义明确的业务阈值 |
| `REQUIRED_PKG_FIELDS` 中的字段 | 字段列表 | 枚举值，非数字魔法值 |

**结论：⚠️ 存在 3 处魔法数字，建议提取为具名常量。**

---

## 6. 额外发现

### 6.1 `REQUIRED_PKG_FIELDS` 重复定义 ⚠️

`REQUIRED_PKG_FIELDS` 在两个文件中分别定义：

| 文件 | 行号 | 定义方式 |
|------|------|---------|
| `src/types.ts` | L157 | `export const REQUIRED_PKG_FIELDS = [...]` |
| `src/checker.ts` | L39 | `const REQUIRED_PKG_FIELDS = [...]` |

两者值相同，但 `checker.ts` 使用的是局部定义而非从 `types.ts` 导入。这导致：
- 若后续修改 `types.ts` 中的列表，`checker.ts` 不会同步更新
- 维护者需要同时更新两处，增加遗漏风险

**修复建议**：`checker.ts` 中移除局部定义，改为从 `types.ts` 导入：
```typescript
import { REQUIRED_PKG_FIELDS } from "./types.js";
```

### 6.2 `runOnly` 方法可简化

`HealthChecker.runOnly()` 方法委托 `diagnose()` 实现，逻辑正确但多一层包装。当前可接收，无功能性缺陷。

### 6.3 测试覆盖评估

| 维度 | 用例数 | 覆盖情况 |
|------|--------|---------|
| 基础功能 | 2 | ✅ 注册检查器、健康项目诊断 |
| package.json 检查 | 5 | ✅ 字段缺失/类型错误/合规通过 |
| positioning doc 检查 | 2 | ✅ 缺失告警/全存在通过 |
| test header 检查 | 4 | ✅ 缺少标注/合法标注/多种格式/无 tests |
| 工厂函数 | 1 | ✅ doctor() 一键诊断 |
| 检查器注册 | 2 | ✅ 新增/同名覆盖 |
| only/skip 过滤 | 3 | ✅ only/skip/runOnly |
| 边界条件 | 3 | ✅ 空目录/无 packages/非法 JSON |
| Finding 完整性 | 1 | ✅ 字段结构验证 |
| 健康状态逻辑 | 3 | ✅ error→unhealthy/warning→warning/空 only |
| **合计** | **26** | ✅ |

测试覆盖全面，包含正常路径、边界条件和异常场景。

### 6.4 依赖关系

```mermaid
graph LR
    A[@cortex/doctor]
    A --> B[@cortex/shared workspace:*]
    A --> C[@cortex/tools workspace:*]
    A --> D[node:fs]
    A --> E[node:path]
```

依赖合理，`@cortex/shared` 和 `@cortex/tools` 为 workspace 内部依赖，无第三方运行时依赖。

---

## 7. 合规检查清单汇总

| # | 检查项 | 标准/来源 | 结果 | 备注 |
|---|-------|-----------|------|------|
| 1 | 测试文件首行 `// @ci:` 标注 | 宪法 §十四·一 | ✅ | 唯一测试文件合规 |
| 2 | PACKAGE_POSITIONING.md 三问题 | 宪法 §五 | ✅ | Q1/Q2/Q3 完整 |
| 3 | package.json 基本字段 | 包规范 | ✅ | name/version/private/type/scripts 齐全 |
| 4 | tsconfig.json 存在 | 构建要求 | ✅ | 继承 tsconfig.base.json |
| 5 | 无空 catch 块 | checker.ts 模块规约第2条 | ❌ | 3 处违规 |
| 6 | 无 `var` 声明 | 模块规约第3条 | ✅ | |
| 7 | 无裸 console.error/warn | 模块规约第4条 | ✅ | |
| 8 | barrel 导出 | 架构约定 | ✅ | index.ts 汇聚 |
| 9 | 测试使用包名导入 | 模块化铁律第2条 | ✅ | |
| 10 | 无硬编码魔法数字 | 编码规范 | ⚠️ | 3 处建议提取常量 |
| 11 | REQUIRED_PKG_FIELDS 无重复 | DRY 原则 | ⚠️ | checker.ts 和 types.ts 各定义一次 |
| 12 | 类型使用 `import type` | TS 最佳实践 | ✅ | checker.ts 使用 |

---

## 8. 修复建议（按优先级排序）

| 优先级 | 问题 | 文件 | 修复内容 | 预估工时 |
|--------|------|------|---------|---------|
| 🔴 P0 | 空 catch 块 | `src/checker.ts` | 3 处 catch 块添加异常上下文记录 | 15 min |
| 🟡 P1 | 魔法数字 | `src/checker.ts` | 提取 `ERROR_PENALTY_POINTS`、`WARNING_PENALTY_POINTS`、`RUN_ID_RADIX`、`RUN_ID_PAD` 常量 | 10 min |
| 🟡 P1 | REQUIRED_PKG_FIELDS 重复 | `src/checker.ts` | 删除局部定义，改为从 `types.ts` 导入 | 5 min |
| 🟢 P2 | runOnly 文档增强 | `src/checker.ts` | 补充 `@example` 标签 | 5 min |

---

*审计结束。总计检查 12 项，✅ 通过 8 项，⚠️ 警告 2 项，❌ 违规 1 项（3 处实例）。建议在下次迭代中修复 P0 和 P1 级别问题后关闭本审计。*
