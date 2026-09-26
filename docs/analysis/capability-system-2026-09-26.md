# Cortex 功能体系理清（第一版）

**日期**：2026-09-26
**性质**：盘点与方法论——把「仓库里同时存在的两套坐标系」摆到一张桌上，并给出代码侧的真实能力清单
**数据来源**：全部从代码与配置文件抽取（`packages/**/src`、`packages/config/src/data/*.json`、`layer-contract.ts`），不从文档自述反推

---

## 0 · 问题陈述

同一批 28 个包，仓库里有两张不同的图：

| 坐标系 | 切法 | 位置 | 覆盖 | 强制力 |
|---|---|---|---|---|
| **五流六层七原则** | 按「系统做什么」切行为 | `docs/core/Cortex-架构映射-五流六层七原则.md`（615 行） | 16 / 28 包 | 无 |
| **L0–L4 分层** | 按「依赖 DAG」切代码位置 | `PACKAGE_POSITIONING.md` + `packages/tools/src/layer-contract.ts` | 28 / 28 包 | **门禁硬断言** |

**两套坐标系之间没有任何一张对照表。** 一个新人（或一个 agent）读概念文档会得到一套包名，读代码会得到另一套，而两边都没有指向对方的指针。

这是「功能体系理清」要解决的第一件事——不是缺文档，是**两套地图没接上**。

---

## 1 · 两张图的实测状态

### 1.1 五流六层七原则：锚点已大面积漂移

该文档自称「每个节点标注文件、函数和行号」。实测它引用的 **45 个文件**：

| 状态 | 数量 | 说明 |
|---|---|---|
| 仍在原路径 | 31 | |
| **搬了家** | **12** | 功能还在，路径变了 |
| **彻底消失** | **2** | `engine/src/agents/doc-govern-agent.ts`、`engine/src/agents/loop-agent.ts` |
| 行号越界 | 1 | `scheduler/src/core/scheduling-implementations.ts:732-770`——该文件已退化为 **9 行的 re-export 桶**（2026-06-20 SCH-1 拆成 strategies / drivers / execution-models / model-routers 四个文件） |

搬家的 12 个，模式很集中——**engine 的 `core/` 被拆成了 `planning/` / `execution/`**：

```
engine/src/core/sentinel-signal-filter.ts   → engine/src/planning/
engine/src/core/notification-runtime.ts     → engine/src/planning/
engine/src/core/governance-events.ts        → engine/src/planning/
engine/src/core/skill-scope.ts              → engine/src/planning/
engine/src/core/task-router.ts              → engine/src/execution/
engine/src/core/environment-aware-router.ts → engine/src/execution/
engine/src/core/decision-gate-bridge.ts     → engine/src/execution/
engine/src/components/react-loop.ts         → engine/src/execution/
engine/src/memory/pipeline.ts               → engine/src/memory-bridge/
platform/src/file-lock-manager.ts           → engine/src/core/ + shared/src/
consistency/src/consistency-layer.ts        → governance/src/consistency/
consistency/src/intent-fact-wall.ts         → governance/src/consistency/
```

**只有 2 个文件真消失——所以不是功能没了，是坐标系没跟着代码一起走。**

包覆盖方面：文档提到 7 个**已不是包**的目录（`consistency` `parser` `schema` `pm` `cache` `result` `toolchain`），而有 **12 个现役包一次都没被提到**：

```
client · context-manager · design-tokens · desktop · doctor · llm
memory · pattern-extractor · prompt-kit · protocol · server · tools
```

### 1.2 L0–L4：全覆盖，且被门禁钉住

```ts
// packages/tools/tests/layer-contract.test.ts
expect(workspacePkgs.length).toBe(28);
expect(Object.keys(CORTEX_LAYER_CONTRACT).length).toBe(28);
```

新增包必须在此登记，否则门禁失败。**这是仓库里唯一一处「包体系的机器可执行真相源」。**

---

## 2 · 权威性排序（本轮的判定依据）

冲突时按此顺序取信——这是本次所有修正的依据：

| 优先级 | 来源 | 理由 |
|---|---|---|
| 1 | `layer-contract.ts` + 其门禁测试 | 机器可执行，破坏即红 |
| 2 | `packages/config/src/data/*.json` | 运行时真正读的东西（经 schema 校验） |
| 3 | `PACKAGE_POSITIONING.md` | 人类可读镜像，本轮已对齐到 28 |
| 4 | `docs/core/五流六层七原则` | 概念坐标系，锚点已漂移（见 §1.1） |
| 5 | `README.md` / `packages/README.md` | 概览，本轮已部分对齐 |
| 6 | `docs/constitution/…v3.8.md` | **治理文件——改动须走修宪流程，本轮未动** |
| 7 | `docs/archive/**`、`docs/constitution/archive/**` | 历史，**永不对齐**（要求归档与代码同步等于把归档当活文档） |

---

## 3 · 代码侧的真实能力清单

### 3.1 分层与规模（28 包）

| 层 | 包 | src 文件 | 根导出 | cortex 依赖 | 门禁测试 |
|---|---|---|---|---|---|
| **L0** 基础 | config | 62 | 182 | 1 | ✅ |
| | shared | 31 | 36 | 0 | ✅ |
| | protocol | 23 | `export *` 聚合 | 0 | ✅ |
| | fsm-compiler | 19 | 12 | 0 | ✅ |
| | telemetry | 15 | 24 | 1 | ✅ |
| | resilience | 13 | 10 | 0 | ✅ |
| | logging | 11 | 16 | 0 | ✅ |
| | notification | 7 | 13 | 0 | ✅ |
| | pattern-extractor | 7 | 8 | 0 | ✅ |
| | tools | 5 | 18 | 1 | ✅ |
| | design-tokens | 4 | 16 | 0 | **无测试目录** |
| | testing | 1 | 5 | 1 | ✅ |
| **L1** 核心服务 | memory | 37 | 32 | 1 | ✅ |
| | scheduler | 29 | 45 | 3 | ✅ |
| | prompt-kit | 20 | 13 | 1 | ✅ |
| | plugin-runner | 10 | 7 | 2 | ✅ |
| | client | 7 | 7 | 1 | ✅ |
| | context-manager | 7 | 5 | 3 | ✅ |
| | doctor | 4 | 6 | 1 | ✅ |
| | llm | 4 | 4 | 3 | ✅ |
| **L2** 复合服务 | platform | 31 | 15 | 3 | ✅ |
| | memory-store | 14 | 30 | 6 | ✅ |
| **L3** 领域/治理 | governance | 16 | 24 | 3 | ✅ |
| | skill-kit | 7 | 17 | 5 | ✅ |
| **L4** 编排/入口 | cli | 94 | 34 | 15 | ✅ |
| | engine | 72 | 81 | **16** | ✅ |
| | desktop | 29 | **无 barrel**（应用非库） | 3 | ✅ |
| | server | 17 | 5 | 9 | ✅ |

> 「根导出」为 `src/index.ts` 显式导出符号的静态计数——`protocol` 走 `export *`、
> `desktop` 无 `src/index.ts`，这两处的 0/缺值是**测量口径**问题，不代表没有能力。
>
> 门禁测试覆盖 **27/28 包**——`design-tokens` 无测试目录，不在 CI 测试矩阵内。

### 3.2 能力域速查

| 能力域 | 数量 | 真相源 | 备注 |
|---|---|---|---|
| 包 | 28 | `layer-contract.ts` | 门禁硬断言 |
| Agent 条目 | 18 | `config/src/data/agent-manifests.json` | 见 §3.3 |
| 角色人格 | 16 | `prompts/<角色>/` | 与 18 条目的差额是两个通用条目 `api`/`data` |
| 工具 | 19 | `config/src/data/tools.json` | read_file/write_file/edit_file/run_shell/… |
| 技能结晶 | 27 | `skills/*.json` | 形状 `{id,tags,trigger,steps,output,risk_note}` |
| PipelineEventType | 60 | `shared/src/infra.ts` | 事件类型闭合枚举 |
| 路由表条目 | 41 | `config/src/data/event-routing.json` | important 17 / routine 21 / urgent 3 |
| 通知通道 | 4 | `notification/src/types.ts` | urgent / important / routine / info |
| 通知语义档 | 3 | `notification/src/semantic-layer.ts` | FYI / WARNING / DECISION_REQUIRED |
| 配置域 | 17 | `config/src/loader.ts` | 4 个 required：eventRouting / models / keysContext / agentManifests |
| 模型 | 3 | `config/src/data/models.json` | V4.1 flash / pro / flash-vision-exp，均 2M 上下文 |
| CLI 命令模块 | 19 | `cli/src/commands/` | agent·config·confirm·doc·doctor·eval·help·inspect·memory·roundtable·run·schedule·setup·skill·status·task·version·command-list·index |
| API 端点 | 8 | `PACKAGE_POSITIONING.md` §RESTful | `/api/v1/{state,nodes,agents,health,execute,events}` |
| 治理原则 | 七条 | 五流六层七原则 + 宪法 | 原则五为唯一全流约束 |

### 3.3 Agent 体系（18 条目 / 16 人格 / 5 profile）

| id | type | profile | 人格 |
|---|---|---|---|
| ganyu | meta | — | 甘雨（七星秘书，规划） |
| albedo | code | code-writer | 阿贝多（实现） |
| sigewinne | fix | code-fixer | 希格雯（修复） |
| keqing | review | read-only | 刻晴（审查） |
| nahida | analysis | read-only | 纳西妲（分析） |
| ningguang | doc-govern | read-write-gov | 凝光（文档治理） |
| amber | inspector | read-only-inspect | 安柏（巡检） |
| mona | loop | read-only | 莫娜（模式扫描） |
| beidou | ops | read-only | 北斗（运维） |
| yoimiya | browser | read-only | 宵宫（浏览器） |
| cyrene | butler | — | 昔涟（管家） |
| zhongli | strategist | — | 钟离（战略） |
| shuangning | strategist | — | 霜凝（方向监理） |
| yanfei | confirm-gate | — | 烟绯（确认门） |
| kuki | api | — | 久岐忍（API） |
| alhaitham | data | — | 艾尔海森（数据） |
| api | api | read-only | （通用条目） |
| data | data | read-only | （通用条目） |

**5 个共享 profile**：`code-writer` / `code-fixer` / `read-only` / `read-write-gov` / `read-only-inspect`。
18 个条目**全部**声明了 `produces`，且都被 `produces ↔ routeTable` 跨字段校验覆盖。

---

## 4 · 五流 → 代码 的对照（本版首次给出）

把概念坐标系接到 L0–L4 上。**注意：五流不是包的一一对应**——一条流通常横跨多层多个包。

| 流（做什么） | 主要落在 | 代码落点 | 有独立包？ |
|---|---|---|---|
| **交互流** | L4 | `cli/src/commands/`（19 模块）+ `cli/src/tui/` + `server/src/daemon.ts` + `desktop/src/renderer/` | ✅ cli / server / desktop |
| **治理流** | L3 | `governance/src/`（governance-loop、consistency/）+ `engine/src/planning/governance-events.ts` + `scheduler/src/core/confirm-gate.ts` | ✅ governance |
| **规划-执行流** | L1+L4 | `engine/src/planning/`（meta-agent、task-router 计划侧）+ `scheduler/src/dispatch-steps/`（6 步管线）+ `engine/src/execution/react-loop.ts` | ✅ scheduler / engine |
| **技能-工具流** | L2+L3 | `platform/src/toolkit.ts`（统一入口 + 权限）+ `tools/src/` + `skill-kit/src/` + `pattern-extractor/src/` | ✅ platform / tools / skill-kit |
| **记忆流** | L1+L2 | `memory/src/`（类型 + 生命周期状态机）+ `memory-store/src/`（向量/图谱/SQLite）+ `engine/src/memory-bridge/` | ✅ memory / memory-store |
| **基础设施层**（非流） | L0 | `shared` `config` `logging` `resilience` `telemetry` `notification` `protocol` `design-tokens` `fsm-compiler` `testing` | ✅ |

**结论**：五流六层与 L0–L4 **不是竞争关系，是两个正交切面**——
- 六层回答「这个文件放哪」→ 对应 L0–L4（依赖约束）
- 五流回答「这段逻辑属于哪条行为链」→ 跨层，一条流穿过 2–3 层

上表是第一版手工对照，**尚未机器化**。机器化的成本不高（流 ↔ 目录前缀的映射表），但要先决定由谁持有（见 §7）。

---

## 5 · 声明 vs 事实：本轮修了什么

### 5.1 已修（本轮）

| 位置 | 原文 | 改为 | 依据 |
|---|---|---|---|
| `README.md` ×4 | 29 个包 | **28 个包** | 门禁断言 `toBe(28)` |
| `README.md` 宪法表 | 21 个包各司其职 | **28 个包** | 同上 |
| `README.md` 结构树 | `├── parser/  # AST 解析` | 删除该行 | `packages/parser` 已非包 |
| `README.md` 资源表 | `cortex-agents.json` / 14 个 Agent | `config/src/data/agent-manifests.json` / 18 条目 | 文件已迁移，根目录不存在 |
| `PACKAGE_POSITIONING.md` | 29 个包 | **28 个包** | 同上 |
| `PACKAGE_POSITIONING.md` 图 | 含 `parser` | 移除 | 同上 |
| `PACKAGE_POSITIONING.md` 模型表 | V4 / 1M / 384K | **V4.1 / 2M / 1M**，并注明以 `models.json` 为准 | 上一轮 V4.1 迁移漏改 |
| `packages/README.md` | 29 包分层架构 | **28 包** | 同上 |
| `layer-contract.ts` 注释 ×2 | 29 个 workspace 包 | **28** | 与其自身常量表一致 |

> 「16 种角色人格」与「26 个预置技能」经核对**是对的**，未改：
> `prompts/` 恰有 16 个子目录；`skills/` 26 个 `skill-p*.json`（另有 1 个 `data-2pc-rollback-verify.json`，
> 形状相同但不在编号序列内——见 §6）。

### 5.2 待修（本轮刻意未动）

| 位置 | 问题 | 为什么没动 |
|---|---|---|
| `docs/constitution/Cortex 概念顶层设计 v3.8.md` | 多处「29 包」「`├── parser/`」；且带日期实测值（2026-08-01）属历史记录 | **宪法有修宪流程**（`docs/amendments/AM-*.json`）。绕过流程直接改，等于破坏它自己定义的第 7 条原则 |
| 同上 | 上一轮我在「状态」段直接加了 2026-09-26 的修复记录——**同样没走 AM 流程** | 需一并处置：补一份 AM，或回退该行 |
| `docs/core/五流六层七原则.md` | 12 处路径漂移 + 2 处文件消失 + 1 处行号越界（§1.1） | 需要先决定这张图是否仍由该文档持有（§7），否则改完下一轮重构又漂 |
| `docs/README.md` | 指向 `constitution/Cortex 概念顶层设计 v3.7.md`——**该文件不存在**（现行是 v3.8） | 需确认是改链还是补档 |

### 5.3 不修

- `docs/archive/**` 与 `docs/constitution/archive/**` 里的全部历史引用——**归档不是活文档**。
- 带日期的历史实测值（如「3982 passed / 13 skipped（2026-08-01 实测）」）——那是当时的真实读数，不是错误。

---

## 6 · 体系边界上的灰区（需要判断，不是笔误）

| 现象 | 事实 | 影响 |
|---|---|---|
| `packages/parser/` 残留目录 **（已清除，见 §7-3）** | `src/` 与 `tests/` 已空，只剩 `dist/` + `node_modules/` + `tsbuildinfo`；**git 跟踪 0 文件** | 它是「29 个目录 vs 28 个包」这个数差的来源。三个非包目录：`parser`（残留）、`tests`（测试数据）、`.cortex` |
| `packages/tests/.test-data/` **（已取消跟踪，见 §7-3）** | **33 个文件被提交进 git**，全是 `noflush-<时间戳>/` 形式的测试产物 | 测试产物进了版本库 |
| `skills/` 的 27 vs 26 | 26 个 `skill-p*.json` + 1 个 `data-2pc-rollback-verify.json`（形状相同，无编号） | 「预置技能数」取哪个口径需要定 |
| `design-tokens` 无测试 | 28 包中唯一不在门禁测试矩阵内的 | 它的正确性靠什么保证？ |
| `desktop` 无 `src/index.ts` | 它是 Electron 应用（main/preload/renderer 三入口），不是库 | PACKAGE_POSITIONING 把它列在 L4「入口」，与实际形态吻合；但它的「公开导出」概念不适用 |

---

## 7 · 下一步

> **2026-09-26 追记**：本节四项已在下述同日工作处置完毕，原始裁决问题保留在括注中以便追溯。

1. **五流六层七原则这张图，由谁持有？（裁决为 (c)，已落地）**
   实现：`packages/config/src/data/architecture-flows.json`（数据，已注册为 `architectureFlows` 配置域）
   + `packages/tools/src/flow-contract.ts`（契约逻辑，与 `layer-contract.ts` 同源）
   + `packages/tools/tests/flow-contract.test.ts`（`@ci: contract` 门禁）。

   **四条不变量**（新增包 / 新模块不归类即门禁红）：

   | # | 不变量 | 防的是什么 |
   |---|---|---|
   | 1 | 路径真实 | 声明了不存在的目录——正是五流六层文档 45 条引用里 12 条搬家、2 条消失的那个病 |
   | 2 | 包全覆盖（双向） | 新增包不归流；流认领已删包 |
   | 3 | 模块全归类（双向） | 新增 src 子模块不声明归属 |
   | 4 | 词汇闭合 | layer / principles 用了名单外的词 |

   一个**顺带查实的事实**：源码里其实**已经有 `// @layer <名>` 注解**，但覆盖率只有
   **115 / 667 = 17.2%**，且词汇不统一（混用「规划-执行层」「L0」「L1」「platform」「治理层→交互层」）。
   所以注解当不了契约源——这正是需要数据文件的原因。注解统一化列为后续独立议题。

   > 口径：`packages/**/src` 下的 `.ts`，排除 `node_modules`/`dist`/`coverage`/`tests`，只看文件头 12 行。
   > 本版初稿曾写「116/651 = 17.8%」——那是带 IO 报错的 PowerShell 粗扫值，经
   > `scripts/audit-amendment.ts` 复算后更正（见 `docs/auditing/am-2026-0926-001-audit.md` F-1）。

2. **宪法里那批过时计数怎么处置？（已按修宪流程起草）**
   `docs/amendments/AM-2026-0926-001.json`，`status: pending_judgment`，**未落笔宪法本体**，
   含 8 组事实勘误与起草人对自身越权的主动披露。待审计（凝光）→ 裁决（开拓者）→ 落笔。

3. **`packages/parser/` 残留与 `packages/tests/.test-data/` 的 33 个提交产物（已清理）**
   残留目录删除；测试产物取消跟踪（磁盘保留）；并修掉一处指向已删包的
   `packages/cli/tsconfig.test.json` project reference（全仓 45 份 tsconfig 扫描下来唯一一处真悬空）。
   **未动 `.tmp-lingxu/`（18.5 MB）**——那是第三方项目 CommonTrustProtocol 的解包副本，
   属参考资料而非垃圾，不在「该清除」之列。

4. **L0–L4 与五流的正式对照（已由第 1 项接手）**
   本版 §4 保留为人工可读的导览；机器可读形态归 `architecture-flows.json`。二者若不一致，以数据文件为准。

---

## 附：本版的方法与边界

- **所有数字都从代码或配置文件抽取**，脚本一次性使用、跑完即删；除 `protocol`（`export *`）与 `desktop`（无 barrel）两处已在文中标注的口径限制外，均可复现。
- **判断与事实分开写**：§1–§4 是抽取结果，§5–§7 是判断。判断部分标了依据。
- 本版**刻意未动宪法与归档**——前者有流程，后者是历史。
