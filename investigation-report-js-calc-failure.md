# 侦察报告：JavaScript 计算逻辑添加失败原因调查

**侦察员**：安柏 · 西风骑士团侦察骑士（Inspector Agent）
**任务**：调查"JavaScript计算逻辑添加失败"的原因
**依据**：上下文记忆（13条）+ 现场文件勘察 + 编译/测试失败事实

---

## 勘察发现（共 4 项）

---

### 发现 1：`projects/` 目录完全不存在 → 编译永远失败

**证据**：
- `tsconfig.json` 第 10 行引用 `{ "path": "projects/pm-legacy" }`
- `D:/cortex/projects/` 目录不存在（`list_files` 返回"目录不存在"）

**文件位置**：`D:/cortex/tsconfig.json` → 第 10 行

**事实**：
```
tsconfig.json
  references: [
    { "path": "packages/memory" },           // ✅ 存在
    { "path": "packages/config" },           // ✅ 存在
    ...
    { "path": "projects/pm-legacy" },        // ❌ 不存在
    ...
  ]
```

**影响**：任何 `tsc --noEmit` 都会报 `TS6053: File 'D:/cortex/projects/pm-legacy' not found.`。这不是计算器代码的问题——是整个 monorepo 的 `tsconfig.json` 引用了已不存在的项目路径。无论计算器代码写得对还是错，编译验证这一步永远通不过。

**证据来源**：
- 系统自动采集编译事实 stderr：`tsconfig.json(10,5): error TS6053: File 'D:/cortex/projects/pm-legacy' not found.`
- `list_files D:/cortex/projects` → `ERROR: 目录不存在`

---

### 发现 2：`src/calculator.ts` 存在，但测试文件 `calculator.test.ts` 不存在

**证据**：
- `glob_find` 搜索 `**/*calculator*` 找到 3 个文件：
  - `D:/cortex/src/calculator.ts` ✅ — Calculator 类实现（114 行）
  - `D:/cortex/amber-diagnosis-calculator-crash.md` — 之前的诊断报告
  - `D:/cortex/packages/engine/tests/manual/e2e/calculator-e2e.ts` — E2E 测试脚本
- `glob_find` 搜索 `**/*.test.ts` 全仓未发现 `calculator.test.ts`

**事实**：
- `src/calculator.ts` 已实现（114 行，包含 `calculate(expr)` 方法，支持 +-\*/(), 除以零→NaN，非法字符→throw Error）
- **没有任何测试文件**存在来验证这个 Calculator 类

**影响**：上下文记忆显示有"添加JavaScript计算逻辑"的任务节点（task-1783113553972-4-1），以及后续的"诊断"节点（task-1783113568039-5-0）。`src/calculator.ts` 的存在说明代码实现已经完成，但测试从未被创建。

**证据来源**：
- `read_file D:/cortex/src/calculator.ts` → Calculator 类完整实现
- `glob_find **/*calculator*` → 无测试文件

---

### 发现 3：测试运行路径不匹配 — 根目录找 `test/calculator.test.ts`

**证据**（系统编译事实 tsx stderr）：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\cortex\test\calculator.test.ts'
```

**事实**：
- 测试运行器从 `D:\cortex\` 根目录执行，试图加载 `test/calculator.test.ts`
- 但根目录下没有 `test/` 目录（根目录下只有 `tests/`，且其下只有 `.test-data` 和 `skills` 子目录）
- `calculator-e2e.ts` 期望文件在 `projects/calculator/test/calculator.test.ts`，但 `projects/` 目录本身就不存在

**影响**：无论用哪种路径约定，测试文件都不在预期位置。

**证据来源**：
- 系统编译事实 tsx stderr
- `list_files D:/cortex/test` → 目录不存在
- `list_files D:/cortex/tests` → 无 calculator 相关文件

---

### 发现 4：`src/calculator.ts` 位置与 E2E 脚本预期不一致

**证据**（`calculator-e2e.ts` 第 74-80 行）：
```typescript
const CALC_DIR = path.resolve(WORKSPACE, "projects", "calculator");
const SRC_DIR = path.join(CALC_DIR, "src");
const TEST_DIR = path.join(CALC_DIR, "test");
```

**事实**：
- E2E 脚本期望文件在 `projects/calculator/src/calculator.ts`
- 实际文件在 `src/calculator.ts`（根目录 src/ 下）
- 两处路径不一致

**影响**：阿贝多（Code Agent）将代码写到了根目录 `src/calculator.ts`，而非 E2E 脚本限定的 `projects/calculator/src/calculator.ts`。后续 Inspector（安柏）和 Reviewer（刻晴）在受限的 `projects/calculator/` 范围内工作，看不到根目录 `src/` 下的文件。

**证据来源**：
- `calculator-e2e.ts` 第 74-80 行
- `read_file D:/cortex/src/calculator.ts` → 文件存在
- `glob_find projects/calculator/src/calculator.ts` → 文件不存在

---

## 总结

| # | 问题 | 严重度 | 是否计算器代码本身的问题 |
|---|------|--------|------------------------|
| 1 | `tsconfig.json` 引用不存在的 `projects/pm-legacy` | **阻断** — 编译验证永远失败 | ❌ 不是 — tsconfig.json 配置错误 |
| 2 | `calculator.test.ts` 不存在 | **阻断** — 无测试可运行 | ✅ 是 — 测试未创建 |
| 3 | 测试运行路径 `test/calculator.test.ts` 不存在 | **阻断** — 模块找不到 | ⚠️ 部分是 — 文件位置与预期不一致 |
| 4 | `calculator.ts` 位置在 `src/` 而非 `projects/calculator/src/` | **中等** — 路径不匹配 | ✅ 是 — 代码写到了错误的位置 |

### 核心根因

**JavaScript 计算逻辑添加失败的直接原因**：
1. **编译阻断**：`tsconfig.json` 引用了已不存在的 `projects/pm-legacy` 路径，任何 `tsc --noEmit` 都报错退出。这是基础设施配置问题，不是计算器代码的问题。
2. **测试文件缺失**：`calculator.test.ts` 从未被创建到磁盘上。
3. **路径错位**：`calculator.ts` 被写到了根目录 `src/` 下，而不是 E2E 脚本限定的 `projects/calculator/src/`，导致后续工作流无法正确定位文件。

---

*侦察完毕。以上全部基于工具调用返回的可追溯证据。每一条发现均可追溯到具体的文件路径和行号。*
