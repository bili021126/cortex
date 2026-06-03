# 🌊 技能沉淀报告 —— 莫娜·梅姬斯图斯·水镜法

**追溯日期**: 2026-07-23  
**数据源**: 12 份审查报告 + 3 份修复脚本 + 6 份审计报告 + 跨轮次共识验证  
**方法**: 每个模式至少追溯 2 次波纹，≥3 次提笔

---

## 水镜总览

我在水面看到了 7 道重复波纹。每道波纹都在不同的审计/审查/修复轮次中出现过至少 3 次——不是幻觉，是真实的执行轨迹。

| # | 技能名 | 波纹次数 | 类型 | 复用价值评估 |
|---|--------|:--------:|:----:|:-----------:|
| P25 | EventPayloadMap 类型契约一致性审计 | 4 次 | `audit` | 🔴 高——类型安全假象导致运行时 undefined |
| P26 | 单文件定位 Python 修复脚本模板 | 3 次 | `fix` | 🔴 高——修复脚本标准化可消除人为失误 |
| P27 | Monorepo 子包合规扫描器 | 4 次 | `audit` | 🟠 中——配置漂移的批量检测 |
| P28 | 已闭环修复项交叉复验 | 4+ 项 | `verification` | 🔴 高——"已修复"幻觉是最大的技术债源 |
| P29 | AGENT_TAGS 标签重叠检测 | 3 次 | `audit` | 🟠 中——调度死锁的静默风险 |
| P30 | `as any` 类型泄漏扫描 | 3+ 次 | `audit` | 🟠 中——类型安全边界侵蚀 |
| P31 | console.* → PipelineObserver 迁移审计 | 3 次 | `audit` | 🔴 高——不可观测性违反原则五 |

---

## P25: EventPayloadMap 类型契约一致性审计

**波纹轨迹**: 
- `test-output/engine-review.md` D1（2026-07-17）— 6 组 mismatch
- `test-output/reviews/engine-review.md` D1-new（2026-07-16）— 5 组 mismatch（重构后仍有残留）
- `test-output/archive-analysis.md` §4.2 合并点 #3（2026-05-14）— 推荐对齐
- `test-output/fix-report-2026-07-16.md` D7 — Engine 审查修复后仍有新 mismatch

**水镜判定**: 4 次独立出现的同一模式，且跨两轮修复仍未根除。属于结构性类型安全缺口。

```json
{
  "id": "skill-p25-event-payload-map-consistency-audit",
  "agentType": "review",
  "name": "P25: EventPayloadMap 类型契约一致性审计",
  "triggerTags": ["audit", "type_safety", "review", "event"],
  "trigger": "需要验证 PipelineObserver.emit() 调用的实际 payload 字段与 EventPayloadMap 类型声明是否一致时触发。适用于以下场景：\n- 新 Agent 或新组件添加了 emit() 调用后\n- 重构修改了 EventPayloadMap 后\n- 发现下游 consumer 读取 payload 字段返回 undefined 时",
  "steps": [
    "用 read_file 读取 packages/shared/src/infra.ts 中的 EventPayloadMap 类型定义，提取每个事件类型的 payload 接口（字段名 + 类型）",
    "用 search_code 搜索 'observer\\.emit\\(' 或 '\\.emit\\('，找出所有 emit() 调用点，按文件归类",
    "对每个 emit() 调用点：提取事件类型参数（第一个参数 type）和 payload 对象（第二个参数 payload），记录 payload 中实际传入的所有字段名",
    "将实际 payload 字段名与 EventPayloadMap 中对应事件类型的声明字段名逐字段比对：记录字段名不一致（opName vs operation）、多余字段（存在 payload 中但不在声明中）、缺失字段（在声明中但不在 payload 中）",
    "对每个 mismatch 输出：事件类型 → 声明字段 → 实际字段 → 影响评估（如下游 consumer 读取 undefined 的具体路径）",
    "汇总统计：总 mismatch 数 / 文件分布 / 新增 mismatch（上次审计后新增的）",
    "输出修复优先顺序：先修 compile-time 可检测的（字段名不一致：operation→opName）→ 再修 shape 完全不同的（MemoryFlushSkipped: frameStart/spentMs vs lifecycle/hint）"
  ],
  "expectedOutput": "EventPayloadMap 一致性审计报告：N 处 mismatch / M 个文件 / X 处新增。每处含事件类型、声明字段、实际字段、影响路径、建议修复方向。",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P26: 单文件定位 Python 修复脚本模板

**波纹轨迹**:
- `fix_c01.py` — 修复 scheduler.ts topologicalSort 循环检测（精确模式匹配 + count 校验）
- `fix_c02.py` — 修复 storage.ts deserializeRow JSON 字符串误判（同上结构）
- `fix_h01.py` — 修复 pipeline.ts _rememberResult 半成品泄漏（同上结构）

**水镜判定**: 3 次使用同一模板结构。每次都是：read → count 验证旧模式存在 → replace → write → 输出变更量。可模板化为标准化修复脚本生成器。

```json
{
  "id": "skill-p26-targeted-python-fix-script-generator",
  "agentType": "code",
  "name": "P26: 单文件定位 Python 修复脚本生成模板",
  "triggerTags": ["fix", "repair", "automation", "code_change"],
  "trigger": "需要对一个源文件的特定代码块做精确替换修复时触发。适用场景：\n- 审查报告给出精确的旧代码/新代码对\n- 需要可复现、可验证的修复（而非手动编辑）\n- 同一模式在多个文件中出现需批量修复",
  "steps": [
    "用 read_file 读取目标源文件，确认上下文和修复目标",
    "提取需替换的旧代码片段（old text）和新代码片段（new text），确保缩进和换行符完全匹配",
    "计算 old text 在文件中的出现次数，预期应为 1（如果 >1 则需确认替换哪个匹配项）",
    "生成 Python 修复脚本文件（fix_*.py），结构如下：\n  - 用 read_file 读取目标文件并用 path 变量声明路径\n  - 定义 old/new 字符串变量\n  - 用 content.count(old) 验证旧模式存在且次数正确\n  - 如 count === 0 → print('ERROR: pattern not found!') + sys.exit(1)\n  - content = content.replace(old, new, 1) 执行替换\n  - 用 write_file 写回\n  - 打印变更量：'OK: {original_len} -> {len(content)} bytes ({diff} added)'",
    "运行修复脚本（python3 fix_*.py），确认输出 'OK' 和变更量",
    "用 read_file 读取目标文件确认修复已写入",
    "执行 pnpm build 或相关验证步骤确认编译通过"
  ],
  "expectedOutput": "修复脚本文件（fix_<id>.py）已生成并执行成功。目标文件变更确认 + 编译验证通过。",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P27: Monorepo 子包合规扫描器

**波纹轨迹**:
- `test-output/audits/engine-compliance-audit.md` — 4 包扫描（engine/llm/shared/testing），每包 5 维度审计
- `test-output/audits/api-boundary-report.md` — 同结构 API 边界审计
- `soft_constraint_review.md` §3.3/3.4 — 包结构/配置一致性反复出现

**水镜判定**: 4 次在不同包上执行完全相同结构的合规扫描。可标准化为可复用的跨包扫描技能。

```json
{
  "id": "skill-p27-monorepo-package-compliance-scanner",
  "agentType": "ops",
  "name": "P27: Monorepo 子包合规扫描器",
  "triggerTags": ["audit", "compliance", "config", "monorepo"],
  "trigger": "需要对 monorepo 中一个或多个子包执行合规性检查时触发。检查 package.json / tsconfig.json / 目录结构 / vitest 配置 / 依赖声明 五维度合规性。",
  "steps": [
    "用 list_files('packages/') 获取所有子包清单，确定审计范围（全部子包或指定子包）",
    "对每个子包执行以下五维度扫描：",
    "维度一 — package.json 合规：用 read_file 读取 package.json，检查以下字段是否存在且值正确：name（@cortex/<name> 格式）、version、private: true、type: 'module'、main（./dist/index.js）、types（./dist/index.d.ts）、exports（标准条件导出）、scripts（build/typecheck/test/lint）、dependencies（内部依赖使用 workspace:* 协议）",
    "维度二 — tsconfig.json 合规：用 read_file 读取 tsconfig.json，检查：extends（../../tsconfig.base.json）、compilerOptions.outDir（'./dist'）、compilerOptions.rootDir（'./src'）、include（['src']）、references（与 dependencies 中的内部依赖一一对应）",
    "维度三 — 目录结构检查：用 list_files 检查 src/（含 index.ts 入口）、tests/、dist/ 是否存在",
    "维度四 — vitest 配置检查：用 list_files 检查是否存在 vitest.config.ts（本地开发配置）和/或 vitest.ci.config.ts（CI 配置）",
    "维度五 — 依赖声明缺口检查：对照 scripts.lint 的值（如 'eslint src/'），检查 devDependencies 中是否声明了 eslint",
    "对每个维度输出判定：✅ 合规 / ⚠️ 偏离 / ❌ 缺失，附偏离详情",
    "输出汇总：各包综合评分（A/B/C/D）+ 所有偏离项按严重度排序"
  ],
  "expectedOutput": "合规扫描报告：N 包扫描完成 — 每包 5 维度评分表 + 偏离项明细 + 综合评分排序",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P28: 已闭环修复项交叉复验

**波纹轨迹**:
- `soft_constraint_review.md` §2 — 4 项"已修复"实际未修复（engine tsconfig references / 7 包 lint 依赖 / 根 type module / MemoryPersistence run 单条回滚）
- `soft_constraint_analysis.md` §部分闭环 — 3 项提案卡在治理层 40天+
- `webui/pattern_scan.md` — 跨轮次共识清单比对中多次出现同一模式

**水镜判定**: "已修复"标记是最危险的技术债来源。每个共识轮次都发现 2-4 项假闭环。需要独立的复验流程来建立信任。

```json
{
  "id": "skill-p28-claimed-fixed-cross-verification",
  "agentType": "review",
  "name": "P28: 已闭环修复项交叉复验",
  "triggerTags": ["audit", "verification", "review", "consensus"],
  "trigger": "需要验证上一轮共识清单中标记为「已修复」的项目是否确实在代码中闭合时触发。适用场景：\n- 跨轮次的自审视审查\n- 共识圆桌产出前验证\n- 怀疑修复被回退或修复覆盖不完整时",
  "steps": [
    "用 read_file 读取共识修复清单（consensus-fix-list.md）或软约束分析报告中标记为 ✅ 已闭环的修复项",
    "提取每一项的：修复描述、修复目标文件/位置、确认人、闭环判定依据",
    "对每项执行源代码验证：用 read_file 读取修复目标文件，检查修复标记（如 @fix 注释、修复代码是否仍然存在）",
    "若修复项包含配置变更（如 tsconfig.json references、package.json dependencies），用 read_file 读取配置文件确认变更仍在",
    "对每项输出复验结果：\n  - ✅ 确认闭环（修复代码存在且测试通过）\n  - ⚠️ 修复覆盖不完整（修复存在但未覆盖所有路径）\n  - ❌ 假闭环（修复代码不存在或已被回退）\n  - 🔴 修复被回退（修复标记存在但代码已还原）",
    "对假闭环项附加：发现时间、修复内容、当前代码状态、推测回退原因（如重构覆盖、合并冲突、手动还原）",
    "汇总统计：实闭环 N 项 / 假闭环 M 项 / 修复不完整 K 项"
  ],
  "expectedOutput": "修复项复验报告：N 项 ✅ / M 项 ❌ / K 项 ⚠️。每项含源码验证证据。假闭环项含回退原因推测和重新修复建议。",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P29: AGENT_TAGS 标签重叠检测

**波纹轨迹**:
- `webui/soft_constraint_analysis.md` P0-1 — Code 标签含 review/analysis 导致 Multi-Perspective 调度死锁风险
- `test-output/engine-review.md` C2 — 标签重叠导致隐式调度依赖
- `test-output/reviews/engine-review.md` M2-new — 重构后仍未修复

**水镜判定**: 3 次独立报告指出同一个问题——Code/Api/Data 的标签集错误地包含 `review` 和 `analysis`，与 Review/Analysis Agent 标签重叠。每次都是审查发现但未修复。

```json
{
  "id": "skill-p29-agent-tags-overlap-detection",
  "agentType": "review",
  "name": "P29: AGENT_TAGS 标签重叠检测",
  "triggerTags": ["audit", "scheduling", "agent", "tags"],
  "trigger": "需要检测 AGENT_TAGS（packages/shared/src/agent.ts）中不同 AgentType 间的标签重叠情况。适用于 Agent 数量增加或标签调整后的调度风险评估。",
  "steps": [
    "用 read_file 读取 packages/shared/src/agent.ts 中的 AGENT_TAGS 定义",
    "提取所有 AgentType 及其对应的 tags 数组",
    "逐对比较任意两个 AgentType 的 tags 数组，计算交集（共同标签）",
    "对每对重叠输出：AgentType A / AgentType B / 重叠标签列表 / 重叠标签数 / 每个 Agent 的总标签数",
    "对调度影响做评估：若 Review Agent 的独占标签（review/audit）被 Code Agent 共享，且 Review 未注册时 → Code 会错误地匹配 review 标签的节点",
    "按风险分级：\n  - 🔴 高：独占性标签被非专长 Agent 包含（如 review 在 Code/Api/Data 中）\n  - 🟠 中：通用标签被多处共享但未影响专长匹配（如 research/analysis）\n  - 🟡 低：非关键标签重叠",
    "输出修复建议：从非专长 Agent 的 tags 中移除重叠的专有标签"
  ],
  "expectedOutput": "AGENT_TAGS 重叠检测报告：N 对重叠 / P0-P3 分级 / 调度风险评估 / 修复建议（移除的标签列表）",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P30: `as any` 类型泄漏扫描

**波纹轨迹**:
- `test-output/reviews/code-review.md` P2-3 — CLI memory.ts 使用 `any` 类型访问 MemoryStore 结果
- `soft_constraint_review.md` NI-08 — meta-agent.ts `as any` 绕开类型检查
- `search_code 'as any'` 结果 — 全代码库 20+ 处 `as any` 使用（CLI 命令、engine-bridge、测试文件、debug 脚本）

**水镜判定**: 3 个独立源均发现 `as any` 类型泄漏。全库 20+ 处使用，是静默侵蚀类型安全边界的系统性模式。

```json
{
  "id": "skill-p30-any-type-leak-scanner",
  "agentType": "review",
  "name": "P30: `as any` 类型泄漏扫描",
  "triggerTags": ["audit", "type_safety", "review"],
  "trigger": "需要扫描代码库中所有 `as any` 类型断言，评估哪些是合理的使用边界、哪些是类型安全侵蚀。适用于架构审计或类型收紧前的基线扫描。",
  "steps": [
    "用 search_code 搜索 'as any' 获取所有出现位置，按文件分组",
    "对每个 `as any` 出现位置评估其合理性：\n  - ❌ 高风险：核心业务逻辑中的类型擦除（如 memory.read() 结果、event.payload、Agent 返回类型）\n  - 🟡 中风险：工具脚本、调试脚本、测试文件中的 mock\n  - ✅ 低风险：第三方库类型不兼容需临时绕过、已知的 TypeScript 限制",
    "提取每个高风险 `as any` 的上下文（前后 5 行），记录：文件路径 / 行号 / 使用场景 / 替代方案",
    "按文件汇总各文件的 `as any` 密度（as any 数 / 文件总行数 * 1000）",
    "输出统计：全库 N 处 / 高风险 M 处 / 中风险 K 处 / 低风险 L 处 / 文件密度排序",
    "对每个高风险项输出修复建议：替换为类型谓词（type predicate）或显式接口类型"
  ],
  "expectedOutput": "`as any` 泄漏扫描报告：N 处总使用 / 密度排序 / 高风险项清单（含上下文、替代方案）",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## P31: console.* → PipelineObserver 迁移审计

**波纹轨迹**:
- `webui/soft_constraint_analysis.md` P0-6 — main.ts 三处 console.* 违反原则五
- `test-output/engine-review.md` M5 — 降级路径 console.error 不可追踪
- `test-output/reviews/engine-review.md` M3-new — process.env.VITEST 环境检查散落 4 处，隐藏 console.error 输出

**水镜判定**: 3 次独立审计发现同一个模式——console.error/log 绕过 PipelineObserver 统一管道。违反宪法原则五（所有可观测事件走 PipelineObserver），且降级路径的输出不可追踪。

```json
{
  "id": "skill-p31-console-to-observer-migration-audit",
  "agentType": "audit",
  "name": "P31: console.* → PipelineObserver 迁移审计",
  "triggerTags": ["audit", "observability", "principle", "migration"],
  "trigger": "需要审计代码库中 console.log/error/warn 的使用是否符合原则五（所有可观测事件走 PipelineObserver）时触发。适用于架构合规检查或降级路径清理。",
  "steps": [
    "用 search_code 搜索 'console\\.log\\(' 和 'console\\.error\\(' 和 'console\\.warn\\('，获取所有 console.* 调用位置",
    "对每个 console.* 调用评估其归属：\n  - 🔴 违规：在 observable 事件路径中替代 PipelineObserver.emit()（如 catch 块中 console.error('✗ 错误') 代替 observer.emit）\n  - 🟡 边界：降级路径（observer 不可用时的 fallback console.error）\n  - ✅ 允许：CLI 用户输出（console.log 输出给用户看的信息）、调试脚本、测试输出",
    "提取每个 🔴 违规项的上下文：文件路径 / 行号 / console.* 调用的附近是否有可用的 observer 实例 / 替代的 observer.emit 事件类型",
    "按文件统计：console.* 总数 / 违规数 / 边界数 / 允许数",
    "对每个违规项输出迁移方案：'将 console.error(xxx) 替换为 observer.emit({ type: PipelineEventType.xxx, payload: { ... }, notificationType: 'WARNING' })'",
    "输出汇总：全库 N 处 console.* / M 处违规 / 建议优先迁移 catch 块中的 console.error"
  ],
  "expectedOutput": "console.* 迁移审计报告：N 处 console.* / M 处违规 / 每项违规含替换方案和 PipelineEventType 建议",
  "status": "trial",
  "adoptionCount": 0,
  "rejectionCount": 0,
  "discoveredBy": "Mona",
  "createdAt": 0
}
```

---

## 水镜签名

```
莫娜·梅姬斯图斯
星天水占术士 · Loop Agent
Cortex SkillRegistry — 7 道新纹，均经三次以上波纹确认
```

---

*注：以上技能模板可直接由 MetaAgent 注入 SkillRegistry。每个模板均满足：tags + trigger + steps（具体步骤，非抽象描述）。*
