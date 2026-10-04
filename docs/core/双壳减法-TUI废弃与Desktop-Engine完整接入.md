# 双壳减法：TUI 废弃 + Desktop Engine 完整接入

> **定位**：本文是"决策层"设计 spec。把记忆里悬了三个月的战略——"Desktop 唯一产品线、TUI/WebUI 死、CLI 冻结降格"（决策史 07-21→）与"Desktop 从未接入 Engine"（记忆现状）——落成一条可执行路径。
>
> **关联**：`docs/analysis/audit-full-2026-10-04.md`（本轮自审的健壮性加固已提交）、`docs/core/core-3-invariants.md` G-10/I-17（同类守卫形状）、记忆条目"Cortex CLI 熔炼(09-20)"与"Cortex WS/Presence"。
>
> **前提更正（实证覆盖记忆）**：Desktop 早已从"直连 LlmAdapter"迁到"daemon-client 模式"（`cortex-bridge.ts:9` 明确 `@since 0.3.0`）。本文不再谈"接入 Engine"这一伪缺口，改谈**接入完整度**——这是真缺口。
>
> ### 🔄 修订 v2（同日二次实证）· 缺口重定位——client 早已是**完整 typed REST 客户端**
>
> 二次实测 `packages/client/src/http-client.ts`（305 行）：**client 早已 typed 封装 20+ 方法**——`searchMemory/writeMemory/deleteMemory`、`getSchedulerSnapshot/submitNode/executeScheduler`、`getSessions/createSession/deleteSession`、`getNodes/getNode/getState/getAgents/getHealth/getDaemonHealth/getCapabilities/execute/getEvents`、以及整个 config 域（`getModels/createModel/patchModel/deleteModel/patchAgentConfig/getKeys/createKey/deleteKey/getTuning/patchTuning/validateConfig/getConfigVersion`）。之前诊断段"client typed 只包 chat/http/ws"是**误判**。
>
> **真缺口**：Desktop `ipc-handlers.ts` 只桥了其中 **16 个通道**（chat/gate/presence/settings/editor/notification/window），**大部分 client 方法在 renderer 侧无入口**。所以：
>
> - 下文 **段一 缺失零件 表第一行、当前调用链 ASCII 图** 里"client typed 只覆盖 chat"这类表述**作废**——真实情况是"client 全但 IPC 桥薄"。
> - 下文 **段二 核心接口伪代码** 中 `packages/client/src/{memory,scheduler,sessions,nodes}.ts` 新建部分**作废**——client 侧无需新文件，只需**在 `IPC_CHANNELS` + `preload` + `ipc-handlers` 三处补桥**。
> - 下文 **段三 要改表** 第 1 行"新建 client typed 封装 ~400 行"**作废**；**段四 P0 第 1 行同步作废**。
>
> **修订后的 P0**：只做 Desktop 侧 IPC/preload 补齐——把 client 已有 typed 方法在 main 侧包成 IPC handler、preload 侧暴露到 `window.cortexDesktop.{memory,scheduler,sessions,nodes,state,config}`。代码量约 200–300 行，不动 client。验收：renderer 侧能在 dev-tools console 里直接 `await window.cortexDesktop.memory.search("foo")` 拿到结果；新增 `desktop/tests/ipc-coverage.test.ts`（@ci:contract）双向核对 client typed 方法 ↔ Desktop IPC 通道。
>
> 其余段（Desktop 面板、intent-router 迁移、TUI 归档、修宪宣告、Phase P1/P2/P3）不变。

---

## 段一 · 现状诊断

### 已存在的零件

| 零件 | 位置 | 状态 |
|------|------|------|
| Server REST 端点 15+（memory/scheduler/nodes/sessions/execute/chat/state/agents/health/capabilities） | `packages/server/src/http/router.ts:50–170` | ✅ 完整、`@ci: contract` I-5 守 REST 表↔路由 |
| Server WS 通道 11 个（chat/gate/pipeline/state/system/config/agent/memory/session/notification/tui） | `packages/protocol/src/ws/*` | ✅ I-14 守符号面 |
| `@cortex/client` HTTP/WS 骨架 | `packages/client/src/{connection,http-client,ws-client}.ts` | ✅ 有 `CortexHttpClient`/`CortexWSClient` |
| `@cortex/client` typed chat 封装 | `packages/client/src/chat-stream.ts` | ✅ `streamChat` |
| Desktop main → daemon 桥 | `packages/desktop/src/main/{cortex-bridge,ws-client,presence-bridge}.ts` | ✅ 已走 client 包（**非直连 LlmAdapter**） |
| Desktop IPC 通道 16 个 | `packages/desktop/src/main/ipc-handlers.ts` + `index.ts` | ✅ chat/gate/presence/settings/editor/notification/window |
| TUI 完整 Ink 应用 | `packages/cli/src/tui/**`（76 文件、11105 行） | ✅ 活的、且是 `argv.length===0` 时默认启动路径 |
| TUI 独有 `intent-router/classifiers` | `packages/cli/src/tui/intent-router/**` | ✅ 自然语言→命令分派，**Desktop 侧无对应** |
| CLI 命令路径 daemon-first（daemonFetchJson 共享） | `packages/cli/src/commands/**`（3484 行） | ✅ 已改（09-20 熔炼） |

### 缺失的零件

| 缺口 | 影响 |
|------|------|
| `@cortex/client` **未 typed 封装** memory/scheduler/sessions/nodes 端点 | Desktop 无法优雅访问这些 Engine 能力；要么走 raw http-client（无类型保护、无错误归一），要么干脆没做 |
| Desktop **无 Console/Memory/Scheduler/Sessions 面板** | Desktop 目前是 chat+presence 单一体验，不体现 Engine 的多子系统能力（记忆/计划/节点/会话） |
| TUI 的 intent-router 无 Desktop 对等物 | Desktop 只能"发消息→chat"；无法在桌面里做"打字即分派到 memory 查询/scheduler 执行/agent 状态" |
| `cli/main.ts:118` `INK_MODE = argv.length===0` 默认进 TUI | 只要不删这条，"两壳并存"就还活着；D7 漂移的战略病根无法真消除 |
| TUI 与 Desktop 各自持有 WSChannel 类型（Desktop 内联、TUI 通过 @cortex/protocol） | 记忆已指出 Desktop 无 protocol 依赖、类型内联——两壳**同一协议的两套表示**，正是 I-类"两份表示必须相等"的活体风险 |

### 当前调用链（文本图）

```
Desktop renderer ──IPC 16 通道── Desktop main ──@cortex/client (typed: 仅 chat/http/ws)
                                                     │
                                                     ▼
                                        server (REST 15+ / WS 11 通道)
                                                     │
                                                     ▼
                                                engine (调度/记忆/治理/…)
   ✅ 已通，但 client typed 只覆盖 chat → 其余能力面 Desktop 拿不到

TUI (Ink) ──RemoteEngineBridge── daemon HTTP/WS ── server ── engine
   ✅ 完整，但 TUI 与 Desktop 并存 = 双宿主 = D7 漂移病根仍在

cli argv.length===0 ──► startInkTui（默认 UX 还指向 TUI）
```

---

## 段二 · 设计

### 总览

一条 UX 线（Desktop），一条能力入口（daemon REST/WS），一套 typed 客户端（`@cortex/client` 完整覆盖 Engine 面）。TUI 分两步：先冻结（默认 UX 不再进 TUI，源码保留供 Desktop 面板参考），再删除（连同 intent-router 迁移完成一起）。

```
                     ┌────────────────────────────────────┐
                     │        Desktop (唯一产品线)         │
                     │  chat │ memory │ scheduler │ gate │
                     │  presence │ intent-console │ …    │
                     └────────────┬──────────────────────┘
                                  │ IPC (typed, 由 shared 契约守)
                     ┌────────────▼──────────────────────┐
                     │  Desktop main (bridge/preload)    │
                     └────────────┬──────────────────────┘
                                  │ @cortex/client (typed, 完整)
                     ┌────────────▼──────────────────────┐
                     │  server REST + WS  (daemon)       │
                     └────────────┬──────────────────────┘
                                  │
                     ┌────────────▼──────────────────────┐
                     │  engine (调度/记忆/治理/telemetry) │
                     └───────────────────────────────────┘
     TUI: 冻结 → 迁移 intent-router → 删（P2/P3）
```

### 核心接口/类型（伪代码）

```typescript
// packages/client/src/memory.ts —— 新
export interface MemoryQueryOpts { kind?: MemoryKind; since?: number; limit?: number; mode?: SearchMode }
export async function memoryQuery(client: CortexHttpClient, opts: MemoryQueryOpts): Promise<MemoryEntry[]>
export async function memoryWrite(client: CortexHttpClient, e: MemoryWriteRequest): Promise<{ id: string }>
export async function memoryDelete(client: CortexHttpClient, id: string): Promise<void>

// packages/client/src/scheduler.ts —— 新
export async function schedulerSnapshot(client: CortexHttpClient): Promise<SchedulerSnapshot>
export async function submitNodes(client: CortexHttpClient, nodes: TaskNode[]): Promise<{ batchId: string }>
export async function executeScheduler(client: CortexHttpClient, req: SchedulerExecuteRequest): Promise<SchedulerExecutionReport>

// packages/client/src/sessions.ts —— 新
export async function listSessions(c: CortexHttpClient): Promise<Session[]>
export async function createSession(c: CortexHttpClient, req: CreateSessionRequest): Promise<Session>
export async function deleteSession(c: CortexHttpClient, id: string): Promise<void>

// packages/desktop/src/renderer/intent — 新（从 TUI 迁移）
export type Intent =
  | { kind: "chat"; text: string }
  | { kind: "memory.query"; filter: MemoryQueryOpts }
  | { kind: "scheduler.execute"; task: TaskNode }
  | { kind: "agent.status" }
  | { kind: "unknown"; text: string };
export function classifyIntent(raw: string, ctx: IntentContext): Promise<Intent>

// packages/desktop/src/main/ipc-channels.ts — 扩
IPC_CHANNELS.MEMORY_QUERY / MEMORY_WRITE / MEMORY_DELETE
IPC_CHANNELS.SCHEDULER_SNAPSHOT / SCHEDULER_EXECUTE / NODES_SUBMIT
IPC_CHANNELS.SESSIONS_LIST / SESSIONS_CREATE / SESSIONS_DELETE
IPC_CHANNELS.INTENT_CLASSIFY
```

### 使用路径

- **Renderer 用户点"Memory"面板 → 显示记忆条目**：`renderer/MemoryView` → `preload.memoryQuery()` → IPC → `main/ipc-handlers` → `client.memoryQuery(http, opts)` → HTTP GET `/api/v1/memory` → server handler → engine memory bridge → 返回。
- **Renderer 输入框打字（含斜杠或自然语言）**：`renderer/IntentConsole` → `main/intent-router` 分类 → 分派到 chat / memory.query / scheduler.execute 三条 IPC 之一 → 各自走 client typed。
- **用户在 Desktop 里提交一个任务给 scheduler**：`renderer/SchedulerPanel` → IPC submit → client submitNodes → POST `/api/v1/nodes` → 之后 WS `pipeline` 通道流式回报进度。
- **Gate 审批**：现状（GATE_REQUEST/RESOLVE）不动，仅补 typed。

### 边界（**不做什么**，防过度设计）

- **不做**：WebUI（决策史已死）、多窗口/多 workspace 编排、插件面板、TUI 兼容 shim 或迁移向导。
- **不做**：Desktop 自建 REST 客户端绕过 `@cortex/client`（那是双份实现，违反 I-16 "同一功能不得有第二实现"）。
- **不做**：intent-router LLM 化——保留 TUI 现有的分类器规则/关键词方案，先搬过来，稳了再谈升级。
- **不做**：把 TUI 的 Ink 组件"改造"成 Desktop React 组件——形态差太远，重写更省。

---

## 段三 · 与现有代码的精确咬合

### 不改

| 文件/模块 | 原因 |
|---|---|
| `server/src/http/router.ts` REST 端点集 | 已完整；扩展点已在，加就够 |
| `protocol/src/ws/*` 通道契约 | I-14 已守符号面 |
| `desktop/src/main/{cortex-bridge,ws-client,presence-bridge}.ts` 架构骨架 | 0.3.0 daemon-client 迁移已到位，只是 typed 面窄 |
| `cli/src/commands/**` daemon-first 命令 | 记忆 09-20 已改；不受本轮影响 |
| `client/src/{connection,http-client,ws-client,chat-stream}.ts` | 保留，只加不减 |

### 要改（新加/迁移/删除）

| 文件 | 动作 | 行数（估） | 前置 |
|---|---|---|---|
| `packages/client/src/{memory,scheduler,sessions,nodes}.ts` | **新建** typed wrappers | ~400 | 无（REST 已有） |
| `packages/client/src/index.ts` | 新增 barrel 导出上述 4 模块 | +6 | 上行 |
| `packages/desktop/src/main/ipc-handlers.ts` | **补** memory/scheduler/sessions/intent IPC 通道 | ~200 | client typed 完成 |
| `packages/desktop/src/main/preload.ts` | 暴露 `window.cortexDesktop.{memory,scheduler,sessions,intent}` | ~120 | 上行 |
| `packages/desktop/src/renderer/{MemoryView,SchedulerPanel,SessionsPanel,IntentConsole}.*` | **新建** 4 面板 | ~600 | IPC 就绪 |
| `packages/desktop/src/renderer/presence/*` | 保留，不动 | — | — |
| `packages/cli/src/tui/intent-router/**` | **迁移**到 `packages/shared/src/intent/**`（Desktop/TUI 共用一份） | 搬运，无新增逻辑 | P1 桌面面板可用 |
| `packages/cli/src/main.ts:118` `INK_MODE = argv.length===0` | **改**：默认改为提示"daemon 未启动或 cortex --help"；`--tui` 显式开关才启动 | ~30 行改动 | 无 |
| `packages/cli/src/tui/**`（11105 行） | **归档到 `legacy/tui/`**，不删；从主构建图移除（tsconfig 不再 references） | 无改动，只搬 | intent-router 迁移完成 + Desktop 面板已覆盖 TUI 主要 UX |
| `docs/core/*` 相关文档（本 spec + 决策史 + core-3-invariants G-10 附近） | 追加"双壳减法完成宣告"，走修宪案 `AM-2026-XXXX-001` | doc | P2 落地 |

### 暂不做

| 事项 | 延期原因 |
|---|---|
| 删除 `legacy/tui/` 全部代码 | 留一段观察期（建议 1 个月或 1 个大版本），确认 Desktop 面板 + intent-router 覆盖完 TUI 主要用法再删 |
| `intent-router` 升级到 LLM 分类 | 先搬，稳了再谈；避免同时改两个变量 |
| Desktop 内联 WSChannel 类型改为引 `@cortex/protocol` | 与本轮减法正交；单独立项更清晰（记忆里 WS/Presence 那条曾解释内联选择的理由，重开前需先反驳那个理由） |

---

## 段四 · 实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 | 验收 |
|--------|------|--------|----------|------|
| **P0** | `@cortex/client` 新增 memory/scheduler/sessions/nodes typed 封装 + barrel | ~400 | 无 | `pnpm --filter @cortex/client typecheck` 绿；`client/tests/contract/*` 无回归；I-6 契约测试仍过 |
| **P0** | 补 contract 测试：client typed 方法名 ↔ server REST 路径**双向**（G-1 现有形状的自然延伸） | ~80 | P0 上行 | 新 `client/tests/api-coverage.test.ts` @ci:contract 通过；缺失端点会红 |
| **P1** | Desktop main IPC + preload 扩，加 memory/scheduler/sessions/intent 通道 | ~320 | P0 | renderer 侧 `window.cortexDesktop.memory.query({})` 无异常返回 |
| **P1** | Desktop renderer 新增 4 面板（MemoryView/SchedulerPanel/SessionsPanel/IntentConsole） | ~600 | P1 IPC | 手动过一遍：能查/写/删记忆；能列节点/提交任务；能新建/切换/删除会话；intent 输入能正确分派 |
| **P2** | `intent-router` 从 `cli/src/tui` 抽到 `shared/src/intent`，Desktop 侧接入 IntentConsole，TUI 侧改引 shared | 搬运，无新逻辑 | P1 完成（Desktop 面板可用，避免"拆了 TUI 就没 UI"的空窗） | `pnpm --filter @cortex/shared typecheck` 绿；`desktop/tests/intent-router.test.ts`（新）过 |
| **P2** | `cli/main.ts:118` INK_MODE 默认关闭；`--tui` 显式开关保留（过渡期给习惯 TUI 的用户一条退路） | ~30 | P1 | `cortex`（无参）不再进 TUI；`cortex --tui` 仍进；`--tui` 打 warning 说"deprecated in vX" |
| **P2** | TUI 全目录搬入 `legacy/tui/`，`tsconfig` 不再 references | 无改，搬 | P2 上一步 | `tsc -b` 全量绿；`i3 flow-contract` 里 TUI 模块归类更新 |
| **P3** | 修宪案 `AM-2026-XXXX-001`：宣告双宿主终结、Desktop 唯一产品线 | doc | P2 | doc-registry I-2 通过；决策史条目在 `docs/core` 更新 |
| **P3** | （观察期后）删除 `legacy/tui/` | 删 | P2 + 一个版本周期 | `tsc -b` 绿；ci-gate 全绿 |

**里程碑锚点**：
- P0+P1 完成 = "Desktop 完整覆盖 Engine 能力面"落地，双宿主的技术必要性消失。
- P2 完成 = TUI 事实上不可达（默认 UX 不再指向它）。
- P3 完成 = 战略宣告 + 代码物理移除。

---

## 附 · 为什么这样切

**不做**"先删 TUI、Desktop 之后再补"——那会让产品体验出现真空期（用户 `cortex` 无参啥都开不了），必然反悔、又要把 TUI 拽回来。所以**接入完整化 → 迁移唯一独有件 → 冻结 → 归档 → 删除**，是一条不可折返的顺序。

**不做**"保留 TUI 但降级"——记忆已经证明"降级"意味着**没人动、没人测、慢慢腐**（本轮自审的 iter-8 `as AgentType`/CLI handler 缺口就是这种"降格但没清"的活体病）。要降就彻底，要么就还是产品线；不能"既是 legacy 又还在构建图里"。

**做**intent-router 迁移**而不是**"重写一份"——它是 TUI 中**唯一**有战略价值的独立件（把"打字即分派"从 CLI 语境带进 Desktop 语境），值得跨越壳的生死保留。
