# Cortex 全量静态自审报告 · 2026-10-04

> 本报告**追加**于既有事实之上，不覆写任何先前结论。先前的架构/审计基础事实仍以
> `docs/analysis/audit-full-2026-08-11.md`、`docs/analysis/optimization-report-2026-09-30.md`、
> `docs/core/core-3-invariants.md`（G-1…G-9 / I-1…I-16）为准。本文只记录 2026-10-04 这一轮
> 八次迭代自审的**新**发现、**已落**修复、**证伪**结论与**待裁决**项。

## 〇、范围与执行方式

- 对象：D:\cortex 自治理 AI Agent 运行时，TS pnpm monorepo（ESM），宪法 v3.8，28 包 7 层（L0–L6）DAG。
- 方法：主 Agent 定点 `grep`/`Read` 逐轴深挖，**不派子代理**（消耗不确定，且自查近零成本）。
- 轴：覆盖宪法记载的六类根因（timeout / empty-catch / type-boundary / parallel-systems / prompt-security / observability）+「机制在但接线断裂」这一最高频类，外加 API 编码约定陷阱、资源/定时器泄漏、Stream/EventEmitter 崩溃面、`as` 洗掉 nominal 枚举品牌。

## 一、基线（诚实声明）

- `git HEAD = 41f38a9b`（2026-10-01，G-9 fail-closed + G-4 测试卫生守卫落地）。此后仅 doc/prompt 未提交，无 `.ts` 源码改动。
- 本轮独立复验的**确定性**基线：`tsc -b tsconfig.json` EXIT:0、`eslint packages/engine/src --max-warnings 0` EXIT:0（等价于新 fail-closed pre-commit 钩子所守两项）。
- **未在本沙箱重跑全量 vitest**：依既往教训「并行 fork 会打爆本机内存、沙箱假红 ≠ CI」，全量测试以 09-30/10-01 提交记录的全绿为准，不据沙箱臆断红。
- 附带发现：工作区两处 `debug.log` 系搜狗输入法把日志写进 `process.cwd()` 的垃圾，非项目产物；已加 `.gitignore` 规则并入回收站。

## 二、八次迭代覆盖矩阵

| 迭代 | 轴 | 结论 | 产出 |
|---|---|---|---|
| 1 | 类型/接线/空catch/包缺口 | 基线绿；desktop→protocol 系 grep 命中注释的**假阳性** | debug.log 卫生 |
| 2 | heartbeat/Promise.all/FixedTimeout/memory-write/enum | 全部**证伪**（已正确/有意） | 仅记录 |
| 3 | prompt-security(R12-F)/observability 横幅 | 分层设计**已正确** | fence.ts 头注释口径修正 + fence.test.ts 3 条 escapeFence 回归（commit d8dd2aa5） |
| 4 | 空 catch 的箭头式盲区 `.catch(()=>{})` | 发现扫描**方法学盲区**；7 处静默吞改 console.warn | 7 改 |
| 5 | nominal enum 跨包 `===` + 裸 `void async` | 枚举轴**无 bug**；void 轴**真发现**：13 裸发补 .catch + 2 处级别错 | 15 改 |
| 6 | 全局 handler 普查 + 主路径 | chat 执行路径**已自处理**（假阳性规避）；CLI 缺全局 handler=**待裁决** | 仅记录 |
| 7 | 资源/定时器泄漏 | 4 setInterval 中 engine alertTimer **未 unref** | 1 改 |
| 8 | Stream/child_process error + `as` 枚举 | **首个崩溃级真缺陷**：mcp-client spawn 无 `on("error")` | 1 改；as-枚举=**待裁决** |

## 三、已落修复清单（本轮累计 24 处，均 tsc+eslint EXIT:0）

### 3.1 崩溃级（迭代 8）
- `packages/platform/src/mcp-client.ts:175` — `spawn()` 出 ChildProcess 却无 `on("error")`。spawn 失败（最常见：MCP server 配的 `command` 不存在 → ENOENT）会异步 emit `'error'`，**无监听则 Node 当未捕获异常抛出 → 崩掉宿主/daemon 进程**（用户配置写错一个路径即可拖垮进程）。修法：在 `start()` 同步体内注册 `on("error")`，与既有 `on("exit")` 同构地**优雅降级**——`console.warn` 记录 + 向所有 handler 发 JSON-RPC error，绝不外抛。

### 3.2 未处理拒绝面（迭代 5：13 处裸 `void async`）
`recordTelemetry`/`limiter.recordTokens` 是 `export async`→会 reject。裸 `void X()` 在 daemon 有 `main.ts:89` 全局 handler 兜（记 error、不崩），但 **CLI/测试/嵌入式无该 handler → Node v15+ 默认直接崩进程**。统一补 `.catch(err => console.warn('[模块] telemetry failed: ...'))`（对齐 react-loop 既有范式）：
- `engine/core/scheduler.ts` 192 maintain_failed / 202 sim_check / 259 replan
- `engine/planning/simulation-runner.ts` 62 stub_fallback
- `llm/llm-adapter.ts` 291 / 446 / 518 / 577 / 599 / 652 + 流式 `recordTokens(totalTokens)`
  （注：577 是 stream:true 版，躲过了迭代 4 只扫 `.catch(()=>{})` 的盲区）

### 3.3 静默吞 → 可见（迭代 4：7 处）
`.catch(() => {})` 空处理器（记忆④高发形态，`catch{}` 块正则抓不到）改为 `console.warn`：
- `llm-adapter.ts` 393/397、`memory-store.ts` 357/643/858/911、`memory/memory-compressor.ts` 216（回滚失败静默吞 → 数据可能永久卡 archived 却无信号）

### 3.4 日志级别错（迭代 5：2 处）
遥测失败用 `console.error` 记 → 经 console-bridge 契约被转成 error 指标 + 触发 ErrorReported（自我污染）。改 `console.warn`：`engine/execution/decision-gate-bridge.ts:174`、`environment-aware-router.ts:254`。

### 3.5 库定时器 unref（迭代 7：1 处）
- `engine/bootstrap/bootstrap-engine.ts` setupAlertEngine 的 60s 巡检定时器补 `.unref()`。engine 是被 daemon **和** CLI/测试复用的库，一个内部巡检定时器不该是吊住宿主 event loop 的那个（daemon 常驻自有 HTTP/WS server 维持）；对齐 `state-handler`/`session-manager` 既有 `heartbeatTimer/gcTimer.unref()`。

### 3.6 文档与安全回归（迭代 3，已提交 d8dd2aa5）
- `engine/execution/fence.ts` 头注释「五条内容→prompt 路径统一标记」→ 据实改为分层 F1–F4 说明（防后来者误以为技能/systemPrompt 被围栏覆盖而跳过真实控制点）。
- `engine/tests/fence.test.ts` 补 3 条 **escapeFence 劫持回归**——锁定"注入内容塞 `[/UNTRUSTED]` 提前闭合 / 伪装 `[UNTRUSTED` 起始"被中和这一安全核心（此前该行为**零测试覆盖**，重构可静默删掉而全绿）。

## 四、证伪与设计性解决（防后续重复怀疑）

| 项 | 结论 |
|---|---|
| heartbeat | 接在 `scheduler/dispatch-steps/execute-step.ts:39/50`（ExecuteStep 在 scheduler 包，不在 engine，勿只 grep engine/src）；阈值 360s>race 是 R13 有意兜底 |
| Promise.all | engine+scheduler 全域 0 误用，全 allSettled |
| resilience FixedTimeout | `resilience-integration.ts:80` 工厂正确翻译 `durationMs: options.timeout?.timeoutMs ?? 30000`，bootstrap 传 `{timeoutMs}` 无误 |
| memory-write retry=3 vs tool-exec=1 | 有意：memory-write 走 MemoryStore 三重去重（`dedup-service.ts`）幂等安全；tool-exec 文件写/bash 非幂等故降 1（R4-C2） |
| prompt-security | R12-F 分层：fence() 只标 F1 rag-memory + F2 工具输出两类**数据**；F3 systemPrompt 有意不 fence（破坏指令性，改约定段+来源注释）；F4 自增殖技能 trial 门控 |
| node.payload | 作"任务"trusted-by-construction，**不应 fence**（套围栏语义正好相反） |
| nominal enum 跨包 `===` | `inferKind(agentType: string)` 是运行时分派，tsc 不约束；`ganyu/ningguang` 是 `agent-manifests.json` 真实注册的人格 Agent，无 AgentStatus 漂移死分支 |
| chat 主路径 | `chat-channel.ts:68 void chatExecutor.execute()` 不是漏洞——`chat-executor.ts:64` 内部 try/catch，失败经 `session.send({type:"chat.error"})` 回会话，execute 永不 reject |
| desktop→protocol | grep 命中 `emotion-map.ts:39` 的**注释**，非 import；WSChannel 类型内联是既定设计 |
| 已守卫勿动 | react-loop `.catch(warn)`；`pipeline.ts:98`、`resilience-integration.ts` 用 `process.stderr.write` 绕 console-bridge（安全）；`scheduler.ts:383` 锁串行化链、`trust-model.ts:143` 存盘队列链的 fire-and-forget |

## 五、待裁决项（本轮**未擅动**，均属决策/设计层）

1. **`as AgentType` 洗掉 nominal 枚举品牌**：`agents.loader.ts:49 decl.type as AgentType` 把 manifest JSON 任意字符串强转枚举，而 manifest 含 `ganyu/ningguang/sigewinne…` 等**不在 AgentType 枚举**的人格名；下游按枚举做的权限/匹配（`[Code,Fix,Ops].includes(...)`、claim、Map 查找）对拼错值静默不命中。正解需确立"权威 agent-type 全集"的单源，或加运行时校验/加宽枚举——是类型模型层决策，非 1 行安全修。
2. **CLI 入口缺全局异常兜底**：全仓仅 `server/main.ts` 装 `unhandledRejection`/`uncaughtException`；`cli` 是另一个 bin 且有"in-process EngineBridge 本地回退"路径却不装 handler → 本地回退时崩溃面裸奔（迭代 5 逐点 `.catch` 只是止血）。修不修取决于对 CLI 的定位（既定方向是 daemon-first + CLI 降格，给降格二进制补安全网 ROI 存疑）。
3. **信息横幅误用 console.error**：`decision-gate-bridge.ts:176` 把"决策结果: xxx → 批准/拒绝"信息性日志用 console.error → 每次 gate 决策污染 error 指标（同 main.ts ready 横幅那类）。改 warn 还是 log+eslint-disable 取决于日志级别语义。
4. **engine 重入 bootstrap 定时器叠加**：同进程二次 bootstrap 且不走完整 teardown 时，`alertTimer` 句柄在函数作用域、只在各自 shutdown 清 → 潜在叠加泄漏。需先厘清 bootstrap 单例/teardown 语义。

## 六、方法学教训（本轮踩到的工具坑，供后续审计）

- **grep 字符串判依赖 = 注释/死名假阳性**：`@cortex/protocol`/`@cortex/cache` 两次误判，源于匹配到注释或根本不存在的包。判"依赖存在"要看 import 语句本身。
- **空 catch 扫描正则的箭头式盲区**：`catch {...}` 块正则抓不到 `.catch(() => {})`/`.catch(() => undefined)`，而后者才是记忆④高发形态，须单独一条正则。
- **`grep -E` 里 `\w` 在 POSIX ERE 不可靠**：`[\w.]*` 退化成 `[w.]*` → **返回空≠干净，是假阴性**。判活/判空一律用显式类 `[a-zA-Z0-9_.]`。（另：ripgrep 大括号 glob `*.{ts,tsx}` 亦假阴性。）

## 七、建议的机械守卫（连回不变量台账）

本轮修复是**逐点**的，没有一条守卫挡住**新增**同类问题。建议在 `core-3-invariants.md` 立一条 G-10「崩溃面 / 静默失败 ↔ 有守卫」并配一条 `@ci: contract` grep 式检查（形状见该文件追加节）：断言 daemon-core 里 `spawn(` 同文件有 `on("error"`、无裸 `void <async>(...)`（整条语句无 `.catch`/`await`/`try`）、library 包 `setInterval(` 皆 `.unref()`。局限：grep 式有误阳/误阴，需具名白名单。

---

**净结论**：八轮静态自审覆盖六类根因 + 约定陷阱 + 资源/枚举面，抓到并修好 1 个崩溃级缺陷（mcp spawn）+ 24 处健壮性/可观测性问题，同时**证伪了大量"看似缺口"并纠正了若干我自己的口头偷懒结论**。代码经 09-20/10-01 清理后总体健康；剩余均为**决策/设计层**待你裁决项，不宜由审计擅自重构。
