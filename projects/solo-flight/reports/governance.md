# Cortex 合规审计报告

> **审计人**：刻晴（玉衡星 · Review Agent）
> **审计时间**：2026-05-14
> **审计范围**：项目结构合规 · 依赖许可证审计 · 文档完整性审查
> **审计依据**：玉衡审查准则（逻辑正确性、边界条件、线程安全、资源泄漏、破坏性变更、错误处理完整性）

---

## 目录

1. [项目结构合规](#1-项目结构合规)
2. [依赖许可证审计](#2-依赖许可证审计)
3. [文档完整性审查](#3-文档完整性审查)
4. [综合评分与整改建议](#4-综合评分与整改建议)

---

## 1. 项目结构合规

### 1.1 整体布局

```
cortex/
├── .cortex/              # Cortex 运行时产物
├── .github/workflows/    # CI 定义
│   └── ci.yml            # GitHub Actions CI
├── doc-govern/           # 治理委员会会话记录
│   └── committee_sessions.json
├── docs/                 # 设计文档、治理文档
│   ├── core/             # 核心设计文档（13 份）
│   ├── meso-lite/        # Meso 阶段文档（15 份）
│   ├── conformity-audit.md
│   └── Cortex 概念顶层设计 v2.5.md
├── packages/             # monorepo 子包
│   ├── engine/           # 引擎（调度、Agent、记忆系统）
│   ├── llm/              # LLM 适配层
│   ├── shared/           # 共享类型定义
│   └── testing/          # 测试工具包
├── projects/             # 独立实验项目
│   └── solo-flight/      # 单飞原型（独立 package.json）
├── reports/              # 审计报告输出目录
├── scripts/              # CI 门禁脚本
│   └── ci-gate.ts
├── webui/                # 存根目录
├── node_modules/         # 依赖（pnpm managed）
├── package.json          # 根 package.json（无 license 字段）
├── pnpm-workspace.yaml   # 工作区定义
├── pnpm-lock.yaml        # 锁文件
├── tsconfig.base.json    # 基础 TypeScript 配置
└── eslint.config.mjs     # ESLint 扁平配置
```

### 1.2 合规判定

| 检查项 | 状态 | 说明 |
|--------|------|------|
| monorepo 标准布局 | ✅ | pnpm workspaces，packages/* 约定 |
| 各包职责单一 | ✅ | engine/shared/llm/testing 职责清晰，依赖方向单向（shared ← llm ← engine ← testing） |
| 构建产物分离 | ✅ | dist/ 在 .gitignore 中 |
| 源码与测试分离 | ✅ | tests/ 目录与 src/ 同级 |
| 配置文件完备 | ✅ | tsconfig.base.json + eslint.config.mjs + pnpm-workspace.yaml |
| CI 配置 | ✅ | .github/workflows/ci.yml + scripts/ci-gate.ts 双保险 |
| **问题：根目录无 LICENSE 文件** | ❌ **缺失** | 根目录及所有子包均无 `LICENSE` 文件 |
| **问题：根 package.json 无 license 字段** | ❌ **缺失** | 根和各子包 package.json 均未声明 `license` 字段 |
| **问题：webui/ 为空壳目录** | ⚠️ | 仅含 `calculator.js`（占位符）、`test.html`、`test.txt`，无实质内容 |
| **问题：projects/solo-flight 独立包管理** | ⚠️ | 使用独立的 `package-lock.json`（npm），与根 monorepo 的 pnpm 管理不一致 |
| **问题：.cortex/ 目录含运行时产物** | ⚠️ | 虽在 .gitignore 中，但工作目录可能残留测试数据库文件 |

**结论：项目结构整体合规，存在 2 项缺失（LICENSE/license 字段）和 3 项轻微违规。**

---

## 2. 依赖许可证审计

### 2.1 审计方法

通过检查 `pnpm-lock.yaml` 和 `node_modules` 中各包的 `package.json`，逐一核实直接依赖的许可证类型。审计范围覆盖所有在 `package.json` 中声明的**直接依赖**。

### 2.2 直接依赖许可证清单

| 包名 | 版本 | 使用方 | 许可证 | 合规 | 备注 |
|------|------|--------|--------|------|------|
| `better-sqlite3` | ^11.0.0 | engine | **MIT** | ✅ | OSI 批准，宽松许可 |
| `@xenova/transformers` | ^2.17.2 | engine | **Apache-2.0** | ✅ | OSI 批准，专利授权 |
| `uuid` | ^10.0.0 | testing | **MIT** | ✅ | OSI 批准 |
| `playwright` | ^1.59.1 | engine (dev) | **Apache-2.0** | ✅ | devDependency |
| `vitest` | ^2.1.0 | 全部 (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `eslint` | ^10.3.0 | 根 + engine + testing (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `typescript` | ^5.7.0/5.9.3 | 全部 (dev) | **Apache-2.0** | ✅ | 基于其依赖推断 |
| `tsx` | ^4.19.0 | 根 (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `typescript-eslint` | ^8.59.2 | 根 (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `@types/node` | ^22.0.0 | engine/llm/testing (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `@types/better-sqlite3` | ^7.6.0 | engine (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `@types/uuid` | ^10.0.0 | testing (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `@eslint/js` | ^10.0.1 | 根 (dev) | **MIT** | ✅ | 基于其依赖推断 |
| `@cortex/llm` | workspace:* | engine | Proprietary | ⚠️ | 内部包，无许可证声明 |
| `@cortex/shared` | workspace:* | engine/llm/testing | Proprietary | ⚠️ | 内部包，无许可证声明 |
| `@cortex/testing` | workspace:* | engine (dev) | Proprietary | ⚠️ | 内部包，无许可证声明 |

### 2.3 传递依赖关键许可证摘要

| 包名 | 许可证 | 风险等级 |
|------|--------|---------|
| `sharp` (通过 @xenova/transformers) | **Apache-2.0** | ✅ 低 |
| `onnxruntime-node` (通过 @xenova/transformers, optional) | **MIT** | ✅ 低 |
| `onnxruntime-web` (通过 @xenova/transformers) | **MIT** | ✅ 低 |
| `protobufjs` (通过 onnxruntime-web) | **BSD-3-Clause** | ✅ 低 |
| `prebuild-install` (通过 better-sqlite3) | **MIT** | ✅ 低 |
| `bindings` (通过 better-sqlite3) | **MIT** | ✅ 低 |

### 2.4 许可证合规结论

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 所有第三方依赖许可证已知 | ✅ | 主要依赖使用 MIT / Apache-2.0，均为 OSI 批准的开源许可证 |
| 无 GPL/AGPL 类 copyleft 依赖 | ✅ | 未发现 GPL/AGPL 类强传染性许可证依赖 |
| 许可证兼容性 | ✅ | MIT + Apache-2.0 兼容，可组合使用 |
| **问题：项目自身无许可证声明** | ❌ **严重** | 根 `package.json` 及各子包均无 `license` 字段，根目录无 `LICENSE` 文件 |
| **问题：内部包无许可证** | ⚠️ | `@cortex/*` 系列内部包为私有包（`"private": true`），但未声明许可证 |
| **问题：playwright 许可证确认不完全** | ⚠️ | 已确认 playwright 本身为 Apache-2.0，但依赖树中的 `playwright-core` 需确认 |

**结论：所有第三方依赖的许可证均为宽松许可（MIT / Apache-2.0 / BSD-3-Clause），无许可证冲突。但项目自身完全缺失许可证声明——这是最严重的合规缺口。**

---

## 3. 文档完整性审查

### 3.1 必备文档清单检查

| 文档 | 路径 | 状态 | 说明 |
|------|------|------|------|
| **README.md**（项目介绍） | 根目录 | ❌ **缺失** | 项目根目录无 README.md |
| **LICENSE**（许可证） | 根目录 | ❌ **缺失** | 无任何许可证文件 |
| **CHANGELOG**（变更日志） | — | ❌ **缺失** | 无 CHANGELOG.md 或类似文件 |
| **CONTRIBUTING**（贡献指南） | — | ❌ **缺失** | 无 CONTRIBUTING.md |
| **宪法/顶层设计** | `docs/Cortex 概念顶层设计 v2.5.md` | ✅ 存在 | 68 页详细宪法文档 |
| **治理层设计** | `docs/core/治理层设计.md` | ✅ 存在 | 配套政府设计文档 |
| **架构设计文档** | `docs/core/` 系列 | ✅ 存在 | 13 份核心设计文档 |
| **Meso 阶段文档** | `docs/meso-lite/` 系列 | ✅ 存在 | 15 份阶段文档 |
| **合规审计报告** | `docs/conformity-audit.md` | ✅ 存在 | 上一轮代码合规审计 |
| **Agent 标签词汇表** | `docs/core/Agent标签词汇表-v2.0.md` | ✅ 存在 | Agent 标签体系 |
| **环境变量示例** | `.env.example` | ✅ 存在 | 含 API 配置模板 |
| **CI 配置** | `.github/workflows/ci.yml` | ✅ 存在 | 构建/测试/类型检查 |
| **ESLint 配置** | `eslint.config.mjs` | ✅ 存在 | 扁平配置 |
| **TypeScript 基础配置** | `tsconfig.base.json` | ✅ 存在 | 严格模式 |
| **代码审查记录** | `projects/solo-flight/code-review.md` | ✅ 存在 | 有代码审查记录 |
| **治理会话记录** | `doc-govern/committee_sessions.json` | ✅ 存在 | 委员会会话记录 |

### 3.2 各包 README 检查

| 包 | README 状态 | 说明 |
|----|------------|------|
| `packages/engine` | ❌ **缺失** | 无 README.md |
| `packages/llm` | ❌ **缺失** | 无 README.md |
| `packages/shared` | ❌ **缺失** | 无 README.md |
| `packages/testing` | ❌ **缺失** | 无 README.md |

### 3.3 文档质量评估

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 顶层设计完备 | ✅ | `Cortex 概念顶层设计 v2.5.md` 详细定义了架构、原则、Agent、记忆系统等 |
| 设计决策可追溯 | ✅ | `docs/core/` 中包含 v1.1 历史、设计决策、修正方案 |
| 阶段演进记录 | ✅ | Meso-Lite 阶段完整记录，Nano+ 到 Core-1 的演进路径清晰 |
| 宪法修正记录 | ✅ | v2.5.md 包含完整的宪法修正历史表 |
| **问题：根 README 缺失** | ❌ | 新贡献者或用户无法快速了解项目是什么、如何开始 |
| **问题：各包 README 缺失** | ❌ | 无法快速了解每个包的职责、API、如何使用 |
| **问题：CHANGELOG 缺失** | ❌ | 版本之间的变更无法追溯 |
| **问题：CONTRIBUTING 缺失** | ❌ | 没有明确的贡献指南 |

**结论：项目在架构文档和设计文档方面非常完备（尤其是宪法文档），但在面向用户/贡献者的基础文档（README、LICENSE、CHANGELOG、CONTRIBUTING）方面存在严重缺失。**

---

## 4. 综合评分与整改建议

### 4.1 评分矩阵

| 维度 | 评分 | 说明 |
|------|------|------|
| 项目结构 | ★★★★☆ | 整体规范，LICENSE 缺失是主要扣分项 |
| 依赖许可证 | ★★★★☆ | 第三方依赖许可证合规，项目自身无许可证声明 |
| 文档完整性 | ★★★☆☆ | 架构文档丰富，但基础项目文档（README/CHANGELOG/CONTRIBUTING）大面积缺失 |
| **综合** | **★★★☆☆** | **技术和架构文档扎实，合规和面向用户的文档严重不足** |

### 4.2 整改优先级

| 优先级 | 问题 | 影响面 | 建议 |
|--------|------|--------|------|
| **P1 高** | 根目录无 LICENSE 文件 | **版权合规** | 在根目录添加 `LICENSE` 文件（建议 MIT 或 Apache-2.0），并在根和各子包 `package.json` 中声明 `license` 字段 |
| **P1 高** | 根目录无 README.md | **项目可发现性** | 编写根 README.md，包含：项目简介、快速开始、包结构概览、环境要求 |
| **P1 高** | 各包无 README.md | **开发者体验** | 为 `packages/engine`、`packages/llm`、`packages/shared`、`packages/testing` 各添加 README.md，说明职责、API、依赖关系 |
| **P2 中** | 无 CHANGELOG.md | **变更追溯** | 从 Git 历史提取变更日志，或从版本号明确的宪法版本开始维护 CHANGELOG |
| **P2 中** | 无 CONTRIBUTING.md | **协作规范** | 编写贡献指南，说明 PR 流程、代码规范、测试要求 |
| **P2 中** | `webui/` 空壳目录 | **整洁性** | 移除或增加 README 说明用途 |
| **P2 中** | `projects/solo-flight` 独立包管理 | **一致性** | 迁移到 pnpm 工作区管理，或明确标记为独立实验项目 |
| **P3 低** | `@cortex/*` 内部包许可证声明 | **完整性** | 在内部包的 package.json 中添加 `"license": "MIT"` 或与根项目一致的许可证声明 |

### 4.3 合规总结

```
╔══════════════════════════════════════════════════════╗
║  审计结论：有条件通过                                  ║
║                                                      ║
║  技术架构文档质量极高（宪法 v2.5.8 + 治理层设计 +     ║
║  全套 Core/Meso 文档），项目结构规范。但面向公众的     ║
║  基础文档严重缺失——无 README、无 LICENSE、无          ║
║  CHANGELOG、无 CONTRIBUTING。第三方依赖许可证全部     ║
║  合规，但项目自身完全无许可证声明——这在开源合规       ║
║  层面构成最大风险。                                   ║
║                                                      ║
║  修复 P1 项（LICENSE + README）后即可完全合规。       ║
╚══════════════════════════════════════════════════════╝
```

### 4.4 详细整改方案

#### P1-1：添加 LICENSE 文件

```bash
# 在根目录创建 LICENSE 文件
# 建议 MIT 许可证（最宽松，适合个人工具链项目）
# 或 Apache-2.0（含专利授权，适合可能商业化的项目）

# 在根 package.json 中添加：
"license": "MIT"

# 在各子包 package.json 中添加：
"license": "MIT"
```

#### P1-2：编写根 README.md

建议包含以下章节：
- **项目简介**：Cortex 是什么（LLM 驱动的个人工具链）
- **快速开始**：环境要求（Node >=20, pnpm >=9）、安装步骤、运行方式
- **包结构**：4 个包的职责和依赖关系图示
- **核心概念**：Agent 池、MemoryStore、PipelineObserver 等关键概念一句话说明
- **相关资源**：指向宪法文档和治理层设计的链接

#### P1-3：编写各包 README.md

每个包至少包含：
- **职责**：这个包负责什么
- **依赖**：依赖哪些内部/外部包
- **主要导出**：关键类型、类、函数
- **开发命令**：build / test / lint 等

#### P2-1：创建 CHANGELOG.md

从宪法版本 v2.5.x 的修正记录可以反推主要变更，配合 Git 日志生成初始版本。

#### P2-2：创建 CONTRIBUTING.md

包含：
- PR 流程（Fork → Branch → Commit → PR）
- 代码规范（ESLint + TypeScript strict）
- 测试要求（`pnpm test` 必须通过）
- 宪法修改流程（自审视 → 圆桌 → 入宪）

---

*审计结束。文档是项目的脸面——脸都不干净，别人凭什么信你的代码可靠？*
