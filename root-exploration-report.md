# 根目录探索实验报告

> 炼金术士阿贝多 · 实验编号：2025-ROOT-01

## 一、包管理器

| 项目 | 值 |
|------|-----|
| packageManager | `pnpm@9.15.4` |
| 锁定文件 | `pnpm-lock.yaml` ✅ |
| workspace 配置 | `pnpm-workspace.yaml` → `packages/*` |
| .npmrc | 存在 |
| engine 要求 | `node >=20.0.0 <25.0.0`，`pnpm >=9.0.0` |

**结论：Monorepo 使用 pnpm workspace，工作区子包位于 `packages/*`。**

---

## 二、Scripts 检查

| 脚本名 | 存在 | 命令 |
|--------|------|------|
| `build` | ✅ | `pnpm -r build` |
| `test` | ✅ | `pnpm -r test` |
| `test:workspace` | ✅ | `vitest --workspace=vitest.workspace.ts` |
| `lint` | ✅ | `pnpm -r lint` |
| `typecheck` | ✅ | `pnpm -r typecheck` |
| `ci` | ✅ | `npx tsx scripts/ci-gate.ts` |
| `build:check` | ✅ | `pnpm build && pnpm test` |

**结论：build、test、lint 三项核心脚本全部存在，另有 typecheck、ci 等配套脚本。**

---

## 三、TypeScript 配置

### 根级别
- **tsconfig.json** — Project References 模式，引用 26 个子包的 tsconfig
- **tsconfig.base.json** — 所有子包的公共基础配置

### 基础配置关键项（tsconfig.base.json）

| 选项 | 值 |
|------|-----|
| target | ES2022 |
| module / moduleResolution | Node16 |
| strict | `true` |
| noUncheckedIndexedAccess | `true` |
| declaration / declarationMap | `true` |
| composite / incremental | `true` |
| outDir | `${configDir}/dist` |
| rootDir | `${configDir}/src` |

### 子包 tsconfig 引用列表（26 个）
packages/memory, config, shared, notification, parser, pattern-extractor, tools, llm, testing, engine (tsconfig.src.json), cli, telemetry, fsm-compiler (tsconfig.src.json), prompt-kit, doctor, tui, governance (tsconfig.src.json), scheduler, platform, memory-store, consistency (tsconfig.src.json), resilience, skill-kit, logging, context-manager, plugin-runner (tsconfig.src.json)

**结论：TypeScript 配置完整——strict 模式 + ES2022 + Project References 架构，26 个子包各自独立编译。**

---

## 四、ESLint 配置

### 配置文件
- **eslint.config.mjs** — ESLint v9 flat config 格式

### 技术栈
- `@eslint/js`（recommended ruleset）
- `typescript-eslint`（recommended ruleset + 自定义规则）
- 无 Prettier 依赖（格式化由 ESLint 统一管理）

### 核心规则（全部 error 级）

| 规则类别 | 具体规则 |
|----------|---------|
| 未使用变量 | `@typescript-eslint/no-unused-vars: error` |
| 禁止 any | `@typescript-eslint/no-explicit-any: error` |
| 禁止 require | `@typescript-eslint/no-require-imports: error` |
| 空 catch 禁止 | `no-empty: error, allowEmptyCatch: false` |
| 裸 throw 禁止 | `no-throw-literal: error` 配合 `only-throw-error` |
| const 优先 | `prefer-const: error` |
| var 禁止 | `no-var: error` |
| 非空断言禁止 | `@typescript-eslint/no-non-null-assertion: error` |
| 类型导入规范 | `consistent-type-imports: error` |
| 控制台限制 | `no-console: error`（仅 allow warn/error） |
| 函数参数上限 | `max-params: warn(3)` |
| 函数行数上限 | `max-lines-per-function: warn(30)` |
| 浮动 Promise | `no-floating-promises: error` |

### 豁免
- `packages/cli/src/**/*.ts` 和 `packages/fsm-compiler/src/cli/**/*.ts` 豁免 console 限制

**结论：ESLint 配置极其严格，与 "Cortex 代码法典" 的 §一~§六、§十 高度对齐，零容忍 any、非空断言、空 catch。**

---

## 五、整体评估

| 维度 | 状态 | 备注 |
|------|------|------|
| 包管理器 | ✅ pnpm@9.15.4 | monorepo workspace |
| build 脚本 | ✅ 存在 | `pnpm -r build` |
| test 脚本 | ✅ 存在 | `pnpm -r test` + vitest workspace |
| lint 脚本 | ✅ 存在 | `pnpm -r lint` |
| TypeScript 配置 | ✅ 完整 | strict + ES2022 + Project References |
| ESLint 配置 | ✅ 完整 | flat config + 严格规则集 |

**整体结论：项目工程基础设施完善，包管理、构建、测试、代码质量工具链一应俱全，且配置均与代码法典要求对齐。**
