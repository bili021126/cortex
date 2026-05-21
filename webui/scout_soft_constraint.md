# 🗺️ 侦察报告：软约束相关代码段全量清单

**侦察员**：安柏（InspectorAgent）  
**侦察范围**：`packages/` + `docs/`  
**工具调用**：`search_code`（查询关键词：`软约束`、`soft-consensus`、`soft`、`verification-templates-soft`、`self-examination-soft`）+ `read_file` 逐文件确认  
**报告日期**：2026-06-10

---

## §1 宪法层——软约束/硬约束双轨协议

**文件**：`docs/constitution/Cortex 概念顶层设计 v2.5.21.md`  
**章节**：§5.1.1bis（第198-236行）

### §1.1 原则定义（第200行）

> 自审视支持两种约束模式——硬约束（`--hard`，默认）与软约束（`--soft`）。硬约束以现存共识清单为强制基线，逐项验证修复闭合；软约束取消预设清单，Agent 自由探索，从自由发现中驱动共识分类。双轨互补——硬约束防退化，软约束发现盲区。

### §1.2 五维度差异表（第204-209行）

| 维度 | 硬约束（默认） | 软约束（`--soft`） |
|------|--------------|-------------------|
| Phase 0 基线 | 读取上轮共识清单作为强制验证基线 | HCA 预读上轮共识清单仅作参考锚点，不强制对照 |
| Agent 探索方向 | 按 verification-templates.json 预设模板逐项验证 | 按 verification-templates-soft.json 自由探索，无预设待办清单 |
| Phase 5 圆桌注入 | 报告摘要写入 MemoryStore 种子记忆，圆桌 Agent 从 MemoryStore 回溯 | 报告摘要直接拼入 topic 字符串注入，不经过 MemoryStore 中转 |
| 圆桌产出 | 对照清单逐项判定闭合/遗留/新增 | 自由发现经交叉表态→凝光分类收束→P0-P3 共识清单 |
| 共识基线 | 上轮清单为强制锚点——闭合项不得重新列出 | 无强制基线——本轮圆桌产出即为下一轮硬约束的基线 |

### §1.3 归因（第212行）

> 硬约束模式的"逐项对照"能发现"宣称已修复但实际未修"的偏差，但前提是清单本身覆盖了所有已知问题。软约束模式取消预设清单，释放 Agent 的发现自由度——让盲区自己浮现。两者形成闭环：软约束发现新问题→写入共识清单→下一轮硬约束逐项验证。

### §1.4 选择规则（第214行）

默认硬约束。以下场景使用软约束：
1. 首次自审视——无现存清单可对照
2. 怀疑清单本身有盲区——需要自由探索补充发现
3. 架构评估——不适用逐项 checklist 的开放性审视

### §1.5 自审视模式权限例外（§5.1.1，第186-193行）

| 项目 | 常规模式 | 自审视模式（`--soft`） |
|------|---------|----------------------|
| Agent 工具权限 | 宪法 §5.1 表所示 | 临时提升至 `FULL_TOOLSET` |
| 写入路径 | 全局受限 | 硬约束于 `test-output/self-examination-soft/` |
| 源码修改 | 不允许 | 不允许（只读） |
| run_shell | 部分 Agent 无 | 全开放（构建/测试/诊断必需） |

---

## §2 软约束共识圆桌——配置定义

### §2.1 cortex-agents.json（第668-669行）

```json
{
  "name": "soft-consensus",
  "description": "软约束共识",
  "personas": 9,
  "rounds": 1,
  "agents": [
    "刻晴", "甘雨", "纳西妲", "阿贝多", "钟离",
    "北斗", "久岐忍", "艾尔海森", "凝光"
  ]
}
```

- **来源**：`read_file D:/cortex/cortex-agents.json` — roundtableTemplates[2]
- **关键特征**：9 席 Agent，1 轮合并会议（原三轮合并优化），不含 BrowserAgent

### §2.2 roundtable-config.ts——SOFT_CONSENSUS_ROUNDTABLE

**文件**：`packages/engine/tests/manual/config/roundtable-config.ts`  
**变量**：`SOFT_CONSENSUS_ROUNDTABLE`（约第370-480行）

配置要点：
- **name**: `"软约束共识圆桌"`
- **rounds**: 单轮合并（原三轮→一轮，minTurns: 3, maxTurns: 5）
- **发言流程**：第一阶段（第1次发言→每人最多3项关键发现）→ 第二阶段（第2次发言→交叉表态）→ 第三阶段（第3-5次发言→凝光收束产出 P0-P3 清单）
- **queryMode**: `"hca"`（广撒网检索）
- **BrowserAgent 排除**：`.filter((p) => p.type !== AgentType.Browser)`（第480行）

---

## §3 verification-templates-soft.json——软约束探索模板

**文件**：`packages/engine/tests/manual/config/verification-templates-soft.json`

### §3.1 文件元信息（第1行）

```json
{
  "_note": "自审视软约束技能模板。不设具体检查清单——只给方向性指引，让专家凭自己的专业直觉在代码库中自由探索。安全硬约束（只读+受限写入）不变。"
}
```

### §3.2 9 个 Agent 模板清单

| key | 类型 | 标题 | 输出文件 |
|-----|------|------|---------|
| keqing | review | 代码质量深度侦察 | `test-output/self-examination-soft/keqing-quality-recon.md` |
| beidou | ops | 工程就绪性自由诊断 | `test-output/self-examination-soft/beidou-ops-diagnosis.md` |
| nahida | analysis | 架构全景自由分析 | `test-output/self-examination-soft/nahida-architecture-analysis.md` |
| ningguang | doc-govern | 治理合规自由审计 | `test-output/self-examination-soft/ningguang-governance-audit.md` |
| mona | loop | 模式发现与趋势预言 | `test-output/self-examination-soft/mona-pattern-discovery.md` |
| amber | inspector | 全项目变更侦察 | `test-output/self-examination-soft/amber-reconnaissance.md` |
| albedo | code | 核心层深度代码审查 | `test-output/self-examination-soft/albedo-deep-review.md` |
| kuki | api | API 契约设计与规范化 | `test-output/self-examination-soft/kuki-api-design.md` |
| alhaitham | data | 数据模型设计与存储规范 | `test-output/self-examination-soft/alhaitham-data-design.md` |

### §3.3 与硬约束 verification-templates.json 的差异

| 维度 | 硬约束（`verification-templates.json`） | 软约束（`verification-templates-soft.json`） |
|------|--------------------------------------|--------------------------------------------|
| Agent 数 | 7 个 | 9 个（多出 kuki/api + alhaitham/data） |
| 探索风格 | 逐项具体检查（"打开第X行，确认..."） | 方向性指引（"整个 codebase 向你敞开"） |
| 检查项 | 硬编码文件+行号+预期代码 | 开放性步骤（"扫描/审视/评估..."） |
| 输出要求 | 每项输出代码行+判断（✅/⚠️/❌） | "不求全，求准"——自由格式 |
| 输出目录 | `test-output/self-examination/` | `test-output/self-examination-soft/` |

---

## §4 软约束共识圆桌的机制——roundtable-config.ts

**文件**：`packages/engine/tests/manual/config/roundtable-config.ts`

### §4.1 材料清单（MATERIAL_CHECKLIST）

**变量**：`MATERIAL_CHECKLIST`（约第200-275行）

软约束圆桌所需的 8 项材料：

| 材料 | 必需？ | 阶段 |
|------|--------|------|
| Agent 审视报告（7 份） | ✅ required | 第一轮 |
| 共识修复清单（上一轮） | ❌ optional | 第一轮 |
| 根因归簇分析报告 | ✅ required | 第二阶段·无主题 |
| 钟离战略评估报告 | ❌ optional | 第二阶段·无主题 |
| 宪法 v2.5 全文 | ✅ required | 全程参考 |
| Agent 标签词汇表 | ❌ optional | 全程参考 |
| 意图响应体系设计 | ❌ optional | 第三轮 |
| 自由审视摘要 | ❌ optional | 热身 |

### §4.2 共识晋升机制（约第670-720行）

`runMeeting` 中的共识晋升流程：
1. `extractConsensusItems` 从凝光的收束发言中解析 P0-P3 条目
2. 各条写入 Conceptual 记忆（P0 weight=10, P1=8, P2=6, P3=4）
3. 链接 `DerivedFrom`（凝光发言）和 `ConfirmedUseful`（全体参会 Agent 末轮发言）
4. 形成 FSA 闭环

### §4.3 共识校验（validateConsensus + CONFIRMED_CLOSED）

**常量**：`CONFIRMED_CLOSED`（约第165-195行）

13 项已闭合项的校验列表（含 keyword、excludeIf、confirmedBy、description），用于防止已闭合项错误出现在 P0/P1 修复清单中。

---

## §5 软约束执行产物路径

### §5.1 DocRegistry 映射（doc-registry.ts 第42行）

```typescript
const PATH_TEMPLATES: Record<string, string> = {
  // ...
  "self-examination": ".cortex/archive/self-examination-soft",
  // ...
};
```

- **来源**：`read_file D:/cortex/packages/engine/src/registry/doc-registry.ts`

### §5.2 意图响应体系设计中的引用

**文件**：`docs/core/意图响应体系设计.md`（第280-281行）

| 类别 | 材料 | 路径 | 阶段 |
|------|------|------|------|
| **审视报告** | 各 Agent 软约束自由探索报告 | `test-output/self-examination-soft/` | 第一阶段·自由探索 |
| **战略归因** | 钟离战略分析报告 | `test-output/self-examination-soft/zhongli-strategy-assessment.md` | 第一阶段半·归因分析 |

### §5.3 历史执行产物（已归档）

侦察发现以下历史软约束执行产物目录：

- `test-output/archive/self-examination-2026-05-12T15-24-18/self-examination-soft__amber-reconnaissance.md`
- `test-output/archive/self-examination-2026-05-12T15-24-18/self-examination-soft__beidou-ops-diagnosis.md`
- `test-output/archive/self-examination-2026-05-12T15-24-18/self-examination-soft__mona-pattern-discovery.md`
- `test-output/archive/self-examination-2026-05-12T17-14-17/self-examination-soft__kuki-api-design.md`
- `test-output/archive/self-examination-2026-05-12T17-14-17/self-examination-soft__ningguang-governance-audit.md`
- `test-output/archive/self-examination-2026-05-13T11-29-50/self-examination-soft__amber-reconnaissance.md`
- `test-output/archive/self-examination-2026-05-13T11-29-50/self-examination-soft__ningguang-governance-audit.md`
- `test-output/archive/self-examination-2026-05-13T12-16-45/self-examination-soft__alhaitham-data-design.md`

---

## §6 test-doc-registry.ts 中的软约束记录

**文件**：`scripts/test-doc-registry.ts`（第33行）

```typescript
const consensus = await registry.register({
  type: "consensus",
  title: "软约束共识-记忆系统架构审视",
  content: [/* P0-P3 清单内容 */],
  authors: ["刻晴", "纳西妲", "凝光"],
  committeeType: "ad-hoc",
  triggerSource: "user",
});
```

- **来源**：`read_file D:/cortex/scripts/test-doc-registry.ts`
- **作用**：DocRegistry E2E 验证脚本，注册一条软约束共识作为测试数据

---

## §7 宪法修正记录中的软约束相关变更

**文件**：`docs/constitution/Cortex 概念顶层设计 v2.5.21.md`  
**章节**：§十五 宪法修正记录

| 版本 | 软约束相关变更 |
|------|---------------|
| v2.4 → v2.5 | 新增自审视模式权限例外——写入硬约束于 `test-output/self-examination-soft/` |
| v2.5.5 → v2.5.6 | §5.1.1bis 软约束/硬约束双轨协议入宪——5 维度差异表；ApiAgent/DataAgent 升级参与软约束自审视；单轮合并优化入宪 |

---

## 侦察结论

以上为软约束机制在项目中的全量代码段清单。共定位 **6 个层级的代码/配置**：

1. ✅ **宪法层**：§5.1.1bis 双轨协议 + §5.1.1 权限例外
2. ✅ **Agent 配置层**：`cortex-agents.json` soft-consensus 圆桌模板
3. ✅ **验证模板层**：`verification-templates-soft.json` 9 Agent 探索指引
4. ✅ **会议配置层**：`roundtable-config.ts` SOFT_CONSENSUS_ROUNDTABLE + MATERIAL_CHECKLIST
5. ✅ **文档注册层**：`doc-registry.ts` self-examination 路径映射
6. ✅ **执行产物层**：`test-output/self-examination-soft/` + 归档历史

勘察完毕，全部事实如实记录。
