# 🗺️ 安柏侦察报告 — 工作区文件清单

> 侦察时间：工作区 `D:/cortex`  
> 任务来源：创建 Web 计算器页面（index.html，含 #expression / #calculateBtn / #result，支持 +-*/ 和错误处理）

---

## 一、任务产出核查：index.html

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 根目录 `index.html` | ❌ **未落盘** | 根目录下无此文件 |
| 全仓 `**/index.html` | ⚠️ 存在 1 个，但不相关 | `packages/tui/src/web/static/index.html` — 属于 TUI 包静态资源，非计算器页面 |
| `**/*.html` 共 5 个 | ⚠️ 均非计算器页面 | 均为 Cortex 控制台/审查报告页面 |

**结论：任务要求的 Web 计算器页面（index.html）未生成落盘。**

---

## 二、计算器相关现有文件

| 文件路径 | 类型 | 大小 | 说明 |
|----------|------|------|------|
| `src/calculator.ts` | TypeScript 类 | 1083 B / 44行 | Calculator 类实现：字符串表达式求值，支持 +-*/、括号、优先级、除以零→NaN、非法字符→throw Error |
| `dist/calculator.js` | 编译输出 JS | — | calculator.ts 的编译产物 |
| `dist/calculator.d.ts` | 类型声明 | — | calculator.ts 的类型声明文件 |
| `packages/engine/tests/manual/e2e/calculator-e2e.ts` | E2E 测试脚本 | — | 模拟 Code→Inspector→Review→Fix 全流程协作，目标目录为 `projects/calculator/` |
| **缺少** `test/calculator.test.ts` | 测试文件 | ❌ 不存在 | E2E 脚本 Task-2 要求写入，但 `D:/cortex/test/` 目录本身不存在 |

---

## 三、工作区完整文件清单

### 3.1 根目录文件

```
[F] .env                       — 环境变量配置
[F] .env.example               — 环境变量示例
[F] .gitignore                 — Git 忽略规则
[F] .gitmodules                — Git 子模块
[F] .npmrc                     — npm 配置
[F] cortex-agents.json         — Agent 运行时定义
[F] cortex-cli.mjs             — CLI 入口
[F] cortex-cognition.json      — 认知配置
[F] cortex-docs.json           — 文档配置
[F] eslint.config.mjs          — ESLint 配置
[F] package.json               — 项目根 package
[F] pnpm-lock.yaml             — pnpm 锁文件
[F] pnpm-workspace.yaml        — pnpm workspace 配置
[F] tsconfig.json              — TypeScript 配置
[F] tsconfig.base.json         — TS 基础配置
[F] vitest.workspace.ts        — Vitest 工作区配置
[F] vitest.workspace.js        — Vitest 工作区配置（JS）
[F] README.md                  — 项目说明
[F] USAGE.md                   — 使用说明
[F] DESIGN.md                  — 设计文档
[F] CORTEX-全景图.md            — 全景架构图
[F] 及其他审查/分析报告 *.md     — 各种审查文档
```

### 3.2 核心包目录 `packages/`

```
[D] packages/cli               — CLI 命令行
[D] packages/config            — 配置常量
[D] packages/consistency       — 一致性检查
[D] packages/context-manager   — 上下文管理
[D] packages/doctor            — 诊断工具
[D] packages/engine            — 引擎核心
[D] packages/fsm-compiler      — FSM 编译器
[D] packages/governance        — 治理
[D] packages/llm               — LLM 适配层
[D] packages/logging           — 日志
[D] packages/memory            — 记忆系统
[D] packages/memory-store      — 记忆存储
[D] packages/notification      — 通知
[D] packages/parser            — 解析器
[D] packages/pattern-extractor — 模式提取
[D] packages/platform          — 平台层
[D] packages/plugin-runner     — 插件运行器
[D] packages/prompt-kit        — 提示词工具
[D] packages/resilience        — 弹性/容错
[D] packages/scheduler         — 调度器
[D] packages/shared            — 共享类型/常量
[D] packages/skill-kit         — 技能工具包
[D] packages/telemetry         — 遥测
[D] packages/testing           — 测试工具
[D] packages/tools             — 工具集
[D] packages/tui               — TUI 界面（含 web 静态资源）
```

### 3.3 源码目录 `src/`

```
[F] src/calculator.ts          — Calculator 类（字符串表达式求值）
[F] src/correct.ts             — 修正工具
[F] src/handler.ts             — 处理器
[F] src/utils.ts               — 工具函数
[F] src/validator.ts           — 校验器
```

### 3.4 编译输出 `dist/`

```
[F] dist/calculator.js         — calculator.ts 编译产物
[F] dist/calculator.d.ts       — 类型声明
[F] dist/correct.js            — correct.ts 编译产物
[F] dist/handler.js            — handler.ts 编译产物
[F] dist/utils.js              — utils.ts 编译产物
[F] dist/validator.js          — validator.ts 编译产物
```

### 3.5 测试相关

```
[D] tests/                     — 测试目录（空/含子目录）
[D] test-output/               — 测试输出
  [D] test-output/webui-demo/  — WebUI Demo 测试（含 dashboard.html）
[D] packages/engine/tests/manual/e2e/ — E2E 测试脚本（19 个文件）
```

### 3.6 其他关键目录

```
[D] .cortex/                   — Cortex 运行时数据（记忆库、配置、日志等）
[D] .agents/skills/            — Agent 技能
[D] docs/                      — 文档（宪法、分析、审查等）
[D] prompts/                   — 提示词模板
[D] scripts/                   — 构建脚本
[D] skills/                    — 技能模块
[D] tools/                     — 工具
[D] _extraneous/               — 杂项（含 dashboard.html）
```

---

## 四、编译/测试失败报告

### tsc --noEmit 编译失败 ❌

```
tsconfig.json(10,5): error TS6053: File 'D:/cortex/projects/pm-legacy' not found.
```

**原因**：`tsconfig.json` 第 10 行引用了 `projects/pm-legacy` 目录，但该目录不存在。`projects/` 目录本身也不存在（未创建）。

### vitest 测试失败 ❌

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\cortex\test\calculator.test.ts'
```

**原因**：测试框架尝试运行 `calculator.test.ts`，但 `D:/cortex/test/` 目录不存在。

---

## 五、侦察结论

1. **任务产出缺失**：Web 计算器 HTML 页面（index.html，含 #expression / #calculateBtn / #result）**未落盘**。全仓搜索不到符合条件的 index.html。
2. **部分成果存在**：`src/calculator.ts` 实现了 Calculator 类的核心逻辑（字符串表达式求值），但缺少配套的 HTML 页面和测试文件。
3. **`calculator.test.ts` 未创建**：测试目录 `D:/cortex/test/` 本身不存在，测试文件也未生成。
4. **`projects/calculator/` 项目目录不存在**：E2E 脚本 `calculator-e2e.ts` 目标目录未被创建。
5. **tsconfig.json 引用了不存在的路径**：`projects/pm-legacy` 指向不存在的目录。

> 侦察员签名：安柏 · 西风骑士团侦察骑士
