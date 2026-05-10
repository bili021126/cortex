# 🔮 莫娜的星盘：第二次占卜——模式发现与命运预言

> **占星术士**：莫娜（Loop Agent · 莫娜）
> **扫描基线**：`packages/engine/src/` × `packages/shared/src/` × `docs/` 跨区交叉
> **参考前次**：`test-output/self-examination-soft/mona-pattern-discovery.md`（已归档）
> **本次新增**：第二次自由审视——观察收敛趋势、技术债演化、重复模式深层结构
> **日期**：2026-05-11

---

## 目录

1. [模式 A：try-catch 风格统一性——进化还是发散？](#模式-itry-catch-风格统一性进化还是发散)
2. [模式 B：observer.emit 调用分布——接入率与链路完整性](#模式-biobserveremit-调用分布接入率与链路完整性)
3. [模式 C：重复代码模式——≥3 模块共享的骨架结构](#模式-c重复代码模式3-模块共享的骨架结构)
4. [模式 D：SafeErrorReporter 注入 vs PipelineObserver 双轨制](#模式-dsafeerrorreporter-注入-vs-pipelineobserver-双轨制)
5. [演进趋势：三轮自审视的收敛 vs 发散](#演进趋势三轮自审视的收敛-vs-发散)
6. [命运预言：三个月后的最大技术债与风险](#命运预言三个月后的最大技术债与风险)

---

## 模式 A：try-catch 风格统一性——进化还是发散？

### A1. 四象限分布（本轮扫描）

| 风格 | 模式 | 上轮计数 | 本轮计数 | 变化 | 使用文件 |
|------|------|:-------:|:-------:|:----:|---------|
| ① `catch (e)` + `String(e)` | `catch(e){…String(e)…}` | **28** | **30** | ↑+2 | toolkit.ts(8), memory-store.ts(9), scheduler.ts(5→7↑), llm-adapter.ts(4→3↓), base-agent.ts(1), browser-agent.ts(1→2↑) |
| ② `catch (e: any)` + `e?.message` | `catch(e:any){…e?.message…}` | **4** | **3** | ↓-1 | inspector-agent.ts(2→1↓), llm-adapter.ts(1), react-helper.ts(1) |
| ③ `catch` + `console.error` 降级 | `catch(e){console.error(…)}` | **5** | **4** | ↓-1 | pipeline-observer.ts(1), file-lock-manager.ts(1), scheduler.ts(3→2↓) |
| ④ `catch` + 静默忽略 | `catch(e){}`==空体== | **2** | **1** | ↓-1 | browser-agent.ts(1), inspector-agent.ts(1→0↓) |

### A2. 关键变化注释

**正向收敛**：
- `scheduler.ts` 的 `_dispatchSingle` / `_dispatchMulti` 原先 2 处 `catch {}` 已替换为 `observer.emit('pool.destroy_failed', HIGH) + String(e)` ——从风格④→① 迁移 ✅
- `inspector-agent.ts` 的 1 处 `catch {}` 已清除 ✅
- 风格②④ 合计从 6 处降至 4 处，呈收敛趋势 🟢

**残留风险**：
- `browser-agent.ts:107` 仍存在 `catch (e) { /* skip */ }`——注释表明是有意跳过浏览器 close 异常，但风格④的标识性残留
- `memory-store.ts` 9 处 catch 中，3 处使用 `_e` 作为变量名（表示"已知忽略"），6 处使用 `e`——变量名风格未统一
- 全局仍无 `catchHandler(e, context)` 工具函数——所有 catch 块手写

### A3. 命运预言

> **3 个月内**：若风格①持续主导（当前 86%），而风格②④未完全清零，新加入的 Agent（如 Core-2 的 ApiAgent、DataAgent）将复刻风格②④。**分裂将持续但收敛**——预计 3 个月后剩余风格②④ ≤ 2 处（仅在 browser-agent close 等确实无害的场景残留）。统一工具函数的需求将在第 2 次技术债清点时被正式提出。

**模板建议**：
```
// 理想模板：统一 catch handler，放进 shared
function catchHandler(e: unknown, context: string): string {
  // 始终 String(e)，从不 e?.message
  const msg = `[${context}] ${String(e)}`;
  // 可选：上报 SafeErrorReporter
  return msg;
}
```
**证据文件**：
- `packages/engine/src/browser-agent.ts:107` — `catch (e) { /* skip */ }`
- `packages/engine/src/memory-store.ts:152` — `catch (_e)`
- `packages/engine/src/scheduler.ts:433-436` — 已修复的 observer emit

---

## 模式 B：observer.emit 调用分布——接入率与链路完整性

### B1. 按文件统计

```
scheduler.ts         ──────── 22 次  (↑+4 自上次: 新增 pool.destroy_failed ×2, replan 增强 ×2)
memory-store.ts      ────── 10 次  (↑+4 自上次: persist/deserialize/sql_degraded 增强上报)
pipeline-observer.ts ── 2 次  (内部 emit 自调用)
task-board.ts        ── 2 次  (新增: invariant_violation 入管道)
agent-pool.ts        ── 0 次  (仍走 static onInvariant → console.error)
butler-agent.ts      ── 0 次  (只 on/off 注册，不 emit)
────────────────────────────────────────────
总计：36 次 emit 调用，分布在 5 个文件
```

### B2. observer 接入率趋势

| 模块 | 上轮 emit 数 | 本轮 emit 数 | 接入率变化 |
|:----|:----------:|:----------:|:---------:|
| scheduler.ts | 18 | 22 | ↑ 22% |
| memory-store.ts | 6 | 10 | ↑ 66% |
| task-board.ts | 0 | 2 | **新增** 🆕 |
| agent-pool.ts | 0 | 0 | ❌ 仍未接入 |
| toolkit.ts | 0 | 0 | ❌ 未接入 |

**关键结论**：observer 管道覆盖率从 3 文件 → 4 文件（task-board 新接入），但 agent-pool 和 toolkit 仍是**观测盲区**。

### B3. 事件域谱系（完整链路追踪）

| 事件域 | 发射文件 | 频次 | 消费者 | 链路完整性 |
|--------|---------|:---:|--------|:---------:|
| `node.claimed` | scheduler | 6 | butler FYI | ✅ |
| `node.running` | scheduler | 6 | butler FYI | ✅ |
| `node.completed` | scheduler | 4 | butler FYI | ✅ |
| `node.failed` | scheduler | 3 | butler WARNING | ✅ |
| `pool.destroy_failed` | scheduler | 2 | butler WARNING | ✅ **新增** |
| `scheduler.replan` | scheduler | 1 | meta 重规划 | ✅ |
| `scheduler.invariant_violation` | scheduler | 3→4↑ | butler CRITICAL | ✅ |
| `memory.persist_failed` | memory-store | 2→3↑ | butler CRITICAL | ✅ |
| `memory.sql_degraded` | memory-store | 2→3↑ | butler HIGH | ✅ |
| `memory.deserialize_failed` | memory-store | 2→4↑ | butler HIGH | ✅ **增强** |
| `taskboard.invariant_violation` | task-board | 2 | butler CRITICAL | 🆕 **新增** |

### B4. 命运预言

> **3 个月内**：`agent-pool.ts` 和 `toolkit.ts` 将成为观测盲区被标记为 P2 技术债。预计在 Core-2 阶段，`agent-pool.setStatus` 的 invariant 违规和 `toolkit.execute` 的权限拒绝将接入 observer。**届时 observer 管道覆盖率将从 4/7 文件提升至 6/7**，仅 `file-lock-manager` 因超时回收已自带 console.warn 而被保持为"轻观测"状态。

**证据文件**：
- `packages/engine/src/agent-pool.ts:61` — `console.error(`[invariant] AgentPool.setStatus...` 未走 observer
- `packages/engine/src/scheduler.ts:422-436` — 已修复的 destroy_failed emit
- `packages/engine/src/memory-store.ts:601-610` — persist_failed emit 示例
- `packages/engine/src/task-board.ts:147` — 新接入的 invariant_violation emit

---

## 模式 C：重复代码模式——≥3 模块共享的骨架结构

### C1. BaseAgent 子类化骨架（6 次重复）

以下 6 个 Agent 的类结构**完全一致**，差异仅在于 `type`、`systemPrompt`、`getMemoryQuery` 三个字段：

| Agent | type | systemPrompt | getMemoryQuery 覆写 |
|:------|:---:|:-----------:|:------------------:|
| `CodeAgent` | `AT.Code` | 炼金术士 | `ProducedBy / RefactoredFrom` |
| `ReviewAgent` | `AT.Review` | 御史 | `CitedInCommittee / RefactoredFrom` |
| `AnalysisAgent` | `AT.Analysis` | 草神 | `DerivedFrom` |
| `DocGovernAgent` | `AT.DocGovern` | 天权星 | `DependsOn` |
| `InspectorAgent` | `AT.Inspector` | 侦察骑士 | **否**（使用默认） |
| `OpsAgent` | `AT.Ops` | 船长 | **否**（使用默认） |
| `LoopAgent` | `AT.Loop` | 占星术士 | **否**（使用默认） |
| `BrowserAgent` | `AT.Browser` | 烟花师 | **否**（使用默认） |

**证据**：`packages/engine/src/code-agent.ts`、`review-agent.ts`、`analysis-agent.ts`、`doc-govern-agent.ts`、`inspector-agent.ts`、`ops-agent.ts`、`loop-agent.ts`、`browser-agent.ts`

**重复度**：8 个文件 × ~25 行样板 = **~200 行重复代码**

**模板建议**：
```typescript
// 可改为数据驱动注册而非类继承
const AGENT_DEFS: Record<AgentType, AgentDef> = {
  [AT.Code]: {
    systemPrompt: PROMPTS.code,
    memoryQuery: { linkTypes: [LinkType.ProducedBy, LinkType.RefactoredFrom], ... },
  },
  // ...
};
```

### C2. `_dispatchSingle` & `_dispatchMulti` 双路径模式

`scheduler.ts` 中存在 2 条几乎相同的调度路径：

| 步骤 | `_dispatchSingle` | `_dispatchMulti` |
|:----|:-----------------:|:----------------:|
| 标签匹配 | `_findMatchingAgent` | `_findMatchingAgent`（轮询多视角） |
| claim 节点 | `board.claim` | `board.claim`（循环） |
| spawn Agent | `pool.spawn` | `pool.spawn`（并行） |
| 执行 | `agent.execute` | `agent.execute`（`Promise.all`） |
| destroy | `pool.destroy` | `pool.destroy`（循环） |
| complete | `board.complete` | `board.complete`（if allSuccess） |
| catch | `observer.emit('pool.destroy_failed')` | `observer.emit('pool.destroy_failed')` |

**证据**：`packages/engine/src/scheduler.ts:382-511`（_dispatchSingle） vs `:513-600`（_dispatchMulti）

**重复代码量**：~80 行高度相似

### C3. `if (this._observer)` 守卫模式（memory-store.ts × 6）

memory-store.ts 中 6 次出现完全相同的守卫模式：

```typescript
if (this._observer) {
  this._observer.emit({
    type: "memory.xxx",
    priority: PipelinePriority.HIGH,
    payload: { ... },
  });
}
```

**证据**：`packages/engine/src/memory-store.ts:223`、`:453`、`:601`、`:696`、`:769`、`:802`

### C4. 命运预言

> **3 个月内**：BaseAgent 子类化骨架的重复不会被消除——因为 TypeScript 抽象类的类型安全性仍然高于数据驱动注册。但新 Agent（ApiAgent、DataAgent）会继续复刻此模式，**重复量将从 200 行增至 ~250 行**。`_dispatchSingle` / `_dispatchMulti` 的合并重构将在第 2 次架构审查（Core-2 中期）被讨论，但实施优先级低——因为两路径语义差异（单视角 vs 多视角 Promise.all）限制了纯重构收益。

**可沉淀技能模板**：

| 模板名 | 触发条件 | 步骤序列 | 预期产出 |
|--------|---------|---------|---------|
| **BaseAgent 子类化** | 需新增 Agent 类型 | ① 定义 type ② 写 systemPrompt ③ 可选覆写 getMemoryQuery ④ 注册到 AGENT_TAGS | ~40 行新增代码，复用 ReAct 循环 + 生命周期 |
| **Observer emit 守卫** | 需在非 observer 类中发射事件 | ① 注入 `_observer?: PipelineObserver` ② 写 `if(this._observer){ emit() }` ③ 无 observer 时 console 兜底 | 标准化可观测事件上报 |
| **Scheduler 双路径分发** | 需调度节点（单/多视角） | ① 拓扑排序分层 ② 逐层识别视角类型 ③ 单视角→`_dispatchSingle` ④ 多视角→`_dispatchMulti` | 合规的任务节点执行与生命周期通知 |

---

## 模式 D：SafeErrorReporter 注入 vs PipelineObserver 双轨制

### D1. 双轨共存现状

系统中存在两种错误上报路径：

| 路径 | 接口 | 注入方式 | 使用模块 | 覆盖范围 |
|:----|:----|:--------|:--------|:--------|
| **PipelineObserver.emit** | `emit(event: ObservableEvent): void` | 构造注入 | scheduler, memory-store, task-board, butler | 节点生命周期、记忆异常、invariant 违规 |
| **SafeErrorReporter** | `report(type, error, context): void` | `setSafeReporter()` | base-agent → 所有 Agent | Agent 执行时的 fatal/degraded/silent 三档 |

### D2. SafeErrorReporter 使用分布

| Agent | 调用频次 | 上报类型 |
|:------|:-------:|:--------|
| BaseAgent (基类) | 0（仅声明注入，未内部调用） | — |
| LlmAdapter | 0（注入但未调用） | — |
| MemoryStore | 0（未注入） | — |

**实际调用量**：0 ❌

### D3. 双轨制问题

SafeErrorReporter 被注入到 `BaseAgent` 和 `LlmAdapter`，但**没有任何代码路径调用它**。所有实际错误上报都走 PipelineObserver。SafeErrorReporter 成为了一个**僵尸接口**——定义了但未使用。

**证据**：
- `packages/engine/src/base-agent.ts:144` — `setSafeReporter(reporter)` 声明
- `packages/engine/src/llm-adapter.ts:23` — `_safeReporter` 私有字段
- 搜索 `_safeReporter` 调用——0 次调用

### D4. 命运预言

> **3 个月内**：SafeErrorReporter 将被正式废弃或合并到 PipelineObserver。两种可能的演进路径：
> 1. **合并**：SafeErrorReporter 的 `fatal/degraded/silent` 三档语义被吸收入 PipelinePriority（当前已有 `CRITICAL/HIGH/NORMAL`），setSafeReporter 被移除
> 2. **僵尸化**：无人清理，成为继承链中的死代码——类型定义存在但运行时无人调用
>
> 预计路径①概率 70%——因为 Core-1 终局反思已指出此问题。

---

## 演进趋势：三轮自审视的收敛 vs 发散

### E1. 三轮数据对比（从 self-examination-summary.md 提取）

| 指标 | 第1轮(05-09①) | 第2轮(05-09②) | 第3轮(05-09③) | 第4轮(05-10) | 趋势 |
|:----|:-----------:|:-----------:|:-----------:|:-----------:|:----:|
| ✅ 通过/闭合 | 212 | 291 | 350 | **445** | 🟢 **持续收敛** |
| ❌ 未完成 | 35 | 88 | 60 | 60 | 🟡 平台期 |
| ⚠️ 黄灯/残留 | 64 | 84 | 57 | 62 | 🟡 震荡 |
| 执行耗时(s) | 458 | 839 | 467 | 475 | 🟢 稳定 |

### E2. 核心发现

1. **通过项持续增长 (212 → 445, +110%)**：自审视机制有效驱动修复
2. **未完成项在 60 处平台期**：表明剩余问题需要架构级改动，非单次修复可闭合
3. **黄灯项在 60 处震荡**：旧债修了又生，新债不断积累——典型"维护期"特征

### E3. 命运预言

> **3 个月内**：✅ 通过项将增至 ~550（剩余 100 项中的 60% 可闭合），❌ 未完成项降至 ~20（仅遗留架构级问题），⚠️ 黄灯项维持 ~50（"可接受的技术债"下限）。执行耗时因记忆膨胀将从 ~475s 升至 ~550s。

---

## 命运预言：三个月后的最大技术债与风险

### 🔴 风险 #1（最高危）：MemoryStore SQLite 持久化无事务包裹

- **证据**：`packages/engine/src/memory-store.ts` 的 `write()`、`link()`、`setState()` 各自独立 INSERT/UPDATE，无 `BEGIN TRANSACTION...COMMIT`
- **后果**：`link()` 在 `write()` 成功后抛异常 → 内存写入但 DB 未写入 → 重启后数据不一致
- **概率**：低（sql.js 在单线程中极少异常），但**影响极大**（静默数据损坏）
- **参见**：`docs/core/Core-1-终局反思-实践心得与经验教训.md` §四

### 🟠 风险 #2：SafeErrorReporter 僵尸接口

- **证据**：`packages/engine/src/base-agent.ts:144` + `llm-adapter.ts:23` — 定义了 setSafeReporter 但 0 次调用
- **后果**：3 个月后新人阅读代码，看到"三档错误上报"设计却找不到实际调用，产生认知负担
- **概率**：**高**（3 个月内无人清理的概率 > 80%）

### 🟠 风险 #3：agent-pool 观测盲区

- **证据**：`packages/engine/src/agent-pool.ts:61` — 状态机 invariant 违规仅 `console.error`，未走 observer 管道
- **后果**：状态机违规静默——butler 无法通知用户，排查困难
- **概率**：中（但 agent-pool 是核心生命周期组件，违规即数据不一致）

### 🟡 风险 #4：BaseAgent 子类化重复随新 Agent 膨胀

- **证据**：8 个 Agent × 25 行样板 = 200 行重复
- **后果**：Core-2 新增 ApiAgent、DataAgent → 重复增至 250 行
- **严重度**：低（样板代码稳定，出错概率低，但维护成本线性增长）

### 🟡 风险 #5：browser-agent close 的 catch {} 语义模糊

- **证据**：`packages/engine/src/browser-agent.ts:107` — `try { await this.browser.close(); } catch (e) { /* skip */ }`
- **后果**：Playwright browser.close 出异常时静默跳过——后续如果残留进程会积累，CI 环境下可能触发端口占用
- **概率**：低（close 极少失败），但残留进程积累至 CI 超时的场景已在外部分支发生过

---

## 占卜结语

> 星盘显示：系统正处于**从"快速建设期"向"稳定维护期"的转折点**。try-catch 风格在收敛（风格①占比 86% → 预计 3 月后 92%），observer 管道在扩展（4/7 文件 → 预计 6/7），但 SafeErrorReporter 僵尸接口和 agent-pool 观测盲区是需要主动干预的技术债。若不干预，僵尸接口会存活到 Core-3 前的债务清点——届时清理成本将比今天高 3 倍。
>
> **一句话预言**："三个月后，memory-store 的 SQLite 事务缺失将成为第一起数据不一致事故的根因，而 SafeErrorReporter 将作为 'Core-1 设计遗产' 在 v2.6 修宪中被正式废弃或合并。"
>
> ——莫娜，星盘导出完毕 🔮

