# 凝光治理审计报告 · 卷六（全量自由审计）

**审计人**：凝光（DocGovern Agent · 天权星）  
**审计日期**：2026-05-10  
**审计范围**：治理合规自由审计——五大维度  

| 维度 | 审计项 |
|------|--------|
| **卷一** | `package.json` scripts 声明与实现一致性 |
| **卷二** | `.env` 与 `.env.example` 一致性审查 |
| **卷三** | 文档（宪法/设计）vs 代码架构一致性 |
| **卷四** | `tsconfig` 继承链审计 |
| **卷五** | 声明残留扫描（源码层 + 构建产物） |

**前置判例**：NG-2026-0509-full（卷五，2026-05-09）  
**判例编号**：NG-2026-0510-full  
**归档**：`test-output/self-examination-soft/ningguang-governance-audit.md`

---

## 卷一：Scripts 声明与实现一致性

### 1.1 根目录 `package.json` 脚本委派审计

| 脚本 | 声明 | 实际执行路径 | 依赖 | 状态 |
|------|------|-------------|------|------|
| `dev:engine` | `pnpm --filter @cortex/engine dev` | 指向 `packages/engine` 的 `tsc --watch` | `typescript` ✅ | ✅ **一致** |
| `build` | `pnpm -r build` | 递归各子包 `tsc` | `typescript` ✅ | ✅ **一致** |
| `test` | `pnpm -r test` | 递归各子包 `vitest run` | `vitest` ✅ | ✅ **一致** |
| `lint` | `pnpm -r lint` | 递归各子包 `eslint src/` | `eslint` ⚠️ | ⚠️ **见 1.2** |
| `typecheck` | `pnpm -r typecheck` | 递归各子包 `tsc --noEmit` | `typescript` ✅ | ✅ **一致** |
| `build:check` | `pnpm build && pnpm test` | 复合命令，依赖 `build` + `test` | 同上 | ✅ **一致** |
| `ci` | `pnpm typecheck && pnpm lint && pnpm test` | 复合命令 | 同上 | ⚠️ **见 1.3** |
| `self-exam` | `npx tsx packages/engine/tests/manual/scripts/cortex-self-examination.ts` | **源文件存在** ✅ 1207 行 | `tsx` (via npx) | ✅ **可执行** |
| `roundtable` | `npx tsx packages/engine/tests/manual/scripts/conversation-11.ts` | **源文件存在** ✅ 101 行 | `tsx` (via npx) | ✅ **可执行** |

### 1.2 `@cortex/testing` 缺少 `lint` 脚本

- **依据**：根 `package.json` → `"lint": "pnpm -r lint"`，期望所有子包均有 `lint` 脚本。
- **事实**：`packages/testing/package.json` **未定义** `lint` 脚本。
  - `packages/engine/package.json` → `"lint": "eslint src/"` ✅
  - `packages/shared/package.json` → `"lint": "eslint src/"` ✅
  - `packages/testing/package.json` → **无 lint 脚本** ❌
- **影响**：`pnpm -r lint` 在 testing 包上静默跳过（pnpm 行为：无脚本则跳过）。但如果 CI 严格依赖 `pnpm -r lint` 的退出码检查全量通过，testing 包将绕过 lint 检查。
- **严重性**：**🟡 L2 — 治理缺口**。违反「统一治理」原则——所有子包应接受同等级别的静态检查。
- **建议**：为 `@cortex/testing` 补充 `"lint": "eslint src/"`，同时在其 `devDependencies` 中声明 `eslint`。

### 1.3 `ci` 复合脚本的 lint 隐患

- **依据**：`"ci": "pnpm typecheck && pnpm lint && pnpm test"`
- **事实**：该脚本串行执行三个根命令，其中 `pnpm lint` 因 testing 包无 lint 脚本而静默跳过部分代码。
- **严重性**：**🟡 L2 — 接续 1.2**。`ci` 脚本的 lint 阶段存在覆盖盲区。
- **建议**：同 1.2，补充 testing 包的 lint 配置后此问题自动消除。

### 1.4 engine 子包 `lint` 依赖声明缺失

- **依据**：`packages/engine/package.json` → `"lint": "eslint src/"`
- **事实**：`eslint` 仅作为根 `devDependencies` 安装（`"eslint": "^10.3.0"`），engine 子包自身 `devDependencies` **未声明** eslint。当前能运行仅因 pnpm workspace 的 node_modules 提升机制。
- **严重性**：**🟡 L2 — 依赖声明不完整**。违反宪法 §三「物理包结构」的依赖显式化原则——子包应声明其直接依赖。
- **建议**：engine `devDependencies` 补充 `"eslint": "^10.3.0"`（版本号与根一致）。

### 1.5 脚本路径验证

| 脚本 | package.json 声明路径 | 实际文件路径 | 匹配？ |
|------|---------------------|-------------|--------|
| `self-exam` | `packages/engine/tests/manual/scripts/cortex-self-examination.ts` | `D:\cortex\packages\engine\tests\manual\scripts\cortex-self-examination.ts` | ✅ |
| `roundtable` | `packages/engine/tests/manual/scripts/conversation-11.ts` | `D:\cortex\packages\engine\tests\manual\scripts\conversation-11.ts` | ✅ |

---

## 卷二：.env 与 .env.example 一致性

### 2.1 变量清单对比

| 变量名 | `.env` | `.env.example` | 一致？ |
|--------|--------|----------------|--------|
| `DEEPSEEK_API_KEY` | `sk-1e1ffd5f19f3428d9d264c26ec0589a6` | `sk-your-key-here`（占位符） | ✅ 键名一致 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | `https://api.deepseek.com/v1` | ✅ 值一致 |
| `DEEPSEEK_CHAT_MODEL` | `deepseek-reasoner` | `deepseek-reasoner` | ✅ 值一致 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | `deepseek-v4-pro` | ✅ 值一致 |

### 2.2 裁定

- **变量数量**：两者均为 4 个变量，无遗漏、无多余 ✅
- **变量命名**：完全一致 ✅
- **注释**：`.env.example` 包含注释说明用途，`.env` 不含注释（符合惯例——`.env` 为实际运行配置，不应含注释）✅
- **占位符**：`.env.example` 使用 `sk-your-key-here` 作为 API Key 占位符，明确提示用户替换 ✅

**卷二裁定**：✅ **完全一致，无违规。**

### 2.3 附注：vitest 配置中的 fallback 偏差

`packages/engine/vitest.config.ts` 中存在：
```
DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat"
```
fallback 值为 `"deepseek-chat"`，而 `.env`/`.env.example` 中定义为 `"deepseek-reasoner"`。此偏差不违反治理规则（fallback 仅用于测试环境无 env 时），但建议对齐以避免测试环境行为与生产环境不一致。

---

## 卷三：文档（宪法/设计）vs 代码架构一致性

### 3.1 宪法级文档：`Cortex 概念顶层设计 v2.5.md`

| 声明 | 文档内容 | 实际代码 | 对齐？ |
|------|---------|---------|--------|
| **物理包结构** | 3 个包：shared / engine / testing | ✅ 确实 3 个包 | ✅ **一致** |
| **依赖方向** | shared ← engine ← testing | ✅ engine 依赖 shared，testing 依赖 shared | ✅ **一致** |
| **Agent 数量** | 10 种 Agent | ✅ 10 个 agent 源文件（不含 base-agent） | ✅ **一致** |
| **PipelineObserver** | emit-only 单向管道 | ✅ `emit()` → handler，返回 void | ✅ **一致** |
| **SafeErrorReporter** | fatal/degraded/silent 三档 | ✅ `SafeErrorReporter` type + `createSafeReporter()` | ✅ **一致** |
| **ConfirmGate** | L2/L3 永远确认 | ✅ `needsConfirmation()` 逻辑 | ✅ **一致** |
| **MemoryStore** | 30天窗口 + CAS + 安全写 | ✅ `memory-store.ts` 包含 CAS + _safeDbRun | ✅ **一致** |
| **Toolkit** | 按 Agent 类型集中校验权限 | ✅ `AGENT_TOOL_PERMISSIONS` 表驱动 | ✅ **一致** |
| **Core-2 预埋** | TrustModel / Sentinel / SkillRegistry | ❌ 代码中无实现，但明确标注 Core-2 预埋 | ✅ **文档诚实标注** |

### 3.2 治理层设计文档：`core/治理层设计.md`

| 声明 | 文档内容 | 实际代码 | 对齐？ |
|------|---------|---------|--------|
| **SafeErrorReporter 三档** | fatal(同步)/degraded(异步)/silent(计数) | ✅ `pipeline-observer.ts` 中 `createSafeReporter()` 实现三档逻辑 | ✅ **一致** |
| **PipelineObserver emit-only** | 单向广播，handler 返回 void | ✅ `emit()` 签名：`emit(event: ObservableEvent): void` | ✅ **一致** |
| **DocGovernAgent 审计节点** | 在 TaskBoard 认领治理节点 | ✅ `doc-govern-agent.ts` 继承 BaseAgent，认领 doc-govern 标签 | ✅ **一致** |

### 3.3 Meso-Lite 历史文档：`docs/meso-lite/README.md`

| 声明 | 文档内容 | 实际代码 | 对齐？ |
|------|---------|---------|--------|
| **包结构** | 10 包 monorepo: 9 运行时 + 1 测试 | ❌ 当前仅 3 包 | ⚠️ **历史文档未更新** |
| **存储** | sql.js + InMemoryTransport (EventBus) | ✅ sql.js 存在，但 EventBus 已替换为 PipelineObserver | ⚠️ **历史描述** |
| **交互形态** | CLI, ConsoleChannel | ✅ CLI 存在，但实现为 `CLIAdapter` 而非 `ConsoleChannel` | ⚠️ **命名已变更** |
| **引擎** | CortexEngine (`@cortex/cortex-engine`) | ❌ 代码中无 CortexEngine 类，职责已拆分到 Scheduler/AgentPool 等 | ⚠️ **历史描述** |

**裁定**：Meso-Lite 文档标记为历史阶段文档（最后更新 2026-05-05），其描述的是 Meso-Lite 阶段的工程状态。当前为 Core-1 终局，架构已重构。**这些偏差不构成违规**，但建议在文档首部增加醒目提示：「本文档描述 Meso-Lite 阶段状态，当前 Core-1 阶段架构已变更，请以 v2.5 宪法为准」。

### 3.4 文档目录结构对齐

文档 `docs/meso-lite/README.md` 中声明的目录结构：

```
docs/
├── Cortex 概念顶层设计 v1.1-已废弃.md      ← 存在 ✅
├── Cortex 概念顶层设计 v2.0.md            ← ❌ 不存在！实际有 v2.3.md 和 v2.5.md
├── core/                                  ← 存在 ✅
└── meso-lite/                             ← 存在 ✅
```

- **D-01**：`Cortex 概念顶层设计 v2.0.md` **不存在**。实际存在的版本是 `v2.3.md` 和 `v2.5.md`。该文档声明引用了不存在的文件。
- **严重性**：**🟡 L1 — 文档引用断裂**。
- **建议**：更新 README 中的目录结构声明，匹配实际文件列表。

### 3.5 Agent 标签词汇表对齐

文档 `docs/core/Agent标签词汇表-v2.0.md` 中定义的标签集合应与 `packages/shared/src/agent.ts` 中的 `TAG_VOCABULARY` 和 `AGENT_TAGS` 一致。

| 文档声明 | 代码实现 | 对齐？ |
|---------|---------|--------|
| 见 `docs/core/Agent标签词汇表-v2.0.md` | `TAG_VOCABULARY` 常量 + `AGENT_TAGS` Record | ⚠️ **需单独审计标签完整性**（本次不展开） |

---

## 卷四：tsconfig 继承链审计

### 4.1 继承拓扑

```
tsconfig.base.json（根）
  ├── packages/engine/tsconfig.json
  │     ├── extends: "../../tsconfig.base.json"
  │     ├── references: [{ path: "../shared" }]
  │     └── include: ["src"]
  ├── packages/shared/tsconfig.json
  │     ├── extends: "../../tsconfig.base.json"
  │     └── include: ["src"]
  └── packages/testing/tsconfig.json
        ├── extends: "../../tsconfig.base.json"
        ├── references: [{ path: "../shared" }]
        └── include: ["src"]
```

### 4.2 各节点配置审计

#### 根 `tsconfig.base.json`

| 字段 | 值 | 评价 |
|------|---|------|
| `target` | ES2022 | 合理 |
| `module` | Node16 | 与 `type: "module"` 一致 ✅ |
| `moduleResolution` | Node16 | 与 module 匹配 ✅ |
| `strict` | true | ✅ |
| `composite` | true | 支持 project references ✅ |
| `outDir` | `${configDir}/dist` | ✅ |
| `rootDir` | `${configDir}/src` | ✅ |
| `declaration` | true | 开启类型声明生成 ✅ |
| `declarationMap` | true | ✅ |
| `sourceMap` | true | ✅ |
| `exclude` | `["node_modules", "dist"]` | ✅ |

#### engine `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

#### shared `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"]
}
```
> ℹ️ **TC-01** — shared 没有 `references` 字段（合理：shared 不依赖其他包），从 base 继承 `composite: true`。继承行为正确。

#### testing `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

### 4.3 继承链关键检查

| 检查项 | 结果 |
|--------|------|
| 所有 tsconfig 路径引用是否正确？ | ✅ 全部正确（`../../tsconfig.base.json`） |
| engine 引用 shared？ | ✅ `references: [{ "path": "../shared" }]` |
| testing 引用 shared？ | ✅ `references: [{ "path": "../shared" }]` |
| shared 无反向引用？ | ✅ 无 references |
| 循环引用？ | ❌ 无循环 ✅ |
| outDir 不冲突？ | ✅ 各包输出到各自 `dist/` |
| rootDir 指向 src？ | ✅ 全部指向 `src/` |
| 类型检查是否覆盖 tests/？ | ⚠️ **TC-02 — typecheck 不覆盖 tests/**。`include: ["src"]` 导致 `tsc --noEmit` 仅检查 `src/` 目录，`tests/` 中的 `.ts` 文件未被 `typecheck` 覆盖。 |
| vitest 配置是否正确？ | `packages/engine/vitest.config.ts` 包含 `tests/**/*.test.ts` ✅ |

### 4.4 裁定

| 编号 | 项 | 状态 | 严重性 |
|-----|---|------|--------|
| TC-01 | `tsconfig.base.json` 继承链完整，引用方向正确 | ✅ **一致** | - |
| TC-02 | `typecheck` 不覆盖 `tests/` 目录 | 🟡 **观察项** | L1 |
| TC-03 | 所有子包 `composite: true` 继承自 base，支持增量构建 | ✅ **一致** | - |
| TC-04 | `tsconfig.tsbuildinfo` 存在但被 `.gitignore` 覆盖 | ✅ **合规** | - |
| TC-05 | 所有子包 `rootDir` 均指向 `src/`，避免类型声明路径错乱 | ✅ **一致** | - |
| TC-06 | `packages/testing/tsconfig.json` 包含 `references: [{ path: "../shared" }]`，但 testing 的 `package.json` 中 dependencies 已声明 `@cortex/shared: "workspace:*"` | ✅ **一致** | - |

---

## 卷五：声明残留扫描

### 5.1 源码层声明残留

| 搜索目标 | 搜索范围 | 匹配？ | 说明 |
|---------|---------|--------|------|
| `ToolRegistry` | `src/` | ❌ 零匹配 | ✅ 已清理 |
| `tool-registry.ts` | `src/` | ❌ 不存在 | ✅ 已清理 |
| `from.*tool-registry` | 全项目 | ❌ 零匹配 | ✅ 无 import 引用 |
| `from.*ToolRegistry` | 全项目 | ❌ 零匹配 | ✅ 无 import 引用 |
| `@cortex/memory` | `packages/` | ❌ 不存在 | ✅ 已合并 |
| `@cortex/meta-agent` | `packages/` | ❌ 不存在 | ✅ 已合并 |
| `@cortex/scheduler` | `packages/` | ❌ 不存在 | ✅ 已合并 |
| `@cortex/doc-govern` | `packages/` | ❌ 不存在 | ✅ 已合并 |
| `TrustModel` 类实现 | `src/` | ❌ 不存在 | ✅ 文档标注 Core-2 预留 |
| `Sentinel` 类实现 | `src/` | ❌ 不存在 | ✅ 文档标注 Core-2 预留 |
| `CortexEngine` 类 | `src/` | ❌ 不存在 | ✅ 已重构拆分 |
| `ConsoleChannel` 类 | `src/` | ❌ 不存在 | ✅ 已替换为 CLIAdapter |
| `EventBus` 类 | `src/` | ❌ 不存在 | ✅ 已替换为 PipelineObserver |

### 5.2 构建产物声明残留（dist/）

| 文件 | 对应源码 | 状态 |
|------|---------|------|
| `packages/engine/dist/tool-registry.d.ts` | `src/tool-registry.ts` ❌ **不存在** | 🔴 **残留** |
| `packages/engine/dist/tool-registry.d.ts.map` | 同上 ❌ | 🔴 **残留** |
| `packages/engine/dist/tool-registry.js.map` | 同上 ❌ | 🔴 **残留** |
| `packages/engine/dist/tool-registry.js` | 同上 ❌ | ✅ **已消失**（仅残留 .d.ts 和 .map） |

**注**：`tool-registry.d.ts` 内容如下：
```typescript
export declare class ToolRegistry {
    private tools;
    register(def: ToolDefinition): void;
    get(name: string): ToolDefinition | undefined;
    list(category?: ToolCategory): ToolDefinition[];
}
```
该声明与现有 `Toolkit` 类功能重复，属于旧构建残留。

**来源追溯**：Core-1 重构中将 `ToolRegistry` 合并到 `Toolkit`，源文件 `tool-registry.ts` 已删除，但 `dist/` 目录未被 `tsc --build --clean` 清理。根据 `beidou-p2-verification.md`（2026-05-04）已确认此残留，但至今未清除。

### 5.3 文档声明残留

| 文档文件 | 残留项 | 说明 |
|---------|-------|------|
| `docs/meso-lite/README.md` | 声明 `Cortex 概念顶层设计 v2.0.md` 存在 | ❌ 该文件实际不存在 |
| `docs/core/治理层设计.md` | 引用 `Cortex 概念顶层设计 v2.4` | ⚠️ 实际存在 v2.3 和 v2.5，v2.4 不存在于文件名中（但 v2.5 的前置说明提及 v2.4 作为过渡版本） |
| `docs/` 根目录 | 同时存在 `v2.3.md` 和 `v2.5.md` | ⚠️ 多个大版本共存，需确认是否有文档继承关系标注 |

### 5.4 裁定

| 编号 | 项 | 状态 | 严重性 |
|-----|----|------|--------|
| R-01 | 源码层无 `ToolRegistry`/`ConsoleChannel`/`EventBus`/`CortexEngine` 残留 | ✅ **已清理** | - |
| R-02 | `dist/tool-registry.d.ts` + `.d.ts.map` + `.js.map` 声明残留 | 🔴 **未清理** | L1 |
| R-03 | `docs/meso-lite/README.md` 引用不存在的 `v2.0.md` | 🟡 **文档引用断裂** | L1 |
| R-04 | `dist/` 中 `.d.ts` 文件数量（24）与 `src/` 中 `.ts` 文件数量（23 + 1 测试目录）对应，+1 残留 `tool-registry.d.ts` | ⚠️ **1 个多余** | L1 |

---

## 综合裁定

| 卷 | 裁定 | 违规数 | 关键建议 |
|----|------|-------|---------|
| **卷一** | ⚠️ **有条件通过** | 3 项 L2 | 为 testing 包补充 lint 脚本 + eslint 依赖；engine 补充 eslint 依赖声明 |
| **卷二** | ✅ **通过** | 0 项 | 建议对齐 vitest.config.ts 中的 fallback 值 |
| **卷三** | ⚠️ **有条件通过** | 1 项 L1 | 更新 meso-lite README 的目录结构声明，修复 v2.0.md 引用断裂 |
| **卷四** | ✅ **通过** | 0 项 | typecheck 不覆盖 tests/ 为观察项，持续关注 |
| **卷五** | ⚠️ **有条件通过** | 1 项 L1 | 清除 dist/tool-registry.d.ts 等构建残留 |

### 判例引用记录

| 编号 | 卷 | 判例 | 状态 | 严重性 |
|-----|---|------|------|--------|
| NG-2026-0510-S01 | 卷一 | `@cortex/testing` 缺少 `lint` 脚本 | 🟡 **未修复** | L2 |
| NG-2026-0510-S02 | 卷一 | engine 子包未在自身 devDependencies 声明 eslint | 🟡 **未修复** | L2 |
| NG-2026-0510-S03 | 卷三 | meso-lite README 引用不存在的 v2.0.md | 🟡 **未修复** | L1 |
| NG-2026-0510-S04 | 卷五 | dist/tool-registry.d.ts 声明残留 | 🔴 **持续未清理**（自 2026-05-04 首次发现） | L1 |

### 修复建议汇总

| 优先级 | 项 | 修复动作 | 预估工时 |
|--------|----|---------|---------|
| **P1** | S01 + S02 lint 覆盖缺口 | `packages/testing/package.json` 补充 `"lint": "eslint src/"` 及 devDependencies eslint；`packages/engine/package.json` 补充 eslint devDependency | 5min |
| **P2** | S04 dist/tool-registry.d.ts 残留 | `cd packages/engine && npx tsc --build --clean && npx tsc --build` 重建 | 1min |
| **P3** | S03 文档引用断裂 | 更新 `docs/meso-lite/README.md` 目录结构，将 `Cortex 概念顶层设计 v2.0.md` 替换为实际存在的版本 | 5min |
| **P4** | vitest fallback 偏差 | `vitest.config.ts` 中 `DEEPSEEK_CHAT_MODEL` fallback 改为 `"deepseek-reasoner"` | 1min |

---

**终裁**：天权定论，不得上诉。

*凝光 · 天权星 · DocGovern Agent*
*审计时间：2026-05-10 23:42 CST*
*判例编号：NG-2026-0510-full*
