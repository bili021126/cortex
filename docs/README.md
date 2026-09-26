# Cortex 文档导航地图

> 最后更新：2026-09-26
> 如果你不知道从哪份文档开始读——从这里开始。
>
> **2026-09-26 修订**：本图此前有 **11 条链接失效**（7 条目标已归档、1 条改属 `analysis/`），
> 且把归档文档摆在「当前活跃设计文档」乃至「⭐从这里开始」里——等于把新人引向历史。
> 本次逐条核验修正，并在每处标注真实归属。

---

## ⭐ 从这里开始（一份就够了）

| # | 文档 | 定位 |
|---|------|------|
| **0** | [constitution/Cortex 概念顶层设计 v3.8.md](constitution/Cortex%20概念顶层设计%20v3.8.md) | **现行宪法 v3.8**——代码即真相，唯一权威 |
| **1** | [analysis/capability-system-2026-09-26.md](analysis/capability-system-2026-09-26.md) | **功能体系理清**——两套坐标系（五流六层 ↔ L0–L4）的实测诊断 + 代码侧真实能力清单 |
| **2** | [analysis/optimization-report-2026-09-26.md](analysis/optimization-report-2026-09-26.md) | **2026-09-26 优化与体检**——门禁健康度 / notification_queue 无界增长 / 五项体检 |

> ⚠️ **原先放在这里的是 `core/概念设计全面整合-项目实际阶段与路线图.md`——它已于 2026-06 移入 `archive/`。**
> 那份曾自称「一切概念的最终收敛」，但描述的是 Core-2 过渡期的阶段认知，已被现行宪法 v3.8 取代。
> 追溯概念谱系时读归档版，**不要拿它当现状**。

---

## 必读（核心文档）

| # | 文档 | 定位 | 什么时候读 |
|---|------|------|-----------|
| 1 | [constitution/Cortex 概念顶层设计 v3.8.md](constitution/Cortex%20概念顶层设计%20v3.8.md) | **现行宪法 v3.8**——代码即真相。包数以 `layer-contract` 门禁断言为活引用（2026-09-26 实测 28） | 任何时候。这是唯一权威。 |
| — | [constitution/archive/Cortex 概念顶层设计 v2.5.35.md](constitution/archive/Cortex%20概念顶层设计%20v2.5.35.md) | 前代宪法 v2.7.1。已被 v3.x 替代，归档保留为历史参考。 | 追溯历史修宪记录时 |
| 2 | [core/治理层设计-v3.0-全量整合版.md](core/治理层设计-v3.0-全量整合版.md) | **政府运行手册**——宪法§10/§11的细化。已落地+设计锚点+超前设计 | 需要理解治理机制怎么运作时 |
| 3 | [core/consistency-design.md](core/consistency-design.md) | **六层防御 spec**——记忆-现实一致性校验层完整设计 | 需要理解记忆防幻觉机制时 |

> 注：`core/治理层设计.md`（无版本后缀）已归档至 `archive/`，现行版是 `core/治理层设计-v3.0-全量整合版.md`。

---

## 当前活跃设计文档 (`docs/core/`)

> 以下为 **2026-09-26 核验后仍实际位于 `docs/core/`** 的条目标注。原先列在此处而实际已归档的，
> 已汇总到本节末尾的「已归档」清单。

| 文档 | 定位 |
|------|------|
| [**core-3-design-backlog.md**](core/core-3-design-backlog.md) | **设计债清单（2026-09-26 挖题核验）**——宪法「6 项 Core-3 设计决策」逐条回代码核实：**1 项已完成、1 项前提已消失、2 项题名与实况不符**。含 7 条本轮新挖出的题 |
| [**observability-dual-channel-design.md**](core/observability-dual-channel-design.md) | **可观测双通道设计与边界**（原「Logger 推广」题的重新定义）——运行时 `console-bridge` 与编译期 `@cortex/logging` 两条通道并存且无边界定义 |
| [治理层设计-v3.0-全量整合版.md](core/治理层设计-v3.0-全量整合版.md) | 政府运行方式——已落地/设计锚点/超前设计 三部分结构 |
| [consistency-design.md](core/consistency-design.md) | 六层防御完整spec（IntentFactWall/InitVerifier/SchemaEnforcer等） |
| [技能沉淀机制设计.md](core/技能沉淀机制设计.md) | 技能闭环——提取→注册→持久化→冷启动加载 |
| [循环策略注册表设计.md](core/循环策略注册表设计.md) | Agent 执行循环的策略注册表——从硬编码 ReAct 到可插拔策略模式 |
| [Cortex-架构映射-五流六层七原则.md](core/Cortex-架构映射-五流六层七原则.md) | **概念坐标系**——五流/六层/七原则合并版。⚠️ 其代码锚点已漂移（45 条引用中 12 条搬家、2 条消失），机器可读形态见 `packages/config/src/data/architecture-flows.json` |
| [full-flow-map.md](core/full-flow-map.md) | 12 条核心数据流映射 |
| [telemetry-design-principles.md](core/telemetry-design-principles.md) · [telemetry-infrastructure-deepening.md](core/telemetry-infrastructure-deepening.md) | 遥测设计原则与深化 |
| [webui-architecture-design.md](core/webui-architecture-design.md) | WebUI 六面板设计。⚠️ 后端已于 commit `25f01704` 作为死代码删除，REST/WS 实际由 `@cortex/server` 承载——本节为**未落地设计** |
| [Committee-session-协议设计.md](core/Committee-session-协议设计.md) | Committee session 协议（Core-3 保留项） |
| [cortex-tui-v2-final-design.md](core/cortex-tui-v2-final-design.md) | TUI v2 设计。⚠️ 其中 ToolCard / FocusRouter / DiffRenderer / OverlayManager 等尚未实现 |
| [analysis/思考执行体系总纲.md](analysis/思考执行体系总纲.md) | 三层架构spec——群策层→Scheduler层→RLM层 |
| [analysis/core-2-governance-implementation-gap.md](analysis/core-2-governance-implementation-gap.md) | 纳西妲的代码层缺口分析 |
| [analysis/audit-full-2026-08-11.md](analysis/audit-full-2026-08-11.md) | 四轮全量审计（D/E/F 三组 40+ 发现 + 修复记录） |
| [analysis/three-front-external-ecosystem-2026-08-11.md](analysis/three-front-external-ecosystem-2026-08-11.md) | 三端外部生态联网调研 |

**已归档（原列于本节，实际在 `docs/archive/`）**：
`概念设计全面整合-项目实际阶段与路线图.md` · `Core-2-过渡阶段-全面接入改造计划.md` ·
`Cortex-Core-2-阶段全景.md` · `Cortex-演进方法论-九阶段闭环.md` ·
`黄金裔Agent体系与跨项目联邦架构设计.md` · `Agent标签词汇表-v2.0.md`

### 桌面端 / UI 层

| 文档/代码 | 定位 |
|------|------|
| `packages/desktop/` | Electron 双窗（桌宠 + 聊天）+ Live2D + Monaco（F11 登记——此前 UI 层为文档盲区） |
| `packages/design-tokens/` | 三端共享设计常量（ENGINEERING / PRESENCE / CHAT 三 palette） |
| [analysis/desktop-ui-design-history.md](analysis/desktop-ui-design-history.md) | 画布式 UI 三层架构设计史（**在 `analysis/`，不在 `core/`**） |
| [core/webui-architecture-design.md](core/webui-architecture-design.md) | WebUI 六面板设计（后端已删，前端未落地） |

> **已收敛文档**（内容已整合进〔概念设计全面整合〕，保留为历史参考；**该收敛文档本身亦已归档**）：
> - `archive/概念收敛-2026-06-模型调研与架构三线.md` → 已整合进全面整合 §二
> - `archive/治理层演进全史-从v1.1到v2.5.35.md` → 已整合进全面整合 §二
> - `archive/Core-2治理层架构推演全记录.md` → 核心概念已整合，细节保留
> - `core/意图响应体系设计.md` → 核心概念已整合进 §2.6（**该文件仍在 `core/`，未归档**）
> - `archive/2026-05-31-前沿对齐验证-架构全维度对比.md` → 外部验证锚点已吸收

---

## 宪法 (`docs/constitution/`)

| 文档 | 定位 |
|------|------|
| **Cortex 概念顶层设计 v3.8.md** | **现行宪法**（v3.8，AM-2026-0811-001 事实勘误修订） |
| archive/ | 宪法版本归档（含前代 v2.5.35 / 自动备份，不需要手动阅读） |
| backup/ | 修宪前备份（2份） |

> **治理转型说明**（v3.7）：`doc-govern/` 目录已于 6eefe676 删除，修宪记录以 `docs/amendments/AM-*.json` 为权威源，审计报告在 `docs/auditing/`。

---

## 修正案 (`docs/amendments/`)

每份 `.json` 文件是一次修宪提案的完整记录。按 `AM-YYYY-MMDD-NNN` 编号。

| 关键修正案 | 修了什么 |
|-----------|---------|
| AM-2026-0515-003 | §10.1 冲突解决三原则入宪 |
| AM-2026-0515-004 | 战略双柱拆分（钟离+霜凝） |
| AM-2026-0708-004 | 冲突解决"第四原则"→"规则四"命名修正 |
| AM-2026-0715-001 | 玉衡全量治理审计——10项缺口修复 |
| AM-2026-0722-003 | 宪法 v3.6 后续补充修正 |
| AM-2026-0801-001 | 宪法 v3.7 全面修订——图景盘点实测刷新 + 第二轮审查战果 |
| AM-2026-0811-001 | 宪法 v3.8 事实勘误修订——8 组 18 处量化自述对齐 |
| AM-2026-0926-001 | **草案·待裁决**——宪法 v3.9 事实勘误（包数 29→28 / agents.json 退役同步 / WebUI 锚点订正 / 测试基线去绝对值化）。审计已过：[审计报告](auditing/am-2026-0926-001-audit.md) |

---

## 审计报告 (`docs/auditing/`)

Agent（凝光/刻晴）的治理审计产出。按日期命名。

| 报告 | 审计对象 |
|------|---------|
| [am-2026-0926-001-audit.md](auditing/am-2026-0926-001-audit.md) | AM-2026-0926-001 审计（42 项判定 + 1 项提示）。可复用脚本：`npx tsx scripts/audit-amendment.ts <AM-ID>` |

---

## 历史归档 (`docs/archive/`)——参考价值，非现行

### 历史宪法 (`archive/constitution/`)

| 文档 | 状态 | 参考价值 |
|------|------|---------|
| [Cortex 概念顶层设计 v1.1-已废弃.md](archive/constitution/Cortex%20概念顶层设计%20v1.1-已废弃.md) | 废弃 | Expert Committee冲突收束三原则、HCA/CSA原始定义 |
| [Cortex 概念顶层设计 v2.3.md](archive/constitution/Cortex%20概念顶层设计%20v2.3.md) | 废弃 | 过渡版本 |

### Core 阶段讨论 (`archive/core/`)

| 文档 | 参考价值 |
|------|---------|
| [Core 阶段治理机制概念讨论.md](archive/core/Core%20阶段治理机制概念讨论.md) | 政府模型映射(人大/三省六部)、监理封驳权、八裂缝 |
| [v1.1-关键设计理念保留.md](archive/core/v1.1-关键设计理念保留.md) | v1.1中与v2.x不冲突的设计理念(已提取) |
| [Core-1-第四轮-记忆系统设计反思与工程教训.md](archive/core/Core-1-第四轮-记忆系统设计反思与工程教训.md) | 记忆系统CAS/BFS优化经验 |
| [Core-1-终局反思-实践心得与经验教训.md](archive/core/Core-1-终局反思-实践心得与经验教训.md) | Core-1收尾复盘 |

### Meso-Lite 阶段 (`archive/meso-lite/`)

| 文档 | 参考价值 |
|------|---------|
| [Cortex Meso 阶段——概念设计落地产出文档.md](archive/meso-lite/Cortex%20Meso%20阶段——概念设计落地产出文档.md) | **3162行**——议题一到七，技术选型到阶段策略 |
| 议题一~七 | 技术选型、项目形态、功能抽象、记忆系统、阶段策略、交互协议、横向关切 |

---

## 分析文档 (`docs/analysis/`)

纳西妲（知识库Agent）的系统分析报告。**2026-09-26 实测 48 份**（本图此前误记「15份」）。
含本轮新增的 [optimization-report-2026-09-26.md](analysis/optimization-report-2026-09-26.md)
与 [capability-system-2026-09-26.md](analysis/capability-system-2026-09-26.md)。

---

## 阅读路径建议

```
新人入门（30分钟）：
  概念设计全面整合(§一~§三) → 现行宪法(§1~§3)

治理层深入（1小时）：
  概念设计全面整合(§二·治理层) → 治理层设计(全文) → 现行宪法(§10/§11)

架构方向了解（1小时）：
  概念设计全面整合(全文) → 思考执行体系总纲 → consistency-design

Agent执行层了解（30分钟）：
  循环策略注册表设计 → 概念设计全面整合(§三·设计锚点) → pipeline.ts

代码层缺口了解（30分钟）：
  概念设计全面整合(§三) → core-2-governance-implementation-gap

历史追溯（按需）：
  废弃宪法v1.1 → v1.1关键设计理念保留 → Meso概念设计落地
```

---

*维护：手动更新。新增文档时在此注册。概念收敛文档更新后同步刷新。*
