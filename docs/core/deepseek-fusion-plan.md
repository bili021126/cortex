# DeepSeek++ 与 Cortex 融合增强方案

> 定位：将 DeepSeek++ 从通用聊天增强工具转变为 Cortex 治理框架的指挥舱。
> 数据源：DeepSeek 外部记忆库 #39「DeepSeek++ 与 Cortex 融合增强方案」

---

## 概述

DeepSeek++ 是 Chrome 扩展，通过前端注入为 DeepSeek 网页版赋予 Agent 能力。核心功能包括：记忆系统（跨对话长期记忆）、技能系统（`/skill` 切换专家模式）、MCP 工具系统（调用外部工具）、自动化任务（定时执行）。

与 Cortex 融合后，DeepSeek++ 从通用工具转变为 **Cortex 治理框架的交互中枢**。四大增强方向如下。

---

## 增强一：Agent 控制台

### 现状

DeepSeek++ WebUI 存在已识别的安全漏洞（零认证、CORS 全开），需要先修复再启用。

### 目标

将 WebUI 改造为 Cortex Agent 控制台，包含：

| 组件 | 功能 |
|------|------|
| **拓扑图** | 14 种 Agent 的实时运行拓扑，显示任务分配路径 |
| **信任水位仪表盘** | 每个 Agent 的信任值、当前水位、历史波动 |
| **治理事件流** | 实时显示 `GovernanceEvent` 流（预案触发、裁决、审批） |
| **门禁状态** | 341/341 门禁实时状态，显示全绿/异常 |

### 实现思路

- WebUI 后端读取治理事件总线（`PipelineObserver`）
- 拓扑图从 `MetaAgent` 的任务分配记录中获取
- 信任水位从 `governance-config` 的信任值表中读取

---

## 增强二：记忆与技能的深度文档注入

### 现状

DeepSeek 在每次对话开始时没有准确的项目上下文，需要手动补充。

### 目标

将以下文档作为上下文**固化**进模型，使其在任何对话中都能准确引用：

| 文档 | 用途 | 优先级 |
|------|------|--------|
| 架构报告（`docs/analysis/architecture-report-2026-06-21.md`） | 让模型理解五流六层七原则 | P0 |
| 代码评审记录（`docs/analysis/external-code-review-2026-06-30.md`） | 让模型知道已知问题和修复方向 | P0 |
| 宪法版本（`.cortex/cyrene-constitution.md`） | 昔涟全量人格定义 | P1 |
| 治理层设计（`docs/core/治理层设计-v3.0-全量整合版.md`） | 治理闭环的具体实现 | P1 |

### 注入方式

- 通过 DeepSeek++ 的「技能系统」注册为 `/cortex-context` 技能
- 触发时自动加载文档摘要 + 关键接口定义
- 对话中可通过 `@cortex-context` 快捷引用

---

## 增强三：@Cortex 多 Agent 协作钩子

### 现状

DeepSeek 聊天框只能与单个模型对话，无法调度后端 Agent。

### 目标

在 DeepSeek 聊天框中直接调度 Cortex Agent：

```
用户: @甘雨 审查一下当前架构的风险点
DeepSeek++ → Cortex API Gateway → MetaAgent → 调度刻晴审查 → 返回结果
```

### 实现架构

```
DeepSeek 聊天框
  │
  ├─ @AgentName 识别
  │     └─ DeepSeek++ 解析 → 发送到 Cortex 后端
  │
  ▼
Cortex API Gateway (express 服务)
  │
  ├─ 认证 → 门禁检查
  │
  ├─ MetaAgent 路由
  │     └─ 按 @AgentName 匹配 CapabilityRegistry
  │
  └─ 结果返回 DeepSeek 聊天框
```

### 支持的命令

| 命令 | 行为 |
|------|------|
| `@甘雨 审查 ...` | 调度甘雨执行审查任务 |
| `@刻晴 评估 ...` | 调度刻晴执行评估任务 |
| `@阿贝多 实现 ...` | 调度阿贝多执行实现任务 |
| `@状态` | 返回当前 Agent 池状态 |
| `@拓扑` | 返回 Agent 运行拓扑 |

---

## 增强四：工程刚性缺口清单

### 现状

DeepSeek++ 缺少与 Cortex 基础设施对接的 MCP 工具。

### 目标

| 缺口 | MCP 工具 | 用途 | 优先级 |
|------|---------|------|--------|
| Redis 热数据操作 | `redis-mcp` | 仿真层热缓存读写、偏差窗口查询 | P0 |
| SQLite 记忆操作 | `sqlite-mcp` | 直接查询 `cyrene-memory.db` 或 `memory.db` | P0 |
| 文件系统操作 | `fs-mcp` | 读取 docs/ 目录、代码文件 | P1 |
| 治理事件订阅 | `governance-mcp` | 实时订阅治理事件流 | P1 |

### 实现路径

```
DeepSeek++ MCP Client
  │
  ├─ MCP Server (每个工具一个进程)
  │     ├─ redis-mcp → Redis 实例
  │     ├─ sqlite-mcp → CyreneMemoryDB / MemoryDB
  │     └─ fs-mcp → 文件系统
  │
  └─ 工具调用 → 结果 → 对话上下文
```

---

## 实施优先级

| 优先级 | 事项 | 前置依赖 | 预估工时 |
|--------|------|---------|---------|
| P0 | WebUI 安全修复（认证 + CORS 收敛） | — | 短 |
| P0 | Redis MCP + SQLite MCP | 对应数据库就绪 | 中 |
| P0 | 文档注入（架构报告 + 代码评审） | 文档整理 | 短 |
| P1 | @Cortex 多 Agent 钩子 | Cortex API Gateway | 长 |
| P1 | Agent 控制台（拓扑图 + 仪表盘） | WebUI 修复 | 中 |
| P2 | 完整 MCP 工具集 | P0 MCP 验证 | 中 |

---

> 修订记录
> - 2026-07-03：初版，基于 DeepSeek 外部记忆库 #39 同步
