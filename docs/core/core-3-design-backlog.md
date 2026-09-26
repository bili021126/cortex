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

### 【2】execSync → async —— ✅ 面很小，位置明确，可直接做

| 文件 | 次数 |
|---|---|
| `packages/engine/src/execution/zero-token-validator.ts` | 3 |
| `packages/cli/src/main.ts` | 2 |
| `packages/engine/src/agents/inspector-agent.ts` | 1 |
| `packages/shared/src/fs-adapter.ts` | 1 |
| **合计** | **4 文件 / 7 次** |

无新增，量级与立项时一致。**这是清单里最容易先做完的一项。**

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

### 【5】Disposable 推广 —— ⚠️ **半推广：有实现，无声明**

| 指标 | 实测 |
|---|---|
| `implements Disposable` 的文件 | **1** |
| 定义了 `dispose()` 方法的文件 | **22** |
| 接口来源 | `shared/src/infra.ts` |

22 个类实现了 `dispose()`，但只有 1 个显式声明 `implements Disposable`。
**缺口不在实现，在契约声明**——没有声明就无法被类型系统强制调用，
这正是「Promisify 式」的半推广：机制在，约束不在。

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
| N-1 | **`scripts/` 不在任何 lint 门禁覆盖内** | `eslint.config.mjs` 未忽略它，但门禁只跑 `eslint packages`；实跑 `eslint scripts` 有 **243 个问题**，其中 2 个是**解析错误**（不在任何 tsconfig 内）。而 `scripts/verify/critical-fixes.ts` **正是门禁第 3 步执行的东西** | 243 项 |
| N-2 | **`ci-gate` 计数口径无一致定义** | `total` 与 `passed+skipped` 在两个时点都不相等且方向相反：2026-07-20 为 `3593/3631 passed \| 22 skipped`（3615≠3631）、2026-09-26 为 `3988/3993 passed \| 14 skipped`（4002≠3993） | 影响所有基线的可信度 |
| N-3 | **文档注册表实质失修** | `docs/README.md` 29 条链接中 11 条失效（7 条目标已归档），且把归档件摆在「当前活跃设计文档」与「⭐从这里开始」；`cortex-docs.json` 宪法条目 version 写 3.7 而文件是 v3.8；`docs/analysis` 实为 48 份而 README 记 15 份 | 已修（2026-09-26） |
| N-4 | **五流六层坐标系的锚点已漂移** | 45 条文件引用中 12 条搬家、2 条消失、1 条行号越界；只覆盖 16/28 包 | 已机器化（`architecture-flows.json` + `flow-contract` 门禁） |
| N-5 | **`design-tokens` 无测试** | 28 包中唯一不在门禁测试矩阵内 | — |
| N-6 | **`skills/` 的口径分歧** | 27 个 JSON = 26 个 `skill-p*.json` + 1 个 `data-2pc-rollback-verify.json`（形状相同、无编号） | 「预置技能数」取哪个口径未定 |
| N-7 | **PACKAGE_POSITIONING 的 RESTful API 契约已不完整** | 该节记 8 个端点且称「@cortex/cli 承载」，实测有 **6 个 handler**、端点含 `/capabilities`、`/daemon/health`、`/chat`、`/memory`、`/sessions`、`/scheduler`、`/scheduler/execute`、`POST /nodes`，且承载方是 `@cortex/server` | 已在本轮修 PACKAGE_POSITIONING 的模型表与包数，**此节未修** |

---

## 四、建议的处置顺序

| 优先 | 题 | 理由 |
|---|---|---|
| 1 | 【4】EventPayloadMap | **已完成，只需从清单划掉** |
| 2 | N-2 ci-gate 计数口径 | 它污染所有基线——**不修它，后面每一条基线的可信度都打折** |
| 3 | 【1】可观测双通道 | 面最大（296 调用点 + 两套并存机制），且牵涉原则五合规 |
| 4 | 【2】execSync→async | 4 文件 7 次，最容易做完 |
| 5 | 【6】全仓 35 处 export\* | 范围清晰，逐包可做 |
| 6 | 【5】Disposable 声明补齐 | 22 文件，机械可做 |
| 7 | 【3】server 鉴权 | 需先定暴露面 |
| 8 | N-1 scripts 门禁 | 需先裁决 lint 策略（属决策非清理） |

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
