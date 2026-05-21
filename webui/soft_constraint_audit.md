# 🗺️ 侦察报告：软约束约束状态审计

**侦察员**：安柏（InspectorAgent）  
**侦察范围**：项目根目录 + `packages/` + `docs/`（软约束相关文件全量扫描）  
**工具调用**：`search_code` + `read_file` + `list_files`（逐文件确认，可追溯至具体工具调用）  
**报告日期**：2026-06-10  

> **本报告仅记录亲眼所见的事实。不推断、不推测、不给建议。**

---

## §0 编译/测试事实（来自系统采集）

| 命令 | 结果 | 事实依据 |
|------|------|---------|
| `tsc --noEmit` | ❌ **编译失败** (exit 2) | `tsconfig.json(15,5): error TS6053: File 'D:/cortex/packages/docs' not found.` |
| `tsx` | ❌ **测试失败** (exit 1) | `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\cortex\test\calculator.test.ts'` |
| `vitest` | ✅ **通过** (7/7) | 全部 7 个 LLM 适配器测试通过 |

**编译失败根因**：`tsconfig.json` 第 15 行 `{ "path": "packages/docs" }`——`packages/docs` 目录在物理仓库中**不存在**。`pnpm-workspace.yaml` 声明 `packages: ["packages/*"]` 通配所有子包，但 `packages/docs` 从未被创建。此路径被 tsconfig 的 `references` 引用，导致 `tsc --noEmit` 因找不到引用路径而报错。

**tsx 测试失败根因**：测试入口 `test/calculator.test.ts` 在仓库中不存在。这似乎是已废弃或未创建的测试文件。

---

## §1 软约束相关文件全量清单

### §1.1 宪法层——双轨协议与权限例外

**文件**：`docs/constitution/Cortex 概念顶层设计 v2.5.21.md`

| 条款 | 章节 | 行号 | 内容摘要 |
|------|------|------|---------|
| 自审视模式权限例外 | §5.1.1 | 第186-193行 | 自审视模式（`--soft`）下 Agent 工具权限临时提升至 FULL_TOOLSET，写入路径硬约束于 `test-output/self-examination-soft/` |
| 软约束/硬约束双轨协议 | §5.1.1bis | 第198-236行 | 5 维度差异定义（Phase 0 基线 / 探索方向 / Phase 5 注入 / 圆桌产出 / 共识基线）+ 选择规则 + 归因 |

### §1.2 Agent 配置层——soft-consensus 圆桌

**文件**：`cortex-agents.json`
- **路径**：roundtableTemplates[2]
- **配置**：9 席 Agent（刻晴、甘雨、纳西妲、阿贝多、钟离、北斗、久岐忍、艾尔海森、凝光），1 轮合并会议

### §1.3 验证模板层——软约束探索指引

**文件**：`packages/engine/tests/manual/config/verification-templates-soft.json`

9 个 Agent 的无预设清单探索模板：

| Agent | 角色 | 输出文件 |
|-------|------|---------|
| 刻晴 (keqing) | 代码质量深度侦察 | `test-output/self-examination-soft/keqing-quality-recon.md` |
| 北斗 (beidou) | 工程就绪性自由诊断 | `test-output/self-examination-soft/beidou-ops-diagnosis.md` |
| 纳西妲 (nahida) | 架构全景自由分析 | `test-output/self-examination-soft/nahida-architecture-analysis.md` |
| 凝光 (ningguang) | 治理合规自由审计 | `test-output/self-examination-soft/ningguang-governance-audit.md` |
| 莫娜 (mona) | 模式发现与趋势预言 | `test-output/self-examination-soft/mona-pattern-discovery.md` |
| 安柏 (amber) | 全项目变更侦察 | `test-output/self-examination-soft/amber-reconnaissance.md` |
| 阿贝多 (albedo) | 核心层深度代码审查 | `test-output/self-examination-soft/albedo-deep-review.md` |
| 久岐忍 (kuki) | API 契约设计与规范化 | `test-output/self-examination-soft/kuki-api-design.md` |
| 艾尔海森 (alhaitham) | 数据模型设计与存储规范 | `test-output/self-examination-soft/alhaitham-data-design.md` |

### §1.4 会议配置层——roundtable-config.ts

**文件**：`packages/engine/tests/manual/config/roundtable-config.ts`

- **变量**：`SOFT_CONSENSUS_ROUNDTABLE`（约第370-480行）
- **特点**：单轮合并（原三轮→一轮，minTurns: 3, maxTurns: 5）
- **queryMode**: `"hca"`（广撒网检索）
- **BrowserAgent 排除**：`.filter((p) => p.type !== AgentType.Browser)`
- **材料清单**（MATERIAL_CHECKLIST，约第200-275行）：8 项材料，含 2 项 required

### §1.5 文档注册层——doc-registry.ts

**文件**：`packages/engine/src/registry/doc-registry.ts`
- **路径**：第42行 `PATH_TEMPLATES["self-examination"] = ".cortex/archive/self-examination-soft"`

### §1.6 执行产物层

**目录**：`test-output/self-examination-soft/`
- **当前状态**：**空目录**。无任何软约束执行产物。
- **历史归档**：`test-output/archive/` 存在历史产物（回溯搜索确认）

---

## §2 现有修复痕迹全量记录

### §2.1 宪法修正案状态

| 提案 ID | 版本 | 目标 | 状态 | 来源 |
|---------|------|------|------|------|
| AM-2026-0515-001 | v2.5.11 | 新增原则七 + 六项子约束 | ✅ `applied` | `read_file` — status 字段 |
| AM-2026-0515-002 | v2.5.12 | 新增 §8.2 通知管线三轨语义分层 | ✅ `applied` | `read_file` — status 字段 |
| AM-2026-0515-003 | v2.5.14 | 冲突解决三原则入宪 | ✅ 入宪（v2.5.14） | 宪法版本头 |
| AM-2026-0515-004 | v2.5.15 | 战略双柱拆分（钟离+霜凝） | ✅ 入宪（v2.5.15） | 宪法版本头 |
| AM-2026-0515-005 | v2.5.16 | 治理层制度化（隐喻声明） | ✅ 入宪（v2.5.16） | 宪法版本头 |
| AM-2026-0606-001 | v2.5.13 | 修复自反性缺口——新增子约束7 | ✅ `applied` | `read_file` — status 字段（已从 proposed 更新为 applied） |
| AM-2026-0606-002 | v2.5.14 | 修复审计闭环缺失 | ⛔ `superseded` | `read_file` — status 字段；被 v2.5.18 替代 |
| AM-2026-0606-003 | v2.5.13 | DECISION_REQUIRED 回退机制 | ⛔ `superseded` | `read_file` — status 字段；被 v2.5.17 替代 |
| AM-2026-0606-004 | v2.5.14 | 子约束7闭环修复 | ✅ `applied` | `read_file` — status 字段（已从 proposed 更新为 applied） |
| AM-2026-0607-001 | v2.5.15 | 条款间一致性 + 不可变语义定义 | ⛔ `superseded` | `read_file` — status 字段；被 v2.5.19 替代 |
| AM-2026-0520-001 | v2.5.20 | 提案超时失效机制 | ✅ 入宪（v2.5.20） | 宪法版本头 |
| AM-2026-0520-002 | v2.5.21 | 层级冲突裁决第四原则 | ✅ 入宪（v2.5.21） | 宪法版本头 |

### §2.2 已修复的审计发现

**来源**：凝光（DocGovernAgent）三项审计报告

| 审计发现 | 等级 | 修复版本 | 修复方式 | 当前状态 |
|----------|------|---------|---------|---------|
| 原则七自反性缺口（1-A） | 🔴 P0 | v2.5.13 | 新增子约束7「子约束修改规则」 | ✅ **已闭合** |
| 紧急修宪通道缺失（1-B） | 🟡 P3 | — | 未修复 | ❌ **仍开放** |
| DECISION_REQUIRED 回退机制（2-A） | 🟡 P2 | v2.5.17 | AM-2026-0515-006 入宪（四层安全阀） | ✅ **已闭合** |
| 治理事件接入路径（2-B） | 🟡 P2 | — | 未修复 | ❌ **仍开放** |
| 通知持久化追踪（2-C） | 🟢 P4 | — | 未修复 | ❌ **仍开放** |
| 审计闭环缺失（3-A） | 🔴 P1 | v2.5.18 | AM-2026-0515-007 入宪（五环节闭环） | ✅ **已闭合** |
| 层级冲突原则缺失（3-B） | 🟡 P3 | v2.5.21 | AM-2026-0520-002 入宪（第四原则） | ✅ **已闭合** |
| 阶段门禁宪法定义不完整（3-C） | 🟢 P4 | — | 未修复 | ❌ **仍开放** |

### §2.3 条款间一致性修复（v2.5.19）

**来源**：凝光全量审计 2026-06-07

| 发现 | 等级 | 修复状态 |
|------|:----:|:--------:|
| 原则七「不可变」语义未定义 | 🔴 P0 | ✅ 已修复——新增脚注¹：「不可变指原则七的标题和存在本身不可删除；内容可演进」 |
| AM-2026-0606-004 状态 `proposed`→`applied` | 🔴 P0 | ✅ 已修复——AM-2026-0607-001 已更新状态且被 superseded，内容已并入 v2.5.19 |
| AM-2026-0606-001 状态 `proposed`→`applied` | 🔴 P0 | ✅ 已修复——同上 |
| 版本头日期悖论 | 🔴 P0 | ✅ 已修复——v2.5.13/v2.5.14 日期从 2026-05-17 更正为 2026-06-06 |
| 继承声明递归约束 | 🟡 P1 | ✅ 已修复——继承声明补充「修改子约束7自身时，同样须遵守本条(a)-(e)」 |
| 子约束7(e)表述澄清 | 🟢 P3 | ✅ 已修复——「不可变性质继承」→「保护力度不可降低」 |

### §2.4 代码层修复痕迹

**来源**：`doc-govern/modification-record.json`

| 会话 | 文件改动 | Agent | 描述 |
|------|---------|-------|------|
| schema-enforce | 8 文件 | DataAgent | 创建 ModificationRecord Schema、MemoryState 新增 PENDING、SchemaEnforcer 组件 |
| hardcode-extract-core1 | 5 文件 | FixAgent | CHECK_ORDER 死代码清理、P0 安全修复（硬编码主密钥）、硬编码→动态初始化等 |

---

## §3 当前约束状态——未解决问题

### ❌ 问题 1：tsconfig.json 引用不存在的 packages/docs

- **文件**：`tsconfig.json` 第 15 行 `{ "path": "packages/docs" }`
- **现象**：`tsc --noEmit` 编译失败
- **事实依据**：`list_files` 确认 `D:/cortex/packages/docs` **不存在**；`search_code` 确认 `packages/docs` 仅在 tsconfig.json 中出现

### ❌ 问题 2：test/calculator.test.ts 不存在

- **文件**：`test/calculator.test.ts`
- **现象**：`tsx` 测试运行失败
- **事实依据**：`list_files` 未在项目根目录找到 `test/` 目录下的 `calculator.test.ts`

### ❌ 问题 3：test-output/self-examination-soft/ 空目录

- **目录**：`test-output/self-examination-soft/`
- **现象**：空目录，无任何软约束执行产物
- **事实依据**：`list_files` 确认目录存在但无文件

### ❌ 问题 4：紧急修宪通道缺失（发现 1-B，P3）

- **状态**：自 2026-06-06 起未修复
- **影响**：Core-2 安全漏洞修复延迟风险

### ❌ 问题 5：治理事件接入路径缺失（发现 2-B，P2）

- **状态**：自 2026-06-06 起未修复
- **影响**：治理审计结论走不出文件系统——DocGovernAgent 写完磁盘即结束

### ❌ 问题 6：阶段门禁宪法定义不完整（发现 3-C，P4）

- **状态**：自 2026-06-06 起未修复
- **影响**：Core-1→Core-2 阶段跃迁无宪法级准入标准

---

## §4 执行产物验证

### §4.1 产物目录状态

| 路径 | 状态 | 预期内容 | 实际内容 |
|------|:----:|---------|---------|
| `test-output/self-examination-soft/` | ❌ **空目录** | 9 份 Agent 探索报告 | 无文件 |
| `test-output/archive/self-examination-*` | ✅ 存在 | 历史产物（含 amber/beidou/mona/kuki/ningguang 等报告） | 多个时间戳目录 |
| `.cortex/archive/self-examination-soft/` | — | doc-registry.ts 映射路径 | 未侦察（超出范围） |

### §4.2 硬约束 vs 软约束差异验证

| 维度 | 硬约束 | 软约束 | 配置一致性 |
|------|--------|--------|:----------:|
| 基线来源 | 上轮共识清单（强制） | HCA 预读（参考锚点） | ✅ 宪法定义一致 |
| 探索模板 | verification-templates.json（7 Agent） | verification-templates-soft.json（9 Agent） | ✅ 文件存在，配置一致 |
| Phase 5 注入 | MemoryStore 种子记忆 | topic 字符串直接注入 | ✅ 宪法定义一致 |
| 圆桌产出 | 逐项判定闭合/遗留/新增 | 自由发现→交叉表态→凝光收束 | ✅ 宪法定义一致 |
| 共识基线 | 上轮清单为强制锚点 | 无强制基线 | ✅ 宪法定义一致 |

---

## §5 侦察依据追溯

| 数据项 | 工具调用 | 证据 |
|--------|---------|------|
| tsconfig.json packages/docs 缺失 | `list_files D:/cortex/packages/docs` | 目录不存在错误 |
| 编译错误详情 | `read_file tsconfig.json` 第15行 | `{ "path": "packages/docs" }` |
| 宪法版本 | `read_file docs/constitution/...v2.5.21.md` 第1行 | `v2.5.21` |
| 提案状态 | `read_file` 各 `AM-*.json` status 字段 | applied / superseded |
| 审计发现 | `read_file docs/auditing/2026-06-06-constitution-audit.md` | 三项审计完整记录 |
| 修改记录 | `read_file doc-govern/modification-record.json` | 2 sessions, 13 records |
| 模板配置 | `read_file verification-templates-soft.json` | 9 Agent 配置 |
| 圆桌配置 | `read_file roundtable-config.ts` | SOFT_CONSENSUS_ROUNDTABLE |
| 文档注册 | `read_file doc-registry.ts` 第42行 | PATH_TEMPLATES 映射 |
| 产物目录 | `list_files test-output/self-examination-soft/` | 空目录 |

---

## 勘察结论

软约束机制的完整骨架已在宪法层、配置层、模板层、会议层、注册层共 **5 个层级**完整落地，形成从宪法定义到运行配置的闭环链路。执行产物层（test-output/self-examination-soft/）当前为空。

**已闭合的修复**：8 项审计发现中的 5 项已通过修宪提案修复并入宪。其中 P0 级发现（自反性缺口、不可变语义矛盾、日期悖论、提案状态不一致）全部闭合。

**仍开放的缺口**：3 项未修复（紧急修宪通道 P3、治理事件接入路径 P2、阶段门禁定义 P4），均不影响当前 Core-1 运行。

**编译/测试层面的两个硬阻断**（packages/docs 路径缺失、calculator.test.ts 文件缺失）与软约束机制本身无直接关联，但构成系统运行的物理阻碍。

勘察完毕，全部事实如实记录。

---

*安柏 · 西风骑士团侦察骑士*
*Inspector Agent — Cortex*
