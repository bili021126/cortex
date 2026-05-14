# Cortex 项目合规审计报告

> 审计人：刻晴（玉衡星 · Review Agent）
> 审计时间：2026-05-14
> 审计范围：目录结构 · TypeScript 规范 · 代码质量 · 配置文件 · 安全性 · 测试覆盖

---

## 目录

1. [目录结构合规](#1-目录结构合规)
2. [TypeScript 规范合规](#2-typescript-规范合规)
3. [代码质量审计](#3-代码质量审计)
4. [配置文件审计](#4-配置文件审计)
5. [安全性审计](#5-安全性审计)
6. [测试覆盖审计](#6-测试覆盖审计)
7. [综合评分与整改建议](#7-综合评分与整改建议)

---

## 1. 目录结构合规

### 1.1 整体布局

```
cortex/
├── .cortex/              # Cortex 运行时产物（含 SQLite DB 文件）
├── .github/workflows/    # CI 定义
├── doc-govern/           # 治理委员会会话记录
├── docs/                 # 设计文档、治理文档
├── packages/             # monorepo 子包
│   ├── engine/           # 引擎（调度、Agent、记忆系统）
│   ├── llm/              # LLM 适配层
│   ├── shared/           # 共享类型定义
│   └── testing/          # 测试工具包
├── projects/             # 独立实验项目
│   └── solo-flight/      # 单飞原型
├── scripts/              # CI 门禁脚本
├── webui/                # 存根目录（仅占位文件）
├── package.json          # 根 package.json
├── pnpm-workspace.yaml   # 工作区定义
├── tsconfig.base.json    # 基础 TypeScript 配置
└── eslint.config.mjs     # ESLint 扁平配置
```

### 1.2 合规判定

| 检查项 | 状态 | 说明 |
|--------|------|------|
| monorepo 标准布局 | ✅ | pnpm workspaces，packages/* 约定 |
| 各包职责单一 | ✅ | engine/shared/llm/testing 职责清晰 |
| 测试代码分离 | ✅ | tests/ 目录与 src/ 同级 |
| 构建产物分离 | ✅ | dist/ 在 .gitignore 中 |
| docs/ 存在 | ✅ | 包含设计文档和治理文档 |
| **问题：.cortex/ 包含 DB 文件** | ⚠️ | `.cortex/` 目录中有 `memory-*.db` SQLite 文件，虽是运行时产物且在 .gitignore 中，但工作目录中残留了测试数据库文件。应定期清理或移至 tmp/ |
| **问题：webui/ 为空壳目录** | ⚠️ | 仅含 `calculator.js`（占位符）、`test.html`、`test.txt`，无实质内容。建议移除或明确标记为 `@deprecated` |
| **问题：projects/solo-flight 独立 package.json** | ⚠️ | `projects/solo-flight` 有自己的 `package.json` 和 `package-lock.json`（非 `pnpm-lock.yaml`），与根 monorepo 的 pnpm 管理不一致。 |

**结论：目录结构整体合规，存在 3 项轻微违规。**

---

## 2. TypeScript 规范合规

### 2.1 配置链

```
tsconfig.base.json (严格模式, ES2022, Node16)
  ├── packages/shared/tsconfig.json   (extends base, references: 无)
  ├── packages/llm/tsconfig.json      (extends base, references: shared)
  ├── packages/testing/tsconfig.json  (extends base, references: shared)
  └── packages/engine/tsconfig.json   (extends base, references: shared, llm)
```

### 2.2 合规判定

| 检查项 | 状态 | 说明 |
|--------|------|------|
| strict: true | ✅ | 所有 tsconfig 均继承 base，开启 strict |
| target ES2022 | ✅ | 合理，Node.js 20+ 支持 |
| module Node16 | ✅ | 符合 Node.js ESM 规范 |
| 项目引用 (composite) | ✅ | engine/llm/testing 正确引用 shared |
| declaration + declarationMap | ✅ | 基础配置已启用 |
| sourceMap | ✅ | 调试支持 |
| **问题：projects/solo-flight/tsconfig.json 未继承 base** | ❌ | 使用独立配置 `target: ES2020, moduleResolution: node`，与主项目不一致。且包含 `**/*.ts`（含 node_modules 风险）——虽被 exclude 保护，但配置不规范。 |
| **问题：paths/aliases 未配置** | ⚠️ | 无 `paths` 映射，所有跨包引用使用 workspace 协议（`@cortex/shared` 等）通过 pnpm resolve，在 monorepo 中可接受但不是最优。 |

**结论：TypeScript 配置整体良好，solo-flight 子项目配置独立是主要违规点。**

---

## 3. 代码质量审计

### 3.1 整体评估

代码质量总体**优秀**。项目采用了契约式设计（Contract-Driven Development），每个模块都有清晰的边界契约、数据流文档和治理引用。

### 3.2 正向发现

| 实践 | 示例 |
|------|------|
| 契约文档 | `@contract` 标签标注模块边界、前置/后置条件 |
| 治理引用 | `@governance 久岐忍 P1-3` 等，可追溯治理判例 |
| 异常语义明确 | 每个方法注释中标注异常行为 |
| 错误隔离 | `SafeErrorReporter` + `PipelineObserver` 双通道 |
| 假阳性禁止原则 | 持久化失败必须传播错误，不得静默吞错 |
| 状态机 | Agent 状态机 (`PoolAwareState`) + 记忆四态状态机 (`MemoryLifecycle`) |
| 不变式检查 | `TaskBoard.onInvariant` + `AgentPool.onInvariant` 双通道上报 |

### 3.3 问题发现

| 严重度 | 问题 | 位置 | 证据 |
|--------|------|------|------|
| **中** | MemoryStore.read() 方法过长 | `packages/engine/src/memory-store.ts` | 单方法 170+ 行，包含候选获取、三级漏斗、通道融合、访问追踪、时间衰减、排序限量、FSA 归因等 7 个阶段，虽然逻辑内聚但可读性差。建议拆分为多个私有方法。 |
| **低** | 部分 fallback 路径使用 console.warn | `memory-store.ts:122`、`persistence.ts:205` | 在 observer 不可用时退化到 `console.warn`，已通过 `!process.env.VITEST` 控制，但生产环境仍可能产生 stdout 噪声。建议统一走 `SafeErrorReporter`。 |
| **低** | `strategist-agent.ts` / `meta-agent.ts` 未检查 | 根目录 | 这两个文件在 index.ts 中被导出但未在本次扫描中深度审查。标记为需后续审查。 |
| **低** | `cli-adapter.ts` 在 shared 和 engine 中均有定义 | `packages/shared/src/cli-adapter.ts` vs `packages/engine/src/cli-adapter.ts` | shared 层仅定义了 `PlatformBridge` 接口，engine 层有 `CLIAdapter` 实现。这符合设计（接口在 shared，实现在 engine），但命名容易混淆。 |
| **信息** | `_deserializeRow` 的 JSON 格式检查有误 | `packages/engine/src/memory/storage.ts:62` | 条件 `!contentStr.trimStart().startsWith('{') && !contentStr.trimStart().startsWith('[')` 用于判断非 JSON，但 `'123'`、`'true'`、`'"string"'` 等合法 JSON 原始值会被误判为 null。不过实际 content 字段始终是对象/数组，故无实际影响。 |

### 3.4 TypeScript 使用质量

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `any` 使用 | ✅ | 极少，ESLint 规则为 warn |
| 类型导出规范性 | ✅ | 使用 `export type` 分离运行时与类型 |
| 枚举使用 | ✅ | 使用 `enum` 而非 `const enum`（兼容性更好） |
| 泛型约束 | ✅ | `ObservableEvent<T>` 等合理使用 |
| **async/await 正确性** | ✅ | 无悬空 Promise（`void` 标记有意的 fire-and-forget） |
| **null vs undefined** | ⚠️ | 部分接口同时使用 `null` 和 `undefined`（如 `LlmResponse.content: string \| null` vs `embedding?: number[]`），建议统一风格。 |

**结论：代码质量优秀，MemoryStore.read() 方法的体量是最显著的改进点。**

---

## 4. 配置文件审计

### 4.1 根配置文件

| 文件 | 状态 | 说明 |
|------|------|------|
| `package.json` | ✅ | engines 限定 Node >=20 <25，包管理器 pnpm>=9 |
| `pnpm-workspace.yaml` | ✅ | packages/* 标准配置 |
| `tsconfig.base.json` | ✅ | 严格模式，ES2022，Node16 |
| `eslint.config.mjs` | ✅ | 扁平配置，推荐规则集 |
| `.gitignore` | ✅ | 覆盖 dist/node_modules/.env/IDE/.cortex 等 |
| `.env.example` | ✅ | 提供模板 |
| `.env` | ❌ **严重违规** | 包含真实 API 密钥，见 [5. 安全性审计](#5-安全性审计) |

### 4.2 ESLint 配置评价

```javascript
// eslint.config.mjs 关键规则
{
  "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
  "@typescript-eslint/no-explicit-any": "warn",
  "no-console": ["warn", { allow: ["log", "info", "debug", "trace", "dir", "time", "timeEnd"] }],
  "no-empty": ["error", { allowEmptyCatch: false }],
}
```

- `no-console` 允许 `console.error/warn` 被禁止（强制走 `PipelineObserver`）——符合设计
- `no-empty` 禁止空 catch ——良好实践
- 缺少 `@typescript-eslint/strict` 扩展——建议启用以捕获更多潜在问题

### 4.3 CI 配置评价

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `.github/workflows/ci.yml` | ✅ | 构建 → 类型检查 → 测试 → Lint |
| `scripts/ci-gate.ts` | ✅ | 本地与 CI 一致的统一门禁 |
| `@ci` 标签系统 | ✅ | 测试文件自声明身份，自动分类 |
| `vitest.ci.config.ts` (各包) | ✅ | CI 专用配置，env 与本地隔离 |

### 4.4 各包 vitest 配置一致性

| 包 | include | passWithNoTests | 备注 |
|---|---------|-----------------|------|
| engine | `tests/**/*.test.ts` | 未设置 | ✅ |
| shared | `tests/**/*.test.ts, src/**/*.test.ts` | 未设置 | src 中也有测试文件 |
| llm | `tests/**/*.test.ts` | **true** | 无测试文件，显式绕过 |
| testing | `tests/**/*.test.ts` | 未设置 | ✅ |

**结论：配置文件整体规范，.env 包含真实密钥是唯一严重违规。**

---

## 5. 安全性审计

### 5.1 机密泄露

| 严重度 | 问题 | 详情 |
|--------|------|------|
| **紧急** | `.env` 文件包含真实 API 密钥 | `DEEPSEEK_API_KEY=sk-1e1ffd5f19f3428d9d264c26ec0589a6`。虽然 `.gitignore` 排除了 `.env`，但文件存在于工作目录中。**任何文件系统级别的泄露（备份、容器镜像、CI 缓存）都可能导致密钥暴露。** |
| **低** | `DEEPSEEK_BASE_URL` 指向公有端点 | 非问题，但需确认 API 密钥权限范围。 |

**建议：**
1. 立即轮换该 API 密钥（从 DeepSeek 控制台撤销并重新生成）
2. 使用 `git filter-branch` 或 `git reset` 确保密钥从未被提交到 Git 历史
3. 考虑使用环境变量注入而非 `.env` 文件（如 CI Secrets、Docker Secrets）
4. 添加 pre-commit hook 检查 `sk-` 模式

### 5.2 其他安全关注

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `run_shell` 工具权限控制 | ✅ | 仅部分 Agent 类型持有，由 `AGENT_TOOL_PERMISSIONS` 集中管理 |
| SQL 注入防护 | ✅ | 使用参数化查询（`better-sqlite3` prepared statements） |
| 读锁/写锁机制 | ✅ | `FileLockManager` 实现文件级锁，含超时自动回收 |
| 依赖版本锁定 | ✅ | `pnpm-lock.yaml` 锁定传递依赖 |
| 无硬编码凭据（除 .env） | ✅ | 其余代码无明文密钥 |

**结论：.env 密钥泄露是紧急安全事件，需立即处理。其余安全措施到位。**

---

## 6. 测试覆盖审计

### 6.1 测试文件分布

| 包 | 测试文件数 | 覆盖范围 |
|----|-----------|----------|
| engine | 28 个 | 单元测试 + 集成测试，覆盖 Scheduler/TaskBoard/AgentPool/PipelineObserver/MemoryStore/MemoryLifecycle/各 Agent 类型 |
| shared | 2 个 | 类型和 SkillRegistry 的基本测试 |
| llm | 0 个 | 无测试（`passWithNoTests: true`） |
| testing | 0 个 | testing 包自身无测试（可理解） |

### 6.2 CI 标签合规

```
// @ci: unit       — 28 个测试（全部在 engine/tests/）
// @ci: llm        — 0 个
// @ci: integration — 0 个
// @ci: e2e        — 0 个
// @ci: manual     — 若干（scripts 引用）
```

所有 engine 测试文件均使用 `// @ci: unit` 标签，CI 门禁正确识别。

### 6.3 测试质量评价

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 使用 Vitest | ✅ | 现代测试框架，性能优秀 |
| Mock 策略 | ✅ | `LlmAdapter.injectMock` 支持 mock 注入 |
| 边界测试 | ✅ | NULL content、过期记忆、非法状态流转等 |
| 状态机测试 | ✅ | CAS、archive/freeze/obliterate 全路径 |
| 并发测试 | ⚠️ | 无显式并发/竞态测试。TaskBoard.claim 的"天然原子"注释依赖 Node.js 单线程特性，但未验证 Promise 交错场景 |
| MemoryStore 持久化测试 | ✅ | 含回滚测试（`memory-store-write-rollback.test.ts`） |
| **LlmAdapter 无单元测试** | ❌ | `@cortex/llm` 包零单元测试，虽有 `passWithNoTests` 绕过 |

**结论：engine 包测试覆盖良好，llm 包零测试是主要缺口。**

---

## 7. 综合评分与整改建议

### 7.1 评分矩阵

| 维度 | 评分 | 说明 |
|------|------|------|
| 目录结构 | ★★★★☆ | 整体规范，3 项轻微违规 |
| TypeScript 规范 | ★★★★☆ | 基础配置优秀，solo-flight 独立配置不一致 |
| 代码质量 | ★★★★★ | 契约式设计、错误隔离、状态机均属上乘 |
| 配置文件 | ★★★★☆ | ESLint/CI/基础配置优秀，.env 是硬伤 |
| 安全性 | ★★★☆☆ | 密钥泄露紧急事件拉低评分 |
| 测试覆盖 | ★★★★☆ | Engine 测试优秀，llm 包零测试 |
| **综合** | **★★★★☆** | **整体合规水平高，4 项改进建议优先处理** |

### 7.2 整改优先级

| 优先级 | 问题 | 影响面 | 建议 |
|--------|------|--------|------|
| **P0 紧急** | `.env` 包含真实 API 密钥 | 安全 | 立即轮换密钥，确认 Git 历史无泄露 |
| **P1 高** | `MemoryStore.read()` 方法过长 | 可维护性 | 拆分为 3-4 个私有方法（候选获取、漏斗执行、融合排序） |
| **P1 高** | `@cortex/llm` 无单元测试 | 质量风险 | 为 `LlmAdapter` 添加 chat/chatStream/retry/cache 的单元测试 |
| **P2 中** | `projects/solo-flight` 配置独立 | 一致性 | 迁移到继承 `tsconfig.base.json`，使用 pnpm 管理 |
| **P2 中** | `webui/` 空壳目录 | 整洁性 | 移除或增加 README 说明用途 |
| **P3 低** | `_deserializeRow` JSON 检测逻辑 | 健壮性 | 使用 `JSON.parse` 尝试解析替代字符串启发式判断 |
| **P3 低** | 部分 fallback 使用 `console.warn` | 运维 | 统一走 `SafeErrorReporter` 通道 |

### 7.3 合规总结

```
╔══════════════════════════════════════════╗
║  审计结论：有条件通过                      ║
║                                          ║
║  项目整体代码质量优秀，契约式设计实践深入，    ║
║  错误处理和边界覆盖到位。P0 安全问题和       ║
║  P1 可维护性问题修复后即可完全合规。         ║
╚══════════════════════════════════════════╝
```

---

*审计结束。每一行代码都是璃月的城墙——不容疏漏。*
