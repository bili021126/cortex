# Cortex 交互层四端综合解剖报告（底座重写决策依据）

> 日期：2026-06-20 ｜ 前置：refactor-phase3-survey-2026-06-20.md（链路级预调研）
> 组成：cli-anatomy-report-2026-06-20.md / tui-anatomy-report-2026-06-20.md / desktop-anatomy-report-2026-06-20.md / client-webui-anatomy-report-2026-06-20.md
> 目的：为「更深层面的重写，将底座打牢」提供完整事实图景与候选形状。

## 1. 调研方法

四路并行逐文件通读（非 grep 猜测）：CLI 包 34 文件 4600 行、TUI 全目录、desktop 全包（约 3700 行）、client 7 文件 660 行 + WebUI 5 文件 1809 行。所有死代码结论均经全仓 grep 实证。

## 2. 四端现状一句话总结

| 端 | 现状 | 行数 | 测试 |
|---|---|---|---|
| **CLI 命令层** | 15 命令，run/task/memory 恒走轻量模式手工拼装（与 bootstrap 行为分裂）；8 处绕过 engine 正式入口点（3 处实质）；6 组死代码；rollback taskId 恒为 "executeToolCall"（跟踪形同虚设） | 4600 | mock 级 |
| **TUI (Ink)** | 已废弃（CORTEX_ENABLE_CLI=1 门控）；v4 ANSI 渲染器已死（monkey-patch no-op）；remote-query-loop 死代码；web/ 前端从未落地；query-loop.ts 是纯 generator 零 Ink 依赖（最接近可下沉底座） | ~2000 | query-loop/intent 良好，ink 组件零测试 |
| **Desktop** | 「壳 + 两套互相隔离的 UI」：Live2D 桌宠与聊天窗零耦合；client 底座只用 15%；550+ 行死代码；通知/确认门/会话/记忆全部缺失；聊天非流式无持久化 | ~3700 | **零测试** |
| **@cortex/client + WebUI** | client 是瘦封装（事件 unknown 透传/无生命周期/无心跳/无发送队列/HTTP 无超时）；**服务端 API 面分裂是最大结构缺陷**；WebUI 是"无前端、不能聊天、execute 即崩"的未完成品；S2-12 notification.ack 客户端缺失 | client 660 / web 1809 | client 2 文件 / web 零测试 |

## 3. 跨端交叉发现（底座重写的核心依据）

### 3.1 服务端 API 面分裂（最大阻断项）

**client 假设一个"合并 API 面"，但存在两个互不兼容的服务端**：

```
daemon (:3210)   —— chat/memory/sessions/daemon-health/state/health/nodes(形状不同)
WebUI server (:3001) —— execute/events/models/keys/tuning/config/state/nodes/health
```

- `client.http.execute()` 对 daemon 404；`getDaemonHealth()` 对 WebUI 404
- `getAgents()` **三头错**：client 期望 `Record<string,string[]>`、daemon 返回 pool stats、WebUI 返回按类型 statuses
- config 10 方法**双端 100% 不可达**（daemon 无路由、WebUI 不传 configHandler）
- client 22 个方法约一半在任何给定服务端上 404；缺 deleteMemory
- **任何上层 UI 都无法在这两个服务端上稳定构建**——底座重写必须先归一 API 面

### 3.2 重复代码汇总（底座应消除）

| 重复 | 位置 A | 位置 B | 规模 |
|---|---|---|---|
| WS 服务端（手写 RFC6455） | cli/web/gateway.ts | server/ws/gateway.ts（自认 Adapted） | 461 + 370 行 |
| StateAggregator + WebUIState 重复声明 | cli/web/state-aggregator.ts | server/http/state-handler.ts + protocol | 302 + 217 行 |
| chat/gate 事件路由 | client/chat-stream.ts | cli/remote-query-loop.ts | cli/remote-engine-bridge.ts | 89 + 206 + 行 |
| 对话循环实现 | cli/query-loop.ts | engine/chat-loop.ts（正式入口） | server/chat-executor.ts | client/chat-stream.ts | 四处 |
| WSMessage cast | client 消费方 ×3 | — | — |

### 3.3 死代码总量（重写应先删后建）

- CLI：platform.ts 整文件、talk 记忆三件套、rebootstrapIfNeeded/fetchToolDefs/setCurrentAgent、_currentRollbackTaskId、3 死类型、3 stub
- TUI：remote-query-loop（整文件）、ANSI renderer 4 文件（monkey-patch no-op）、group-chat ANSI 路径
- Desktop：550+ 行（D1-D12：opener-bubble 82 / boot-sequence 194 / speaking-motion 未接线 / presence 5 死事件分支 / preload 6 死 API / 空 handler / 死变量）
- WebUI：前端页面整体缺失（static 目录不存在）；engineBridge null 擦除（execute 即 TypeError）；config-handler 死路径

### 3.4 契约裂缝（最尖锐的几处）

1. **CortexDesktopAPI.init 参数语义错位**：preload 传 projectRoot、handler 期望 daemonPort
2. **presence 类型双份手抄**：PresenceEventPayload（main）/ PresenceEvent（renderer）/ emotion-map 的 PresenceEventType 全部手工对齐，未引用 protocol 类型锚点
3. **isWSClientCommand 守卫与联合类型不同步**：只认 subscribe/unsubscribe，不认 notification.ack 等 4 成员；且全仓零消费
4. **getAgentsConfig 与 getAgents 同端点不同返回类型**（G12）
5. **IPC_CHANNELS 双份手维护**（ipc-handlers 与 preload）

### 3.5 通知闭环缺口（S2-12 最后一截）

S2-12 的 ack 回路 server 侧完整（protocol 命令 + daemon 处理 + markAcked），但：
- **client 无 ackNotification 发送方法**（G1）
- **desktop 未订阅 notification 通道**（PRESENCE_CHANNELS 无）
- TUI 无通知 UI
- → 通知"只入不出"的闭环在客户端侧仍断着

### 3.6 确认门（gate）现状

- 回路**已通**：engine emit → WS gate.request → client onGateRequest → resolveGate → daemon → gate-bridge（desktop 未用、TUI 未接）
- desktop：gate.request 只驱动"问号表情"，无确认按钮、无 resolveGate 调用
- CLI 轻量模式：gate bridge 为「非 TTY 自动放行」（approved=true 无人工确认）
- TUI：权限门在 app.tsx onPreToolUse 弹窗（与 ConfirmGate 双门），挂起修复史 L329-335

## 4. 底座重写候选形状

### 4.1 底座 = @cortex/client 扩展（三端共用引擎连接底座）

**前提（最大阻断，必须先做）**：**服务端 API 面归一**——daemon 补齐 execute/events/config 路由（或 client 收敛为可发现能力面）。二选一需要决策：**daemon 补齐**（推荐，WebUI server 作为 daemon 的薄包装或删除）or **client 收敛**。

**底座必须项（G1-G12 修复）**：
1. typed 事件分发（基于 protocol WSServerEventByChannel 泛型收窄——protocol 已备好，消除 3 处 as cast）
2. ackNotification（通知闭环）
3. 连接生命周期事件（onConnect/onDisconnect/onReconnect）+ 可选 ping
4. 发送缓冲（非 OPEN 入队 + open flush）
5. HTTP AbortSignal + 超时
6. chat-stream 回调字段补全（toolCallId/durationMs/usage/reasoning）
7. deleteMemory 补齐
8. 服务端分页/agents 语义统一

**可下沉原语（已有雏形，从各端收编）**：
- engine.streamChat（正式入口，server 已消费）——唯一对话入口
- cli/tui/query-loop.ts 纯逻辑（消息组装/persona/工具循环/hooks，零 Ink 依赖）
- cli/tui/intent-router/（意图分类管道，零 UI 耦合）
- cli/tui/streaming-tool-executor（流式工具执行）
- desktop presence 事件类型化（基于 WSServerEventByChannel 生成裁剪函数）

### 4.2 三端 = 薄 UI 壳

| 端 | 保留 | 重写 |
|---|---|---|
| Desktop | 窗口/托盘/Live2D/presence 编排 | ChatView 流式 + 会话 + 记忆 + 确认门 UI；删 cortex-bridge 包装；presence-bridge 改 typed + notification |
| WebUI | —（未完成品） | 决策：前端直连 daemon（client 底座）+ 静态托管；或整体删除 |
| TUI | ink 展示组件 | 已废弃——只删不改（remote-query-loop/renderer v4 死代码） |

### 4.3 机制门禁（S3-9~S3-11，与底座正交）

layer-contract 扩展 / @layer 机制化 / 迁移扫描器 / 审计脚本沉淀——低风险工程，可与底座并行。

## 5. 决策记录（2026-06-20 用户拍板）

1. **API 面归一 → 「底座打实 + 共面加专化」**：不做「daemon 补齐 or client 收敛」二选一——client API 面成为唯一公共面（共面），daemon 与 WebUI server 各自实现共面子集，并允许端级专化扩展。
2. **WebUI**：先不投入——底座 + API 完成后它只是「套壳」，后续想怎么重写都行。
3. **TUI**：等前置（底座/API）完成后处置，本次不动。
4. **阶段三范围 = 前置「底座打牢」**：client 底座扩展 + protocol 契约同步 + API 共面 + 机制门禁 + 守护测试；三端改造全部后置。

## 6. 风险提示

- CLI 包 540+ 测试大量 mock 级，重写后基线脆弱——需先补底座级 contract 测试
- daemon 补齐 execute/events/config 路由 = server 安全面扩大（校验先行，复用 S3-5 的 isWSClientCommand 修复）
- protocol @planned 预留类型（agent/memory/session 通道）转正式需要 server 发射端配合
- desktop 补测试需先纯函数化（presence-bridge/emotion-map 可先行）
