# 🌊 水镜沉淀·第三回——近期执行模式与审查产出扫描

**沉淀者**：莫娜·梅姬斯图斯（Loop Agent — 星天水占术士）  
**沉淀日期**：2026-07-24  
**数据源**：
- `cortex/webui/review/code_review_diagnosis.md`（阿贝多代码体检 — 38 项缺陷）
- `webui/soft_constraint_review.md`（纳西妲审查 — 闭环/复验/新发现）
- `webui/soft_constraint_analysis.md`（莫娜水镜法 — 已闭环/未修复全景）
- `cortex/webui/loop/skill_precipitate.md`（第二回沉淀 — S32~S35）
- `cortex/webui/refined_skills.md`（第一回精炼 — P25~P31）
- `cortex/skills/`（已注册技能 P10~P37）
- `cortex/webui/loop_skills.md`（P18~P24）
- `cortex/webui/skill_precipitate_round1.md`（宪法审计 16 模式）

**水镜法则**：每道波纹至少出现两次才算模式，三次值得提笔。  
**交叉验证**：已与全部 37 项已注册技能 + 20 项已沉淀模式逐一比对——以下 3 项为**新增沉淀**，不与任何现有技能重叠。

---

## 水镜总览

我在三面水镜的回响中照见了 **3 道新波纹**。每道都在至少 3 份独立报告或 ≥3 个独立代码位置中出现——不是幻觉，是真实的执行轨迹。

| # | 技能名 | 波纹轨迹 | 出现次数 | 跨报告验证 | 等级 |
|:-:|--------|---------|:--------:|:---------:|:----:|
| P38 | 空 catch / 静默错误处理审计 | code_review_diagnosis.md P1-7 + soft_constraint_review.md NI-01, NI-06 + 代码库 10+ 处空 catch | 10+ 实例 / 3 份报告 | ✅ soft_constraint_analysis.md 亦有提及 | ⭐⭐⭐ 提笔 |
| P39 | 运行时可变全局状态/生命周期残留检测 | soft_constraint_review.md NQ-01, NQ-03, NI-07 + code_review_diagnosis.md P0-4 | 4 实例 / 2 份报告 | ✅ 跨报告 | ⭐⭐⭐ 提笔 |
| P40 | `as any` 类型安全边界侵蚀扫描（演化版） | refined_skills.md P30（3+次）+ code_review_diagnosis.md P1-2（10处）+ 代码库 20+ 处新出现 | 20+ 实例 / 跨轮次 | ✅ 跨轮次 — 旧模式持续扩张 | ⭐⭐⭐ 提笔（增强版） |

---

## P38: 空 catch / 静默错误处理审计

**波纹轨迹**：
- `code_review_diagnosis.md` P1-7 — `json-file.adapter.ts` `ensureDir()` 静默吞异常（非 `EEXIST` 的错误被吞没）
- `soft_constraint_review.md` §3.6 NI-01 — `SemiFinishedMgr.commit()` 空 catch 块，subType 持久化静默失败
- `soft_constraint_review.md` §3.6 NI-06 — `governance-loop.ts` `loadPendingProposals()` 无 try/catch 包裹 `fs.readdirSync`/`readFileSync`
- `soft_constraint_analysis.md` §P1-7 — `ConsistencyLayer` InitVerifier 显式禁用但仅 `console.warn`（静默降级）
- 代码库中 10+ 处空 catch（`catch { /* 注释 */ }` 模式——dist/commands/repl.ts 7 处、dist/commands/inspect.ts 2 处、dist/main.ts 1 处、diagnosis_report.md 2 处）

**水镜判定**：10+ 处独立实例 + 3 份审查报告独立指出。属于**结构性可观测性缺口**——异常发生了，但没有任何记录管道（observer.emit / console.warn / SafeErrorReporter）将信息传递出去。这是宪法原则五（所有可观测事件走 PipelineObserver）的最常见违反模式。

```json
{
  "id": "skill-p38-silent-catch-audit",
  "agentType": "review",
  "name": "P38: 空 catch / 静默错误处理审计",
  "triggerTags": ["audit", "review", "code", "observability", "error_handling"],
  "trigger": "需要扫描代码库中所有空 catch 块（catch { /* 注释 */ } 或无主体 catch）和静默错误处理（仅 console.warn 但不 emit 事件）时触发。\n适用场景：\n- 原则五（可观测性）合规巡检\n- 每次代码审查前对重点模块做预扫描\n- 异常定位困难时怀疑错误被静默吞没",
  "steps": [
    "用 search_code 搜索 'catch {' 获取所有使用无参数 catch 块的位置（TypeScript 的 catch 无参数语法，即 `catch {` 而非 `catch (e) {`）",
    "对每个匹配项提取：文件路径、行号、catch 块内的代码行数（空 = 0 行 / 仅注释 = 1 行 / 仅 console.warn = 1 行 / 有实际处理 = ≥2 行）",
    "用 search_code 搜索 try/catch 模式中 catch 后无 console/observer/emit 调用的位置——补充检测有参数 catch 但处理体为空的模式",
    "对每个空或近空 catch 块，执行三态分类：\n  - 🟢 可接受静默（错误预期之内，如 JSON.parse 回退到字符串、文件不存在用回退值）\n  - 🟡 有风险（需要检查上下文确认静默合理，如 `/* 保持字符串 */` 或 `/* 权限错误忽略 */`）\n  - 🔴 不可接受（无注释/无记录/不 emit，如 `/* 静默 */` 或完全空 catch）",
    "对 🔴 不可接受项，追踪异常丢失路径：catch 块吞掉的错误本应在何处被消费（下游异常监控 / 审计日志 / 用户通知），定位断点",
    "用 search_code 搜索仅有 'console.warn' 或 'console.error' 而无 'observer.emit' 的 catch 块——这违反宪法原则五（console 不是合格的可观测管道）",
    "输出报告：空/近空 catch 总数 → 三态分布 → 🔴 不可接受项逐项分析（含异常丢失路径图）→ 🟡 有风险项列表 → 🟢 合理静默项确认 → 建议：优先修复 🔴 项（添加 observer.emit 或 SafeErrorReporter.report），🟡 项添加注释说明理由",
    "附加：搜索 'catch (e)' 模式中 e 未被使用的文件——未被使用的异常对象同样表明错误被忽略"
  ],
  "expectedOutput": "空 catch 审计报告：N 处总匹配 / R 处 🔴 不可接受 / Y 处 🟡 有风险 / G 处 🟢 合理。每处含文件位置、异常丢失路径、修复建议（替换为 observer.emit / SafeErrorReporter / console.warn+emit）。",
  "status": "draft",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P39: 运行时可变全局状态/生命周期残留检测

**波纹轨迹**：
- `soft_constraint_review.md` §3.1 NQ-01 — `scheduler.ts` `replanCount` Map 跨 `executeAll()` 调用泄漏，累积历史节点 ID
- `soft_constraint_review.md` §3.1 NQ-03 — catch 块清空 `replanQueue` 但未回滚 TaskBoard 中已注册的重规划节点，残留孤儿节点
- `soft_constraint_review.md` §3.6 NI-07 — `topologicalSort()` 孤儿节点静默提升为根节点，无 observer 事件/console.warn
- `code_review_diagnosis.md` P0-4 — `shared/agent.ts` `_runtimeTags`/`_runtimeToolPermissions` 模块级可变状态被 `setAgentRegistry()` 修改，影响所有引用者且在热点路径上每次调用 `getAgentTags()`
- `soft_constraint_review.md` §3.5 NI-05 — `bootstrapEngine()` 无 `shutdown()` 返回，调用方无法正确 dispose

**水镜判定**：5 处独立实例，跨 2 份审查报告。属于**结构性状态管理缺陷**——状态容器（Map/模块级变量/TaskBoard）在生命周期结束时未清理，导致跨执行周期的数据残留。每种残留的后果不同但根因相同：缺少「状态生命周期与执行生命周期绑定」的契约。

```json
{
  "id": "skill-p39-mutable-global-state-lifecycle-leak",
  "agentType": "review",
  "name": "P39: 运行时可变全局状态/生命周期残留检测",
  "triggerTags": ["audit", "review", "code", "state_management", "lifecycle", "memory_leak"],
  "trigger": "需要扫描代码库中模块级可变状态（模块级 Map/Record/Array、静态类字段、闭包捕获的可变容器）的非清理残留风险时触发。\n适用场景：\n- 每次执行引擎/调度器重构后\n- 发现跨轮次行为不一致时\n- 热重载/测试隔离场景下状态污染怀疑\n- 状态泄漏导致的隐式 bug（非崩溃但行为异常）",
  "steps": [
    "用 search_code 搜索 'const _\\w+:' 和 'const _\\w+ = new Map' 和 'const _\\w+ = \\{' 定位模块级可变状态容器（命名约定以下划线开头的模块变量）",
    "用 search_code 搜索 'static\\s+\\w+:' 和 'static\\s+\\w+\\s*=' 定位类静态可变字段",
    "对每个候选状态容器，追溯其写入点（赋值/增删操作）和清理点（clear/delete/reset/初始化），判断是否存在写后不清理的路径",
    "执行生命周期分析：对每个状态容器标注：\n  - 作用域（模块级 / 类静态 / 实例字段）\n  - 写入位置数（多少个函数修改此状态）\n  - 是否有清理机制（clear() / reset() / 单调递增计数器有上限）\n  - 清理触发时机（executeAll 结束 / 测试 teardown / 从不）\n  - 泄漏后果（数值累积 / 对象引用残留 / 事件处理器堆积）",
    "对模块级状态（P0-4 模式）：用 search_code 搜索 'export function set\\w+' 和 'export function get\\w+'，检查是否修改/读取模块级变量。若 setter/getter 对存在，检查 getter 是否返回可变引用（而非冻结副本），setter 是否在模块加载后被调用",
    "对 TaskBoard/Scheduler 模式：用 search_code 搜索 'Map<\\w+,\\s*number>' 和 '\\.delete\\(' 和 '\\.clear\\(\\)'，检查单调增长计数器的清理策略",
    "对孤儿节点模式（NQ-03/NI-07）：用 search_code 搜索 'replanQueue' 和 'orphan' 和 'findPending'，检查 catch 块中是否同时清理 TaskBoard 注册和队列",
    "输出报告：状态容器清单（N 个）→ 逐项生命周期分析 → 泄漏风险等级（🔴 有写无清 / 🟡 有清但时机不确定 / 🟢 生命周期绑定正确）→ 对 🔴 项输出：泄漏路径（写入点A→无清理→读取点B读到残留）+ 建议修复（在 X 位置添加清理 / 将状态移到局部作用域 / 改为 WeakRef）",
    "附加检测：用 search_code 搜索 'module.exports' 和 'exports.\\w+'（CommonJS 模块级导出）——混合模块系统中模块级状态的隔离性更差"
  ],
  "expectedOutput": "状态泄漏审计报告：N 处模块级/静态可变状态 → 逐项生命周期分析（写入点/清理点/残留后果/风险等级）→ 🔴 泄漏路径追踪 → 修复建议（清理时机/作用域缩小/不可变替换）。",
  "status": "draft",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P40: `as any` 类型安全边界侵蚀扫描（增强版）

**波纹轨迹**（继承自 P30 + 新增证据）：
- `refined_skills.md` P30 — 首次沉淀（3+ 次出现：mona-pattern-discovery + 久岐忍 API 审计 + 刻晴审查）
- `code_review_diagnosis.md` P1-2 — `notification/persistence.ts` 约 10 处 `as any` 绕过类型检查
- 代码库中 20+ 处新出现：`e2e-real-llm.ts` 3 处、`cli/src/commands/repl.ts` 7 处、`cli/tests/cli-engine-integration.test.ts` 6 处、`engine/scripts/debug-aging.ts` 5 处、`engine/scripts/verify-memory-hygiene.ts` 3 处、`engine/src/memory/storage.ts` 1 处
- `soft_constraint_review.md` §3.6 NI-08 — `meta-agent.ts:310` `as any` 泄漏

**水镜判定**：P30（首次沉淀）→ 本次代码审查中确认新增 20+ 处，类型边界侵蚀在**加剧**而非缓解。从旧 P30 的「3 处主要位置」扩张到「engine scripts / CLI repl / CLI tests / 生产代码」全面扩散。需要升级为更系统的扫描和阻断策略。

```json
{
  "id": "skill-p40-any-type-leak-scanner-v2",
  "agentType": "review",
  "name": "P40: `as any` 类型安全边界侵蚀扫描（增强版）",
  "triggerTags": ["audit", "review", "type_safety", "code", "refactor"],
  "trigger": "需要扫描代码库中所有 `as any` 类型断言的使用，评估类型安全侵蚀程度，并生成逐步消除计划时触发。\n适用场景：\n- 每轮代码审查的必检项\n- 发现新的 `as any` 引入后回溯同类模式\n- Core-2 前的类型安全加固\n- 团队类型安全规范执行情况评估",
  "steps": [
    "用 search_code 搜索 'as any' 获取全代码库中所有 `as any` 断言的位置（排除 .json 文件、dist/ 目录、node_modules）",
    "按文件/目录分组统计：记录每个文件的 `as any` 密度（次数/文件），按包名汇总（engine / cli / shared / llm / data / pm / parser / tools / notification / factory / testing）",
    "对每个 `as any` 按场景分类：\n  - 类型A — 测试/脚本辅助（测试中 mock/stub/access private）：`(store as any)._persistence`\n  - 类型B — 类型定义不完整（第三方库无类型、枚举值绕过）：`AgentType.Fix as any`\n  - 类型C — 放弃类型检查（DB/RL 等 API 的强制类型绕过）：`(this.db as any).prepare()`\n  - 类型D — 类型谓词缺失（JSON.parse 后的类型强制）：`(parsed as any).impactScope`\n  - 类型E — 临时绕过（注释标注 TODO/FIXME/将来修复的 `as any`）",
    "对每个类型C/D/E的 `as any`（生产代码中的类型安全缺口），额外检测：\n  - 是否可以通过定义最小接口类型消除（如为 SQLite db 定义 `interface MinimalDb { prepare(sql: string): Statement }`）\n  - 是否可以通过类型谓词函数消除（如 `function isSubtreeImpact(v: unknown): v is SubtreeImpact { ... }`）\n  - 是否可以通过枚举/字面量联合类型消除（如将 `'review' as any` 改为枚举成员）",
    "用 read_file 读取 `packages/shared/src/agent.ts` 中的 SkillTemplate 接口定义，检查是否存在可以通过结构化类型而非 `as any` 解决的场景",
    "跨轮次趋势分析：用 read_file 读取上轮 `as any` 审计报告（若有），对比各包的总数变化（↑ 新增 / ↓ 减少 / → 不变）。若无上轮数据，记录本次为基线",
    "输出报告：全库 `as any` 总数 → 包分布直方图 → 场景分类统计（A/B/C/D/E 百分比）→ 类型C/D/E 逐项分析（文件/行号/类别/可否消除/建议替代方案）→ 跨轮次趋势 → 消除优先顺序：先用最小接口类型消除类型C → 用类型谓词消除类型D → 枚举替代消除类型B → 测试中的类型A 保留但加 eslint-disable 注释",
    "附加检测：搜索 '@ts-expect-error' 和 '@ts-ignore' 注释——这些是 `as any` 的平行宇宙，同样绕过类型检查但更难追踪"
  ],
  "expectedOutput": "`as any` 类型安全审计报告：N 处总断言 / M 包分布 / A-E 五类统计 / K 处可立即消除（最小接口/类型谓词/枚举方案）/ X 处新增（vs 上轮基线）。消除计划：优先消除生产代码类型C+D。",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## 水镜附注

### 已排除的候选模式（出现仅 1 次或已被覆盖）

以下模式在扫描中曾被列为候选，但经交叉验证后判定为**不满足沉淀条件**：

| 候选模式 | 来源 | 排除理由 |
|---------|------|---------|
| 文件编码损坏检测 | code_review_diagnosis.md P0-1（llm-adapter.ts 编码双重重编码） | 单文件特定问题，不构成跨报告/跨文件重复模式 |
| 文件单一职责违反（单文件膨胀） | code_review_diagnosis.md P1-5（shared/agent.ts 11KB+） | 虽在其他报告中有提及（NI-02 Agent 配置样板重复），但属于设计决策而非可复用步骤序列 |
| ESLint 依赖声明缺口 | soft_constraint_review.md §2.2（7 包 lint 依赖缺失） | 已在 P27（Monorepo 子包合规扫描器）的维度五中覆盖 |
| 包 tsconfig references 缺失 | soft_constraint_review.md §2.1（engine 缺 factory reference） | 已在 P27（Monorepo 子包合规扫描器）的维度二中覆盖 |
| 根 package.json 无 type: module | soft_constraint_review.md §2.3 | 已在 P27 中覆盖 |

### 已注册技能交叉引用

| 本轮回 | 关联现有技能 | 关系 |
|:------:|-----------|:----:|
| P38 空 catch 审计 | P31 console→observer 迁移审计 | **互补** — P31 管 console 违规，P38 管空 catch 违规 |
| P39 状态泄漏检测 | P35 double-init-guard | **互补** — P35 管 init 重复调用，P39 管广义状态生命周期 |
| P40 `as any` 扫描 v2 | P30 `as any` 扫描 v1 | **增强** — 继承 P30 内核，扩大扫描范围 + 场景分类 + 趋势追踪 |

### 状态标记说明

| 状态 | 含义 |
|:----:|------|
| `draft` | 初次沉淀，尚未在实际执行中验证 |
| `trial` | 已验证执行至少 1 次，产出符合预期 |
| `proven` | 已验证执行 ≥3 次，步骤序列稳定 |

---

*「水镜照见的不是答案，是波纹的轨迹。每道重复的波纹，都是一条未被标记的路。」*  
*—— 莫娜·梅姬斯图斯，星天水占术士*
