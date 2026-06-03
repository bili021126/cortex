# 🌊 水镜沉淀 · 第二回

**沉淀者**：莫娜·梅姬斯图斯（Loop Agent）
**沉淀日期**：2026-07-23
**数据源**：
- `webui/audit/constitution_audit.md`（玉衡全量治理审计 v2.5.22）
- `webui/audit/constitution_proposal.json`（AM-2026-0716-001 修宪提案）
- `webui/review/code_review_diagnosis.md`（玉衡逐包审查诊断）
- `webui/analysis/architecture_analysis.md`（阿贝多架构分析）
- 前置判例追溯：`webui/loop_skills.md` · `webui/skill_precipitate_round1.md` · `webui/refined_skills.md`

**水镜法则**：每道波纹至少出现两次才算模式，三次值得提笔。
**交叉验证**：已与现有 31 项已注册技能比对 —— 以下 4 项为新增沉淀。

---

## 水镜总览

我在三面水镜（审计/审查/分析）的回响中照见了 **4 道新波纹**。每道都在至少 2 份独立报告中出现，其中 2 道出现 ≥3 次——值得提笔。

| # | 技能名 | 波纹轨迹 | 出现次数 | 等级 |
|:-:|--------|---------|:--------:|:----:|
| S32 | 宪法-代码一致性差隙扫描 | architecture_analysis.md（宪-码62%）+ constitution_audit.md（多处） | 2 份报告 | ⭐⭐ 提笔 |
| S33 | 组件实现但未集成/零消费者诊断 | architecture_analysis.md（4处实例）+ code_review_diagnosis.md（1处） | 5 实例 | ⭐⭐⭐ 提笔 |
| S34 | 配置嵌套深度合并审计 | architecture_analysis.md（resolveConfig 2处）+ code_review_diagnosis.md（ConfigManager 1处） | 3 实例 | ⭐⭐⭐ 提笔 |
| S35 | 跨包职责边界/文档覆盖审计 | architecture_analysis.md（6包未覆盖）+ code_review_diagnosis.md（agent.ts 单一职责） | 2 份报告 | ⭐⭐ 提笔 |

---

```json
[
  {
    "id": "skill-consistency-gap-scan",
    "agentType": "analysis",
    "name": "S32: 宪法-代码一致性差隙扫描",
    "triggerTags": ["analysis", "audit", "research", "pattern_scan", "constitution_check"],
    "trigger": "需要对宪法 vX.Y.Z 的条款声明与 packages/ 中的代码实现进行逐条对照扫描时触发。\n适用场景：\n- 新宪法版本发布后验证工程落地进度\n- 治理审计收尾阶段评估宪-码差距\n- Core-1→Core-2 过渡前的实现就绪度评估",
    "steps": [
      "用 read_file 读取宪法 vX.Y.Z 全文，提取所有带明确行为声明的条款（§2 原则表、§7.2 ConfirmGate、§8.2 通知管线、§9.1 存储策略、§10 治理层、§15.1 超时失效）",
      "将宪法条款按实现状态分类：(a) 显式声明已实现的条款（如 §10 治理层标注了 4/5 环节可用）；(b) 声明了行为但未标注实现状态的条款；(c) 声明了 Core-2 预留的条款",
      "对 (a) 类条款：用 search_code 搜索对应的代码实现（如搜索 'confirm-gate.ts' 核对 ConfirmGate 实现），搜索核心方法的调用点，确认实现不仅在代码中存在且在运行时路径上被调用",
      "对 (b) 类条款：用 search_code 搜索条款关键词对应的代码实现（如搜索 '_onDecision' 检查 DECISION_REQUIRED 回退机制），搜索实现文件的 import 引用链，统计消费者数量",
      "对 (c) 类条款：用 search_code 搜索是否存在超前实现（如 ConsistencyLayer 代码已存在但声明为 Core-2 预留），标注文档标签与实际实现状态的错位",
      "为每个条款建立三态标注：🟢 已落地（代码存在且运行时可达）/ 🟡 部分落地（代码存在但未集成/零消费者）/ 🔴 未落地（代码不存在）",
      "按治理层/引擎层/存储层/CLI 层分类汇总，输出各层一致性评分（百分比）",
      "趋势判断：用 read_file 读取上轮审计报告或上轮一致性扫描结果，比较同一条款的实现进度变化（↑ 修复 / → 无变化 / ↓ 回退）",
      "输出报告：总体评分（宪-码一致性%）→ 逐条款对照表（宪法条款 | 声明内容 | 代码状态 | 实现文件 | 消费者数 | 三态）→ 分层汇总 → 趋势变化 → 优先修复建议（标注阻塞 Core-2 的缺口）"
    ],
    "expectedOutput": "Markdown 一致性差隙扫描报告：总评分 + 逐条款对照表（含三态标记、实现文件、消费者数） + 分层汇总 + 趋势变化 + 优先修复建议",
    "outputFile": "webui/consistency_gap_scan_{version}.md",
    "status": "draft",
    "adoptionCount": 0,
    "rejectionCount": 0,
    "discoveredBy": "Mona",
    "createdAt": 1778962384020
  },
  {
    "id": "skill-component-isolation-diagnosis",
    "agentType": "analysis",
    "name": "S33: 组件实现但未集成/零消费者诊断",
    "triggerTags": ["analysis", "audit", "code", "architecture"],
    "trigger": "需要检测 packages/ 中已完整实现但从未被任何消费方引用的孤立组件时触发。\n适用场景：\n- 架构健康度定期普查\n- 宪法审计发现「已实现但未集成」缺口后深入诊断\n- 重构前识别死代码和假性完成度",
    "steps": [
      "用 read_file 读取架构分析报告或一致性扫描报告中标记为 🟡 部分落地（代码存在但未集成）的组件列表",
      "对每个候选组件执行三步验证：",
      "第一步 — 接口导出验证：用 search_code 搜索该组件的导出点（如 'export class ConsistencyLayer' 或 'export function.*verify'），确认其从包入口（index.ts/barrel）被导出",
      "第二步 — 消费者追溯：用 search_code 搜索 import 语句（如 'import.*ConsistencyLayer' 或 'from.*consistency-layer'），统计全代码库中 import 该组件的文件数量。排除：类型定义文件、测试文件、该组件自身的文件",
      "第三步 — 运行时可达性验证：若消费者数 > 0，追踪消费者是否本身也被孤立（递归验证）。若消费者数为 0，则标记为 🔴 零消费者孤立组件",
      "对标记为 🔴 的孤立组件，额外检测：(a) 是否有 setPreWriteHook/setObserver 等注册/钩子方法从未被调用；(b) 构造函数是否需要外部传入的依赖（如 fs/engineConfig）——若从未被实例化，则 instanceof 检查也不可达",
      "用 search_code 搜索 'new.*' + 组件类名，确认是否在非测试代码中被实例化",
      "汇总输出：组件名 | 文件路径 | 导出状态 | 消费者数 | 实例化次数 | 运行时可达 | 孤立等级（🔴完全孤立 / 🟡间接可达 / 🟢活跃）",
      "对每个 🔴 孤立组件输出：组件职责摘要、文档声明状态（Core-1/Core-2/超前设计）、建议行动（移除/集成到运行时路径/保留为 Core-2 预埋）",
      "附加检测：检查是否存在「设计文档标注为 Core-2 预留但代码已超前实现」的组件——这是文档标签错位的信号（如 consistency-design.md 标注为设计提案但代码已实现 5/6 层）"
    ],
    "expectedOutput": "孤立组件诊断报告：组件名 | 消费者数 | 实例化次数 | 孤立等级 | 建议行动。含代码搜索实证和文档标签错位分析",
    "outputFile": "webui/component_isolation_diagnosis.md",
    "status": "draft",
    "adoptionCount": 0,
    "rejectionCount": 0,
    "discoveredBy": "Mona",
    "createdAt": 1778962384021
  },
  {
    "id": "skill-deep-merge-config-audit",
    "agentType": "review",
    "name": "S34: 配置嵌套对象深度合并审计",
    "triggerTags": ["review", "audit", "config", "code", "refactor"],
    "trigger": "需要审计代码库中使用 Object.assign / 展开运算符 / ?? 链式回退 实现配置合并或默认值传播的地方，检测浅合并导致的深层字段丢失。\n适用场景：\n- 配置系统重构前\n- 发现引擎行为与配置不一致时\n- 新配置字段添加后的回归审计",
    "steps": [
      "用 search_code 搜索 'Object.assign' 获取所有使用浅合并的代码位置",
      "用 search_code 搜索 'resolveConfig' 或 'merge.*config' 获取所有配置合并/解析函数",
      "对每个匹配项执行以下检查：",
      "检查一 — 目标对象是否存在嵌套字段（如 config.engine.dbPath — 超过 1 层深度的字段）。若存在，Object.assign 会整体覆盖而非按字段合并，导致未提供的嵌套字段丢失",
      "检查二 — resolveConfig 类的配置解析函数是否有两个分支路径（如 !partial 分支 vs partial 分支），检查两个分支对同一嵌套字段的默认值处理是否一致（如 search.backends 在分支 A 用 [...DEFAULT] 展开副本，分支 B 用 ?? 回退——逻辑等价但维护者需肉眼验证一致性）",
      "检查三 — 是否存在 null 值语义混淆：?? 运算符将 null 视为有效值，而 || 将 null 视为 falsy。检测配置合并代码中 ?? 与 || 的混用（如 config.field ?? defaultValue 与 config.field || defaultValue 在同一函数中混用）",
      "检查四 — JSON.parse 后的浅合并（如 ConfigManager._mergeFromFile 用 Object.assign 合并 JSON 配置文件）：检测 JSON.parse 的结果是否直接 Object.assign 到目标对象——部分配置文件字段会导致整个对象被覆盖",
      "检查五 — 是否存在静默忽略的 catch 块（如 JSON.parse 失败时 catch 为空），导致配置加载失败无反馈",
      "对每个缺陷输出：文件 | 行号 | 合并方式 | 受影响字段 | 风险等级（🔴字段丢失 / 🟡语义混淆 / 🟢兼容但脆弱）",
      "汇总统计：浅合并总数 / 含嵌套字段的浅合并数 / 有分支不一致的 resolveConfig 数 / 静默 catch 数",
      "输出修复建议：提取 mergeDeep 辅助函数统一处理；Option 类型替代 ??/|| 混用；JSON 配置解析失败至少记录 warning"
    ],
    "expectedOutput": "深度合并审计报告：浅合并位置清单 + 逐项风险评估（含字段丢失模拟） + 修复建议 + mergeDeep 辅助函数签名提案",
    "outputFile": "webui/deep_merge_config_audit.md",
    "status": "draft",
    "adoptionCount": 0,
    "rejectionCount": 0,
    "discoveredBy": "Mona",
    "createdAt": 1778962384022
  },
  {
    "id": "skill-package-boundary-doc-audit",
    "agentType": "review",
    "name": "S35: 跨包职责边界/文档覆盖审计",
    "triggerTags": ["review", "audit", "architecture", "doc_audit"],
    "trigger": "需要审计 monorepo 中子包的职责边界清晰度和文档覆盖率时触发。\n适用场景：\n- 新参与者 onboarding 前\n- 包数量增长或新包添加后\n- 发现两包功能重叠或职责冲突时",
    "steps": [
      "用 list_files('packages/') 获取所有子包清单，确定审计范围",
      "用 read_file 读取宪法（docs/constitution/）和核心设计文档（docs/core/），提取文档中明确描述的子包列表及其职责说明",
      "建立包清单 vs 文档覆盖矩阵：每个子包标注 📖 已在文档中描述 / ❌ 未在文档中提及",
      "对每个 ❌ 未覆盖包，用 read_file 读取其 package.json 中的 description 字段，获取包的自我描述",
      "用 list_files 扫描 ❌ 未覆盖包的 src/ 目录，读取核心文件（index.ts 的导出）理解其职责",
      "类型命名冲突检测：用 search_code 搜索每个 ❌ 未覆盖包的导出的核心类型名（如 data 包的 Task 类），与宪法/核心文档中已有的类型名（如 TaskNode）比对。若类型名相同但语义不同（如 Task 是通用任务实体 vs TaskNode 是 Cortex 调度节点），标记为 🔴 命名冲突",
      "功能重叠检测：对每个 ❌ 未覆盖包，用 read_file 读取其核心模块的导出函数/类列表。与宪法中已定义的 Agent 核心功能（如 PipelineObserver/ButlerAgent 的通知职责 vs notification 包的通知职责）比对。若职责重叠但无明确界限声明，标记为 🟡 职责边界未定义",
      "领域外判定：若 ❌ 未覆盖包与 Cortex 核心架构无调用关系（用 search_code 搜索 packages/ 中其他包是否 import 该包），标记为 🟢 独立子系统/开发工具，建议在文档中标注定位",
      "汇总输出：包名 | 文档覆盖 | 类型命名冲突 | 功能重叠 | 独立子系统 | 建议行动（入宪描述/重命名/职责声明/标注定位）",
      "附：对含 🔴 命名冲突或 🟡 职责边界未定义的包，输出具体的冲突说明和修复方案"
    ],
    "expectedOutput": "包边界审计报告：N 包扫描完成 — 文档覆盖矩阵 + 类型命名冲突检测结果 + 功能重叠分析 + 每包建议行动",
    "outputFile": "webui/package_boundary_doc_audit.md",
    "status": "draft",
    "adoptionCount": 0,
    "rejectionCount": 0,
    "discoveredBy": "Mona",
    "createdAt": 1778962384023
  }
]
```

---

## 水镜附注

### 已排除的候选模式（出现仅 1 次，判定为幻觉）

以下模式仅在其中一份报告中出现，不符合 ≥2 次的标准，故不沉淀为技能：

| 候选模式 | 来源 | 排除理由 |
|---------|------|---------|
| 版本头日期悖论检测 | constitution_audit.md 发现1 | 虽在前置判例 NG-2026-0607 中出现过，但当前三份报告中仅此一份提及 |
| CLI 入口路径检测脆弱 | code_review_diagnosis.md P0-3 | 单文件特定问题，不构成跨报告重复模式 |
| LLM 适配器编码损坏 | code_review_diagnosis.md P0-1 | 单文件文件编码损坏，非结构化重复 |
| 运行时可变全局状态并发风险 | code_review_diagnosis.md P0-4 | 单个组件的设计缺陷，未在其他报告中出现 |
| 模块级副作用检测 | code_review_diagnosis.md P1-4 | 单文件特定问题 |
| Scheduler 标签密度平局打破 | architecture_analysis.md §2.1 | 已在 refined_skills.md P29（AGENT_TAGS 标签重叠检测）中覆盖 |

### 已注册技能交叉引用

本次新增的 4 项技能与现有 31 项技能无重叠：

- S32 聚焦于「宪法条款 ↔ 代码实现」的逐条对照（纵向），不同于 skill-constitution-full-audit-v2（聚焦原则七闭环）和 skill-gap-dependency-root-scan（聚焦缺口间依赖链）
- S33 聚焦于「实现完成但运行时不可达」的孤立组件检测（横向），不同于 P28（聚焦已闭环修复项的复验）
- S34 聚焦于「配置合并时的深层字段丢失」这一特定 bug 模式，不同于 P27（monorepo 子包合规扫描）的广度扫描
- S35 聚焦于「包间职责边界和文档覆盖」的跨包关系审计，不同于 P27（单包五维度合规）
