# Cortex @cortex/client + WebUI 解剖级调研报告

> 调研对象：`packages/client`（7 文件 660 行）+ `packages/cli/src/tui/web`（5 文件 1809 行）+ 证据链扩展（protocol/server/desktop/remote-bridge/scripts）。
> 日期：2026-06-20 ｜ 关联：refactor-phase3-survey-2026-06-20.md

## 0. TL;DR

1. **@cortex/client 是"瘦封装"，不是"底座"**：660 行、7 文件、仅依赖 protocol；事件全部 unknown 透传、无连接生命周期事件、无心跳、无发送队列、HTTP 无超时。
2. **最大结构性缺陷：client 假设"合并 API 面"，但存在两个互不兼容的服务端**——daemon(:3210) 与 WebUI 内置 server(:3001) 各自实现 REST/WS 的不同子集。`client.http.execute()` 对 daemon 404；`getDaemonHealth()` 对 WebUI 404；`getAgents()` 两端返回形状都不匹配 client 类型声明。
3. **S2-12 notification.ack 缺失**：protocol 定义了命令、daemon 处理了命令，client ws-client **没有发送方法**——通知闭环断在客户端。
4. **WebUI 前端页面不存在**：`startWebUI` 的 static 目录不存在；main.ts 未接线 startWebUI；唯一调用方是 scripts/start-webui.ts。WebUI 是"无前端的前端"，且自身不能聊天（无 /chat 端点、WS 只认 subscribe/unsubscribe）。
5. **大量重复**：gateway ×2（461+370 行）、StateAggregator ×2、chat/gate 事件路由 ×3、手写 WS 协议 ×2。

## 1. @cortex/client 完整 API 面

| 文件 | 行数 | 职责 |
|---|---|---|
| index.ts | 26 | barrel：CortexConnection/CortexHttpClient/CortexWSClient/streamChat/错误/配置类型 |
| connection.ts | 49 | CortexConnection 统一入口（http+ws），默认 localhost:3001 |
| ws-client.ts | 203 | CortexWSClient：connect/disconnect/subscribe/unsubscribe/on/off/startChat/cancelChat/resolveGate |
| http-client.ts | 232 | CortexHttpClient：22 个方法（state/nodes/agents/health/execute/events/models/keys/tuning/config/chat/memory/sessions/daemon-health） |
| chat-stream.ts | 89 | streamChat 高层流式 helper（chat+gate 路由，sessionId 过滤） |
| errors.ts | 26 | ProtocolError（RFC7807）/ ConnectionError |
| types.ts | 44 | HttpClientConfig/WSClientConfig/CortexConnectionConfig |

**CortexWSClient 方法**：connect/disconnect/subscribe/unsubscribe/on/off/startChat/cancelChat/resolveGate/connected。`_send` 非 OPEN 时**静默丢弃**（无发送队列）；`on()` 不自动 subscribe（desktop PresenceBridge 正确先 subscribe 再 on）；重连后自动重发全量订阅（唯一会话恢复机制）。

## 2. ws-client 深度解剖

- **连接**：WebSocketImpl 可注入；onerror 空实现（"onclose will handle cleanup"）；**无心跳/活性检测**，断线发现全靠 TCP onclose
- **重连**：指数退避 `backoffMs * 2^attempts` 封顶 30s + 20% 抖动，默认 10 次；耗尽调 `reconnect.onFailed`；**无 onDisconnect/onReconnect 事件通道**
- **接收**：`isWSMessage` 守卫后按 channel 查 handlers——**事件类型是运行时字符串，无 typed 分发**（消费方全部 `as` cast）
- **订阅**：`subscribedChannels` 内存态 + 命令双写；重连重发；**未消费 server 的 subscription_ack**
- **契约绑定**：仅用 WSChannel/WSMessage/WSClientCommand/isWSMessage/LlmMessageDTO；**未用 isWSClientCommand/isProtocolEnvelope/negotiateVersion/WSNotificationAckCommand**

## 3. chat-stream 解剖

startChat 获得 sessionId → on("chat") 按 sessionId 过滤 → switch 分发 chunk/tool_start/tool_result/complete/error；on("gate") 只处理 gate.request。**丢弃字段**：onToolStart 丢 toolCallId/agent、onToolResult 丢 toolCallId/durationMs、onComplete 丢 usage/reasoning——工具追踪与用量统计在高层被阉割。

消费方：desktop cortex-bridge（只用 onChunk/onComplete/onError）；remote-query-loop **未用 streamChat**（手写路由，事件映射反而更完整——保留 toolCallId/durationMs/usage）。

## 4. http-client 解剖（22 方法 × 双端支持矩阵）

| 方法 | daemon(:3210) | WebUI(:3001) |
|---|---|---|
| getState/getHealth/getNodes | ✅ | ✅（getNodes 形状不同） |
| getNode/getEvents/getModels/createModel/patchModel/deleteModel/patchAgentConfig/getKeys/createKey/deleteKey/getTuning/patchTuning/validateConfig/getConfigVersion/execute | ❌ 404 | ✅ |
| chat/searchMemory/writeMemory/getSessions/createSession/deleteSession/getDaemonHealth | ✅ | ❌ 404 |
| getAgents | ⚠️ 形状不匹配（pool stats） | ⚠️ 形状不匹配（statuses） |

**结论：client 的 22 个方法中约一半在任何给定服务端上 404**。config 10 方法双端 100% 不可达（daemon 无路由、WebUI 不传 configHandler）。缺 deleteMemory（daemon 有路由、protocol 有类型、client 无封装）。

## 5. WebUI（cli/src/tui/web/）解剖

- **index.ts**：getStaticDir → `tui/web/static`（**目录不存在**）；默认端口 3001；engineBridge 用 `null as unknown as X` 泛型擦除（**从未被传入——execute 调用即 TypeError**）；configHandler 同样未传（**config API 100% 不可达**）
- **api-router.ts**：REST 路由（state/nodes/agents/health/execute/events），**无 /chat /memory /sessions**；/agents 被 _handleGetAgents 抢先拦截 → getAgentsConfig 死路径
- **gateway.ts**（461 行）：手写 RFC6455（握手/帧解析/掩码 XOR）；**只认 subscribe/unsubscribe**，chat.start/gate.resolve 等命令被丢弃
- **state-aggregator.ts**（302 行）：重复定义 TaskNodeSnapshot/WebUIState（与 protocol 独立维护）；500ms 心跳全量推送
- **前端页面**：不存在（v4 前有 React 前端已随包收敛删除）
- **结论：WebUI 是"无前端、不能聊天、execute 即崩"的未完成品**

## 6. 缺口与冗余

**client 缺口 G1-G12**：
- G1 notification.ack 发送方法缺失（S2-12 闭环断在客户端）
- G2 deleteMemory 缺失
- G3 事件零 typed 分发（3 处消费方全部 as cast）
- G4 无连接生命周期事件（onConnect/onDisconnect/onReconnect）
- G5 无心跳/活性检测
- G6 无发送队列（非 OPEN 静默丢弃）
- G7 HTTP 无超时/取消（无 AbortSignal）
- G8 chat-stream 丢弃 toolCallId/durationMs/usage/reasoning
- G9 config API 双端 100% 不可达
- G10 execute 对 daemon 404（daemon 模式下工具执行必失败）
- G11 getAgents 三头错（client 期望 / daemon 返回 / WebUI 返回 三者不同）
- G12 getAgentsConfig 与 getAgents 同端点不同返回类型

**重复**：cli/web/gateway.ts（461 行）vs server/ws/gateway.ts（370 行，server 注释自认 Adapted）；cli/web/state-aggregator.ts vs server/http/state-handler.ts；chat/gate 事件路由 ×3（chat-stream/remote-query-loop/remote-engine-bridge）；手写 WS 协议 ×2。

## 7. 测试现状

- client：2 文件 198 行。ws-client.test.ts（8 用例，MockWebSocket 注入）；llm-contract.test.ts（**归属错位**——放在 client 包但测的是 cli 的 serializeMsg 行为）。**http-client 22 方法零测试、chat-stream/connection/errors 零测试**
- WebUI：5 文件零测试
- server：4 文件（daemon/health/notification-bridge 契约有守护）

## 8. 底座适配性评估（client 作为三端共用底座）

| 能力 | 判定 |
|---|---|
| 对话流式 | ✅ 可用（G8 丢字段待补） |
| 工具执行 | ⚠️ WS 通、HTTP execute 对 daemon 死 |
| 确认门 | ✅ gate.request → resolveGate 回路完整，三端可共用 |
| 通知订阅 | ❌ G1 阻断闭环（ack 发送缺失） |
| 记忆查询/写入 | ✅（缺 delete） |
| 会话管理 | ✅ |
| 状态/管线观测 | ⚠️ getNodes 分页形状 daemon 不兼容 |
| 配置管理 | ❌ 双端都不可达 |
| 多会话恢复 | ⚠️ protocol 定义 session.resumed 但 server 未发射 |

**底座化改造必须项（按优先级）**：
1. **服务端 API 面归一**（最大阻断）：daemon 补齐 execute/events/config 路由，或 client 删除这些方法并暴露可发现能力
2. **G1 notification.ack**：ws-client 加 ackNotification
3. **G3 typed 事件**：基于 WSServerEventByChannel 泛型收窄（protocol 已备好）
4. **G4/G5 连接活性**：生命周期事件 + 可选 ping
5. **G6 发送缓冲**：非 OPEN 入队，open 后 flush
6. **G7 AbortSignal**
7. **G8 回调字段补全**（toolCallId/durationMs/usage/reasoning）
8. **deleteMemory + session touch**

**纯 UI 壳该做的**：desktop 窗口/托盘/Live2D/TTS/IPC；WebUI 前端框架/组件树/渲染；TUI Ink 组件/键盘/渲染循环。三端共有 UI 态（消息列表、流式增量渲染、工具进度条、门弹窗）各端自持，底座只提供事件流。

## 9. 重写影响面

- **client**：ws-client（+ackNotification/+生命周期事件/+发送队列/+typed 分发）、http-client（+deleteMemory/+AbortSignal/方法收敛）、chat-stream（字段补全）、types（+重连事件/心跳配置）
- **protocol**：events 已完备（agent/memory/session 通道从 @planned 转正式按需）
- **server**：router（+execute/events/config 或确认删）、state-handler（分页形状对齐）、agents 语义统一
- **cli**：tui/web 5 文件要么删除（前端直连 daemon + 静态托管）要么与 server 合并；remote-engine-bridge 复用 streamChat 替代手写路由；remote-query-loop 底层改消费 typed 事件
- **desktop**：cortex-bridge 升级新回调；presence-bridge 改 typed 事件 + 补 notification 订阅
- **scripts**：start-webui.ts 重写

**基线数据**：client 660 行 src + 198 行测试；web 1809 行 src + 0 测试；server 2×gateway 重复约 830 行待合并。
