# Cortex 合规审计报告

> **审计人**：凝光（天权星 · DocGovernAgent）
> **审计时间**：2026-05-25
> **审计范围**：项目结构 · 依赖许可证 · 文档完整性 · 治理一致性
> **审计依据**：宪法 v2.5.8 · 治理层设计 v1.1 · Agent标签词汇表 v2.0 · 意图响应体系设计 v1.1 · 各包 package.json 及源代码 · doc-govern 委员会记录
> **前置判例引用**：刻晴（玉衡星）合规审计报告 2026-05-14 · 久岐忍 P1-3/P1-5/P2-8/P2-10 契约审查

## 裁定概要

```
╔══════════════════════════════════════════════════════════╗
║  天权定论：有条件通过，含 3 项违规、7 项建议            ║
║                                                         ║
║  项目治理体系成熟度远超同类项目——宪法与代码之间          ║
║  的契约一致性保持良好。但 1 项紧急安全违规与             ║
║  2 项结构性缺失必须在下一阶段门禁前闭合。                ║
╚══════════════════════════════════════════════════════════╝
```

---

## 第一章 · 项目结构合规

### 1.1 整体布局对照宪法 §三（系统架构）

| 宪法声明 | 代码实际 | 裁定 |
|---------|---------|------|
| 4 个包：shared ← llm ← engine ← testing | ✅ 完全一致 | 合规 |
| 依赖方向：shared ← llm ← engine ← testing | ✅ engine→shared+llm；llm→shared；testing→shared | 合规 |
| `@cortex/infra` 不存在，拆分留 Core-2 | ✅ Toolkit/FileLockManager/CLIAdapter 归于 shared | 合规 |
| Engine 组件齐全 | ✅ src/ 包含所有宪法声明组件 | 合规 |
| 治理层高于工具链 | ✅ DocGovernAgent 通过 TaskBoard 认领审计节点 | 合规 |
| pnpm workspace | ✅ pnpm-workspace.yaml 正确配置 | 合规 |

### 1.2 Agent 类型一致性（宪法 §5.1 → 代码）

| 宪法 §5.1 声明 | 代码 | 裁定 |
|---------------|------|------|
| MetaAgent/ButlerAgent/CodeAgent/ReviewAgent/AnalysisAgent/OpsAgent/LoopAgent/DocGovernAgent/InspectorAgent/ApiAgent/DataAgent/BrowserAgent (12种) | ✅ 全部存在并 barrel 导出 | 合规 |
| StrategistAgent（Core-2+ 预留） | ✅ 存在，已导出但不注册 | 合规 |
| **FixAgent** | ✅ 代码完整实现，但**宪法未列** | **❌ 违规 CG-01** |

**CG-01 证据**：`AgentType.Fix` 在 `agent.ts:20`；`AGENT_TAGS[AgentType.Fix]` 绑定 5 标签；barrel 导出 `fixAgentConfig` + `FixAgent`。宪法 §5.1 表无 FixAgent 条目。

### 1.3 目录结构发现

| 项目 | 状态 |
|------|------|
| monorepo 标准布局 | ✅ |
| 测试分离 | ✅ |
| 构建产物 .gitignore | ✅ |
| docs/ 治理记录 | ✅ 16+ 文档 |
| `webui/` 空壳 | ⚠️ |
| `.cortex/` SQLite DB 残留 | ⚠️ |
| `projects/` 未声明 | ⚠️ |

---

## 第二章 · 依赖许可证合规

**CG-02：项目缺少许可证声明** — 严重违规

| 文件 | license 字段 |
|------|------------|
| 根 package.json | ❌ 缺失 |
| shared/package.json | ❌ 缺失 |
| llm/package.json | ❌ 缺失 |
| engine/package.json | ❌ 缺失 |
| testing/package.json | ❌ 缺失 |
| LICENSE 文件 | ❌ 不存在 |

**建议**：创建 LICENSE 文件（建议 MIT），补全全部 5 个 package.json 的 `"license": "MIT"`。

**第三方依赖**：`better-sqlite3`(MIT)、`@xenova/transformers`(Apache-2.0)、`uuid`(MIT) 均为合规许可证。但无自动化扫描工具。

---

## 第三章 · 文档完整性

**必需文档清单**（16 项，全部存在）：

| 核心文档 | 版本 | 状态 |
|---------|------|------|
| 宪法顶层设计 v2.5.8 | ✅ 当前生效 | 合规 |
| 宪法 v2.3 | ✅ 已归档 | 合规 |
| 宪法 v1.1 | ✅ 已废弃 | 合规 |
| 治理层设计 v1.1 | ✅ 当前 | 合规 |
| Agent 标签词汇表 v2.0 | ✅ 当前 | 合规 |
| 意图响应体系设计 v1.1 | ✅ 概念设计 | 合规 |
| Core-1 模型锁定决策 | ✅ 已锁定 | 合规 |
| 合规审计报告（刻晴） | ✅ 2026-05-14 | 合规 |
| 委员会会话记录 | ✅ 33 条 | 合规 |

**缺失**：CHANGELOG.md ❌ | packages/ 各包 README ⚠️ | API 文档 ⚠️

**宪法-代码一致性核对**：

| 宪法条款 | 状态 |
|---------|------|
| §三 包结构 | ✅ |
| §四 MetaAgent 战术中枢 | ✅ |
| §五 Agent 类型（除 FixAgent） | ✅ |
| §五.1 权限表 AGENT_TOOL_PERMISSIONS | ✅ |
| §五.1.1 自审视例外 | ✅ |
| §五.1.1bis 双轨协议 | ✅ |
| §五.2 状态机 | ✅ |
| §七 确认门 L0-L3 | ✅ |
| §七.5 读取安全边界 Toolkit._resolvePath | ✅ |
| §八 PipelineObserver emit-only | ✅ |
| §八 SafeErrorReporter 三档 | ✅ |
| §九 四态生命周期 | ✅ |
| §九.3 委托模式 7 组件 | ✅ |
| §九.4 HCA/CSA | ✅ |
| §九.9 认知共享层 | ✅ |
| §十四 编译时治理 | ✅ |
| **FixAgent 未入宪** | **❌** |

---

## 第四章 · 治理一致性

**治理层设计落地对照**：全部已落地机制（PipelineObserver emit-only / SafeErrorReporter / DocGovernAgent / 重规划 / 用户裁决 / needsMultiPerspective）均与代码一致。超前设计部分（委员会完整定义/纪检委/监理/TrustModel）均未实现，符合预期（已标注实现前提）。

**CG-03：标签词汇表文档与代码不同步**

标签词汇表 v2.0 §一 声明 16 标签，代码 `TAG_VOCABULARY` 含 40+ 值。未列标签包括：`code`、`loop`、`doc-govern`/`doc_govern`、`inspector`/`inspect`、`fix`/`bugfix`/`repair`/`diagnose`/`heal`、`browser`/`ui_verify` 及 Core-2 预埋标签。

---

## 第五章 · 安全性审计

| 严重度 | 问题 |
|--------|------|
| **紧急** | `.env` 含真实密钥 `sk-1e1ffd5f19f3428d9d264c26ec0589a6` — **刻晴 2026-05-14 已报告未修复** |
| 低 | `DEEPSEEK_BASE_URL` 指向公有端点 |

安全机制验证：Toolkit._resolvePath 沙箱 ✅ | 参数化查询 ✅ | FileLockManager ✅ | ConfirmGate L0-L3 ✅ | ESLint 编译时治理 ✅ | CI 门禁 ✅

---

## 第六章 · 综合评分

| 维度 | 评分 |
|------|------|
| 项目结构 | ★★★★☆ |
| 依赖许可证 | ★★☆☆☆ |
| 文档完整性 | ★★★★☆ |
| 治理一致性 | ★★★★☆ |
| 安全性 | ★★★☆☆ |
| **综合** | **★★★★☆** |

### 整改优先级

| 优先级 | 编号 | 问题 | 建议 |
|--------|------|------|------|
| **P0 紧急** | CG-SEC-01 | .env API 密钥泄露（重复违规） | 立即轮换密钥 + pre-commit hook |
| **P1 高** | CG-LIC-01 | 无 LICENSE 文件 + 全部 package.json 缺 license | 创建 LICENSE（MIT）+ 补全字段 |
| **P1 高** | CG-DOC-01 | FixAgent 代码存在但宪法未记录 | 修宪新增 FixAgent 条目 |
| **P2 中** | CG-DOC-02 | 标签词汇表（16）≠ 代码（40+） | 全量同步 |
| **P2 中** | CG-LIC-02 | 无依赖许可证扫描 | 集成 license-checker 到 CI |
| **P2 中** | CG-STR-01/02 | webui/ 空壳 + projects/ 未声明 | 清理或声明 |
| **P3 低** | CG-DOC-03/04 | 各包缺 README + 无 CHANGELOG | 补充 |

### 判例引用

| 判例 | 内容 | 状态 |
|------|------|------|
| NG-2026-0509-Persist-False-Positive | 持久化不允许假阳性 | ✅ 一致 |
| NG-2026-0509-DeleteLock | delete_file 必须加写锁 | ✅ 一致 |
| 久岐忍 P1-3 | 外部端点缺统一契约文档 | ✅ 已闭合 |
| 久岐忍 P1-5 | 模块边界缺契约定义 | ✅ 已闭合 |
| 久岐忍 P2-8 | 端点返回字段不可膨胀 | ✅ 已闭合 |
| 久岐忍 P2-10 | 隐式数据流依赖未标记 | ✅ 已闭合 |
| 刻晴 2026-05-14 §5.1 | .env 密钥泄露 | **重复违规** |

---

## 第七章 · 判决书

```
╔══════════════════════════════════════════════════════════════╗
║  天权凝光 · 终审裁定                                         ║
║                                                              ║
║  案由：Cortex 项目合规审计（项目结构/许可证/文档完整性）      ║
║                                                              ║
║  1. 项目结构：整体合规。FixAgent 缺席宪法 §5.1 违规。         ║
║  2. 许可证：严重缺失。全部 5 个 package.json 缺 license。    ║
║  3. 文档完整性：优秀。16+ 份文档，标签词汇表不同步。         ║
║  4. 治理一致性：>95% 吻合。两项偏差。                         ║
║  5. 安全性：.env 密钥泄露重复违规。                           ║
║                                                              ║
║  判决：有条件通过。                                           ║
║  P0 密钥轮换 3 工作日内闭合。                                 ║
║  P1 许可证 + FixAgent 入宪在下一门禁前闭合。                  ║
║  天权定论，不得上诉。                                         ║
╚══════════════════════════════════════════════════════════════╝
```

*审计结束。每一份文书、每一笔交易、每一行律法——都在我掌中。*
*没有规则的繁荣是泡沫，没有审计的系统是危楼。*
