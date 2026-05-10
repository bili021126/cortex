# Cortex 项目文件扫描与模块划分报告

> 生成时间：2025-07-18  
> 扫描范围：`packages/` + `docs/`（排除 `node_modules/`、`dist/`、`*.tsbuildinfo`）

---

## 一、packages/ — 代码包

### 1. packages/engine — 核心引擎（主包）

| 文件 | 模块角色 |
|------|----------|
| `src/index.ts` | 引擎总入口 |
| `src/agent-pool.ts` | Agent 池 — Agent 生命周期管理 |
| `src/base-agent.ts` | Agent 基类 |
| `src/meta-agent.ts` | 元 Agent — 任务拆解与路由 |
| `src/butler-agent.ts` | 管家 Agent — 日常协作调度 |
| `src/code-agent.ts` | 代码 Agent — 代码生成与审查 |
| `src/review-agent.ts` | 审查 Agent — 代码/文档审查 |
| `src/analysis-agent.ts` | 分析 Agent — 数据分析 |
| `src/browser-agent.ts` | 浏览器 Agent — Web 交互 |
| `src/inspector-agent.ts` | 检查 Agent — 结果校验 |
| `src/doc-govern-agent.ts` | 文档治理 Agent |
| `src/loop-agent.ts` | 循环 Agent — 迭代执行 |
| `src/ops-agent.ts` | 运维 Agent — 操作执行 |
| `src/memory-store.ts` | 记忆存储 — 持久化记忆系统 |
| `src/task-board.ts` | 任务板 — 任务编排与追踪 |
| `src/scheduler.ts` | 调度器 — 任务调度 |
| `src/tool-registry.ts` | 工具注册表 — 工具发现与注册 |
| `src/toolkit.ts` | 工具集 |
| `src/file-lock-manager.ts` | 文件锁管理器 |
| `src/pipeline-observer.ts` | 流水线观察器 |
| `src/confirm-gate.ts` | 确认网关 — 人机确认节点 |
| `src/cli-adapter.ts` | CLI 适配器 |
| `src/llm-adapter.ts` | LLM 适配器 |
| `src/react-helper.ts` | React 辅助工具 |
| `doc-govern/committee_sessions.json` | 治理委员会会话记录 |
| `packages/engine/src/string-utils.ts` | 字符串工具（内嵌子包） |

**测试文件**（`tests/`）：
`agent-pool.test.ts`, `butler-agent.test.ts`, `cli-adapter.test.ts`, `code-agent.test.ts`, `confirm-gate.test.ts`, `confirm-gate-cli.test.ts`, `doc-govern-agent.test.ts`, `file-lock-manager.test.ts`, `inspector-agent.test.ts`, `memory-store.test.ts`, `meta-agent.test.ts`, `multi-agent-collab.test.ts`, `pipeline-observer.test.ts`, `review-agent.test.ts`, `scheduler.test.ts`, `task-board.test.ts`, `task-board-stress.test.ts`, `tool-registry.test.ts`

**手动测试**（`tests/manual/`）：
`browser-e2e.ts`, `calculator-e2e.ts`, `conversation-10.ts`, `cortex-self-examination.ts`, `e2e-real-llm.ts`, `manual-e2e-verify.ts`, `mini-react-test.ts`, `webui-calculator-e2e.ts`, `webui-calculator-verify.ts`

### 2. packages/shared — 共享库

| 文件 | 模块角色 |
|------|----------|
| `src/index.ts` | 共享类型与工具导出入口 |
| `tests/types.test.ts` | 类型测试 |

### 3. packages/testing — 测试基础设施

| 文件 | 模块角色 |
|------|----------|
| `src/index.ts` | 测试工具导出入口 |

---

## 二、docs/ — 设计文档

### 1. docs/core — 核心设计文档

| 文件 | 主题 |
|------|------|
| `Cortex 概念顶层设计 v2.0.md` | 概念顶层设计（现行版本） |
| `Cortex 概念顶层设计 v1.1-已废弃.md` | 概念顶层设计（已废弃） |
| `Agent标签词汇表-v2.0.md` | Agent 标签词汇规范 |
| `Core 阶段治理机制概念讨论.md` | 治理机制概念讨论 |
| `Core-1-第四轮-记忆系统设计反思与工程教训.md` | 记忆系统反思 |
| `Core-1-终局反思-实践心得与经验教训.md` | Core-1 终局反思 |
| `Core-1模型版本锁定决策.md` | 模型版本锁定 |
| `Core-1重构计划与测试策略.md` | 重构与测试策略 |
| `Meso文档-v2.0宪法修正附录.md` | Meso 宪法修正附录 |
| `v1.1-关键设计理念保留.md` | v1.1 理念保留记录 |
| `v2.0-治理架构深化讨论.md` | v2.0 治理深化 |
| `事件总线宪法定位审查报告-v1.1历史.md` | 事件总线宪法审查（历史） |
| `功能柱降级修正方案-v1.1历史.md` | 功能柱降级修正（历史） |

### 2. docs/meso-lite — Meso-Lite 阶段文档

| 文件 | 主题 |
|------|------|
| `README.md` | Meso-Lite 总览 |
| `Cortex Meso 阶段——概念设计落地产出文档.md` | Meso 概念落地 |
| `Meso反思-完整记录.md` | Meso 完整反思 |
| `Nano+ 阶段数据回顾与 Meso-Lite 决策追溯.md` | 数据回顾与决策追溯 |
| `原型验证全量审查与修宪启动.md` | 原型验证审查 |
| `工程实践反思合集.md` | 工程反思合集 |
| `议题一-技术选型与敲定.md` | 技术选型 |
| `议题二-项目形态的演进与工程形态的落地.md` | 项目形态演进 |
| `议题三-功能的抽象与具体设计.md` | 功能抽象设计 |
| `议题四-记忆系统与事件通信协议设计.md` | 记忆与通信协议 |
| `议题五-项目演进阶段与执行策略.md` | 演进阶段策略 |
| `议题六-Meso-Lite最小交互协议.md` | 最小交互协议 |
| `议题七-全系统横向关切设计细则.md` | 横向关切细则 |
| `过渡阶段-交付与验收.md` | 交付与验收 |
| `预备修宪清单.md` | 修宪预备清单 |

### 3. docs/ 根目录

| 文件 | 主题 |
|------|------|
| `test.html` | 测试页面 |

---

## 三、模块划分总结

| 层级 | 包/目录 | 职责 |
|------|---------|------|
| **引擎** | `packages/engine` | Agent 运行时：池管理、调度、记忆、工具、流水线、确认网关 |
| **共享** | `packages/shared` | 跨包共享类型与工具 |
| **测试** | `packages/testing` | 测试基础设施与辅助 |
| **设计-核心** | `docs/core` | Cortex Core 阶段概念设计、治理机制、经验反思 |
| **设计-Meso** | `docs/meso-lite` | Meso-Lite 阶段工程化落地：技术选型、协议设计、交付验收 |
