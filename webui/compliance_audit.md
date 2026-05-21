# ⚖️ 凝光合规审计报告：软约束实现与架构宪法一致性审计

**审计人**：凝光（DocGovernAgent）  
**审计日期**：2026-06-10  
**审计范围**：软约束机制（宪法 §5.1.1、§5.1.1bis、§5.1.2）实现与架构宪法 v2.5.21 的一致性  
**审计依据**：
- `docs/constitution/Cortex 概念顶层设计 v2.5.21.md`（宪法全文）
- `packages/engine/tests/manual/config/roundtable-config.ts`
- `packages/engine/tests/manual/config/verification-templates-soft.json`
- `packages/engine/tests/manual/config/verification-templates.json`
- `packages/engine/tests/manual/config/persona-prompts.json`
- `packages/engine/tests/manual/scripts/cortex-self-examination.ts`
- `packages/engine/tests/manual/scripts/run-soft-consensus-roundtable.ts`
- `cortex-agents.json`
- `packages/engine/src/registry/doc-registry.ts`
- `webui/scout_soft_constraint.md`（安柏侦察报告）

---

## 裁定概述

本次审计对软约束机制的宪法合规性进行全量审查。共发现 **7 项违规**，其中 **P1 级 1 项**、**P2 级 3 项**、**P3 级 3 项**。另附 **2 项合规确认**。

---

## 违规项明细

---

### 🔴 P1-001：Phase 5 圆桌注入方式违反宪法（run-soft-consensus-roundtable.ts）

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1bis 五维度差异表——软约束「Phase 5 圆桌注入」：「报告摘要直接拼入 topic 字符串注入，不经过 MemoryStore 中转」 |
| **违规文件** | `packages/engine/tests/manual/scripts/run-soft-consensus-roundtable.ts` |
| **违规代码** | 第 71-122 行：构建 `seedMemories` 数组并通过 `memory.write()` 写入 MemoryStore；第 128 行：调用 `runMeeting(SOFT_CONSENSUS_ROUNDTABLE, adapter, CHAT_MODEL, DB_DIR, CONSENSUS_OUTPUT, seedMemories)` 将 seedMemories 传入 runMeeting——runMeeting 内部将 seedMemories 通过 `memory.write()` 持久化到 MemoryStore |
| **违规描述** | 宪法明确规定软约束模式下报告摘要应「直接拼入 topic 字符串，不经过 MemoryStore 中转」。但 `run-soft-consensus-roundtable.ts` 将报告摘要构建为 `SeedMemory` 对象，通过 `memory.write()` 写入 MemoryStore，违反了宪法规定的注入路径。 |
| **判例对照** | `cortex-self-examination.ts` 第 1050-1090 行正确实现了宪法要求——将报告摘要直接拼入 `enrichedTopic` 字符串，未传 seedMemories。此判例证明合规实现是可行的。 |
| **建议** | 移除 `seedMemories` 构建逻辑，改为将报告摘要拼入 `SOFT_CONSENSUS_ROUNDTABLE.rounds[0].topic`（参考 `cortex-self-examination.ts` 的实现方式）。 |

---

### 🟠 P2-001：SOFT_CONSENSUS_ROUNDTABLE background 入席人数声明不实

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.2 单轮合并优化：「入席者 12 人（刻晴/阿贝多/纳西妲/凝光/莫娜/安柏/北斗/久岐忍/艾尔海森/甘雨/托马/钟离）」 |
| **违规文件** | `packages/engine/tests/manual/config/roundtable-config.ts` |
| **违规代码** | `SOFT_CONSENSUS_ROUNDTABLE.background`（约第 390 行）：「9 位 Agent 全体入席」 |
| **违规描述** | 宪法规定入席者 12 人。`buildPersonas(personaPrompts).filter(p => p.type !== AgentType.Browser)` 实际生成 12 个 Persona，与宪法一致。但 background 文字声明「9 位 Agent」，与宪法和实际实现均不一致。 |
| **建议** | 将 `SOFT_CONSENSUS_ROUNDTABLE.background` 中的「9 位 Agent 全体入席」更正为「12 位 Agent 全体入席」，并列出入席者名单。 |

---

### 🟠 P2-002：cortex-agents.json soft-consensus 模板入席者列表不完整

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.2 单轮合并优化：「入席者 12 人（刻晴/阿贝多/纳西妲/凝光/莫娜/安柏/北斗/久岐忍/艾尔海森/甘雨/托马/钟离）」 |
| **违规文件** | `cortex-agents.json` |
| **违规代码** | `roundtableTemplates[2].agents`（第 668-669 行）：`["刻晴", "甘雨", "纳西妲", "阿贝多", "钟离", "北斗", "久岐忍", "艾尔海森", "凝光"]`（9 人） |
| **违规描述** | cortex-agents.json 的 soft-consensus 圆桌模板只列出 9 位 Agent，缺少莫娜（LoopAgent）、安柏（InspectorAgent）、托马（ButlerAgent）。宪法规定入席者 12 人，实际代码配置与宪法不一致。 |
| **建议** | 将 cortex-agents.json 的 soft-consensus 模板 agents 列表补充为 12 人，增加「莫娜」「安柏」「托马」。 |

---

### 🟠 P2-003：DocRegistry 软约束归档路径与宪法不一致

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1 自审视模式权限例外——写入路径「硬约束于 `test-output/self-examination-soft/`」 |
| **违规文件** | `packages/engine/src/registry/doc-registry.ts` |
| **违规代码** | 第 42 行：`"self-examination": ".cortex/archive/self-examination-soft"` |
| **违规描述** | 宪法规定软约束写入路径硬约束于 `test-output/self-examination-soft/`。但 DocRegistry 的 PATH_TEMPLATES 将 `self-examination` 类型映射到 `.cortex/archive/self-examination-soft`，与宪法规定的路径不一致。 |
| **关联说明** | 当前自审视脚本直接写入 `test-output/self-examination-soft/`，未通过 DocRegistry 注册。此路径映射可能为 DocRegistry 未来集成预留，但当前值与宪法规定不符。若 DocRegistry 用于归档，路径应反映宪法规定的源路径。 |
| **建议** | 将 PATH_TEMPLATES 中的 `self-examination` 路径更新为 `test-output/self-examination-soft`，或添加注释说明此路径为归档副本而非源路径。 |

---

### 🟡 P3-001：MATERIAL_CHECKLIST 宪法引用版本和路径过时

| 维度 | 内容 |
|------|------|
| **违规文件** | `packages/engine/tests/manual/config/roundtable-config.ts` |
| **违规代码** | `MATERIAL_CHECKLIST.items[4]`：`name: "宪法 v2.5 全文"`，`filePath: "docs/Cortex 概念顶层设计 v2.5.md"` |
| **违规描述** | 材料清单引用「宪法 v2.5 全文」，路径为 `docs/Cortex 概念顶层设计 v2.5.md`。但当前宪法版本为 **v2.5.21**，且位于 `docs/constitution/Cortex 概念顶层设计 v2.5.21.md`。版本号落后 21 个修订版，路径缺少 `constitution/` 子目录。此材料为圆桌会议必需材料（required: true）——引用过时路径可能导致 Agent 无法找到正确版本的宪法。 |
| **建议** | 更新为 `name: "宪法 v2.5.21 全文"`，`filePath: "docs/constitution/Cortex 概念顶层设计 v2.5.21.md"`，并同步更新 `MATERIAL_CHECKLIST.version` 和 `updatedAt`。 |

---

### 🟡 P3-002：软约束 Phase 0 HCA 预读被跳过

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1bis 五维度差异表——软约束「Phase 0 基线」：「HCA 预读上轮共识清单仅作参考锚点，不强制对照」 |
| **违规文件** | `packages/engine/tests/manual/scripts/cortex-self-examination.ts` |
| **违规代码** | 第 600 行附近：`SOFT_MODE` 下直接输出「软约束模式——跳过共识基线预读，各 Agent 自由探索」 |
| **违规描述** | 宪法规定软约束模式仍应进行 HCA 预读上轮共识清单——仅作为参考锚点，不强制对照。但当前实现完全跳过预读阶段。虽然软约束强调「自由探索」，但宪法要求「预读作为参考锚点」不应被省略——尤其是存在历史共识清单时，预读可防止 Agent 重复发现已闭合项。 |
| **建议** | 在 SOFT_MODE 下增加 HCA 预读逻辑：读取上一轮共识修复清单中的 ✅ 已闭合项，写入甘雨的规划上下文作为「背景参考」而非「强制基线」。 |

---

### 🟡 P3-003：run-soft-consensus-roundtable.ts 内部术语混淆

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1bis ——明确定义「软约束（`--soft`）」与「硬约束（`--hard`）」双轨 |
| **违规文件** | `packages/engine/tests/manual/scripts/run-soft-consensus-roundtable.ts` |
| **违规代码** | 第 4 行注释：「仅运行 Phase 5——硬约束共识圆桌」；第 48 行 console 输出：「🟢 硬约束共识圆桌启动...」 |
| **违规描述** | 脚本名称 `run-soft-consensus-roundtable.ts` 表明其为「软约束共识圆桌」，但内部注释和输出将其称为「硬约束共识圆桌」。根据宪法，软约束圆桌（SOFT_CONSENSUS_ROUNDTABLE）与硬约束验证（verification-templates.json）是不同概念。术语混淆会导致维护者误解脚本用途。 |
| **建议** | 将注释和输出中的「硬约束共识圆桌」更正为「软约束共识圆桌」。 |

---

## ✅ 合规确认

以下关键合规点经核查确认与宪法一致，无违规：

### ✅ 合规确认 1：verification-templates-soft.json 探索风格符合宪法

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1bis——软约束「Agent 探索方向」：「按 verification-templates-soft.json 自由探索，无预设待办清单」 |
| **验证结果** | ✅ `verification-templates-soft.json` 为 9 位 Agent 提供的是方向性指引（「扫描 engine/src/ 下你认为最关键的模块」），而非硬编码的逐行检查清单。与硬约束 `verification-templates.json`（「打开第 X 行，确认 Y 模式」）形成明确区分。符合宪法规定的双轨差异。 |

### ✅ 合规确认 2：软约束模式工具权限符合自审视例外

| 维度 | 内容 |
|------|------|
| **宪法条款** | §5.1.1——自审视模式权限例外：工具权限提升至 FULL_TOOLSET，run_shell 全开放，写入硬约束于 `test-output/self-examination-soft/` |
| **验证结果** | ✅ `cortex-self-examination.ts` 在 `SOFT_MODE=true` 时注册真实 `run_shell` 和 `delete_file` 工具，写入路径限制在 `test-output/self-examination-soft/`，源码修改禁止。符合宪法规定的自审视权限例外。 |

---

## 审计闭环信息

| 项目 | 内容 |
|------|------|
| **判例 ID** | NG-2026-0610-SoftConstraint-Compliance |
| **判例有效期** | P1 违规有效期至修复提案生效；P2/P3 违规有效期 180 天（至 2026-12-07） |
| **整改责任人** | 开拓者（用户）/ 凝光（DocGovernAgent） |
| **门禁影响** | P1-001 为 P1 违规，须在阶段门禁检查表中登记为「已知未关闭项」；P2/P3 违规不阻塞门禁，须在门禁结论中注明 |

### 整改建议优先级

1. **P1-001**（Phase 5 注入违规）→ 优先修复，参照 `cortex-self-examination.ts` 的实现方式
2. **P2-001**（background 声明不实）+ **P2-002**（cortex-agents.json 缺失）→ 同步修复，统一入席者名单
3. **P2-003**（DocRegistry 路径）→ 确认归档策略后更新路径
4. **P3-001~003** → 依次修复，建议与上述修复同一批次完成

---

*天权定论，不得上诉。本判决书归档至 MemoryType.Governance 分区。*
