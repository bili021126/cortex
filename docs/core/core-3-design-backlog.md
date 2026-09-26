# Core-3 设计债清单（挖题核验）

**日期**：2026-09-26
**来源**：宪法 v3.8 §一「6 项设计决策排入 Core-3」+ §二十五「仅 4 项真正未落地」
**方法**：全部**回到代码重新量**，不复用文档自述。量法见文末「复现方式」。

> **为什么需要这份清单**：宪法里记着一份题单，但**没人回来更新过它**。核验后发现——
> **6 项里 1 项已完成、1 项前提已消失、2 项题名与实况不符**。
> 一份不更新的待办清单比没有清单更危险：它让人以为还有 6 件事要做，而其中一半已经不是那件事了。

---

## 一、6 项 Core-3 设计决策 —— 逐条核验

### 【1】Logger 推广 —— ⚠️ **题名已过时，需重新定义**

| 维度 | 实测 |
|---|---|
| 引用 `@cortex/logging` 的 src 文件 | **2 / 83**（仅 `engine/bootstrap/bootstrap-engine.ts`、`engine/core/meta-agent.ts`） |
| 可执行裸 `console.*` 调用 | **296 处 / 83 文件**（TS 解析器口径，注释与字符串不计） |
| 其中 `console.log`（eslint 全局禁止） | 52 处，非豁免路径 **39 处——全部带显式 `eslint-disable` 注释与理由** |
| 其中 `console.warn/error`（eslint 允许） | 244 处 |

**关键发现——这个题的前提已经变了**：仓库里**已经有**一套运行时拦截，
`packages/telemetry/src/console-bridge.ts` 的 `installConsoleBridge(observer)`
在 `bootstrap-engine.ts:285` 启动时安装，把 `console.warn/error` 直接转成
`PipelineObserver.emit(ErrorReported)`。

**即：裸 console 已经被"兜进"结构化管道了**——用运行时 monkey-patch，而不是宪法设想的编译期迁移。

于是真实的问题不是「把 console 换成 Logger」，而是：
- **两条通道并存且没有边界定义**：编译期的 `@cortex/logging`（2 个消费者）与运行时的 `console-bridge`（全仓覆盖）职责重叠
- `console.log` **不进管道**（bridge 只对它做 stderr 透传），所以 `log` 级信息仍然不可观测
- bridge 的 `_isWhitelisted()` **每次调用都构造一次 `new Error().stack`**——296 个调用点里凡是热路径的都在付这个代价
- bridge 截断在 500 字符

→ **已另立设计文档**：[observability-dual-channel-design.md](observability-dual-channel-design.md)

### 【2】execSync → async —— ⚠️ **题名不准；已拆成「去重（已完成）」与「接口改造（待决策）」**

**实测**（TS 解析器口径，注释不计）：

| 范围 | 处数 | 文件 |
|---|---|---|
| 全仓同步子进程调用 | 24 | 15 |
| 其中 `src/` | **7** | 4（`execSync` 3 + `execFileSync` 4） |
| 其中 `tests/manual/` | 17 | （`@ci: manual`，CI 不跑，不在范围） |

**题名不准**：宪法写「execSync」，而实际只有 3 处是 `execSync`，另 4 处是 `execFileSync`。
且上一版把**注释**计了进来——`inspector-agent.ts` 与 `fs-adapter.ts` 里的「execSync」只是注释。

**本轮已做（去重，2026-09-26）**：

`execution/zero-token-validator.ts` 与 `planning/hard-verification-gate.ts`
**各写了一遍** `git diff` / `eslint --format compact` 的同步查询——命令、超时、解析正则完全相同，
即同一关切的两处实现、也就是**两处事件循环阻塞点**，且任何调整都要改两遍。

已收成单一来源 `packages/engine/src/core/subprocess-sync.ts`：
`src/` 内调用点 **7 处 / 4 文件 → 5 处 / 3 文件**（engine 1044 测试全绿）。

**未做（需接口决策，不属机械修正）**：

- `cli/src/main.ts:233` 的 `chcp 65001`——启动时设控制台码页，**必须早于任何输出**，
  同步是正确取舍。**明确不改**，已在此记录理由。
- 剩下 2 处（`subprocess-sync.ts` 内部）要转 async，需先把
  `ZeroTokenRule.validate(event, ctx): RuleResult` 改为 `Promise<RuleResult>`。
  该接口变更会波及 `SentinelSignalFilter` / `GovernanceEventEmitter` / `NotificationRuntime`
  的**事件处理器路径**（`notification-runtime.ts` 在同步 `_handleEvent` 里直接调它）。
  这是设计决策，需单独立项；**收成单一来源后，届时只改那一个模块**——
  这正是本次去重的目的。

### 【3】WebUI 鉴权 —— ⚠️ **前提已消失，需重新界定**

- `packages/cli/src/tui/web/` **已不存在**——该目录连同 `scripts/start-webui.ts` 已于
  commit `25f01704`『重整化第一波』作为死代码删除（理由：cli 内的**第二** WS 网关属重复实现）
- 所以「WebUI 鉴权」这个题**没有对象**了
- 但**它指向的真问题还在**：REST/WS 现在由 `@cortex/server` 承载（`server/src/http/` 6 个 handler），
  而我在 `server/src/http/` 里**找不到任何鉴权**（4 处字样命中全部无关，如 chat-handler 的 token 计数）

→ **建议重命名为「server REST/WS 鉴权」**，并重新评估暴露面（见 §三「PACKAGE_POSITIONING 未收录的端点」）。

### 【4】EventPayloadMap 补完 —— ✅ **已完成**

| 指标 | 实测 |
|---|---|
| `PipelineEventType` 值 | 60 |
| `EventPayloadMap` 键 | 60 |
| **缺口** | **0** |

**该项可从 Core-3 移除。** 这是清单里唯一一条已经做完但没人划掉的。

### 【5】Disposable 推广 —— ⚠️ **题名被实测推翻；但顺带挖出并修掉一个真缺陷**

**题名的预设**：「22 个类有 `dispose()` 却只 1 个声明 `implements Disposable`，补声明即可」。
实测推翻了它：

- `Disposable`（`shared/src/infra.ts:489`）是**全可选、同步**的鸭子类型，专为 Plugin `stop()` 而设。
- 含 `dispose()` 的类是 **20 个**（不是 22——上一版把文件数当成了类数）。
- 其中只有 `ConfirmGate` 声明了 `Disposable`，而它的 **`dispose(): void` 确实是同步的**——
  **那个声明是对的**，不是「唯一的正确样本」。
- 其余 19 个的 `dispose()` 返回 `Promise<void>`。它们**类型上本就"满足" `Disposable`**
  （`() => Promise<void>` 可赋给 `() => void`）——所以「补声明」既无必要，还会误导。

**真正的问题在别处，而且是真缺陷**：接口把异步抹成了 `() => void`，
于是**调用方连 `await` 都写不出来**——8 处清理全部 fire-and-forget：

| 位置 | 调用 | 目标方法 | 后果 |
|---|---|---|---|
| `assemble.ts:95` | `scheduler.stop?.()` | async | 未 await |
| `assemble.ts:96` | `pool.destroyAll?.()` | async | 未 await |
| `assemble.ts:97` | `observer.clear?.()` | 可能 async | 未 await |
| `assemble.ts:100` | `cliAdapter.close?.()` | 可能 async | 未 await |
| `scheduler.plugin.ts:72` | `stop?.()` | async | 未 await |
| `agent-pool.plugin.ts:30` | `destroyAll?.()` | async | 未 await |
| `meta-agent.plugin.ts:45` | `shutdown?.()` | async（`shared/infra.ts:437`） | 未 await |
| `pipeline-observer.plugin.ts:29` | `clear?.()` | 可能 async | 未 await |

而 `assemble.ts` 的注释写着「**逆序**释放资源」——除 `memory.close` 外全都没 await，
**所谓逆序实际是并发 fire-and-forget，且那些 `try/catch` 根本看不到异步拒绝**。

**已修（2026-09-26）**：
1. `Disposable` 各成员改为 `() => void | Promise<void>`——严格放宽，向后兼容
   （同步实现照旧满足，异步实现从此可被 await）
2. 上表 8 处补 `await`

验证：tsc 零错误、eslint 零问题、engine 91 文件 / 1044 测试全绿。

### 【6】shared export\* —— ⚠️ **题名与实况不符**

| 指标 | 实测 |
|---|---|
| `shared/src/index.ts` 的 `export *` | **0**（全部 12 处为具名导出） |
| 各包 `index.ts` 中 `export *` 总数 | **35** |

**`shared` 自己已经零 `export *` 了**——这一项在 `shared` 范围内已完成。
真实范围是**全仓 35 处**，集中在其他包。

→ **建议重命名为「全仓 35 处 export \* 收敛」**，并逐包评估（`export *` 会隐式扩大公共面、
绕过 barrel 完整性检查）。

---

## 二、4 项「真正未落地」—— 核验

| 项 | 源码命中 | 判定 |
|---|---|---|
| **钟离契约监督** | 0 | ✅ 确认未落地（Core-2 预留） |
| **Committee session** | 0 | ✅ 确认未落地（Core-3）。设计稿在 `core/Committee-session-协议设计.md` |
| **TrustModel** | 10 文件（`engine/src/bootstrap`、`engine/src/plugin/confirm-gate.plugin.ts` 等） | ⚠️ **与宪法表述不符**——并非「数据不足未落地」，`ConfirmGate` 的 trust 路径已经在接线 |
| **跨进程治理** | 1 文件（`cli/src/commands/agent.ts`） | ✅ 基本确认未落地（Full 阶段） |

**注意 TrustModel 那条**：宪法说它「未落地（数据不足）」，但 `confirm-gate.plugin.ts`
与 `bootstrap-engine.ts` 里已有 TrustModel 的接线。需要判断这是「部分落地」还是
「接而不用」——**这正是本轮在通知归并上遇到过的同一种形态（机制存在但链路断）**。

---

## 三、本轮新挖出的题（不在任何既有清单里）

| # | 题 | 证据 | 量级 |
|---|---|---|---|
| N-1 | **`scripts/` 不在任何门禁覆盖内** | **部分已修（2026-09-26）**——详见下节 | 余 84 项 |
| N-2 | ~~**`ci-gate` 计数口径无一致定义**~~ **✅ 已修（2026-09-26）** | 成因：打印串把「未运行的测试文件数」与「用例数」摆在同一分母旁。修正后 `3988 + 5 = 3993` 已闭合。**顺带修出两个真缺陷**：① 门禁 1-3 失败时不输出 JSON（消费方永远拿不到结果）→ 已加 `abort(stage)`；② `governance-pipeline.ts` 的 ci_verify 阶段读永不存在的字段（`configValid`/`build`/`testDetails` 等）→ 失败时恒报「全段失败」、成功消息嵌 `undefined/undefined`。**并因此定案：宪法历来的「3982 passed / 13 skipped」那个 3982 是 total，不是 passed** | 已闭合 |
| N-3 | **文档注册表实质失修** | `docs/README.md` 29 条链接中 11 条失效（7 条目标已归档），且把归档件摆在「当前活跃设计文档」与「⭐从这里开始」；`cortex-docs.json` 宪法条目 version 写 3.7 而文件是 v3.8；`docs/analysis` 实为 48 份而 README 记 15 份 | 已修（2026-09-26） |
| N-4 | **五流六层坐标系的锚点已漂移** | 45 条文件引用中 12 条搬家、2 条消失、1 条行号越界；只覆盖 16/28 包 | 已机器化（`architecture-flows.json` + `flow-contract` 门禁） |
| N-5 | **`design-tokens` 无测试** | 28 包中唯一不在门禁测试矩阵内 | — |
| N-6 | **`skills/` 的口径分歧** | 27 个 JSON = 26 个 `skill-p*.json` + 1 个 `data-2pc-rollback-verify.json`（形状相同、无编号） | 「预置技能数」取哪个口径未定 |
| N-7 | **PACKAGE_POSITIONING 的 RESTful API 契约已不完整** | 该节记 8 个端点且称「@cortex/cli 承载」，实测有 **6 个 handler**、端点含 `/capabilities`、`/daemon/health`、`/chat`、`/memory`、`/sessions`、`/scheduler`、`/scheduler/execute`、`POST /nodes`，且承载方是 `@cortex/server` | 已在本轮修 PACKAGE_POSITIONING 的模型表与包数，**此节未修** |

---

## 三-bis、N-1 详录：`scripts/` 的门禁悬空态（部分已修）

**原始状态**：`eslint.config.mjs` 未忽略 `scripts/`，但**没有任何门禁跑它**——门禁第 2 步是
`eslint packages --ext .ts,.tsx`。处于「配置上应该管、流程上没人管」的悬空态。
最刺眼的一条：**`scripts/verify/critical-fixes.ts` 正是门禁第 3 步所执行的东西**，
而它自身既不在类型检查内、也不在 lint 内。

### 已修（2026-09-26）

| # | 问题 | 修法 |
|---|---|---|
| 1 | `scripts/tsconfig.json` 的 `include` 写的是 `["*.ts"]`——**只收顶层，不收 `verify/` 子目录**，于是 `verify/critical-fixes.ts`、`verify/cli-frozen.ts` 不在任何 project 内（eslint 报 2 个解析错误） | `include` → `["**/*.ts"]` |
| 2 | scripts 由 tsx 运行、从不产出 dist，却配着 `composite` + `outDir`（配置与现实不符，且阻塞 `.ts` 扩展名导入） | `composite: false` + `noEmit: true` + `allowImportingTsExtensions: true` |
| 3 | **违反单一来源约束**：`confirmgate-stress.ts` 从 `@cortex/shared` 导入 `ReversibilityLevel`，而其真相源是 `@cortex/config`——`shared/tests/toolkit-single-source.test.ts` 明文禁止这件事，但**该守护的扫描范围不含 `scripts/`**，所以一直没被抓到 | 改从 `@cortex/config` 导入 |
| 4 | **指向不存在的 dist 路径**：`inject-cyrene-memories.ts` 从 `packages/engine/dist/memory/memory-store.js` 等导入（engine 已无该路径，memory-store 是独立包） | 改走包公共入口 `@cortex/memory-store` / `@cortex/shared` |
| 5 | **floating promise**：`cortex-cli.ts` 末尾裸 `main();`，拒绝变成 unhandled 且进程可能以 0 退出——而本目录其他脚本（`verify-docs-registry.ts`/`critical-fixes.ts`）都有 `.catch` 收尾 | 按既有约定补 `.catch` |
| 6 | `no-console` 占 168 项（68%）——而 scripts 正是**终端工具**，stdout 就是产出；`eslint.config.mjs` 已为 `packages/cli/src/**` 开了同类豁免 | 把 `scripts/**/*.ts` 加入该豁免 |
| 7 | 新豁免使 3 处 `/* eslint-disable no-console */` 变成冗余指令 | 清除（含本轮自己写的 `audit-amendment.ts`） |

**量化结果**：类型错误 **66 → 63**（死引用类 TS2305/TS2307/TS5097 **清零**）；
lint **263 → 84**，**fatal 解析错误 0**。

### 未做（需先清 84 项，故 `eslint scripts` / `tsc -p scripts` 尚未进门禁）

| 规则 | 项数 | 性质 |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 31 | 需要逐个判断真实类型 |
| `@typescript-eslint/no-non-null-assertion` | 20 | 多为 `noUncheckedIndexedAccess` 连带 |
| `no-empty` | 16 | 空 catch 块——**其中可能有静默吞错，需逐个看** |
| `@typescript-eslint/no-unused-vars` | 15 | 机械 |
| `no-useless-assignment` / `prefer-const` | 2 | 机械 |

类型错误 63 项中 46 项是 `noUncheckedIndexedAccess` 连带（`!`/`??` 补齐即可），
11 项 TS2345 + 4 项 TS2322 需逐个判断。

**判断**：这是一次独立的、有界的清理（约 147 项，绝大多数机械），
但它**不改运行时行为**，且与门禁策略变更绑定——建议在清完后一次性
把 `tsc -p scripts` 与 `eslint scripts` 加进门禁，而不是边清边加
（边清边加会让门禁长期处于红/黄之间，失去信号价值）。

---

## 四、建议的处置顺序

| 优先 | 题 | 理由 |
|---|---|---|
| 1 | 【4】EventPayloadMap | **已完成，只需从清单划掉** |
| 2 | N-2 ci-gate 计数口径 | 它污染所有基线——**不修它，后面每一条基线的可信度都打折** |
| 3 | 【1】可观测双通道 | 面最大（296 调用点 + 两套并存机制），且牵涉原则五合规 |
| 4 | ~~【2】execSync→async~~ | **已做（去重部分）**——余下需接口决策 |
| 5 | 【6】全仓 35 处 export\* | 范围清晰，逐包可做 |
| 6 | ~~【5】Disposable 声明补齐~~ | **题名被推翻**，改做的是「接口异步语义 + 8 处补 await」，已完成 |
| 7 | 【3】server 鉴权 | 需先定暴露面 |
| 8 | ~~N-1 scripts 门禁~~ | **部分已修**（详见 §三-bis），余 84 lint + 63 类型，需一次性清完再进门禁 |

> **本轮（2026-09-26）已完成**：N-2（计数口径）、【2】（去重部分）、【5】（改为接口+await 修复）、
> N-1（部分：tsconfig/死引用/floating promise/lint 豁免）。
> **仍待做**：【1】可观测双通道、【6】export\* 收敛、【3】server 鉴权、
> N-1 剩余 147 项清理、【2】的接口改造决策。

---

## 复现方式

本文所有数字来自一次性脚本（已删），核心口径：

- **裸 console 计数**：用 **TypeScript 编译器 API**（`ts.createSourceFile` + 遍历 `CallExpression`），
  **不用正则**——正则会把 `@example` 注释块与字符串里的 `console.log(` 计进来。
  实测差距：正则得 342 处 / 97 文件，解析器得 **296 处 / 83 文件**（46 处是注释或字符串）。
- **文件扫描**：用 Node 遍历，**不用 PowerShell `-Recurse`**——pnpm 的嵌套软链会让它陷入无限路径并报大量 IO 错。
- **路径与编码**：`git` 调用必须带 `-c core.quotepath=false`（否则中文路径被八进制转义，`includes()` 永不命中）；
  落盘日志按 BOM 判编码（本仓有 UTF-8 与 UTF-16LE 两种）。

---

*挖掘与核验：昔涟。2026-09-26。核验结果与代码同步；本文若与代码冲突，以代码为准。*
