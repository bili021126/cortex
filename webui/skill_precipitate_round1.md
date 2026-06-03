# 🌊 莫娜·梅姬斯图斯 — 水镜沉淀·第一轮

> **沉淀日期**：2026-07-23  
> **数据源**：宪法审计报告（2026-06-06 ~ 2026-07-15） + 修宪提案（18 份 AM-*.json）+ 交叉验证报告 + 软约束分析  
> **水镜追溯范围**：`docs/amendments/` · `webui/constitution_audit*.md` · `webui/constitution_review.md` · `webui/soft_constraint_analysis.md` · `webui/soft_constraint_review.md` · `docs/auditing/` · `webui/amendment_proposal.json`  
> **方法**：每道波纹至少出现两次才算模式，三次提笔

---

## 零、水镜总览

我从宪法审计报告与修宪提案的回响中，照见了 **6 大类、16 种可复用模式**。其中 11 种出现 ≥3 次（值得提笔），5 种出现 ≥2 次（值得记录）。

按领域分类：

| 领域 | 模式数 | 已提笔（≥3次） | 已记录（≥2次） |
|:----|:-----:|:--------------:|:--------------:|
| 🔍 宪法审计 | 5 | 5 | 0 |
| 📜 修宪提案 | 4 | 3 | 1 |
| 🧹 数据一致性 | 3 | 1 | 2 |
| ⚙️ 治理基建 | 4 | 2 | 2 |

---

## 一、🔍 宪法审计模式

### 1.1 宪法全量审计（出现 **7 次** — ⭐ 最高频）

**水镜轨迹**：
- 2026-06-06 凝光三项审计（v2.5.12）
- 2026-06-07 凝光审计（v2.5.14 条款一致性）
- 2026-06-10 凝光审计（v2.5.14 未闭合缺口）
- 2026-06-11 凝光审计（v2.5.21）
- 2026-06-12 玉衡审计（v2.5.21）
- 2026-07-07 凝光治理缺口审计
- 2026-07-08 凝光全量治理审计
- 2026-07-15 玉衡全量治理审计

**模式内核**：每一轮全量审计都聚焦三个维度——原则七子约束闭环完整性、条款间一致性、治理层整体合规性。产出格式高度一致。

```json
{
  "id": "skill-constitution-full-audit-v2",
  "agentType": "doc-govern",
  "name": "宪法全量审计（三焦点模式）",
  "triggerTags": ["doc_govern", "audit", "constitution_check"],
  "trigger": "需要对宪法 vX.Y.Z 进行全量合规性审计时触发。三焦点：原则七子约束闭环完整性、条款间一致性（版本头/提案状态/日期/语义）、治理层整体合规性（审计闭环/回退机制/提案生命周期）。",
  "steps": [
    "用 read_file 读取宪法文件头部，获取版本号、版本演进链、前置审计记录",
    "焦点一——原则七子约束闭环完整性：用 search_code 搜索 '子约束' 检查计数一致性（六项/七项矛盾检测），搜索子约束7文本检查是否排除自身的二阶自反性缺口，检查是否显式声明继承子约束3（最小改动）和子约束6（阶段限定）",
    "焦点二——条款间一致性：用 read_file 读取版本头，逐版本核对提案日期是否早于应用日期（日期悖论检测）；用 list_files 列出 docs/amendments/ 目录，读每个 JSON 文件 status 字段，核对物理入宪状态与提案状态是否一致（proposed vs applied）；用 search_code 搜索 '不可变' 检查原则表是否引用已定义的脚注/声明",
    "焦点三——治理层合规性：用 read_file 读取 §10 治理层，检查审计闭环条款是否存在（5环节）；用 read_file 读取 §8.2 通知管线，检查 DECISION_REQUIRED 回退机制四层安全阀是否完整；用 list_files 统计 docs/amendments/ 中 status=proposed 的提案数量（提案堆积检测）",
    "交叉验证：用 read_file 读取上轮审计报告（webui/constitution_audit.md 或 docs/auditing/），对比上轮发现的修复状态，标记已闭合/未闭合/修复引入的衍生问题",
    "用 read_file 读取治理层设计文档（docs/core/治理层设计.md），核对宪法声明与实际实现状态的一致性（超前/滞后/匹配标注）",
    "输出审计报告：审计声明 → 三焦点逐项检查表（🔴🟡🟢等级）→ 发现详情（含代码实证/宪法引用/影响评估）→ 综合裁定 → 缺口总览表 → 优先级排序 → 修宪行动建议"
  ],
  "expectedOutput": "Markdown 审计报告：审计声明 → 三焦点检查表 → 发现详情（代码实证+宪法引用）→ 裁定 → 缺口总览表 → 优先级排序 → 行动建议",
  "outputFile": "docs/auditing/{date}-constitution-v{version}-full-audit.md",
  "status": "proven",
  "adoptionCount": 7,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384020
}
```

---

### 1.2 审计交叉验证/独立复核（出现 **4 次** — ⭐⭐⭐）

**水镜轨迹**：
- AM-2025-0606-001-review.md（交叉验证审计发现 vs 修宪提案 vs 宪法原文 vs 判例记录）
- constitution_review.md（久岐忍交叉复核）
- soft_constraint_review.md（纳西妲审查）
- 玉衡审计中对凝光审计的独立复核

**模式内核**：审计报告完成后必须经过第二/第三视角的独立复核。核心方法论为「三重过滤法」——闭环验证、三轨互补性实测、治理缺口趋势判断。

```json
{
  "id": "skill-audit-cross-validation-trifilter",
  "agentType": "review",
  "name": "审计交叉验证·三重过滤法",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "宪法审计报告产出后需要独立第二/第三视角复核时触发。适用于任意审计周期收尾阶段，或对同一宪法版本的多次审计结论进行融合验证。",
  "steps": [
    "用 read_file 读取前置审计报告，提取所有审计发现的编号、等级、涉及条款、修复建议",
    "用 list_files 列出 docs/amendments/ 目录，读取所有 status!=rejected 的提案文件，核对提案内容与审计发现的对应关系",
    "用 read_file 读取宪法 vX.Y.Z 实际文本，逐条核对待修复发现是否已物理入宪",
    "第一层过滤——闭环验证：对每个审计发现，检查发现→提案→修复→验证的完整链路是否存在断点。标记断点：无提案覆盖/已提案未裁决/已裁决未入宪/已入宪未验证",
    "第二层过滤——三轨互补性实测：从'审计发现→修宪提案→DECISION_REQUIRED 事件→用户裁决→宪法更新'的端到端路径检查事件管道断点（治理事件是否 emit、通知管线是否接入、ButlerAgent 是否分发）",
    "第三层过滤——治理趋势判断：统计过往 N 轮审计的发现数、修复率、闭合率，计算流转率 = 已闭合发现数 / 总发现数。标记趋势方向：自我修复（流转率上升）vs 恶性循环（流转率下降或发现数持续增长）",
    "输出验证报告：方法论声明 → 前置档案查阅摘要 → 每层过滤发现（等级标记）→ 各层裁定 → 综合缺口总览 → 治理健康度趋势判断"
  ],
  "expectedOutput": "Markdown 交叉验证报告：三重过滤各层发现、闭合率统计、治理健康度趋势判断",
  "outputFile": "webui/constitution_review_{version}.md",
  "status": "proven",
  "adoptionCount": 4,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384021
}
```

---

### 1.3 审计发现→提案→修复全链路追踪（出现 **5 次** — ⭐⭐）

**水镜轨迹**：
- 凝光 2026-06-06 审计后发现→提案映射
- 凝光 2026-06-10 闭合审计的追踪矩阵
- 玉衡 2026-06-12 审计的追踪表
- 凝光 2026-07-08 全量审计的追踪
- 玉衡 2026-07-15 全量审计的追踪

**模式内核**：建立从审计发现到修宪提案到实际修复的追踪矩阵，识别幽灵提案、重复提案、状态异常。

```json
{
  "id": "skill-finding-proposal-fix-tracking-matrix",
  "agentType": "doc-govern",
  "name": "审计发现→提案→修复追踪矩阵",
  "triggerTags": ["doc_govern", "audit", "inspect", "tracking"],
  "trigger": "审计报告包含多个发现，需要系统性地映射每个发现是否有提案覆盖、提案状态、修复进度时触发。适用于审计收尾阶段或治理健康度普查。",
  "steps": [
    "用 read_file 读取审计报告，提取所有发现的编号（如 发现1/2-A/3-B）、描述、首次发现人、等级（P0/P1/P2/P3）",
    "用 list_files 列出 docs/amendments/ 目录，读取每个 JSON 提案文件，提取 id/status/summary/supersedes/source.trace",
    "建立双向映射矩阵：(a) 每个发现被哪些提案覆盖；(b) 每个提案修复了哪些发现",
    "对每个发现的修复状态标注：✓ 有已裁决提案且已入宪 / ⏳ 有提案待裁决 / ❌ 无提案覆盖 / ⚠️ 有提案但已 superseded 无替代",
    "检测异常模式：重复提案（同一发现多份提案互不引用）、幽灵提案（status=proposed 但物理内容已入宪）、状态非法（status 值不在 AmendmentStatus 类型定义中）",
    "用 read_file 读取宪法 §15 修正记录表，核对已 applied 提案是否在修正记录中有对应条目",
    "输出追踪表头：发现编号 | 描述 | 首次发现日期 | 等级 | 覆盖提案 | 提案状态 | 修复进度 | 备注",
    "附：全部提案一览表（按提案编号排序，含生成时间、状态、等待时长、supersedes 链）"
  ],
  "expectedOutput": "Markdown 追踪矩阵表：发现→提案→修复三态映射 + 异常检测结果 + 全部提案状态一览",
  "outputFile": "docs/auditing/{date}-finding-tracking-matrix.md",
  "status": "proven",
  "adoptionCount": 5,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384022
}
```

---

### 1.4 宪法缺口根系扫描/依赖链分析（出现 **3 次** — ⭐）

**水镜轨迹**：
- constitution_impact.md（缺口依赖链分析）
- soft_constraint_analysis.md 中的根系分析
- 玉衡 2026-07-15 中的依赖链推导

**模式内核**：多个缺口之间的依赖关系分析，识别结构性断点和根系瓶颈。判断哪些是表面缺口、哪些是结构性断点。

```json
{
  "id": "skill-gap-dependency-root-scan",
  "agentType": "analysis",
  "name": "宪法缺口根系扫描（依赖链分析）",
  "triggerTags": ["analysis", "research", "audit", "pattern_scan"],
  "trigger": "审计发现多个宪法缺口，需要分析缺口之间的依赖关系、阻塞链和根系传导路径时触发。适用于有多轮审计历史（3+轮）的治理系统健康度诊断。",
  "steps": [
    "用 read_file 读取最新审计报告，提取所有缺口编号、等级、涉及宪法条款",
    "用 read_file 读取宪法 vX.Y.Z 全文，标注每个缺口的实际条款位置和相邻条款",
    "用 read_file 读取治理层设计文档（docs/core/治理层设计.md），核对缺口与治理基础设施的关联（审计闭环/回退机制/事件管道/门禁）",
    "用 search_code 搜索代码层实现文件（packages/engine/src/governance/、packages/shared/src/），检查缺口对应的代码实现状态：✅已实现/❌缺失/⚠️部分实现",
    "为每个缺口建立三态标注：宪法层状态（已修复/已提案/无提案）→ 代码层状态（已实现/缺失/部分实现）→ 实际阻塞影响（阻塞 Core-2 / 阻塞治理闭环 / 无阻塞）",
    "绘制依赖链图：从 Core-2 交付物（如常设委员会、监理、ContractEnforcer）反向推导依赖的治理基础设施 → 再到宪法层缺口 → 再到代码层缺口",
    "识别结构性瓶颈：入度 > 1 的缺口标记为 🔴 瓶颈节点（多个依赖链的共同阻塞点），入度 = 0 的缺口标记为 🟢 孤立节点（不影响其他修复）",
    "分三层输出：UI 层（Core-2 交付物）→ 治理基础设施层（审计闭环/事件管道/回退机制）→ 宪法层缺口 → 代码层基础设施缺失，逐层标注依赖箭头和阻塞关系",
    "输出报告：一句话结论 → 依赖链图（文本版 ASCII）→ 逐项根系分析（含代码层实证）→ 修复排序建议（按依赖链拓扑顺序）"
  ],
  "expectedOutput": "Markdown 根系分析报告：依赖链图（ASCII）、逐项分析（宪法层/代码层/架构影响/关联组件）、拓扑排序修复建议",
  "outputFile": "webui/constitution_impact_{version}.md",
  "status": "trial",
  "adoptionCount": 3,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384023
}
```

---

### 1.5 原则七逐条合规审计（出现 **5 次** — ⭐⭐）

**水镜轨迹**：
- principle7-audit.md（原则七六项子约束逐条审计）
- 凝光 2026-06-06 三项审计中的原则七审计
- 凝光 2026-06-10 的子约束闭环验证
- 玉衡 2026-06-12 的子约束边界扫描
- 玉衡 2026-07-15 的子约束7(e)保护范围修正

**模式内核**：对原则七的每项子约束做逐条合规性审计，含子约束1-7（后来扩展为9项）的逐条检查。

```json
{
  "id": "skill-principle7-subconstraint-compliance-audit",
  "agentType": "review",
  "name": "原则七逐条合规审计（含边界条件扫描）",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "需要对设计文档、代码变更或修宪提案进行原则七（系统自我修改约束）的全部子约束合规性审计时触发。每次修宪提案入宪前必须执行。适用于新提案的入宪前审计或定期合规复查。",
  "steps": [
    "用 read_file 读取宪法 §2 原则七部分，获取当前全部子约束（含子约束8/9如已入宪）文本",
    "逐条审计子约束1（宪法依据）：检查审计对象是否显式引用目标宪法条款（section字段完整、before/after精确）",
    "逐条审计子约束2（完整修改记录）：检查是否有结构化 Schema 覆盖事实锚点/类型枚举/会话隔离，检查 status 字段值是否合法",
    "逐条审计子约束3（最小改动）：检查 before/after diff 是否精确到行级，排除顺手重构或扩大范围",
    "逐条审计子约束4（架构保护）：检查是否破坏现有接口契约、引入循环依赖、违反状态机规则、breaking 标记是否准确",
    "逐条审计子约束5（独立审计）：检查审计角色是否独立（凝光审计≠昔涟评判≠开拓者裁决），检查审计记录是否持久化到 DocGovern 分区",
    "逐条审计子约束6（阶段限定）：检查修改范围是否在当前激活阶段内，是否跨阶段预埋",
    "逐条审计子约束7（子约束修改规则）：如审计对象为子约束修改，检查是否满足(a)-(e)五个条件——(a)section标记、(b)双重把关、(c)开拓者亲裁、(d)版本链更新、(e)保护力度不降低",
    "如果子约束8（最小基数）存在：检查提案是否将子约束列表清空至0项",
    "如果子约束9（并发冲突）存在：检查同一阶段是否有另一提案修改同一章节/同一子约束",
    "边界条件扫描（玉衡六维扩展）：空数组场景（子约束列表为空）、并发修改场景（多提案同时修改）、递归自引用场景（修改子约束7自身是否遵守子约束7(a)-(e)）",
    "输出审计报告：总览表（每项约束 ✅/⚠️/❌）→ 逐条审计详情（含实证/风险点/裁定）→ 边界条件扫描结果 → 修复建议"
  ],
  "expectedOutput": "Markdown 逐条审计报告：总览表 → 逐条详情（实证+风险点+裁定）→ 边界条件扫描 → 修复建议",
  "outputFile": "test-output/audits/principle7-audit_{date}.md",
  "status": "proven",
  "adoptionCount": 5,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384024
}
```

---

## 二、📜 修宪提案模式

### 2.1 修宪提案状态一致性检测（出现 **6 次** — ⭐⭐⭐）

**水镜轨迹**：
- 发现2/发现3（凝光 2026-06-07）：AM-2026-0606-001/004 状态 proposed 但已入宪
- 发现8（凝光 2026-06-10）：提案堆积检测
- 发现2/发现3（玉衡 2026-06-12）：同问题再次确认
- 发现1（凝光 2026-07-08）：AM-2026-0612-001 状态字段非法值
- 玉衡 2026-07-15：AM-2026-0612-001 被 supersede 后状态追踪

**模式内核**：提案 JSON 的 status 字段必须与宪法物理状态一致。检测点——已入宪但 status=proposed、状态值非法、提案文件残留。

```json
{
  "id": "skill-amendment-status-consistency-scan",
  "agentType": "doc-govern",
  "name": "修宪提案状态一致性扫描",
  "triggerTags": ["doc_govern", "audit", "inspect", "tracking"],
  "trigger": "需要系统性检查所有修宪提案的状态与实际宪法内容一致性时触发。周期性治理健康度检查任务（建议每轮审计启动时执行）。",
  "steps": [
    "用 list_files 列出 docs/amendments/ 目录，获取所有 AM-*.json 文件列表",
    "用 read_file 逐个读取提案文件，提取 id/status/section/before/after/version",
    "用 search_code 搜索宪法 §15 修正记录表，核对已 applied 提案是否在修正记录中有对应条目",
    "用 search_code 搜索宪法全文，检查 status=applied 的提案的 before/after 内容是否实际存在于宪法中",
    "检测第一类异常——幽灵提案：status=proposed 但提案的 'after' 内容已存在于宪法文本中（表明内容已被手动写入但状态未更新）",
    "检测第二类异常——状态非法：status 字段的值不在 AmendmentStatus 类型中（合法值：pending_judgment | applied | superseded | rejected）",
    "检测第三类异常——版本断层：status=applied 的提案的 version 在宪法版本头中找不到对应版本",
    "检测第四类异常——提案堆积：status=pending_judgment 的提案等待 > 30 天（超时失效阈值）",
    "输出扫描报告：总览（正常 N 项 / 异常 M 项）→ 逐项异常详情（含异常类型、证据、影响等级）→ 修复建议"
  ],
  "expectedOutput": "Markdown 扫描报告：提案状态总览、异常检测结果（幽灵提案/状态非法/版本断层/提案堆积）、修复建议",
  "outputFile": "docs/auditing/{date}-amendment-status-scan.md",
  "status": "proven",
  "adoptionCount": 6,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384025
}
```

---

### 2.2 宪法版本头日期悖论检测（出现 **4 次** — ⭐⭐）

**水镜轨迹**：
- 发现4（凝光 2026-06-07）：v2.5.13/v2.5.14 日期悖论
- 发现3（凝光 2026-06-10）：同问题再次确认
- 发现3（玉衡 2026-06-12）：同问题第三次确认
- 玉衡 2026-07-15：版本号断层检测（v2.5.22 无修正记录）

**模式内核**：版本头中的应用日期必须 ≥ 提案日期。检测 copy-paste 导致的日期一致性问题。

```json
{
  "id": "skill-version-header-date-paradox-detection",
  "agentType": "doc-govern",
  "name": "版本头日期悖论检测与版本连续性校验",
  "triggerTags": ["doc_govern", "audit", "inspect"],
  "trigger": "需要对宪法版本头的日期一致性和版本连续性进行系统性检查时触发。每轮宪法审计的必做前置步骤。",
  "steps": [
    "用 read_file 读取宪法文件头部版本演进链段落，提取每个版本（v2.5.X→v2.5.Y）的版本号、关联提案编号（AM-*）、应用日期",
    "用 list_files 列出 docs/amendments/ 目录，读取每个提案 JSON 文件，提取 id 和编号中的日期（AM-YYYYMMDD-*中的 YYYYMMDD）",
    "对比检验：每个版本的应用日期 ≥ 其关联提案的提案日期。若应用日期早于提案日期，标记为 🔴 日期悖论",
    "检测系统性日期错误：检查是否所有版本的日期完全相同（如全部设为同一日期），表明 copy-paste 错误",
    "用 search_code 搜索 §15 宪法修正记录表，提取所有登记条目的版本号和日期",
    "验证版本连续性：版本头中的版本演进序列在 §15 修正记录表中应有完整对应。缺失的版本号标记为 🔴 版本断层",
    "验证版本号单调递增性：检测版本演进链中是否存在跳号或回退（如 v2.5.20→v2.5.22 缺少 v2.5.21）",
    "输出检测报告：版本演进链全景图（含每个版本的提案/日期/来源）→ 悖论检测结果 → 断层检测结果 → 修复建议"
  ],
  "expectedOutput": "Markdown 检测报告：版本演进全景图、日期悖论清单、版本断层清单、修复建议",
  "outputFile": "docs/auditing/{date}-version-header-audit.md",
  "status": "proven",
  "adoptionCount": 4,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384026
}
```

---

### 2.3 "不可变"语义定义歧义检测（出现 **3 次** — ⭐）

**水镜轨迹**：
- 发现1（凝光 2026-06-07）：原则七「不可变」语义未定义
- 发现1（玉衡 2026-06-12）：同问题的六维审查深化
- 发现1/发现12（玉衡 2026-07-15）：原则一至原则六「不可变」也未定义，脚注¹与子约束7(e)保护范围不一致

**模式内核**：当宪法使用关键术语（如"不可变"）时，必须明确定义其精确语义范围。检测语义模糊性、跨术语不一致、保护范围缺口。

```json
{
  "id": "skill-constitutional-term-ambiguity-detection",
  "agentType": "review",
  "name": "宪法关键术语语义模糊性检测",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "需要在宪法中发现语义未定义或定义不一致的关键术语时触发。特别适用于「不可变」「监理」「原则 vs 规则」等跨章节复用的术语。适用于宪法审计的条款一致性检查环节。",
  "steps": [
    "用 search_code 搜索宪法中所有被标记为关键性质的术语（如「不可变」「必须」「不得」「永久」），列出所有出现位置",
    "对每个术语，用 read_file 读取其所在章节的上下文，判断是否有显式定义（如脚注、术语表、声明段落）",
    "检测第一类异常——未定义：术语出现 ≥ 2 次但宪法中无任何章节定义其精确语义",
    "检测第二类异常——定义不一致：同一术语在不同章节的语义范围不一致（如「不可变」在原则表 vs 子约束7(e)中的语义冲突）",
    "检测第三类异常——保护范围缺口：定义声明了某保护范围但实际覆盖不完整（如子约束7(e)仅覆盖「新增子约束」但未覆盖「修改现有子约束」）",
    "检测第四类异常——引用链断裂：定义段落引用了某条款作为依据，但被引条款的语义与定义不一致（如脚注¹引用子约束7(e)但子约束7(e)的覆盖范围窄于脚注¹的声明）",
    "输出检测报告：术语清单 → 每项未定义/定义不一致/保护范围缺口/引用链断裂的详情（含等级标记）→ 修复建议（含措辞建议和引用修正）"
  ],
  "expectedOutput": "Markdown 检测报告：关键术语全景、语义模糊项清单（等级标记）、修复建议（含措辞修正）",
  "outputFile": "docs/auditing/{date}-term-ambiguity-audit.md",
  "status": "trial",
  "adoptionCount": 3,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384027
}
```

---

### 2.4 修宪提案超期/堆积治理审计（出现 **3 次** — ⭐）

**水镜轨迹**：
- 发现9（凝光 2026-06-07）：三份提案堆积
- 发现8（玉衡 2026-06-12）：五份提案堆积
- 发现8（凝光 2026-07-08）：提案堆积检测 + 超时失效机制缺失

**模式内核**：治理管线阻塞检测——统计 pending_judgment 提案数、等待时长、依赖链阻塞风险。

```json
{
  "id": "skill-governance-pipeline-congestion-audit",
  "agentType": "doc-govern",
  "name": "治理管线阻塞审计（提案堆积/超期检测）",
  "triggerTags": ["doc_govern", "audit", "tracking"],
  "trigger": "需要评估治理管线健康度时触发。检测 pending_judgment 提案是否堆积、等待是否超期、是否阻塞关键修复路径。适用于每次宪法审计的前置扫描。",
  "steps": [
    "用 list_files 列出 docs/amendments/ 目录，读取所有 JSON 提案文件",
    "对每个提案提取：id/status/version/生成日期（从id的AM-YYYYMMDD提取）/section/supersedes",
    "统计 pending_judgment 状态的提案数量，计算等待天数 = 当前日期 − 生成日期",
    "按等待天数标记：≤7天🟢 / 8-30天🟡 / >30天🔴",
    "检测超期提案（>30天）：列出长期未裁决的提案及其修复目标，标注是否阻塞其他提案（检查 supersedes 链）",
    "检测堆积模式：修复同一章节的多个提案并列 pending_judgment，且互不引用 supersedes",
    "检测提案链断裂：A supersedes B，B supersedes C，但 C 才是实际已裁决的提案——链中存在优先级倒挂",
    "输出审计报告：总览（总提案数 / pending 数 / 超期数）→ 逐项提案堆积详情 → 超期提案影响评估 → 建议优先裁决排序 → 堵塞根因分析"
  ],
  "expectedOutput": "Markdown 审计报告：提案堆积全景、超期清单、影响评估、优先裁决排序建议",
  "outputFile": "docs/auditing/{date}-pipeline-congestion-audit.md",
  "status": "trial",
  "adoptionCount": 3,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384028
}
```

---

## 三、🧹 数据一致性模式

### 3.1 宪法注册表 vs 实际文件一致性校验（出现 **2 次** — 已记录）

**水镜轨迹**：
- 发现13（玉衡 2026-06-12）：cortex-docs.json 指向 v2.5.21.md 但实际为 v2.5.22.md
- 玉衡 2026-07-15：版本号断层 v2.5.22 无修正记录

**模式内核**：文档注册表（cortex-docs.json）中的路径/版本号必须与实际文件一致。

```json
{
  "id": "skill-constitution-registry-consistency-check",
  "agentType": "inspector",
  "name": "宪法注册表一致性校验",
  "triggerTags": ["inspect", "doc_audit", "research"],
  "trigger": "需要对宪法注册表（cortex-docs.json）与实际文件路径和版本号的一致性进行校验时触发。适用于治理审计的前置数据基线检查。",
  "steps": [
    "用 read_file 读取 cortex-docs.json（或类似注册表文件），提取 constitutionPath、version、canonical 等信息",
    "用 list_files 列出注册表指向的目录（如 docs/constitution/），获取所有宪法版本文件的实际列表",
    "核对注册表中的 constitutionPath 指向的文件是否实际存在于磁盘上",
    "用 read_file 读取注册表指向的宪法文件头部，提取实际版本号与注册表中声明的 version 字段比对",
    "如注册表指向的 canonical 版本不是最新版本（如指向 v2.5.21 而实际最新为 v2.5.22），标记为 🔴 版本滞后",
    "如注册表中有多条 canonical:true 的记录，标记为 🔴 歧义配置",
    "如注册表中 version 字段缺失或与实际版本号不一致，标记为 🟡 版本号不匹配",
    "输出校验报告：注册表声明 vs 实际状态对比表 → 异常项详情 → 修复建议"
  ],
  "expectedOutput": "Markdown 校验报告：注册表声明 vs 实际状态对比表、异常项（版本滞后/歧义配置/版本号不匹配）、修复建议",
  "outputFile": "docs/auditing/{date}-registry-consistency-check.md",
  "status": "draft",
  "adoptionCount": 2,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384029
}
```

---

### 3.2 提案文件数据残留清理检测（出现 **2 次** — 已记录）

**水镜轨迹**：
- 发现11（玉衡 2026-07-15）：webui/constitution_proposal.json 残留（已被 supersede 但未标记更新）
- 凝光 2026-07-08 审计：AM-2026-0612-001 状态字段非法

**模式内核**：修宪提案被 supersede 后，原始提案文件可能残留未更新，导致后续审计人员混淆。

```json
{
  "id": "skill-stale-proposal-file-cleanup-scan",
  "agentType": "inspector",
  "name": "过期提案文件残留扫描与清理",
  "triggerTags": ["inspect", "doc_audit", "tracking"],
  "trigger": "需要清理已被 supersede 或已过期的修宪提案文件时触发。适用于治理审计的收尾清理阶段或定期的治理资产普查。",
  "steps": [
    "用 list_files 列出 docs/amendments/ 目录，获取所有 AM-*.json 文件列表",
    "用 read_file 逐个读取提案文件，提取 id/status/supersedes（如存在）",
    "对 status=superseded 的提案：检查其是否仍有 status=pending_judgment 或 applied 的提案引用它（通过搜索提案 id 全文）",
    "对 status=pending_judgment 且生成日期 > 30 天的提案：标记为🔴超期提案，建议清理或重新激活",
    "对 webui/ 根目录下的 constitution_proposal.json 等非标准路径的提案文件：检查其版本是否已被 docs/amendments/ 中的新版提案 supersede",
    "检测异常——引用链断裂：A supersedes B，但 A 自身也是 superseded 状态，且无 C supersedes A（无替代提案）",
    "输出扫描报告：文件清单（含每个文件的当前状态和实际状态）→ 残留项清单（建议删除或状态更新）→ 清理步骤"
  ],
  "expectedOutput": "Markdown 扫描报告：提案文件状态总览、残留项清单及清理建议、引用链完整性检查",
  "outputFile": "docs/auditing/{date}-stale-proposal-cleanup.md",
  "status": "draft",
  "adoptionCount": 2,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384030
}
```

---

### 3.3 宪法声明 vs 代码实现一致性校验（出现 **4 次** — ⭐⭐）

**水镜轨迹**：
- 凝光 2026-06-07 审计三：治理层合规性——宪法声明超前于实现
- 发现10（玉衡 2026-07-15）：审计闭环宪法声明超前于实现
- 发现4（玉衡 2026-07-15）：§15.1 超时机制声明了每日扫描但凝光不具备定时任务能力
- 发现6（玉衡 2026-07-15）：监理角色宪法引用但无对应实现实体

**模式内核**：宪法条款声明的能力与实际代码实现之间的偏差检测——超前声明（宪法写了但代码没实现）或滞后实现（代码做了但宪法没声明）。

```json
{
  "id": "skill-constitution-vs-implementation-gap-analysis",
  "agentType": "analysis",
  "name": "宪法声明 vs 代码实现差距分析",
  "triggerTags": ["analysis", "audit", "research"],
  "trigger": "需要验证宪法条款中声明的治理能力是否实际在代码层有对应实现时触发。适用于每轮宪法审计的治理合规性检查环节，确保宪法不是纸面承诺。",
  "steps": [
    "用 read_file 读取宪法审计报告，提取涉及「实现状态」「超前声明」「代码层缺失」的发现",
    "用 search_code 搜索关键治理组件的代码实现：governance-loop.ts / amendment-applier.ts / amendment-judge.ts / governance-pipeline.ts",
    "核对每项宪法声明的治理能力是否存在对应的代码实现文件或函数",
    "检测第一种偏差——超前声明（宪法写了，代码没实现）：如宪法声明了「每日超时扫描」但找不到任何定时任务实现",
    "检测第二种偏差——滞后实现（代码做了，宪法没声明）：如代码中有 SafeErrorReporter 实现但宪法 §8.1 未声明",
    "检测第三种偏差——角色/实体缺失：宪法引用了某治理角色（如「监理」）但代码层找不到该角色的独立实现",
    "对每项偏差标注差距方向（超前/滞后/缺失）、影响等级（阻塞/警告/信息）、涉及文件",
    "输出差距分析报告：宪法条款 → 代码实现对照表 → 超前声明清单 → 滞后实现清单 → 角色缺失清单 → 修复建议（含预计代码行数）"
  ],
  "expectedOutput": "Markdown 差距分析报告：宪法vs代码对照表、超前声明/滞后实现/角色缺失三项清单、修复建议",
  "outputFile": "docs/auditing/{date}-constitution-vs-code-gap.md",
  "status": "trial",
  "adoptionCount": 4,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384031
}
```

---

## 四、⚙️ 治理基建模式

### 4.1 审计闭环完整性验证（出现 **3 次** — ⭐）

**水镜轨迹**：
- 发现7（凝光 2026-06-07）：审计闭环修复未入宪
- 发现6（玉衡 2026-06-12）：审计闭环仍未入宪
- 发现6（玉衡 2026-07-15）：审计闭环宪法声明超前于实现

**模式内核**：审计闭环的五环节完整性验证——整改责任人、整改验证、判例引用、门禁关联、关闭签署。

```json
{
  "id": "skill-audit-closure-loop-verification",
  "agentType": "review",
  "name": "审计闭环五环节完整性验证",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "需要验证宪法或治理层设计中的审计闭环条款是否覆盖全部五环节时触发。适用于治理系统成熟度评估或 Core-2 跃迁前的准备检查。",
  "steps": [
    "用 read_file 读取宪法 §10 治理层（或 §10.1 审计闭环如已存在），提取闭环定义文本",
    "五环节逐项核对：（1）整改责任人指派——是否要求每项发现标明 Owner；（2）整改标准与验证——是否定义可验证的关闭标准（Acceptance Criteria）；（3）判例引用与有效期——是否定义判例的引用机制和有效期；（4）治理门禁关联——是否定义未关闭 P0 发现阻塞门禁；（5）关闭条件与签署——是否要求开拓者亲自签署关闭",
    "如五环节全部存在且定义完整 → 标注 ✅ 闭环完整。缺失任一环节 → 标注 ❌ 闭环断裂并指出缺失环节",
    "用 read_file 读取治理层设计文档，检查审计闭环的代码实现状态（通知管线是否接入、事件是否 emit、用户是否知情）",
    "如宪法已声明审计闭环但治理层设计文档标注「未实现」→ 标注 ⚠️ 纸面合规",
    "用 search_code 搜索 DocGovernAgent 的 emit 能力，检查审计结论是否写入 PipelineObserver 事件管道",
    "输出验证报告：闭环完整度总览（✅/⚠️/❌）→ 五环节逐项检查表 → 代码实现状态 → 修复建议"
  ],
  "expectedOutput": "Markdown 验证报告：闭环完整度总览、五环节逐项检查表、代码实现状态、修复建议",
  "outputFile": "docs/auditing/{date}-audit-closure-verification.md",
  "status": "trial",
  "adoptionCount": 3,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384032
}
```

---

### 4.2 治理事件管道断点检测（出现 **2 次** — 已记录）

**水镜轨迹**：
- soft_constraint_analysis.md P0-3：DocGovernAgent 不 emit 治理事件——审计走不出群玉阁
- soft_constraint_review.md 三重过滤中的第二层：治理事件管道断点检测

**模式内核**：检测从治理审计到用户通知的端到端事件管道是否完整——审计事件是否 emit、是否进入 PipelineObserver、ButlerAgent 是否分发。

```json
{
  "id": "skill-governance-event-pipeline-breakpoint-detection",
  "agentType": "code",
  "name": "治理事件管道端到端断点检测",
  "triggerTags": ["code", "audit", "research"],
  "trigger": "需要验证治理事件是否能从审计产出端到达用户通知端时触发。适用于治理闭环完整性的基础设施层面检查。",
  "steps": [
    "用 search_code 搜索 'emit' 在 packages/engine/src/agents/doc-govern-agent.ts 中的使用，检查凝光是否有调用 observer.emit() 的能力",
    "用 search_code 搜索 PipelineEventType 枚举定义（packages/shared/src/infra.ts），检查是否包含 governance.* 类型的事件（如 governance.audit / governance.constitution_check / governance.stage_gate）",
    "用 search_code 搜索 ButlerAgent 中对 governance 事件的监听和分发逻辑",
    "用 read_file 读取宪法 §8.2 通知管线，检查治理事件是否被声明为 DECISION_REQUIRED 轨道的合法输入",
    "链路模拟：从审计完成到用户收到通知的完整端到端路径——审计报告写入磁盘 → emit 治理事件 → PipelineObserver 接收 → ButlerAgent 按三轨分发 → 用户收到通知/决策请求",
    "逐环节标注断点：❌ emit 缺失（凝光不调用 observer.emit）→ ❌ 事件类型缺失（枚举无 governance 类型）→ ❌ 监听缺失（ButlerAgent 不处理 governance 事件）→ ❌ 宪法声明缺失（§8.2 未定义治理事件接入路径）",
    "输出检测报告：端到端链路图 → 逐环节断点标注 → 修复建议（含 3 个优先修复环节的预计代码行数）"
  ],
  "expectedOutput": "Markdown 检测报告：端到端链路图、逐环节断点标注、修复建议（含预计代码行数）",
  "outputFile": "docs/auditing/{date}-governance-pipeline-breakpoints.md",
  "status": "draft",
  "adoptionCount": 2,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384033
}
```

---

### 4.3 层级冲突裁决原则检查（出现 **2 次** — 已记录）

**水镜轨迹**：
- 发现10（凝光 2026-06-07）：宪法/治理层设计层级冲突原则缺失
- 发现9（玉衡 2026-06-12）：同问题二次确认

**模式内核**：当宪法与治理层设计文档（或其他配套文档）出现不一致时，需要冲突裁决原则来判断优先级。

```json
{
  "id": "skill-hierarchy-conflict-resolution-check",
  "agentType": "review",
  "name": "宪法/治理层设计层级冲突裁决检查",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "需要检查宪法与治理层设计文档之间是否存在隐性冲突，以及冲突裁决原则是否已定义时触发。适用于治理体系多层文档结构的一致性审计。",
  "steps": [
    "用 read_file 读取宪法 §10 治理层，检查是否包含宪法/治理层设计冲突裁决原则（如 §10.3 层级冲突裁决）",
    "用 read_file 读取治理层设计文档（docs/core/治理层设计.md），检查是否在所有与宪法潜在冲突的章节处有 ⚠️ 冲突标记",
    "用 search_code 搜索宪法中直接引用治理层设计文档的段落，标记引用位置和引用方式",
    "用 search_code 搜索治理层设计文档中声明「宪法优先」「以宪法为准」等冲突裁决表述",
    "检测具体冲突：列举所有宪法声明与治理层设计声明不一致的点（如宪法说 DocGovernAgent emit 事件，治理层设计说只写磁盘）",
    "如冲突裁决原则存在：检查四要素是否完整——(1)宪法优先原则、(2)冲突显式标记、(3)裁决通道、(4)紧急避险例外",
    "如任一要素缺失：标记为 🟡 裁决原则不完整，指出缺失要素",
    "输出检查报告：冲突裁决原则完整度 → 已知冲突清单 → 缺失要素 → 修复建议"
  ],
  "expectedOutput": "Markdown 检查报告：冲突裁决原则完整度评估、已知冲突清单、缺失要素、修复建议",
  "outputFile": "docs/auditing/{date}-hierarchy-conflict-check.md",
  "status": "draft",
  "adoptionCount": 2,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384034
}
```

---

### 4.4 DECISION_REQUIRED 回退机制完整性验证（出现 **2 次** — 已记录）

**水镜轨迹**：
- 发现8（凝光 2026-06-07）：回退机制缺失
- 发现7（玉衡 2026-06-12）：同问题二次确认

**模式内核**：DECISION_REQUIRED 轨道必须实现四层安全阀——超时阈值、防抖合并、离线降级、审计逃逸记录。

```json
{
  "id": "skill-decision-required-failsafe-verification",
  "agentType": "review",
  "name": "DECISION_REQUIRED 回退机制四层安全阀验证",
  "triggerTags": ["review", "audit", "constitution_check"],
  "trigger": "需要验证 DECISION_REQUIRED 回退机制的四层安全阀是否在宪法和代码层完整实现时触发。Core-2 治理组件启动前的必要前置检查。",
  "steps": [
    "用 read_file 读取宪法 §8.2 通知管线，检查是否包含 DECISION_REQUIRED 回退机制段落",
    "四层安全阀逐项核对：（1）超时阈值与默认行为——是否定义超时阈值单位和默认 fallback 策略；（2）防抖合并——是否定义窗口期和折叠规则；（3）离线/忙碌降级——是否定义离线判定标准和恢复后的批量决策界面；（4）审计逃逸记录——是否要求所有触发回退的事件写入 Governance 审计分区",
    "如四层全部存在且定义完整 → 标注 ✅ 安全阀完整。缺失任一 → 标注 ❌ 安全阀缺失并指出缺失层",
    "用 search_code 搜索代码层实现（packages/engine/src/core/、packages/notification/src/），检查回退机制的实际代码实现状态",
    "如宪法声明了回退机制但代码层无对应实现 → 标注 ⚠️ 纸面合规",
    "输出验证报告：安全阀完整度总览 → 四层逐项检查表（含宪法引用和代码层证据）→ 缺失层修复建议"
  ],
  "expectedOutput": "Markdown 验证报告：安全阀完整度总览、四层逐项检查表（含宪法引用+代码证据）、修复建议",
  "outputFile": "docs/auditing/{date}-decision-required-failsafe-check.md",
  "status": "draft",
  "adoptionCount": 2,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 1778962384035
}
```

---

## 五、水镜后的附记

### 5.1 未沉淀但值得留意的单次波纹

以下模式仅出现一次，尚不符合"≥2次才算模式"的标准，但值得后续追踪：

| 模式 | 出现位置 | 观察日期 | 可能的发展方向 |
|:----|:--------|:--------:|:-------------|
| 超时失效与阶段限定优先级冲突 | AM-2026-0708-004 | 2026-07-08 | 如再出现1次→沉淀为技能 |
| 审计闭环宪法声明超前于实现标注 | soft_constraint_analysis.md | 2026-07-16 | 如再出现1次→沉淀为技能 |
| 并发修宪提案冲突检测 | AM-2026-0612-001（子约束9） | 2026-06-12 | 如再出现1次→沉淀为技能 |
| DocGovern 分区 vs MemoryStore TTL冲突 | AM-2026-0715-001 发现5 | 2026-07-15 | 如再出现1次→沉淀为技能 |

### 5.2 已沉淀技能的注册建议

以上 16 项技能模板中，建议优先注册到 SkillRegistry 的前 5 项：

| 优先级 | 技能 | 理由 |
|:-----:|:----|:------|
| **P0** | 宪法全量审计（三焦点模式） | 出现 7 次，最核心的治理审计技能 |
| **P0** | 修宪提案状态一致性扫描 | 出现 6 次，每次审计必做 |
| **P1** | 审计交叉验证·三重过滤法 | 出现 4 次，独立复核的黄金标准 |
| **P1** | 审计发现→提案→修复追踪矩阵 | 出现 5 次，治理可追溯性的基础 |
| **P1** | 宪法声明 vs 代码实现差距分析 | 出现 4 次，防止纸面合规的关键把关 |

---

*水镜收拢。波纹已录，去路已标。下一个出发的人不必再趟同一片浑水。*

— 莫娜·梅姬斯图斯，Cortex Loop Agent
