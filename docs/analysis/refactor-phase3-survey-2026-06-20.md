# Cortex 重整化 · 阶段 3 链路调研报告（协议与入口统一）

> 日期：2026-06-20 ｜ 前置：refactor-drift-survey-2026-06-20.md → refactor-blueprint-2026-06-20.md → refactor-spec-2026-06-20.md
> 目的：阶段 3（spec §3：CLI 交互层基底化 / 协议单契约 / API 收敛与机制门禁）实施前的链路事实调研。只读调研，不改代码。

## 0. 调研范围与方法

三路并行只读调研（GeneralPurpose agent）：
- **链路 A**：CLI/TUI 交互层（query-loop / engine-bridge / run / desktop / webui）
- **链路 B**：protocol 契约 + server WS 链路（S3-5 决策点）
- **链路 C**：未消费 API 分布 + 0 测试包现状（S3-6/S3-7 基线）

统计口径：grep 词边界粗统计（含注释/字符串误命中），与阶段一 v4 审计口径不同，仅并列呈现不换算。

## 1. 关键事实：CLI/TUI 已官方废弃

`packages/cli/src/main.ts:328-339`：**CLI/TUI 已废弃（2026-07）**——Cortex 当前仅作为引擎库使用，设置 `CORTEX_ENABLE_CLI=1` 才启用。此事实改变阶段 3.1 的意义：CLI 基底化不再是「入口统一」主线，主线应是「**引擎正式入口完善 + 交互原语下沉**」。

## 2. 链路 A：CLI/TUI 交互层现状

### 2.1 对话循环：in-process 直连 LlmAdapter，绕过 engine 正式入口

```
queryLoop ──bridge.streamChat──▶ EngineBridge.streamChat ──▶ LlmAdapter.chatStream   (in-process 直连，绕过 engine)
        └────────▶ RemoteEngineBridge.streamChat ──WS startChat──▶ ChatExecutor ──▶ engine.streamChat  (远程，正式入口)
```

- 调用点：`cli/src/tui/query-loop.ts:279`；直连实现：`cli/src/services/engine-bridge.ts:319-330`（`l.chatStream(...)`）
- **engine 已导出正式入口** `streamChat`（`engine/src/index.ts:69-70`，`execution/chat-loop.ts:63`，含 `onBeforeToolExecute` 门控钩子），**唯一使用方是 server**（`server/src/chat-executor.ts:12,58`）；**CLI 未 import 它**
- 四处对话循环实现：`cli/tui/query-loop.ts`（in-process）/ `engine/execution/chat-loop.ts`（正式入口）/ `server/chat-executor.ts`（WS 封装）/ `client/chat-stream.ts`（WS 路由）
- `remoteQueryLoop`（`cli/src/tui/remote-query-loop.ts:74`）**无任何调用方**（死代码）

### 2.2 工具执行：直接 toolkit.execute，绕过 Scheduler BoundaryGuard

- `streaming-tool-executor.ts:89 → engine-bridge.ts:291`：`toolkit.execute({toolName, params}, AgentType.Code)` 直调
- **BoundaryGuardStep 仅在 Scheduler PipelineModel 内**（`scheduling-implementations.ts:1032-1037`）——CLI 直调路径完全绕过
- **ConfirmGate 有接线但分层**：bootstrap 模式 `toolkit.setGate(gate)`（`bootstrap-engine.ts:499`）；轻量模式 bridge 为「**自动放行**」（`engine-bridge.ts:191-202`，非 TTY 时 approved=true）
- TUI 另有 `onPreToolUse` 权限弹窗（`app.tsx:340-360`）与 ConfirmGate 构成双门

### 2.3 run 命令：单节点直提 Scheduler，无 MetaAgent 规划

- `run.ts:87-98`：`board.addNode(单节点)` + `scheduler.executeAll()`；TaskNode 自行构造（`agentType=analysis`，`needsMultiPerspective:false`），**无 MetaAgent 引用**
- 对照：TUI plan 模式才走 `metaAgent.plan(input)`（`plan-mode.ts:203-213`）

### 2.4 三套交互面 + 原语分布

| 交互面 | 入口 | 对话/工具/规划 | 状态 |
|---|---|---|---|
| CLI TUI (Ink) | main.ts:259 | queryLoop（本地循环）/ plan-mode（Scheduler） | 已废弃（CORTEX_ENABLE_CLI=1） |
| WebUI | tui/web/index.ts:108 | 仅 `/api/v1/execute` → executeToolCall；无对话循环 | 部分 |
| Desktop | ChatView → IPC → CortexBridge → @cortex/client → daemon | 纯 daemon 客户端 | 活跃 |

### 2.5 CLI 测试现状

5 个测试文件全以 **mock bridge** 验证（vi.fn 伪造 streamChat/executeToolCall），不覆盖真实 LLM、ConfirmGate、BoundaryGuard。附带发现：`query-loop.test.ts:21` 引用已不存在的 `LlmStreamBridge` 类型（过时引用）。

## 3. 链路 B：protocol 契约现状（S3-5 决策点事实）

### 3.1 契约定位明确，但入站未落地

- protocol 定位：**L0 零依赖、三端（TUI/WebUI/Desktop）与 daemon 唯一契约**（`src/index.ts:2-7`、PACKAGE_POSITIONING.md:46）
- **命令入站路径未落地 `WSClientCommand`**：`gateway.ts:61` 自造 `OnCommandFn = (connId, msg: unknown)`；`daemon.ts:325-327` `msg as WSClientCommand` **类型断言代替校验**；分发为 if 分支 + switch/case（非映射表）
- server 仅做**输出型消费**（事件 `satisfies` 标注），命令校验零接入

### 3.2 运行时守卫与类型联合不同步

- `validation.ts:38-44` `isWSClientCommand` **只认 subscribe/unsubscribe**，不识别 S2-12 新增的 `notification.ack` 等 4 个命令成员（联合类型 6 成员）——**契约漂移**
- `isWSClientCommand` / `isProtocolEnvelope` / `isProblemDetails` 全仓**零消费**
- WS 链路无 payload 运行时校验，完全信任客户端；HTTP 层为手写字段校验（与 protocol DTO 字段集不一致，存在契约漂移，如 `memory-handler.ts` 手写字段 vs `MemoryEntryDTO`）

### 3.3 零消费导出 ~40 个（预留为主）

- 命令：`WSSubscribeCommand`/`WSUnsubscribeCommand`（仅联合成员）；事件：`WSServerEvent`/`WSServerEventByChannel`/`WSStateEvent`/`WSPipelineEvent` 及 agent/memory/session 通道各 4 个 @planned 预留；REST：12 个 GET 响应包装类型；守卫 4 个
- **dist 产物与 src 不同步**：`dist/` 缺 `rest/`、`ws/` 子目录产物，但 `dist/index.js` re-export 引用它们——tsc 增量模式下消费方会引用不存在的声明文件（构建隐患）

### 3.4 S2-12 客户端缺口

`WSNotificationAckCommand` 在 client/cli **零引用**——`ws-client.ts` 无 notification.ack 发送方法。S2-12 的 ack 回路 server 侧完整、**客户端侧未接**。

### 3.5 protocol 测试现状

2 个测试文件（envelope/validation，共 112 行），仅覆盖 4 守卫 + 3 工厂函数；WS 命令/事件类型与 REST DTO 纯类型无测试；无 server WS 链路测试。

## 4. 链路 C：API 收敛与测试缺口基线

### 4.1 scripts/ 无审计脚本（phase1 遗留 5 未闭合）

scripts/ 15 个工具均为压测/CI/运维类，无 zero-consumption 审计脚本。

### 4.2 四包零消费粗统计（词边界 grep，含噪声）

| 包 | 导出总数 | 纯零消费 | 零消费率 | 主要零消费构成 |
|---|---|---|---|---|
| protocol | 111 | 45 | **40.5%** | REST 响应包装 + @planned 预留 WS 事件（>30% 需解释） |
| cli | 137 | 33 | 24.1% | startWebUI 等（scripts/start-webui.ts 有口径外消费） |
| memory | 97 | 10 | 10.3% | worldbook 知识类型 + sqlite 选项类型（对应 cyrene RAG 悬空） |
| config | 252 | 21 | 8.3% | — |
| 合计 | 597 | 125 | 20.9% | — |

> 口径说明：782 基线（v4 审计）与本次口径不同，仅并列呈现。`cli.startWebUI` 在 packages/ 内零引用但 `scripts/start-webui.ts` 消费（口径外引用需注意）。

### 4.3 0 测试包现状

- **desktop**：零测试（renderer/main 均无）
- **design-tokens**：零测试（`--passWithNoTests`）
- **server**：阶段一 2 测试 → 现 4 测试（notification-bridge 等 S2-11/S2-12 新增）

## 5. 交叉发现（跨链路）

1. **S2-12 客户端缺口**：ack 回路 server 完整、client 无发送方法——通知闭环还差最后一截
2. **protocol dist 产物缺失**：rest/ws 子目录未构建——需要查构建配置（可能漏加 tsconfig include）
3. **isWSClientCommand 契约漂移**：守卫与联合类型不同步，且零消费——落地入站校验时需先修复
4. **CLI 废弃改变阶段 3.1 优先级**：入口统一主线从「CLI 改造」转为「引擎正式入口唯一化 + 原语下沉」
5. **engine.streamChat 已是事实标准**：server 已消费，CLI 直连路径是唯一旁路

## 6. 阶段 3 调整建议（基于事实，待用户决策）

| spec 项 | 调研后建议 |
|---|---|
| S3-1~S3-4 CLI 基底化 | **降级为「引擎入口唯一化」**：CLI 已废弃，不再投入改造；将 streamChat 确立为唯一交互入口（server 已用），删除/标记 CLI 直连路径与 remoteQueryLoop 死代码；交互原语下沉以 Desktop（活跃端）为准 |
| S3-5 协议决策 | **落地 + 收敛组合**：①修复 isWSClientCommand 同步 6 成员并接入 daemon 入站（运行时校验，替换 `as WSClientCommand`）；②删除 @planned 预留零消费类型（40 个零消费中降一半以上）；③修复 dist 产物缺失 |
| S3-6 API 收敛 | protocol 45 零消费为首要收敛目标（40.5% > 30% 门槛），其次 cli 33（注意 startWebUI 口径外消费）；审计脚本沉淀到 scripts/（闭合 phase1 遗留 5） |
| S3-7 0 测试包 | desktop 补核心链路测试（CortexBridge → client → daemon）；design-tokens 已收编 desktop 主题（接 desktop 测试覆盖）；server 继续补 WS 链路测试 |
| S3-8 cyrene RAG | memory 10 个零消费（worldbook）——接真实场景或内部化，同 spec |
| S3-9~S3-11 机制门禁 | 不变（layer-contract 扩展 / @layer 机制化 / 迁移扫描器） |
| 新增 | **S2-12 客户端缺口补全**：ws-client 加 notification.ack 发送方法（通知闭环最后一截） |

## 7. 决策点（提交用户拍板）

1. **CLI 去留**：已废弃（CORTEX_ENABLE_CLI=1 门控）——是「保留壳代码 + 移除直连旁路」还是「彻底删除 CLI 交互层」？
2. **S3-5 方向**：落地+收敛组合（推荐）——入站校验落地 + 零消费预留删除？
3. **范围优先级**：先做「协议单契约 + 客户端缺口」（高价值闭环），还是「机制门禁」（低风险工程），还是并行？
