# Cortex 内部数据流向（落点台账）

> **为什么有这份文档**：cortex 的很多缺陷不是「逻辑写错了」，而是**同一份数据有好几个落点，
> 而没有任何东西在保证它们一致、或者哪怕只是「被写下来」**。
> 这一份把**数据往哪儿流**逐条具名。
>
> **口径（重要）**：本表**不是从文档抄的**，是 2026-09-30 从源码里抽的
> （grep `writeFileSync` / `process.cwd()` / `.cortex` / `join(..., "data", ...)`）。
> **凡「文档说的」与「代码做的」不一致，都单列出来，不抹平。**
>
> **每条流的四格**：入口 → 变换 → **落点** → **谁保证它一致**。
> 新加一条流时，这四格必须填满；**第四格填不出来，就是下一个 N-22。**

---

## 一、落点总表（按根分组）

### A. `<workspaceRoot>/.cortex/` —— 工作区级（`.gitignore:95` 已忽略整个目录）

| 落点 | 谁写的 | 出处 |
|---|---|---|
| `logs/audit.jsonl` | `AuditTrail` | `telemetry/src/audit-trail.ts:108`（默认 `process.cwd()/.cortex/logs`） |
| `logs/api-calls.jsonl` | LLM 调用审计（开关） | `llm/src/llm-adapter.ts:66` |
| `logs/quotas.json` | 每日配额 | `llm/src/rate-limiter.ts:78` |
| **`telemetry.jsonl`** | bootstrap 注入 | `engine/src/bootstrap/bootstrap-engine.ts:199`（`wsRoot/.cortex/telemetry.jsonl`） |
| `notifications.db` | `NotificationPersistence`（SQLite） | `bootstrap-engine.ts:431` |
| `memory.db` | memory-store plugin（SQLite） | `engine/src/plugin/memory-store.plugin.ts:37`（`ctx.workspaceRoot`） |
| `tui-session.json` | CLI 会话 | `cli/src/tui/session-store.ts:27` |
| `plan-state.json` | CLI plan 模式 | `cli/src/tui/modes/plan-mode.ts:53` |
| `eval-report.json` | 活性层评测 | `engine/tests/eval/eval-gate.ts:17` |
| `agent-instances.json` | CLI agent 命令 | `cli/src/commands/agent.ts:18` |
| `file-hashes.json` | 一致性校验器哈希缓存 | `governance/src/consistency/init-verifier.ts:15` |
| `config` | CLI 本地配置 | `cli/src/services/config-manager.ts`、`cli/src/commands/config.ts:158` |

### B. `~/.cortex/` —— 用户级

| 落点 | 谁写的 | 出处 |
|---|---|---|
| `config/*.json` | **运行时真正读的那份配置**（`seedMissingFiles` 补种） | `config/src/loader.ts:325` |
| `ws-token` | daemon 签发（`mode 0o600`） | `server/src/daemon.ts:251` |
| `skills/` | L0 跨域技能目录 | `engine/src/planning/skill-scope.ts:8`（注释声明） |

### C. **`<cwd>/`** —— **工作区根，且这里是问题所在**

| 落点 | 读写 | 谁写的 | 出处 | `.gitignore` |
|---|---|---|---|---|
| `data/memory.json` | **写** | 记忆单例 | `memory/src/cyrene/memory-store.ts:113` | ✅ 已忽略 |
| `data/rag-data/` | **写** | 向量库 | `memory/src/cyrene/rag/index.ts:49` | ✅ 已忽略 |
| `memory-trace.log` | **追加写** | 记忆追踪 | `memory/src/cyrene/memory-trace.ts:35` | ✅ 已忽略 |
| **`data/entity-graph.json`** | **写** | `EntityGraph` | `memory/src/cyrene/entity-graph.ts:120/124/163` | ⚠️ **2026-09-30 补入**（此前漏） |
| `data/model-settings.json` | **只读** | 压缩器 / 判定器 / 解析器 | `memory-compressor.ts:48`、`memory-judge.ts:47`、`memory-resolver.ts:91` | 不需忽略（只读） |
| `models/` | **只读** | RAG 模型查找 | `rag/reranker.ts:50`、`rag/embedding.ts:60` | 不需忽略（只读） |

> `data/` 是**被 git 跟踪**的目录（`data/claims/tsconfig-references-consistency.md`）——
> 所以上面几个**写**落点一旦被触发，工作树就脏。

---

## 二、逐流（入口 → 变换 → 落点 → 守卫）

### 流 1 · 配置 —— **守卫齐备，这条是正面样板**
- **入口**：`packages/config/src/data/*.json`（源码，被跟踪）
- **变换**：`copy-data.mjs` 镜像 → `dist/data`；`seedMissingFiles` **add-only 补种** → `~/.cortex/config`
- **落点**：`~/.cortex/config/*.json`（**运行时真正读的那份**）；`dist/data` 只是 seed 源与测试源
- **守卫**：**I-9**（copy-data + 门禁第 ①′ 步，失败 `failedStage: "configDataSync"`）、**I-10**（add-only，不覆盖用户编辑）
- **已确认不一致**：曾经有——`dist/data` 陈旧导致 `setMergeRules([])`，**事件归并子系统从未生效**；`~/.cortex/config` 只播种一次，上游改动永远到不了。**两者已修。**

### 流 2 · 记忆 —— **三个落点，无人保证一致**
- **入口**：`bootstrapEngine` → `initCyreneMemory()`
- **变换**：`bootstrap-engine.ts:248` **不传参**；返回的 `{manager, store}` 在 541 行**只被 await、值从未被读**
- **落点**：**实际写 `cwd/data/memory.json`**（模块级单例 `new MemoryStoreManager()` 无参 → `memory-store.ts:113` 兜底）；另有一条 SQLite 路径 `wsRoot/.cortex/memory.db`；追踪另写 `cwd/memory-trace.log`
- **守卫**：**没有**
- **已确认不一致**：**代码自称 `.cortex/cyrene-memory.json`**（`engine/src/bootstrap/init-memory.ts:143` 的默认参数）**，实际落 `cwd/data/memory.json`**。见 N-22 / 待裁决第 4 条。

### 流 3 · 遥测与审计 —— **两个根、两种扩展名**
- **入口**：引擎各组件 → collectors / `AuditTrail`
- **落点**：`wsRoot/.cortex/telemetry.jsonl`（bootstrap）**与** `cwd/.cortex/telemetry.json`（telemetry-controller）——**两个不同文件**；审计写 `cwd/.cortex/logs/audit.jsonl`
- **守卫**：`config_violation` 落盘已做**跨进程幂等**（本轮）；**其余没有**
- **已确认不一致**：`wsRoot` 与 `cwd` **取自不同来源**——常见情形下相等（都从仓库根跑），但**它们可以分叉**，而没有任何东西会告警。`telemetry.jsonl` / `telemetry.json` 一字之差两个文件。

### 流 4 · 通知
- **入口**：治理事件 → `NotificationPersistence`
- **落点**：`wsRoot/.cortex/notifications.db`（SQLite）
- **守卫**：三层保留策略（本轮加）；`notifications.db` 被 bootstrap 持有连接
- **已确认不一致**：曾**无限增长**（实测 9,693,314 行 / 1,975 MB）——`Important` 通道无 ack 路径，其行**永远进不了清理条件**。已修并回收至 0.7 MB。

### 流 5 · 会话（TUI）
- **入口**：TUI 启动/退出
- **落点**：`cwd/.cortex/tui-session.json`、`cwd/.cortex/plan-state.json`
- **守卫**：坏 JSON 有容错测试；**没有一致性守卫**
- **注**：DSH 自己的会话存在 `~/.dsh/sessions/`，与本流**无关**——两套会话，两处落盘。

### 流 6 · 治理与修宪 —— **轴二那条真成果在这里**
- **入口**：提案 → `governance/src/governance-loop.ts`
- **变换**：`scripts/audit-amendment.ts`（事实复算 `before`/`after`）→ 裁决 → `amendment-applier.ts`
- **落点**：`docs/amendments/AM-*.json`、`docs/constitution/*.md`、`docs/auditing/*-audit.md`
- **守卫**：`docs-registry-integrity.test.ts` 守**注册表/版本头**；**「正文每次改动必须有对应 AM 记录」→ 没有守卫**
- **已确认不一致**：**`AM-2026-0926-001` 的 `_disclosure` 段**——起草人自报**两次改动宪法本体而未经裁决**（版本头段落合并、追加一行记录），已随 `commit f05196e5` 进 main。
  > **这条检查的第一个真阳性样本已经存在，而且是被人工发现的。** 它该被机器发现。

### 流 7 · 技能
- **入口**：`skills/`、`skill-p*.json`、`~/.cortex/skills/`
- **变换**：`bootstrap/init-skills.ts` → `skillRegistry.registerAll(...)`
- **落点**：技能注册表（内存）+ 快照
- **守卫**：`init-skills` 会调 `registerAll`（曾经不会，即仓库自己记录的「断裂3」，已修）
- **已确认不一致**：**四级作用域模型（L0 跨域 / L1 项目 / L2 包级 / L3 Agent）从未生效**——`tagSkillScope`（唯一写 `_scope` 的地方）零调用。见 N-27。

### 流 8 · 工具调用与确认
- **入口**：Agent → `Toolkit.execute()`
- **变换**：`ConfirmGate` + `TrustModel`（`scheduler/src/core/trust-model.ts:139` 持久化）
- **落点**：TrustModel 状态文件（测试用的是临时路径）
- **守卫**：`engine/tests/trust-model.test.ts`——**标的是 `@ci: integration`，不在默认门禁里**（实测默认跳过 14 个文件）
- **已确认不一致**：宪法称 TrustModel「未落地（数据不足）」，而 `confirm-gate.plugin.ts` 与 `bootstrap-engine.ts` **已有接线**。性质待裁（见待裁决第 13 条）。

### 流 9 · 一次性产物（cwd 相对，只读或半只读）
- `cwd/.cortex/eval-report.json`（评测）、`cwd/.cortex/agent-instances.json`（CLI）、`cwd/.cortex/file-hashes.json`（哈希缓存）
- **守卫**：无

---

## 三、已确认的三处不一致（都有实测证据）

| # | 不一致 | 证据 |
|---|---|---|
| 1 | **记忆的「宣称落点」与「实际落点」不同** | `init-memory.ts:143` 写 `.cortex/cyrene-memory.json`；`memory-store.ts:113` 兜底到 `cwd/data/memory.json`；单例无参构造 |
| 2 | **遥测两个根、两种扩展名** | `bootstrap-engine.ts:199` → `wsRoot/.cortex/telemetry.jsonl`；`telemetry-controller.ts:47` → `cwd/.cortex/telemetry.json` |
| 3 | **宪法正文改动没有对应的强制记录** | `AM-2026-0926-001._disclosure` 自报两次未记录改动 |

---

## 四、`.gitignore` 的那份清单为什么改了口径

原清单（`2026-09-26`）只列了 **3** 处，是按 **「现在会不会写」** 列的。
`EntityGraph` 那处（`entity-graph.ts:163` 有 `writeFileSync`）**因为类当前没有任何实例化点**（`entityGraph` 在审计里属「包内外皆无人用」）而没被列进去。

**问题**：一旦有人把它接上——**而「接线」正是这个仓库接下来要做的事**——它立刻开始往 git 跟踪目录里写，
**而那份清单会静默过期**。

**所以 2026-09-30 改成按「源码里声明了会写」列**，并逐行标出 `【活跃】/【未接线】`。
只读的两处（`cwd/models/`、`data/model-settings.json`）经复核确实只读，**保持不忽略**。

> **这一条的普适形状**：**按现状列的清单，会在现状改变的那一刻过期。**
> 该按声明列，并把「现在是否生效」作为状态字段——不是作为入选条件。

---

## 五、怎么用这份表

**新加一处落点之前，先回答四格**：入口 / 变换 / **落点** / **谁保证它一致**。
第四格填不出来，就先别加——或者同时加一个守卫。

**判定「落点是否已被声明」的机械办法**（一次性，未接门禁）：
把 `writeFileSync` / `appendFileSync` / `createWriteStream` 的调用点抽出来，
与本文的落点表比对。**这次比对抓出了 1 处漏（`entity-graph.json`）、纠正了 1 处我自己的误判（`model-settings.json` 是只读的）。**

> **不要靠读文档发现这个。** 这一轮两次抽查里，一次抓到了漏、一次纠正了我自己——
> 而两次都不是靠「记得」，是靠**把两个来源摆在一起**。
