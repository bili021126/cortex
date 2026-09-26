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
| N-16 | ~~**`design-tokens` 的 CSS 变量生成器零消费方 + 一句假文档**~~ **已定性并处置文档（2026-09-26）** | `generateCssVariables` / `generateFullStylesheet` / `--cx-*` 在**包外零引用**；而 `css-variables.ts` 写着它们「供 WebUI (Tailwind / vanilla CSS) 和 Desktop (Electron renderer) 使用」——**两者都不存在**。查明去向：① 全仓**没有 WebUI、没有 `packages/webui`**，只有 `docs/core/webui-architecture-design.md` 与 `webui-role-assignment.md` 两份**设计稿**——**设计已写、未落地**；② Desktop 用的是**另一套**变量（`packages/desktop/src/renderer/ui/tokens.css` 的 `--rb-*`，62 项，权威值 `CHAT_PALETTE`，由 desktop 侧一致性测试守护）。另注 `motion` 有 5 个键而发射只覆盖 panel/status/modal；且 `PRESENCE === CYRENE_PALETTE`，故 `[data-theme='presence']` 块与 `[data-persona='cyrene']` 块内容全同（冗余但非 bug） | **文档已修，代码有意保留**：`css-variables.ts` 头注释改为如实说明「当前零消费方，是为规划中的 WebUI 预留的发射端」，并点出 Desktop 用的是 `--rb-*` 那套。**不删代码**——删是纯 churn 且毁掉未来要用的东西（沿用本清单对 `export *` 的既有判断）。接不接真消费方由人定 |
| N-17 | **`scripts/audit-unconsumed.ts` 有两处假阴性，使它看不见自己存在要找的东西** | ① **barrel 再导出被当成消费**：`index.ts` 的 `export { foo } from "./foo.js"` 命中 `\bfoo\b` → 记为「有引用」；② **包自己的测试文件被当成消费**——只为被测而存在的符号同样算「被引用」。实测证据：该脚本对 `design-tokens` 报「导出 25 / 零消费 **0 (0.0%)**」，而其中 14 个**无包外引用**、6 个包内外皆无人用。**死面能长期存活，正因为这份审计说它被消费了**（N-16 即其一） | 已修：统计前剥掉 `export { ... }` 与 `export type { ... }` 列表（原先漏了 `type` 形态），且引用语料**排除被审计包自身**；输出改为两档——「无包外引用 N 个，其中包内外皆无人用 M 个」并逐条标注（仅包内 x 处 / 包内亦无引用）。**口径变更已写进文件头**：本口径的「零消费」= 无包外引用，**不等于死代码**（如 `ENGINEERING` 被同包 `ink-theme` 使用，而 `inkTheme` 有 14 个包外消费方） |
| N-17a | └ **又查出两处失真，一并修掉（`52ab4569`）** | ③ **包内计数也把定义文件排除了** → 「只在自己文件里用」的符号被当成死面。实测 `desktop` 的 `PRESENCE_IPC_CHANNEL` 在第 17 行定义、第 65 行**同一文件**里就被 `webContents.send` 用了，却被列进死面（desktop 死面 23→5）。④ **`.tsx` 完全不可见**——`walkFiles` 只收 `.ts`，于是「只被 TSX 组件引用」的符号也成死面（cli 死面 125→81→49） | 已修。**四处合起来，这个审计此前两个方向都在骗人。共同教训：正则近似的脚本，每一处失真只有抽查条目才看得出来**——本轮抽查 8 条（跨 5 包）才发现③ |
| N-18 | **全仓死面清单（新口径首次可用读数）** | 28 包 / 导出 2069 / 无包外引用 1328（64.2%）/ **其中包内外皆无人用 168**。按包：cli 49、config 42、memory 24、protocol 11、shared 8、engine 6、design-tokens 6、logging 5、desktop 5 …… 已知成因三类：① **应用包**（cli/desktop/server）的「无包外引用」近乎必然——它们不是库，别拿那几行当健康指标；② **旧项目遗留**（`FILE_CYRENE_MEMORY_DB` 之类只服务已迁走的 `D:\cyrene`）；③ **真没人用** | 清单可复现：`npx tsx scripts/audit-unconsumed.ts --json <pkgs>`。「真没人用」那类已逐条定性，见 N-20/N-21 |
| N-20 | ~~**`config/src/schemas/validators.ts` 是与通用机制完全重复的第二套校验**~~ **✅ 已删（2026-09-26）** | 12 个函数（`validates_<域>` / `safeValidates_<域>`，覆盖 models/keysContext/agentManifests/tuning/tools/eventRouting 六域）。**与 loader 的通用机制完全重复**：`validates_models(d)` ≡ `validateDomainWithSchema("models", d)`、`safeValidates_models(d)` ≡ `validateSafe("models", d)`，用的是**同一批 schema 对象**（loader 把那 6 个注册进 `CONFIG_DOMAINS`，validators.ts 又各自 import 了一遍）同一套 `validateJsonSchema` 引擎。**三条删因**：① 零调用零测试（全仓只出现在自己的定义与旧导出名单里）；② **只覆盖 6 个域而通用机制覆盖全部 18 个**——这是「被放弃的平行实现」的签名，不是有意的校验入口；③ **静默同步陷阱**——新增第 7 个域时通用机制自动覆盖、它却要手工补，缺了没有任何测试会报警。删法与仓库既有做法一致（宪法变更史有「重复实现统一：PipelineEventType 删除 238 行、AGENT_DEFS config 版删除 117 行」） | 已删：文件整体移除 + `index.ts` 的 12 行导出换成一段说明（写清删因与正路）。域校验的正路是 `validateDomainWithSchema(domainName, data)`，而 `loadConfigDomain` 本来就会调它（硬阻断），业务代码通常什么都不用做 |
| N-21 | **`config` 的四个 store 工厂无人使用——但类在用，性质与 N-20 不同** | `createModelStore` / `createKeyStore` / `createAgentManifestStore` / `createTuningStore` 零调用；然而 `ModelStore` / `KeyStore` / `AgentManifestStore` / `TuningStore` **四个类是被重度使用的**——`cli/src/bootstrap/config.ts` 与 `server/src/engine-host.ts` 都直接 `new ModelStore(readFile, writeFile, dir)`，`config/tests/crud-chain.test.ts` 也在测。**且两个消费方各自手搓了同样四行构造**，正是工厂想避免的那种重复 | **未删（有意）**：与 N-20 不同，这四个是**无害的一行糖**——命名准确、无同步陷阱、不误导（不会有人把它当成校验入口）。按本轮用的准则处置：**主动误导或有陷阱的删；无害、可能有意留下的记**。若将来要消掉两处手搓构造，这四个工厂就是现成的钩子 |
| N-22 | **Cyrene 记忆层：初始化结果被丢弃，实际落盘路径与声明不符——且落在被 git 跟踪的目录里** | （2026-09-26 查明，`memory` 那 24 个零消费导出的成因大多在此）① `bootstrap-engine.ts:248` 调 `initCyreneMemory()` **不传参**，返回的 `{manager, store}` 在 541 行只被 `await`、**值从未被读取**（全仓仅 2 处出现该变量）。而 `initCyreneMemory` 内部建了**自己的** `MemoryStoreManager(".cortex/cyrene-memory.json")` 并 `load()` 它——那份工作连同组装好的 `MemoryManager`+RAG 桥**一起被丢弃**。② 真正干活的是模块级单例 `memoryStore = new MemoryStoreManager()`（`cyrene/memory-store.ts:703`，**不带参数**），其兜底路径是 **`process.cwd()/data/memory.json`**。所以**引擎把 L0/L1/L2 记忆写进 `cwd/data/memory.json`，而不是代码自称的 `.cortex/cyrene-memory.json`**。③ 而 **`data/` 是被 git 跟踪的目录**（含 `data/claims/`）→ 从仓库根跑一次、记忆层一写，工作树即脏。④ 相关：`setTracePath` / `setRagDataDir` / `setRagModelsDir` / `set*ModelPath`(×3) **全部零调用**，导致这套记忆层的 **5 处文件位置全部 cwd 相对且无法从引擎配置**；`initRAG("auto", undefined×4, "none")` 里第 5 个是 `rerankerMode`（故重排器 3 个导出不可达，属**刻意关闭**）、第 6 个 `worldbookDir` 未传（故 worldbook 从未构造，其 4 个 accessor 不可达——此项 2026-07 审计已记 `@deprecated`，但那条注释把它写成 `worldbookDir="none"`，**实为 `rerankerMode="none"` 而 `worldbookDir=undefined`**，参数位置记错了） | **症状已修、成因待裁决**：已在 `.gitignore` 按文件忽略 `data/memory.json` / `data/rag-data/` / `memory-trace.log`（**不忽略整个 `data/`**，`data/claims/` 仍未忽略——已验证），使工作树不再被运行时产物弄脏。**成因未动**：到底该以 `.cortex/cyrene-memory.json` 为准（代码自称）还是 `cwd/data/memory.json`（实际运行），改任一方都会搬动既有数据，属设计裁决。**已排除数据丢失**：单例每次操作前都会 `await this.load()`（`memory-store.ts` 内 30+ 处），不会用空状态覆盖文件 |
| N-23 | **REST 线契约没有单一来源：`@cortex/protocol` 是「部分覆盖 + 部分前瞻 + 少量没人用的准确别名」的混合体，而缺口由消费方各自内联补上** | 逐条核实（模块头注释 ↔ `router.ts` 18 条路由 ↔ `capabilities.api`）：① **缺已实现端点的类型**——`GET /agents`、`GET /scheduler`、`POST /scheduler/execute`、`POST /nodes` 在 protocol 里**没有模块**，客户端于是在 `client/src/types.ts` 自建 `SchedulerSnapshot` / `SchedulerExecutionReport` / `NodeSubmitRequest`；② **前瞻**——`rest/events.ts` 与 `rest/config.ts` 为**未实现**端点声明了完整 DTO（`capabilities.api.events === false`、`config === false`），而 `config.ts` 的 DTO 恰是客户端重度使用的（配 `_assertSupported` 守卫）；③ **没人采用的包装别名**（11 个）——它们**是准确的**（逐条与 router 实际返回比过，**未发现漂移**），只是消费方直接内联组合（client 写 `PaginatedResponse<TaskNodeSnapshot>`，与 `GetNodesResponse` 的定义**逐字相同**） | **呈现已补、结构未动**：在 `protocol/src/rest/index.ts` 的桶导出头部加了一张**模块 ↔ 端点 ↔ 实现状态**表，把三类东西分开标清（含「缺哪些类型」「哪些是没人用的准确别名」），让读者不必再自己拼。**未删任何类型、未补缺失模块**——补缺失模块是设计动作（要不要把 `scheduler`/`agents` 的线类型收归 protocol，属线契约归属的裁决）；删别名则会让线契约彻底失去形式化落点。另注：这解释了 N-16 与 N-22 同一片土壤——**没有单一来源，就没有任何东西在保证两处一致** |
| N-24 | **span 追踪是半成品：读取端与词汇表齐备，写入端未做（已被记录，此处汇总）** | `shared` 的 5 个 `SPAN_PREFIX_*`（task-/cfg-/scene-/boot-/sys-）零消费；`AuditEntryBase.spanId` 字段声明但**从不被填充**——`telemetry/src/audit-trail.ts` 的 `record*` 五个方法没有一个写 `spanId`。读取端却已建好：`queryBySpan()` 扫描 + `doctor --audit-span-id` 查询 + 测试。**代码里两处已明写这是已知状态**：`telemetry/tests/audit-trail.test.ts:144`「record* 当前不产 spanId，读取端用于后续扩展」、`doctor/src/audit-checker.ts:115`「无匹配条目（record* 当前不产 spanId，命中 0 条属预期）」 | **不动**：写入端需要设计「谁生成 spanId、怎么在调用链上传递」——那是新功能不是修正。汇总统一处的意义是：**这 5 个常量不是死代码，是未接线功能的词汇表**（同 N-22 的 `set*Path` 一类） |
| N-25 | **`CapabilityRegistry` 与 10 份 Agent 能力声明构成闭环，但运行时没有入口——整套「Agent 自声明能力画像」惰性** | 实测（2026-09-26，`engine/src` 内穷举）：① `capabilityRegistry`（`core/capability-registry.ts:129` 模块级单例）在 `src/` 里**只有两处**出现——它自己的定义，以及 `agents/registry.ts:191` 的 `registerAllCapabilities()` 函数体内那一行；**没有任何调用点**。② 本类的读取方法 `toPromptDescription()` / `findByTags()` / `findTeam()` **全部零调用**——而 `toPromptDescription()` 的注释写着「生成人类可读的能力清单（**供 MetaAgent prompt 注入**）」，即**本该注入 MetaAgent prompt 的那份清单从未被读取**。③ `AGENT_REGISTRY` 那 10 项 `capability` 声明（role / emoji / tags / produces / toolPermissions / applicableScenarios / outputFormat / collaborationMode）在 `engine/src` 里的**唯一读者就是该函数**（line 190 的 `AGENT_REGISTRY.map(r => r.capability)`）。④ 单例是 `new CapabilityRegistry()` 裸构造，**无自填充**。**所以它运行时是空的、且没人读**——注意这不等于「死代码」：每一块都写完了、读得通，是**未接线的功能**（同 N-22 的 `set*Path`、N-24 的 `SPAN_PREFIX_*`）。**同类先例（说明是复发而非孤例）**：`engine/tests/manual/scripts/skill-system-roundtable.ts:147` 记过「断裂3: 冷启动不加载——`registerAll()` 注释写好了，但代码库中没有任何地方调用它」，那指的是 **skill** registry，**后已被修好**（`bootstrap/init-skills.ts:90/133` 现在会调 `skillRegistry.registerAll(...)`）——同一个病在 capability registry 上还在 | **只加注释、未修（按用户边界）**：在 `agents/registry.ts` 的 `registerAllCapabilities()` 上方与 `core/capability-registry.ts` 的单例上方各加一段说明，写清零调用、读取端也零调用、10 份声明的唯一读者、以及那条复发先例。**没有加调用点**——「接到哪一段启动流程」属设计裁决（且改动会触及行为）。同上，`engine` 那 6 个死面里其余 5 个（`simulationRunner` / `compactToSubAgentSummary` / `tagSkillScope` / `hasAgentFactory` / `getRegisteredAgentTypes`）本轮只读未定性完，待续 |
| N-26 | **`@cortex/logging` 的接线面极窄：全仓只有 2 个生产文件引用它** | 直接 grep 证实（此前设计文档口径的「2 / 83」得到复核）：生产代码里 `from "@cortex/logging"` 只出现在 `engine/src/core/meta-agent.ts:6`（`createLogger`）与 `engine/src/bootstrap/bootstrap-engine.ts:41`（`LoggingPipelineBridge` / `createLogger` / `addTransport`）；其余命中全是 `logging/` 自己的测试与 README。而该包导出 26 个、无包外引用 20 个（76.9%）、包内外皆无人用 5 个（`LOG_CONFIG_DEFAULTS` / `getLogger` / `shutdownLoggers` / `LogLevelValue` / `rootLogger`）。**注意 README 把 `shutdownLoggers` 当公开 API 写进了示例**（README:100）——文档在教一个零调用的入口 | **不动**：这一条不是孤立死面，而是本清单 **【1】可观测双通道**（`observability-dual-channel-design.md`）的同一片土壤——那 3 项待裁决（`console.log` 要不要进管道 / 基线门禁放哪一层 / 要不要合并 `LoggingPipelineBridge` 与 `console-bridge`）**决定** logging 包是被推广还是被收编。在裁决出来之前动它的导出是瞎动 |
| N-27 | **`MetaAgent` 的依赖注入接了一半：四个 setter 里三个从不被调用，三条功能链整条断路** | `setPromptManager` ✅ 被调（`bootstrap-engine.ts:275`）——证明接线点存在、模式在用；而 `setSimulationRunner` / `setSkillScope` / `setResolveByScope` **全部零调用**。三条链因此各断一环（每一环都写完了、彼此期待对方存在）：① **仿真**——`simulationRunner`（`planning/simulation-runner.ts:127` 的单例）是**唯一**构造出来的 `SimulationRunner`（`new SimulationRunner` 只此一处），没人把它注进来 → `meta-agent.ts` 的 `if (this._simulationRunner)` 分支永不执行、`core/scheduler.ts:196` 的检查**恒为假**；② **技能作用域**——`tagSkillScope`（`planning/skill-scope.ts:66`）是**唯一**会写 `skill._scope` / `_packageName` 的地方，零调用 → 没有任何技能带上作用域标记；③ **作用域解析**——`resolveByScope` 只在 `index.ts` 桶导出与**一行注释**里出现，无真实调用方；且即便注入，② 也决定了 `skill._scope === "cross-domain"/"package"` 永不为真，四级作用域模型（L0 跨域 / L1 项目 / L2 包级 / L3 Agent）从未生效 | **只加注释、未修（按用户边界）**：在 `core/meta-agent.ts` 三个字段声明上方加了一段说明（四个 setter 的调用情况表 + 三条链各断在哪 + 与 N-25 同源），并在其中点明一处**审计口径的实例弱点**：`resolveByScope` 之所以没被列为零消费，是因为 `\bresolveByScope\b` 命中了下方的注释——即该工具自己写明的「含注释/字符串误命中」。**没有加任何调用点**（接到哪一段启动流程属设计裁决） |
| N-27a | └ **`engine` 那 6 个死面的其余三个：两个是无害内省助手，一个是无人用的 helper** | ② `hasAgentFactory` / `getRegisteredAgentTypes`（`plugin/agent-factory-registry.ts:39/44`）——**工厂注册表本身是活的**：`registerAgentFactory` 在 `scheduler.plugin.ts` 被调 3 次（inspector/browser/butler）、`getAgentFactory` 在同文件 143 行被用。死的只是这两个**内省**助手（同 N-21 那一类无害糖）。③ `compactToSubAgentSummary`（`memory-bridge/pipeline.ts:526`）及其 `SubAgentSummary` 类型只在该文件定义、在 `memory-bridge/index.ts` 桶导出——**无任何真实调用方** | **均不动**：② 同 N-21 判据（无害、命名准确、不误导 → 记）；③ 是无人用的 helper + 未被采用的类型，删它属代码改动、越出本轮边界。**至此 `engine` 的 6 个死面全部定性完毕**（3 个属未接线功能、2 个属无害内省、1 个属无人用 helper） |
| N-28 | **`shared` 剩余死面结清：一个被绕过的桶 + 一份被明确延后的宪法 schema** | ① **`agent.ts` 这个桶被绕过**：其头部自述「所有子模块通过此桶统一导出，外部消费方无需感知拆分细节」，但 `shared/src/index.ts` **从不引用 `./agent.js`**（grep 零命中）——它直接从 `agent-registry.js` / `agent-skill-types.js` / `agent-protocols.js` 再导出，即本文件在做的事；全仓唯一 import `./agent.js` 的是 `modification-record.ts`（取 `AgentType`）。于是 `agent.ts` 里**唯一独有的声明** `SHARED_IDENTITY_ANCHOR`（一句内嵌中文提示词「你是 Cortex 工程助手的身份锚点」）**不在 `@cortex/shared` 公开面上**——`index.ts` 没转出它，包外拿不到，包内也无人引用；它还在一份纯类型再导出的 barrel 里孤立存在。② **`modification-record.ts` 整个模块零代码消费方**：其全部导出（`ModificationType` / `ReversibilityClass` / `FactAnchor` / `ModificationRecordItem` / `ModificationSession` / `ModificationRecordV1`）在全仓只出现在**本定义文件内部互相引用**、`index.ts` 导出名单、以及几份文档里。**而这不是遗忘，是有意延后**——`governance/src/consistency/schema-enforcer.ts:13` 明写「modification-record 全量 Schema 延后至 Core-2」。③ **一处接值不接类型的桥**：`config/src/vocabularies/tool-enums.ts:29` 的 `toReversibilityClass()` 自称是 `ReversibilityClass` 的显式映射，注释写「@fix 艾尔海森 P0-1 — 两套枚举描述同一域但无映射，消费方需自己推断」——**但它返回字符串字面量联合 `"reversible" \| "irreversible" \| "meta"` 而非枚举本身**，而字面量联合在 TS 里不可赋给字符串枚举，消费方仍须 cast。即那次修复**接上了值、没接上类型**。④ `StrictNonEmptyArray`（`infra.ts:510`）是纯类型工具，零使用——类型层无运行时成本，属无害词汇表 | **只加注释、未删（按用户边界）**：在 `modification-record.ts` 与 `agent.ts` 各加一段说明（写清零消费、明确延后、以及那处「接值不接类型」的对口）。**未删任何导出、未改 `toReversibilityClass` 的返回类型**——都属代码改动。**至此 `shared` 的 8 个死面全部定性完毕**（5 个 `SPAN_PREFIX_*` 见 N-24；本条覆盖其余 3 个） |
| N-19 | **治理层 code↔doc 漂移：校验器按编号执行宪法已不陈述的子约束** | 当前宪法 **v3.8 通篇没有「子约束」二字**（grep 零命中），而 `packages/governance/src/constitution-validator.ts` 仍在按编号执行 **检查⑦ 子约束修改规则 / ⑧ 硬编码禁令 / ⑨ 类型安全保障**（⑧ 的判据是启发式：`after` 里出现 `: 32000`、`"localhost"` 或 `: 数字≥5 位`）。同一套编号还散见于 `prompts/coding-standards.md`（写成「配置驱动开发铁律」）、`packages/doctor`（ConfigConsistencyChecker）、`docs/core/Cortex-架构映射-五流六层七原则.md`、`docs/auditing/AM-2026-0531-001.json` 的 `section: "§七·子约束8…"` | **未处置（需裁决）**：这不是代码缺陷而是**治理层漂移**——要么把子约束体系补回宪法正文，要么让校验器与其余文档不再引用已不在正文里的编号。**我不自行处置**：改的是宪法或治理规则，须走提案→审计→裁决→落笔。注：本轮据此判断「按硬编码禁令修是有据的」（它在多份活跃文件中仍被执行），但不替它补宪法依据 |
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

## 四、处置索引（2026-09-26 **重建**）

> ⚠️ **本节是派生索引，不是登记表。** 逐条证据在上面 §三 的主表里，本节只做分流、不重复登记。
> **脚本统计条目数时请只扫 §三**——本节的表行同样以 `| N-` 开头（实测：按 `| N-` 全文档扫会得到
> 67 行，而真实条目是 **35** 条；差值来自本节的索引行）。这一句是给下一个写脚本的人留的，免得数错。
>
> **为什么要重建**：本节此前只列到 `N-1` / `N-2` 与【1】-【6】，而清单已长到 **N-28**。
> 过期的处置顺序比没有更危险——它会让人以为「N-1 还剩 147 项」「export\* 收敛还待做」，
> 而这两件都已闭合、或被明确决定不动。**一份不更新的清单会把人派去做已经做完的事。**
>
> 现按**处置类别**重建：四类各自列全，供 30 秒内分流。逐条证据仍在上面的表里，此处不重复。

### A. 已修 / 已闭合 —— 无需动作（16 项 + 3 项设计题）

| 项 | 一句话 |
|---|---|
| N-1 | `scripts/` 纳入门禁；原 147 项已清零 |
| N-2 | `ci-gate` 计数口径统一（并顺带修出 `abort(stage)` 与 governance 读错字段两处真缺陷） |
| N-3 | 文档注册表恢复一致（失效链接 / 版本头 / 目录归属） |
| N-4 | 五流六层锚点已机器化（`architecture-flows.json` + `flow-contract` 门禁） |
| N-5 | `design-tokens` 补契约测试，**首次进入门禁测试矩阵** |
| N-5a | `desktop` 补 `test` 脚本——此前 `pnpm test` 静默跳过它的 37 个测试 |
| N-7 | REST 契约表校正为 18 条；新增**文档↔路由双向**守护测试 |
| N-7a | 请求体超限回 **413**（此前一律 500）；真实 http.Server 测试守护 |
| N-8 | `dist/data` 与 `src/data` 同步进 CI 门禁（`failedStage: "configDataSync"`） |
| N-9 | 用户数据目录改为 **add-only 补种**——上游配置改动不再永远到不了已安装目录 |
| N-10 | `config_violation` 落盘幂等；`audit.jsonl` 净化 2,603,117 → 92,267 字节 |
| N-11 | `doc-drift-check` 由「恒红的假门禁」改为**盘点**（默认 exit 0 / `--strict` 阻断） |
| N-16 | CSS 生成器零消费方一事写入头注释（**代码有意保留**） |
| N-17 / N-17a | `audit-unconsumed` 四处失真修完——它此前**两个方向都在骗人** |
| N-20 | 删除与通用机制完全重复的第二套域校验器 |
| 【4】 | `EventPayloadMap` 已完成 |
| 【5】 | 改做的是「接口异步语义 + 8 处补 await」，已完成 |
| 【6】 | 原题已满足；剩余 35 处 `export *` **经评估不动** |

### B. 需人裁决 —— 卡在拍板，不卡在干活（12 项）

| 项 | 卡在哪 |
|---|---|
| **AM-2026-0926-001** | 8 组事实对齐 + 两处未经授权改正文的处置披露，`status: pending_judgment` |
| N-19 | 治理层漂移：宪法 v3.8 无「子约束」，而校验器仍按编号执行检查⑦/⑧/⑨。**须走提案→审计→裁决→落笔** |
| N-15 / N-15a | 宪法正文那处 `ToolGateway` 应为 `Toolkit`（性质已查明是旧名），**同名回填仍须走修宪流程** |
| N-22 | Cyrene 记忆落盘以 `.cortex/cyrene-memory.json`（代码自称）还是 `cwd/data/memory.json`（实际运行）为准——改任一方都会搬动既有数据 |
| N-25 | `CapabilityRegistry` 与 10 份能力声明要不要接线、接到哪一段启动流程 |
| N-27 | `MetaAgent` 三条断链（仿真 / 技能作用域 / 作用域解析）要不要接 |
| N-13 | `~/.cortex/config/models.json` 保留用户旧版还是同步到 src 新版 |
| N-6 | `skills/` 的「预置技能数」取哪个口径 |
| 【1】 | Logger 推广——设计已完成，**实现卡在 3 项裁决**（`console.log` 进不进管道 / 基线门禁放哪层 / 是否合并两条桥） |
| 【2】 | `execSync → async` 的**接口改造**（去重部分已做） |
| 【3】 | WebUI 鉴权——原前提已消失，需重新界定 |
| §二·TrustModel | 宪法说「未落地（数据不足）」，但 `confirm-gate.plugin.ts` 已有接线——判「部分落地」还是「接而不用」 |

### C. 有意不动 —— 已定性，**不要动它**（11 项）

| 项 | 为什么不动 |
|---|---|
| N-18 | 全仓死面清单：**那是读数不是待办**。应用包（cli/desktop/server）的「无包外引用」近乎必然，别当健康指标 |
| N-20 之外的词汇表类（N-21 / N-24 / N-27a） | 无害的一行糖 / 未接线功能的词汇表 / 无害内省助手——按判据「主动误导或有陷阱的删；无害的记」 |
| N-23 | protocol 线契约的呈现已补（桶导出头部状态表）；**未删类型、未补缺失模块**（补是设计动作） |
| N-26 | `@cortex/logging` 接线面窄——它与【1】是同一片土壤，**裁决出来之前动它的导出是瞎动** |
| N-28 | `shared`：被绕过的桶 + 明确延后的 schema——见 D 档说明 |
| N-5b | 测试文件全仓不进类型检查：这**大概正是**「测试不进 tsc」的成因（测试常需更松的字面量），要改先量全仓范围 |
| N-7b | 405 + `Allow` 头——是**功能**不是修正，已在文档标 ❌ |
| N-12 | `AuditTrail` / `FileTransport` 无轮转：**按实测（0.6 MB/年）不构成当下痛点** |
| N-14 | 孤儿 `agents.json`：dist 侧已清，用户目录遗留无域引用（惰性） |

### D. 确认延后 —— 有明确排期依据，等阶段（4 项）

| 项 | 依据 |
|---|---|
| N-28 里的 `modification-record` | `governance/src/consistency/schema-enforcer.ts:13` 明写「**全量 Schema 延后至 Core-2**」——不是遗忘 |
| §二·钟离契约监督 | 确认未落地，Core-2 预留 |
| §二·Committee session | 确认未落地（Core-3）；设计稿在 `core/Committee-session-协议设计.md` |
| §二·跨进程治理 | 基本确认未落地（Full 阶段） |

---

### 判据速查（本轮沉淀，处置任何「零调用 / 零消费」时按它办）

| 情形 | 处置 |
|---|---|
| 主动误导或有陷阱的 | **删** |
| 无害的一行糖 / 词汇表 / 内省助手 | **记** |
| 未接线的功能 | **标注**（别删——它是指出缺口的证据） |
| 文档里明确写了「延后」的 | **别动**，只记它现在不生效 |

> 见到「零消费」先问三句：**为什么没人调用？**（可能是接线缺口）→ **有没有「已推迟」的声明？**（那它就不是死代码）→ **顺着引用再追一层。**（「有包内引用」也不等于活着——`CapabilityRegistry` 就是这么逃过报表的。）

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
