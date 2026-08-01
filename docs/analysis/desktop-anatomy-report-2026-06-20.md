# Cortex Desktop 解剖级调研报告

> 调研对象：`packages/desktop`（Electron 桌宠，双窗口架构）。逐文件通读，证据格式 `文件:行号`。
> 日期：2026-06-20 ｜ 关联：refactor-phase3-survey-2026-06-20.md（链路级预调研）

## 1. 目录结构完整图

```
packages/desktop/
├── package.json            # v0.1.0；依赖 client/design-tokens/shared + pixi/live2d/react
├── electron-builder.yml    # NSIS 打包；files: dist+resources
├── vite.config.ts          # 双入口(main/chat html)；注入 cubism core
├── tsconfig.main.json / tsconfig.renderer.json
└── src/
    ├── main/                ── 主进程（523 行 TS）
    │   ├── index.ts         (149) 入口：双窗口管理、拖拽 IPC、生命周期、托盘
    │   ├── cortex-bridge.ts (96)  连接 daemon 的薄封装（@cortex/client）
    │   ├── ipc-handlers.ts  (108) 8 个 IPC handler + settings.json 读写
    │   ├── presence-bridge.ts (99) WS 事件 → presence:event IPC 转发
    │   └── tray.ts          (71)  系统托盘菜单
    ├── preload/index.ts     (110)  contextBridge 双桥：window.cyrene + window.cortexDesktop
    └── renderer/            (TS/TSX 约 2000 行)
        ├── main.ts          (151) 桌宠窗口入口：无 React，DOM + PIXI
        ├── global.d.ts      (60)  window 全局类型（含 4 个 preload 未暴露接口）
        ├── chat/ChatView.tsx (174) 聊天 UI：消息列表 + 发送（非流式）
        ├── chat/main.tsx / index.html / chat.css (1735 行遗产样式)
        ├── live2d/          (9 文件 1135 行) manager/interaction/focus/click-through/
        │                     expression-reset/mouth-sync/speaking-motion/param-driver/opener-bubble
        ├── presence/        (6 文件 1061 行) engine/emotion-map/design-spec/idle-behavior/boot-sequence
        └── public/          avatars/、models/cyrene/（model3.json + moc3 + 11 表情 + 5 动作）、cubism4.min.js
```

**双窗口架构**（index.ts:4-7）：`mainWindow` = 透明桌宠窗（Live2D），`chatWindow` = 独立聊天窗（React）。共用同一 preload，渲染层完全不同的两套代码。

## 2. main 进程解剖

| 阶段 | 行为 | 证据 |
|---|---|---|
| 启动 | `new CortexBridge()` → `await cortex.init()`，**失败仅 console.error，不阻断** | index.ts:26, 59-61 |
| 窗口 | mainWindow 600×800 透明无框 skipTaskbar；chatWindow 960×680 show:false + ready-to-show | index.ts:33-76 |
| 安全 | 双窗均 contextIsolation:true, nodeIntegration:false, sandbox:true | index.ts:45-50 |
| Presence | isInitialized 为真才建 PresenceBridge（init 失败则 presence 静默缺失） | index.ts:84-87 |
| 拖拽 IPC | window:move/move-to/set-dragging/set-interactive/capture-frame(恒 null 占位)/get-cursor-position | index.ts:90-115 |

**CortexBridge**（cortex-bridge.ts）：init = `CortexConnection({port:3210})` + connect（无重连策略配置）；chat = `conn.http.chat()` 非流式；streamChat 手动包 Promise；getAgents 失败静默回退 `["cyrene"]`；dispose = disconnect。

**IPC 全集**（ipc-handlers.ts:14-23，channel 常量与 preload 双份手维护）：

| Channel | 请求→响应 | 备注 |
|---|---|---|
| cortex:init | (daemonPort?) → {ok} | **preload 传 projectRoot，handler 期望 daemonPort——语义错位** |
| cortex:chat | (input, agent?) → {ok, data} | 非流式 |
| cortex:stream-chat | (input, agent?) → 流式回推 {chunk,done} | 定义了链路但 renderer 无人调用 |
| cortex:get-agents | → {ok, data} | renderer 无调用方 |
| live2d:speak | (text) → {ok} | **TTS 未就绪恒空** |
| live2d:expression | (expression) → 原样回显 | 无调用方 |
| settings:get/set | (key?, value?) → {ok} | JSON 文件，无 schema 校验 |

**PresenceBridge**（presence-bridge.ts）：订阅 chat/gate/system 三通道；白名单转换 9 种事件（chat.chunk/tool_start/tool_result/complete/error、gate.request/notify、system.status/shutdown）；**未订阅 notification 通道**；手工精简类型 `PresenceEventPayload` 与 renderer 对齐，未引用 protocol 类型锚点。

## 3. preload 层

- `window.cyrene`（窗口控制）：minimize/hide/quit/setInteractive/moveBy/moveTo/setDragging/captureFrame/getCursorPosition/onPetZoom/openChat
- `window.cortexDesktop`（业务）：init/chat/streamChat/getAgents/speak/expression/settings.get/set/onPresenceEvent
- **streamChat 每发起一次注册一个 ipcRenderer.on listener**（done 时移除）——潜在泄漏模式
- ⚠️ `global.d.ts` 声明 `live2dSpeech/live2dAction/openerBridge/window.settings` 四组接口，**preload 从未暴露任何一个**——指向死代码

## 4. renderer 解剖

**桌宠窗**（main.ts，无 React）：Live2DManager 加载 → ExpressionReset/MouthSync/SpeakingMotion(未 start)/ParamDriver/Interaction/MouseFocus/ClickThrough → PresenceEngine.start() → onPresenceEvent 桥接。

**聊天窗**（ChatView.tsx，React）：`useState` 本地消息数组，**无 store/无持久化/无会话概念**；发送走**非流式** `cortexDesktop.chat`；thinking 字段有渲染分支但从未被置真。

**presence 层**：presence-engine 事件→ExpressionDelta 编排；emotion-map 14 事件映射（5 个事件真实链路永不抵达）；idle-behavior 30s 空闲状态机。

## 5. 数据流全景

- **一次对话（唯一实际路径，非流式）**：ChatView.handleSend → preload chat → IPC cortex:chat → CortexBridge.chat → conn.http.chat → POST :3210/api/v1/chat → 回显
- **流式链路已定义但无人使用**：renderer 无人调用 streamChat
- **工具调用 presence 链路**：engine 工具事件 → WS chat channel → PresenceBridge 白名单 → presence:event IPC → emotion-map → 表情/嘴型
- **通知/ack（S2-11/S2-12）在 desktop 完全不消费**：PRESENCE_CHANNELS 无 notification；无 ack 方法调用

## 6. 契约依赖

全包仅 6 处跨包 import：`@cortex/client`（CortexConnection, streamChat, type）、`@cortex/shared`（clamp ×3）、`@cortex/design-tokens`（CYRENE_PALETTE, PersonaPalette）。**未直接 import protocol、未绕过 client**。client 能力仅用 6 个（http.chat/getAgents、ws.subscribe/on、streamChat）——其余 16+ 全未用。

## 7. 状态模型

- 桌宠窗：无持久状态（控制器实例引用 + 拖拽临时量）
- 聊天窗：messages[]/sending/input，**窗口关闭即丢失**
- main 进程：窗口引用 + settings 落盘；`_dragging` 死变量
- 跨进程同步：仅 invoke/handle 请求应答 + webContents.send 单向推送。无共享状态、无事件总线

## 8. 死代码 / 冗余 / 缺口

**死代码 D1-D12**：OpenerBubbleController（82 行，无 import）、BootSequence（194 行，从未 new，其 daemon 直连 fetch 全失效）、SpeakingMotionController.start（构造不启动）、presence-engine notifyUserTyping/Stopped（无桥接）、emotion-map 5 个死事件分支、cortexDesktop 6 个死 API、cyrene.onPetZoom（main 不发射）、captureFrame（恒 null）、live2d:expression handler、global.d.ts 4 组未实现接口、ChatView thinking/#particles、_dragging 死变量。**合计 550+ 行 TS 死代码**。

**冗余**：IPC_CHANNELS 双份手维护；PresenceEventPayload/PresenceEvent 双份手工对齐；resolveAsset 重复定义；chat.css 1735 行遗产样式；构建双轨（tsconfig.renderer + vite 混写 dist/renderer）。

**功能缺口**：通知消费缺失（S2-12 断）、确认门 UI 缺失（gate.request 只驱动问号表情，无 resolveGate 调用）、记忆浏览/写入未用、会话管理未用、流式对话未用、TTS 空实现、设置 UI 空目录、断线感知无 UI、模型/Agent 选择无。

## 9. 可下沉原语 + 重写影响面

**下沉到 @cortex/client**：连接生命周期（init/重连/失败事件）、流式路由（删除 cortex-bridge 包装层）、通知订阅+ack（新增）、会话/记忆/agent 高封装 API、Presence 事件类型化（基于 WSServerEventByChannel 生成裁剪函数）。

**desktop 保留（纯 UI 壳）**：窗口管理/托盘/拖拽/点击穿透、Live2D 渲染控制器（除 opener-bubble）、presence 表情编排（剔除 boot-sequence 直连）、ChatView 纯视图（改造）。

**重写影响面**：删 cortex-bridge.ts/opener-bubble.ts；改造 presence-bridge（补 notification）/ipc-handlers（channel 收敛 + gate.resolve + notification.ack）/preload（API 收敛 + 修 init 语义错位）/ChatView（流式重写 + 会话 + 记忆 + 确认门 UI）/boot-sequence（走 client getDaemonHealth）；保留 index.ts（删占位）、live2d/、presence/ 核心。

## 10. 测试现状与优先清单

**确认零测试**（全包 *.test.ts 0 命中）。优先补（全部可脱离 Electron 单测）：
1. presence-bridge 事件转换（纯函数化后）
2. emotion-map → ExpressionDelta 映射（14 事件 × 分支）
3. cortex-bridge 连接生命周期（mock client）
4. ipc-handlers 8 channel 契约（mock IpcMain）
5. presence-engine 编排（注入假控制器）
6. preload streamChat listener 生命周期（防泄漏）
7. idle-behavior 状态机（fake timers）

## 核心结论

1. **desktop 是"壳 + 两套互相隔离的 UI"**：Live2D 桌宠与聊天窗除 openChat 外零耦合——"她"不知道用户在聊什么。
2. **client 底座只用了 15%**：连接/流式/订阅原语齐全，缺"通知订阅 + gate 应答 + 会话原语"上层封装。
3. **550+ 行死代码**：重写应先删后建。
4. **最尖锐契约裂缝**：init 参数语义错位（projectRoot vs daemonPort）；presence 类型双份手抄；_dragging 死变量。
5. **重写抓手排序**：① client 增补通知/gate/会话原语 → ② desktop 全链路改走 client 直连（删 cortex-bridge 包装）→ ③ ChatView 重写为流式+会话+记忆+确认门 UI → ④ presence 接线真实通知/session 事件 → ⑤ 测试清单兜底。
