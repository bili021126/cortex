# Core-3 设计债清单（挖题核验）

**日期**：2026-09-26
**来源**：宪法 v3.8 §一「6 项设计决策排入 Core-3」+ §二十五「仅 4 项真正未落地」
**方法**：全部**回到代码重新量**，不复用文档自述。量法见文末「复现方式」。

> **为什么需要这份清单**：宪法里记着一份题单，但**没人回来更新过它**。核验后发现——
> **6 项里 1 项已完成、1 项前提已消失、2 项题名与实况不符**。
> 一份不更新的待办清单比没有清单更危险：它让人以为还有 6 件事要做，而其中一半已经不是那件事了。

---

## 一、6 项 Core-3 设计决策 —— 逐条核验

### 【1】Logger 推广 —— ⚠️ **题名已过时，需重新定义**（设计已完成；**实现待 3 项裁决**）

> **2026-09-26 追记**：设计文档已写就并落盘（`observability-dual-channel-design.md`），
> 含四条不变量式的分工设计与 5 条验收标准。
> 其中「惰性栈」一条**已实测并决定不改**（8 749 ns/次 vs 前缀检查 15 ns，但 1000 次/秒下
> 只占事件循环 0.87%；改法会动白名单语义，风险大于收益）——详见该文档 §3.2-bis。
> 剩余实现项均**卡在 3 项待裁决上**：① `console.log` 要不要进管道（涉及保留策略）
> ② 基线门禁放哪一层 ③ 是否合并 `LoggingPipelineBridge` 与 `console-bridge`。
> **裁决未出之前动手会返工**，故本项到此为止。

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

### 【6】shared export\* —— ✅ **原题已满足；剩余 35 处经评估不动；另补了一处真缺口**

**原题的预设**：`shared` 里的 `export *` 需要收敛。实测：**`shared/src/index.ts` 已 0 处
`export *`**（12 个具名导出块）——**这条题在它被记录的那个范围内早已完成**。

**剩余 35 处的实测分布**：

| 包 | 处数 |
|---|---|
| protocol | **22** |
| fsm-compiler | **10** |
| cli / governance / memory | 各 1 |

**关键实测**：35 处**全部位于 barrel（`index.ts`）内**，非 barrel 文件 **0 处**。
所以「`export *` 绕过 barrel 完整性检查」这个顾虑**不成立**——恰恰相反，它们就是 barrel 本身。

**为什么不动它们**：`protocol` 是**纯类型契约包**（67 interface + 15 type + 7 function，零运行时依赖），
`fsm-compiler` 的 10 处是子 barrel 聚合。把 32 处惯用的 barrel 再导出展开成显式命名清单，
是**纯 churn**：维护面剧增、功能零收益，而且会让 barrel 文件**更臃肿**——而项目自己的
`BarrelExportRule` 唯一的结构性顾虑正是 barrel **体积**（`barrelMaxSize` 实配 10 MB，
实际永不触发）。

**但评估中发现一处真缺口，已补**：

> 全仓 35 处 `export *` 里 22 处集中在 `protocol`——**而 `protocol` 此前没有任何 barrel 守护**
> （只有 `envelope.test.ts` 与 `validation.test.ts`）。对比之下 `fsm-compiler` 有 **3 组**
> 「barrel re-exports」测试。而 `protocol` 是**三端与 daemon 之间的唯一契约**。

已新增 `packages/protocol/tests/barrel.test.ts`（32 项），守三类失效：

| 失效 | 守护 |
|---|---|
| barrel 指向的子模块不存在 | 悬空聚合检查 |
| 传递闭包内重名（`export *` 会**静默取其一**，契约语义不确定） | 重名检查 |
| 契约符号静默消失 | **29 个核心跨端符号**逐个断言 + 表面规模下限 |

**反向验证已做**：临时把 `ProtocolEnvelope` 改名 → 测试立即变红并报出符号名；文件已还原。
`protocol` 测试数 21 → **53**。

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
| N-1 | **`scripts/` 不在任何门禁覆盖内** | ✅ **已闭合（2026-09-26）**——详见下节 | 0（原 147 项） |
| N-2 | ~~**`ci-gate` 计数口径无一致定义**~~ **✅ 已修（2026-09-26）** | 成因：打印串把「未运行的测试文件数」与「用例数」摆在同一分母旁。修正后 `3988 + 5 = 3993` 已闭合。**顺带修出两个真缺陷**：① 门禁 1-3 失败时不输出 JSON（消费方永远拿不到结果）→ 已加 `abort(stage)`；② `governance-pipeline.ts` 的 ci_verify 阶段读永不存在的字段（`configValid`/`build`/`testDetails` 等）→ 失败时恒报「全段失败」、成功消息嵌 `undefined/undefined`。**并因此定案：宪法历来的「3982 passed / 13 skipped」那个 3982 是 total，不是 passed** | 已闭合 |
| N-3 | **文档注册表实质失修** | `docs/README.md` 29 条链接中 11 条失效（7 条目标已归档），且把归档件摆在「当前活跃设计文档」与「⭐从这里开始」；`cortex-docs.json` 宪法条目 version 写 3.7 而文件是 v3.8；`docs/analysis` 实为 48 份而 README 记 15 份 | 已修（2026-09-26） |
| N-4 | **五流六层坐标系的锚点已漂移** | 45 条文件引用中 12 条搬家、2 条消失、1 条行号越界；只覆盖 16/28 包 | 已机器化（`architecture-flows.json` + `flow-contract` 门禁） |
| N-5 | ~~**`design-tokens` 无测试**~~ **✅ 已修（2026-09-26）** | 原判「28 包中唯一不在门禁测试矩阵内」**成立且已核实**：27 个包有 `tests/` 目录，只差它。但成因比「没写」更具体——它的 `vitest.config.ts` 写着 `include: ["src/**/*.test.ts"]`（与全仓 `tests/**` 约定不符）**且 `passWithNoTests: true`**，于是零测试也静默通过；门禁按「有测试文件的包」分组，它自然落在外。另发现它的文档声称 CSS 生成器「供 WebUI 和 Desktop 使用」，而**全仓 3254 个文件里 `--cx-*` 零消费方**（WebUI 根本不存在），`inkTheme` 则实有 14 个消费方（`packages/cli/**`） | 已修：vitest 配置改指 `tests/**` 并**去掉 `passWithNoTests`**（反向验证：无测试文件时 exit 1，此前静默 exit 0）；新增 `tests/tokens-contract.test.ts` 16 条，只钉**真正没人守**的不变量（色值合法 hex——`PersonaPalette` 字段是 `string`，`"#zzz"` 也编译得过而 CSS 静默丢弃；persona 键集一致；spacing/radius/font.size 发射覆盖；单块无重名变量）。CSS 生成器零消费一事**未处置**，见 N-16 |
| N-5a | **`desktop` 有 37 个测试却不在 `pnpm test` 覆盖内** | `packages/desktop/package.json` **没有 `test` 脚本**，而根 `pnpm test` = `pnpm -r test`（只跑有该脚本的包）。实测 `pnpm --filter @cortex/desktop test` **退出 0 且零输出**——报告成功、什么都没跑。它的 `tests/` 之所以还能跑，只因为门禁第 4 步是**直接调 vitest**、不走 `pnpm -r test` | 已修：补 `"test": "vitest run"`；实测现在跑出 37 个测试（2 个文件，含 `src/renderer/chat/message-state-machine.test.ts`） |
| N-5b | **测试文件全仓不进类型检查**（观察，非本轮引入） | 所有包的 `tsconfig.json` 都只 `include: ["src"]`，vitest 用 esbuild 转译不做类型检查——所以测试里的类型错误没人看得见。实测 `packages/config/tests/` 有 4 条既有错误（`crud-chain.test.ts` 1 条 `id` 多余属性、`schema.test.ts` 3 条字面量过宽），都是「测试传了更松的字面量」这类，**运行时无碍** | **未修（有意）**：这大概正是「测试不进 tsc」的成因（测试常需更松的字面量）。要改就先量全仓范围——本轮只随手验了两处：新加的 `design-tokens/tests/tokens-contract.test.ts` 与 `config/tests/seed-missing-files.test.ts` **都是类型干净的** |
| N-16 | **`design-tokens` 的 CSS 变量生成器零消费方** | `generateCssVariables` / `generateFullStylesheet` / `--cx-*` 在全仓 3254 个文件中**只出现在本包内部**；`DEFAULT_PERSONA` 同样零消费。而 `css-variables.ts` 的文档写着它转换 palette「供 WebUI (Tailwind / vanilla CSS) 和 Desktop (Electron renderer) 使用」——**这两个消费方都不存在**（全仓无 `apps/`、无 WebUI，仅有的 CSS 是 `packages/desktop/src/renderer/` 三份，且用的是 `--rb-*` 与 `CHAT_PALETTE`）。另注 `motion` 有 5 个键而发射只覆盖 panel/status/modal（`stream` 与 `expression` 未发射） | **未修（有意）**：删是纯 churn、留着又挂着一句假的文档。要么接上一个真消费方，要么把文档改成「预留」，要么删。留给人定 |
| N-6 | **`skills/` 的口径分歧** | 27 个 JSON = 26 个 `skill-p*.json` + 1 个 `data-2pc-rollback-verify.json`（形状相同、无编号） | 「预置技能数」取哪个口径未定 |
| N-7 | ~~**PACKAGE_POSITIONING 的 RESTful API 契约已不完整**~~ **✅ 已修（2026-09-26）** | 原判成立且更严重：该节记「8 个端点、`@cortex/cli` 承载」，实测**承载方是 `@cortex/server`**（同文档上方包表即如此写），真实端点 **18 条**——原表 **2 条不存在**（`GET /agents/:type`、`GET /api/v1/events`，后者 `capabilities` 明写 `events: false`）、**漏列 12 条**。且「规范」一行把未实现的算进来了 | 已修（`4a10a3a4`）：表格校正为 18 条 + 承载方改写 + 规范表逐条标注实现状态；新增 `packages/server/tests/api-contract.test.ts` **双向守护**（表里每条必须有路由 / 路由每条必须在表里），两个方向都做过反向验证 |
| N-7a | └ **顺带查出一条真缺陷：413 未实现，超限一律 500** | 文档声明「413 体积限制」，实现里没有 413——`readBody` 超限只抛 `Error("Payload too large")`，被各 handler catch 当内部错误处理（execute/nodes 走 dispatcher 的 500；chat/memory/sessions 走各自 catch 的 500）。**有上限、状态码错** | 已修（`270b606c`）：`readBody(req, res?)` 超限即回 413（problem+json）；守护测试用**真实 http.Server 发 2 MB 请求**。**过程中两个坑只有真连接才暴露**：① 超限后立刻 `destroy()` → 客户端只看到 ECONNRESET、收不到 413（两种 destroy 时序都试了）；② 正解是不销毁、继续丢弃剩余上传，再加 `DRAIN_LIMIT_BYTES = 8×上限` 防被无限上传拖住 |
| N-7b | └ **仍未实现：405 + Allow 头** | 文档曾一并声明。实测路由未命中即 404，没有按路径的方法匹配，也没有 `Allow` 头 | **未修（有意）**：这是一个功能而非修正（要按路径收集允许方法），已在文档规范表标为 ❌ 未实现 |
| N-8 | ~~**`dist/data` 与 `src/data` 不同步**~~ **✅ 已修（2026-09-26）** | `dist/` 被 gitignore，门禁第 1 步只有 `tsc -b`（**不复制 JSON**——复制只发生在包自己的 build 脚本里，门禁从不跑它），而 loader 在 VITEST 下把数据目录解析到 `packages/config/dist/data`。实测缺失：`event-routing.json` 无 `mergeRules`（→ `setMergeRules([])`，NotificationPipe 归并静默失效）、`architecture-flows.json` 整文件不存在。**测试全绿**——因为没有任何东西在验证二者一致 | 已修：`copy-data.mjs` + 门禁同步步骤（`failedStage: "configDataSync"`） |
| N-9 | ~~**用户数据目录只播种一次**~~ **✅ 已修（2026-09-26）** | `seedIfMissing` 是 `if (existsSync(userDataDir)) return`——只在首次创建时播种，于是上游配置改动**永远到不了已安装目录**。实测 `~/.cortex/config` 缺 `mergeRules` 与 `architecture-flows.json`；反讽的是 src 里那行 description 早写着「2026-09-26：补上 mergeRules」 | 已修：改 `seedMissingFiles`，每次解析补缺且 **add-only 不覆盖**；已备份并修复本机目录 |
| N-10 | ~~**`audit.jsonl` 同一警告重复 882 条**~~ **✅ 已修（2026-09-26）** | `recordBootstrapAudit` 每次 bootstrap 无条件记 `config.warnings`，而跨字段警告是配置的**静态属性**。同一签名 882 条 ≈ 1.73 MB，**占该文件 2.55 MB 的 68%**；`audit-bootstrap` 的 T2/T3 正是靠这堆残留才「通过」——假绿 | 已修：`config_violation` 按内容幂等（跨进程靠读盘播种）；文件净化 2,603,117 → 92,267 字节 |
| N-11 | ~~**`scripts/doc-drift-check.ts` 恒退出 1**~~ **✅ 已修（2026-09-26）** | 输出 40+ 条 `MISS <符号> refs=3`，脚本自己都注明「may be forward-design or deprecated — manual check」。**一个永远红的检查等于没有信号。** 逐层查过判据，两条便宜的修法都试了、都不成立：① **按目录分角色**成立但不足以支撑阻断——活跃口径仍余 32 条，逐条核对后**32/32 全落在设计稿或虚构文本里，真阳性为零**；② **按编辑距离认改名**不成立——`Seated→started`/`Voting→routing`/`Footer→filter`/`Dreaming→streaming` 全是短词巧合。而**文档角色无法可靠自动推断**：206 篇里 34 篇前 12 行无任何角色标记，其中就含最该判为「当前态」的 `core/full-flow-map.md`——任何启发式过滤都是猜 | 已修：范围收敛（`archive`/`backup` 段与 `analysis|auditing|audit|reviews|review|inspection|amendments|superpowers` 不进判定）+ 按**活跃文档**归并呈现 + **默认 exit 0**（`--strict` 才阻断）+ `--json`。总数保持 272 以与既有报告可比 |
| N-15 | **宪法正文指名了一个已不存在的机制：`ToolGateway`** | 宪法 v3.8 §2.7 **原则三·边界集中** 正文（第 67 行）写「所有工具调用经统一 **ToolGateway** 注册，不私接 API」。而 `packages/*/src` 里**没有任何 `ToolGateway`**——现机制是 `@cortex/platform` 的 **`Toolkit`**（`packages/platform/src/toolkit.ts`）。全库 69 次出现中 68 次在 `docs/archive/meso-lite/**` 等归档里（Meso-Lite 原型期），**当前宪法只剩这一行** | **未修（按规矩不动正文）**：修宪走提案→审计→裁决→落笔，起草人不改正文。此处只登记，待人裁决 |
| N-15a | └ **性质已查明：不是违宪，是同一份文档自相矛盾的一处旧名** | 宪法**自己在别处已经用现名**：第 114 行 `├── platform/  # 平台抽象——Toolkit + MCP 鉴权`；第 262 行代码锚点 `packages/platform/src/toolkit.ts`；第 258 行描述拦截语义（L0–L3 可逆性等级）用的是现机制。所以原则三的**实质在被实现**，只有第 67 行的名字没跟着改 | 处置建议：**同名回填**（`ToolGateway` → `Toolkit`），实质不动。仍须走修宪流程，因为改的是宪法正文 |
| N-12 | **`AuditTrail` / `FileTransport` 无大小上限、无轮转** | `AuditTrail` 以 `"a"` 打开 `audit.jsonl` + `fs.writeSync`；`telemetry-infrastructure-deepening.md` 写的「定期 rotate」**从未实现**。**但实测量级远小于提案担忧**：净化后 443 条 / 56 天 ≈ **0.6 MB/年** | **未修（有意）**：按实测不构成当下痛点。写进文档的教训是「先看数据再定紧迫度」——此前按未去重文件估出的「约 16 MB/年」是错的 |
| N-13 | **`~/.cortex/config/models.json` 语义漂移待人工裁决** | 用户是 `deepseek-v4-flash` / `deepseek-v4-pro` 且无 `_pricing`；src 是 `deepseek-v4-1-flash` / `-pro` / `-flash-vision-exp`。可能是用户定制，也可能只是旧版 | **未动（有意）**：语义变更不自动迁移，覆盖不可逆，留给人决定 |
| N-14 | **孤儿 `agents.json`** | `CONFIG_DOMAINS` 18 个域**无一引用它**（`agents` 域早已移除、由 `agentManifests` 取代）。dist 侧已由 `copy-data.mjs` 的孤儿清理删除；用户目录仍遗留一份（惰性，无害） | dist 已清；用户目录遗留待定 |

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

### 未做 → **已闭合（2026-09-26）**

原列「余 84 lint + 63 类型，需先清完再进门禁」。**已全部清完并纳入门禁**：

| 指标 | 前 | 后 |
|---|---|---|
| `eslint scripts` | 263 | **0** |
| `tsc -p scripts/tsconfig.json` | 63 | **0** |

清理纪律（全批遵守，已 grep 复核）：不新增 `eslint-disable`；不新增 `any`/`as any`；
不用 `!`；非空断言与 `noUncheckedIndexedAccess` 一律改**显式守卫**（不可达分支保留类型收窄
并在注释里写明为何不可达）；空 catch 补注释而不扩大吞异常；不改运行时行为。

**门禁自用的脚本也在其中**：`scripts/verify/critical-fixes.ts`（门禁第 3 步执行的东西）
原有 16 个问题，清理后实跑仍 **14 通过 / 0 失败**。

**纳入门禁**：
- 门禁 1/5 增补 `tsc --noEmit -p scripts/tsconfig.json`（root tsconfig 只 references `packages/`，
  `scripts/` 从不在构建图内）
- 门禁 2/5 作用域：`eslint packages` → `eslint packages scripts`
- 新失败段名 `scriptsTypecheck`，并**回显末 30 行 tsc 输出**
  ——此前那句「见上方输出」是空话，`run()` 并不回显，失败时看不到原因

**反向验证**：注入类型错误 → 门禁 exit=1 且 `failedStage="scriptsTypecheck"`。

> ⚠️ **验证手法的一个坑，必须记下**：反向验证时用 `git checkout -- <file>` 撤销注入行，
> **把该文件里尚未提交的清理成果一并回滚了**——门禁当场变红才发现。
> `git checkout` 恢复的是 HEAD，不是「注入之前」。
> **此后一律：先提交，再反向验证；或只做定点回撤，不用整文件 checkout。**

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
