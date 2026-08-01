# Cortex TUI 解剖报告（packages/cli/src/tui/）

> 范围：`packages/cli/src/tui/` 全部 90 个文件（含 ink/、modes/、intent-router/、interaction/、layout/、renderer/、theme/、animation/、web/）。
> 性质：只读解剖，未修改任何代码。证据格式 `文件:行号` + 代码摘录。
> 姊妹篇：[cli-anatomy-report-2026-08-02.md](cli-anatomy-report-2026-08-02.md)（CLI 非 tui 部分）。
> 用途：为「交互层更深层重写、将底座打牢」决策提供完整事实图景。

---

## 0. TL;DR

1. **双轨渲染系统并存**：`renderer/`（手写 ANSI escape，v4 遗产）与 `ink/`（Ink React，v5 现行）同目录共存；`renderer/tool-log.ts:50,72` 渲染调用已被注释（"纯流式模式"），`group-chat.ts` 的 ANSI `renderGroup` 被 `ink/group-view.tsx:195` monkey-patch 为 no-op——**v4 渲染栈已实质废弃，仅 3 个文件仍被引用**（sigint-handler / sanitize / permission-dialog 的 L1-L3 评估被 app.tsx 复用）。
2. **双套持久化**：`session-store.ts`（SessionSnapshot 文件 I/O）与 `ink/session-persistence.ts`（SessionState↔LlmMessage 适配 + autoSaver）职责重叠，后者写入时显式丢弃群聊状态（`session-persistence.ts:57` 写 `groups: [], talkTrio: false`）。
3. **remote-query-loop.ts 是死代码**：`remoteQueryLoop` 全仓库无调用方（grep 仅命中自身与 `types.ts:160` 的错误上下文字符串）。它依赖 `@cortex/client` 的 `CortexConnection`，与 `services/remote-engine-bridge.ts` 的 daemon 模式属于两代方案——当前 daemon 模式走 `RemoteEngineBridge`（实现 `ITuiEngineBridge`），`remote-query-loop` 的 WS channel 协议无人消费。
4. **web/ 子目录前端从未落地**：`web/index.ts:23-27` 的 `getStaticDir()` 指向 `tui/web/static/`，**该目录不存在**（Glob 全仓 0 个 HTML/CSS）。`startWebUI` 只在 `tui/index.ts:103` barrel 导出，`main.ts` 未调用——HTTP/WS 后端完备、前端页面缺失、入口无接线。
5. **意图分类已沉淀为独立原语**：`intent-router/`（Explicit→Pattern→Context 管道 + confidence 融合）与 UI 解耦，可直接下沉；`intent-router.ts:63` 只是向后兼容的桥接重导出。
6. **query-loop.ts 是唯一对话执行核心**：消息组装 / persona / 真流式 / 工具循环 / 95% 压缩全部内聚于此 402 行；app.tsx 通过 `use-input-handler.ts` 消费它，事件经 `TuiEventBus` 广播——**执行逻辑已与 UI 解耦（可下沉），但 plan 模式与权限门控仍耦合在 Ink 组件内**。
7. **hooks.ts 的权限钩子名存实亡**：`defaultHooks.onPreToolUse` 对 L1 返回 allow 且其余也返回 allow（`hooks.ts:32-36`，注释称 L2/L3 由 ConfirmGate 接管，实际恒 allow）；真正的权限门控在 `app.tsx:338-362` `createExternalHooks`（PERMISSION_REQUIRED + Promise 挂起）。
8. **Desktop/WebUI 不消费 TUI 任何代码**：`packages/desktop` 对 `ITuiEngineBridge`/`TuiEventBus`/`queryLoop` 零引用，走自己的 `CortexBridge`（@cortex/client HTTP/WS）；`web/` 的 `/execute` 路由与 desktop 的 `streamChat` 是同一底层能力的两套薄壳。

---

## 1. 目录结构完整图

### 1.1 tui/ 根目录（13 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| index.ts | 124 | barrel：导出全部子系统与 `startInkTui`/`startWebUI` |
| types.ts | 257 | `TuiEvent`（14 种事件联合）、`TuiHooks`（26 钩子）、`ReplMode`、`TuiContext` |
| event-bus.ts | 98 | 类型安全 pub/sub `TuiEventBus`（含通配符订阅） |
| hooks.ts | 73 | `defaultHooks`/`talkHooks`/`partyHooks` 工厂（权限钩子恒 allow，见 §9.4） |
| query-loop.ts | 402 | **本地对话循环**：system 组装/persona/真流式/tool 循环/压缩（§5.1） |
| remote-query-loop.ts | 237 | 远程 daemon 对话循环（**死代码**，§5.2） |
| streaming-tool-executor.ts | 182 | 工具调用执行器：按可逆性 L1/L2/L3 读写分批并发（§5.3） |
| context-compactor.ts | 409 | 5 层上下文压缩管线（L1 裁剪/L2 截断/L3 压缩对/L4 LLM 摘要/L5 丢弃） |
| session-store.ts | 85 | `SessionSnapshot` 会话快照文件 I/O（.cortex/sessions） |
| group-chat.ts | 457 | `GroupChatManager` 全局单例群聊（ANSI 渲染被 monkey-patch 抑制） |
| intent-router.ts | 63 | 意图分类向后兼容桥接（重导出新管道） |
| commands.ts | — | （注意：此为 ink/commands.ts，见下） |

### 1.2 ink/（16 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| app.tsx | 518 | **根组件**：布局/权限门控/Esc 中断/type-ahead（§2.1） |
| ink-entry.tsx | 56 | `startInkTui`：Ink.render + 流重定向/恢复 + sigint 接管 |
| app-context.tsx | ~40 | React Context：共享 dispatch/agent/mode/session |
| session-reducer.ts | 362 | `SessionState`（12 字段）+ 25 种 action（§7.1） |
| session-persistence.ts | 76 | SessionState↔LlmMessage 适配 + autoSaver（每 8s / 退出） |
| chat-view.tsx | 204 | 消息列表渲染（含流式光标/角色色） |
| input-bar.tsx | 51 | 输入框（TextInput + 提交回调） |
| status-bar.tsx | 107 | 状态条（Agent/模式/Token 消耗） |
| group-view.tsx | 276 | 群聊视图；**monkey-patch `manager.renderGroup` 为 no-op**（L195） |
| task-tree.tsx | 146 | TaskNode 树渲染（plan 执行进度） |
| diff-block.tsx | 218 | diff 文本块渲染 + `looksLikeDiff` 启发式 |
| permission-prompt.tsx | 99 | 权限确认浮层（30s 超时自动 deny） |
| command-palette-view.tsx | 126 | 命令面板浮层（模糊搜索列表） |
| splash-screen.tsx | 141 | 启动画面（星空动画） |
| commands.ts | 108 | `/` 前缀内部命令处理器（help/exit/mode/agent 等） |
| hooks/use-event-bridge.tsx | 69 | EventBus→reducer dispatch 桥（订阅 + 卸载清理） |
| hooks/use-input-handler.ts | 187 | **输入分发链核心**（§3.1） |

### 1.3 modes/（3 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| command-mode.ts | 27 | 纯命令分发：`bridge.executeToolCall(name, args)` 后经 hooks 回调 |
| plan-mode.ts | 264 | Plan FSM + 生成（queryLoop plan/reasoner）/审批/执行（executeWithStream）（§4） |
| plan-utils.ts | 216 | 纯工具：workspace 提取/意图澄清循环/中文确认词/任务树格式化 |

### 1.4 intent-router/（8 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| index.ts | 23 | 管道 barrel 导出 |
| pipeline.ts | 65 | 分类器管道执行器（EARLY_EXIT_THRESHOLD=0.95，异常跳过） |
| router.ts | 68 | 全局单例管道（Explicit→Pattern→Context）+ `classifyIntent(input, context?)` |
| types.ts | 54 | `IntentType`/`IntentResult`/`ClassificationTrace`/`RouterContext` |
| classifiers/explicit.ts | 48 | `/` 命令与 `@agent` 前缀显式分类 |
| classifiers/pattern.ts | 143 | 14 条中文正则规则（任务/命令/确认/模式切换/闲聊） |
| classifiers/context.ts | 58 | 上下文推断（基于历史/模式/焦点） |
| classifiers/confidence.ts | 80 | `fuseResults` 类型加权 + consensusBonus 融合 |

### 1.5 interaction/（8 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| types.ts | 91 | `FocusZone`/`KeyBinding`/`IntentType`/`KeyContext` |
| key-registry.ts | 126 | 快捷键注册表（支持序列键/上下文匹配） |
| key-bindings.ts | 177 | 默认键位工厂（`createDefaultBindings`/`PERMISSION_BINDINGS`） |
| focus-manager.ts | 84 | 焦点管理 + overlay 栈（pushOverlay/popOverlay） |
| command-palette.ts | 202 | 命令面板控制器（模糊搜索 + 过滤） |
| index.ts | 29 | barrel |
| hooks/use-keybinding.ts | 84 | Ink `useInput` → KeyRegistry 桥接 |
| hooks/use-focus.ts | 43 | 焦点订阅 hook + 焦点操作封装 |

### 1.6 layout/（5 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| primitives.ts | 85 | 布局抽象：PanelConfig/SplitConfig/`detectLayoutMode` |
| panel-presets.ts | 86 | 9 种面板预设（chat/tool/permission/status/...） |
| adapter-ansi.ts | 75 | v4 ANSI 布局渲染（renderAnsiPanel/renderStatusBar） |
| adapter-ink.tsx | 144 | v5 Ink 布局组件（Panel/SplitPane/Separator） |
| index.ts | 23 | barrel |

### 1.7 renderer/（8 文件）—— v4 ANSI 遗产

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| ansi.ts | 318 | ANSI 原语：cursor/erase/style/Box 增量渲染/StatusLine |
| index.ts | 10 | barrel（仅导出 sigint-handler + sanitize） |
| permission-dialog.ts | 158 | **仍被复用**：L1/L2/L3 可逆性评估 + `reversibilityLevel()`（§8.3） |
| diff-viewer.ts | 144 | unified diff / side-by-side ANSI 渲染 |
| sanitize.ts | 25 | 终端文本净化 |
| sigint-handler.ts | 36 | Ctrl+C 两连退出（**仍被 ink-entry 使用**） |
| token-monitor.ts | 112 | Token 消耗面板 |
| tool-log.ts | 66 | 工具日志渲染（**渲染调用已注释**，纯流式模式） |

### 1.8 theme/（8 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| tokens.ts | 230 | 设计令牌（昔涟翡翠绿 #48C78E，色/间距/边框/排版/动效） |
| palette.ts | 99 | 色板工具（PALETTE/GRADIENTS/hexToRgb/lerpColor） |
| character-theme.ts | 211 | 角色主题（CHARACTER_THEMES，按 agent 取色） |
| border-chars.ts | 174 | 边框/分隔字符集（BORDER_CHARS/SEPARATOR_CHARS） |
| motion.ts | 113 | 动效预设（easing/spinner/PRESET_*） |
| adapter-ansi.ts | 124 | v4 ANSI 消费适配器 |
| adapter-ink.ts | 172 | v5 Ink 消费适配器（`inkTheme`） |
| index.ts | 82 | barrel |

### 1.9 animation/（14 文件）

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| engine.ts | 208 | 全局帧调度器（setInterval，15fps，慢帧自动降帧至 0.25） |
| index.ts | 25 | barrel |
| hooks/use-frame.ts | 66 | 帧回调 hook（useAnimation） |
| hooks/use-typewriter.ts | 132 | 打字机效果 hook |
| hooks/use-fade-in.ts | 100 | 淡入 hook |
| hooks/use-slide-in.ts | 99 | 滑入 hook |
| hooks/use-progress.ts | 139 | 工具执行进度 hook（ToolExecutionStatus） |
| hooks/use-spinner.ts | 73 | Spinner hook |
| components/Typewriter.js | 41 | Ink 打字机组件 |
| components/FadeIn.js | 30 | Ink 淡入组件 |
| components/SlideIn.js | 29 | Ink 滑入组件 |
| components/ProgressBar.js | 47 | Ink 进度条组件 |
| components/Spinner.js | 34 | Ink Spinner 组件 |

### 1.10 web/（5 文件）—— 见 §6 详析

| 文件 | 行数 | 一句话职责 |
|---|---|---|
| index.ts | 222 | `startWebUI`：StateAggregator + APIRouter + WSGateway + 静态服务（目录缺失） |
| api-router.ts | 430 | REST 路由（/state /nodes /agents /health /execute /events） |
| config-api-handler.ts | 343 | 配置 CRUD（/models /agents /keys /tuning /config/*） |
| gateway.ts | 396 | **手写 RFC6455 WebSocket** 服务端（无外部依赖） |
| state-aggregator.ts | 270 | 聚合 WebUIState（TaskBoard/AgentPool/Health），500ms 心跳推送 |

---

## 2. 组件树（ink/）

### 2.1 渲染层级

```
ink-entry.tsx: startInkTui() → Ink.render(<App/>) + 流重定向
└─ app.tsx (518) 根组件 [useReducer(SessionState) + Context + KeyRegistry/FocusManager]
   ├─ StatusBar (status-bar.tsx)
   ├─ 主区（两列）：Sidebar（agent 列表）│ ChatView (chat-view.tsx) + GroupView (group-view.tsx)
   ├─ 浮层（互斥）：
   │  ├─ CommandPaletteView (command-palette-view.tsx)
   │  ├─ Help 面板
   │  └─ PermissionPrompt (permission-prompt.tsx, 30s 超时)
   ├─ TaskTree (task-tree.tsx, plan 执行时) / DiffBlock (diff-block.tsx)
   ├─ InputBar (input-bar.tsx) ← 默认焦点
   └─ SplashScreen (splash-screen.tsx, 启动时)
```

### 2.2 核心组件要点

**app.tsx（518 行）—— 状态与职责最重的组件**
- 本地 UI 状态（非 reducer）：`showSplash`/`showSidebar`/`showHelp`/`showCommandPalette`/`pendingInputs`（type-ahead 队列）
- 会话状态：`useReducer(sessionReducer)`（§7.1）
- **权限门控**（`createExternalHooks`, app.tsx:338-362）：`onPreToolUse` 对 L1 直接 allow；`approveAllRef` 为真时跳过；否则 `dispatch(PERMISSION_REQUIRED)` 并挂起 Promise 等 resolver。权限 resolver 释放修复（app.tsx:329-335）：`pendingPermission` 置 null 时 resolve("deny") 防 queryLoop 挂起
- Esc 处理（app.tsx:391-409）：help/面板优先关闭 → 处理中则 `interrupt()` + `TURN_INTERRUPTED` → 默认聚焦 input
- Ctrl+C 两连退出经 SigintHandler（app.tsx:386-390）
- `useKeybinding(keyRegistry, focusManager)`（app.tsx:413）
- 通过 `use-input-handler` 把提交动作委托给外部 `onSubmit`（由 ink-entry 注入 bridge/hooks）

**session-reducer.ts（362 行）** —— 见 §7.1

**chat-view.tsx（204）**：props = `{ messages, streamingContent, mode, agent, visibleOffset }`；渲染消息列表，assistant 消息拼接流式 buffer，`visibleOffset` 实现滚动窗口。

**input-bar.tsx（51）**：props = `{ onSubmit, disabled, placeholder }`；Ink TextInput；处理中禁用。

**status-bar.tsx（107）**：props = `{ agent, mode, tokenUsage, isProcessing }`；右侧 token 消耗。

**permission-prompt.tsx（99）**：props = `{ permission, onDecision }`；渲染工具名/参数/风险等级，30s 无响应自动 deny。

**group-view.tsx（276）**：订阅 GroupChatManager 事件；**L194-195 monkey-patch `manager.renderGroup` 为 no-op**，注释"抑制 GroupChatManager 的 ANSI 渲染（避免与 Ink 冲突）"，卸载时恢复（L203-205）。消息折叠 `maxMessages`（L215-217）、任务进度统计（L221-224）。

**task-tree.tsx（146）**：props = `{ nodes, planState }`；按 parentId 建树，状态着色。

**diff-block.tsx（218）**：`looksLikeDiff` 启发式（diff/+++/---/@@ 前缀）决定是否走 diff 渲染，否则原样输出。

**splash-screen.tsx（141）**：星空动画（animationEngine 注册帧回调）+ 品牌标语。

### 2.3 hooks 表

| hook | 文件 | 职责与依赖 |
|---|---|---|
| use-input-handler | ink/hooks/use-input-handler.ts | 输入分发链（§3.1）；依赖 `ITuiEngineBridge`/`ICommandDispatcher`/`TuiEventBus` |
| use-event-bridge | ink/hooks/use-event-bridge.tsx | 订阅 TuiEventBus → `dispatch(sessionReducer action)`；卸载清理 |
| useKeybinding/useKeyBinding | interaction/hooks/use-keybinding.ts | Ink useInput → KeyRegistry 匹配；`KeyContext` 来自 FocusManager |
| useFocus/useFocusActions | interaction/hooks/use-focus.ts | 订阅 FocusManager 变化；提供 focus/pushOverlay/popOverlay 操作 |
| useFrame/useAnimation | animation/hooks/use-frame.ts | animationEngine 帧注册 |
| useTypewriter | animation/hooks/use-typewriter.ts | 打字机（依赖 engine + tokens.motion.typewriterSpeed） |
| useFadeIn/useSlideIn | animation/hooks/ | 入场动画 |
| useProgress | animation/hooks/use-progress.ts | 工具执行状态 → 进度条 |
| useSpinner | animation/hooks/use-spinner.ts | Spinner 字符轮换 |

---

## 3. 输入处理管线

### 3.1 use-input-handler.ts（187 行）完整流程

```
用户回车 → onSubmit(input)
│
├─ 1. 同步守卫 _processingGuard（L64,72）：处理中再次提交直接丢弃
├─ 2. handleCommand(input)（L78）：/ 前缀内部命令（commands.ts）→ 返回
├─ 3. classifyIntent(input) === "command" → registry.dispatch（L82-91）
│     走 ICommandDispatcher（全局命令注册表，非模式路由）
├─ 4. Plan 审批短路（L94-134）：planState==="reviewing" 且输入匹配
│     审批词（"执行"/"approve"/"开始"…）→ planMode("execute")
│     （拒绝词 → planMode("reject")）
├─ 5. classifyIntent(input) + parseAgentFromInput(input)（L137-138）
├─ 6. 构建历史（L149-151）：提取 session.messages，过滤 system 消息
├─ 7. 模式路由（L161-181）：
│     ├─ intent==="task"（或 mode==="plan"）→ planMode（plan-mode.ts）
│     └─ 否则 → 进入 queryLoop({ input, mode, agent, ... })（query-loop.ts）
│         所有 yield 的 TuiEvent 经 tuiEventBus.emit() 转发（全局广播）
│         结束回调 → dispatch 会话更新
└─ interrupt()（L199-201）= abortRef.abort() —— 供 Esc/Ctrl+C 调用
```

要点：
- **处理链是串行的 if-else 阶梯**，命令 → 审批 → 意图分类三层判定顺序固定；
- **执行完全委托**：use-input-handler 自身不持有执行逻辑，只做编排与事件转发；
- abort 信号通过 `QueryLoopParams.signal` 传入（app.tsx 持有 abortRef），中断语义见 §5.1。

### 3.2 intent-router/ 分类器管道

```
router.ts:25-28 全局单例管道 = [ExplicitClassifier, PatternClassifier, ContextClassifier]
classifyIntent(input, context?)（router.ts:39-48）→ pipeline.run()
pipeline.ts: EARLY_EXIT_THRESHOLD = 0.95（L14）
  逐分类器执行 → 若 maxConfidence ≥ 0.95 提前退出
  分类器异常 → 跳过不中断（try/catch）
  最终 confidence.fuseResults(各分类器结果)（L18-81）
```

各分类器逻辑要点：

| 分类器 | 逻辑要点 |
|---|---|
| explicit.ts (48) | `/xxx` → command；`@agent` → 提取 agent 并归为 task/chat；最高置信度 1.0 |
| pattern.ts (143) | 14 条中文正则：任务类（分析/修改/重构/审计/生成…）、命令类（查/看/运行/执行/列出…）、确认类（是/对/好/可以/没错…）、模式切换（切到 plan/talk/group…）、闲聊兜底。短文本(<5 字)默认 chat 0.5（L123-129）；长文本(>40 字)倾向 task 0.55（L152-158） |
| context.ts (58) | 基于 `RouterContext`（当前模式/历史/焦点）：若 mode==="plan" 或历史最近意图为 task → task 加权；无上下文时中性 |
| confidence.ts (80) | `fuseResults`：按类型对各分类器置信度加权 + `consensusBonus`（0.1×(一致数-1)）；最终置信度 < LOW_CONFIDENCE(0.4) 时填充 `uiHint`（提示用户明确意图） |

---

## 4. 模式系统（modes/）

### 4.1 command-mode.ts（27 行）

```ts
// command-mode.ts: 纯命令分发
const result = await bridge.executeToolCall(name, args);
hooks.onToolResult?.(...)
```
即：不经过 LLM，直接执行命令工具（如 ls/git）。输出经事件总线广播。

### 4.2 plan-mode.ts（264 行）—— Plan FSM + 生成/审批/执行

**FSM**（plan-mode.ts:19-28）：

```
idle → planning → reviewing → approved → executing → completed/failed/aborted
                    ↑_________________|
                    （拒绝 → 回 reviewing）
```

- `canTransition(from, to)`（L34-40）转移表校验；
- **持久化**：`.cortex/plan-state.json`（L53）load/save/clearPlanState——**plan 状态跨进程恢复**；
- `planMode({ action })` generator（L123-235）三条支路：
  1. `action==="execute"` 且 planState==="approved"：`bridge.executeWithStream(pendingNodes, cb)`（L168-184）——**执行委托给引擎**，回调转 eventQueue 逐个 yield；
  2. `action==="reject"`：回 reviewing，保留计划待改；
  3. 生成新计划：`queryLoop({ mode: "plan", agent: "reasoner" 路径 })`（L199）→ 取 finalOutput → **MetaAgent 标准化**：`bridge.getMetaAgent?.()` + `metaAgent.plan(input)`（L203-214）→ 失败降级 `_extractPlanNodes` 解析 JSON（L244-273，支持纯 JSON/code block/内嵌数组）→ `_normalizeNodes` 补全 id/status/parentId 等字段（L276-292）。

**与 bridge 的交互**：`getMetaAgent`（可选方法）、`executeWithStream`（plan 执行）、`streamChat`（经 queryLoop）。
**输出流**：yield `plan_generated` / `task_tree_update` / `node_*` 等 TuiEvent → 事件总线 → task-tree.tsx 渲染。

### 4.3 模式与桥接汇总

| 模式 | 入口 | 执行路径 | 输出流 |
|---|---|---|---|
| chat | queryLoop(mode:"chat") | bridge.streamChat(chat model) | llm_chunk → chat-view |
| talk | queryLoop(mode:"talk") | bridge.streamChat + persona（§5.1） | llm_chunk |
| plan | planMode | queryLoop(plan/reasoner) + metaAgent.plan 或 executeWithStream | plan_generated/node_*/task_tree_update |
| group | GroupChatManager + queryLoop | 单例管理多 agent 并发 | group 事件（ANSI 渲染被抑制） |
| command | commandMode | bridge.executeToolCall | tool_start/tool_result |

---

## 5. 对话循环解剖

### 5.1 query-loop.ts（402 行）完整逻辑

**入口**：`queryLoop(p: QueryLoopParams)` async generator（L213-439），yield `TuiEvent`，return `finalOutput: string`。

**流程**：

1. **System prompt 组装**（L215）：`assembleSystemPrompt(mode, agent)`（L170-192）——按 `(mode, agent)` 缓存；`butler`/`analysis` agent 用 persona 自包含（L160 复用 `agentTalkPersona`）。
2. **Persona 解析** `agentTalkPersona(agent)`（L87-130）5 级：枚举名 → 中文名 → id 自识别 → 盲试 → 回退昔涟；读取 `.cortex/lore/{agent}/persona-talk.txt`（L118）——**绕过 bridge 直连文件系统**（§8.2）。
3. **消息注入**：history（filter system）+ 当前 input（L149-151 由调用方构建）。
4. **模型路由**：`bridge.getChatModelName()`；plan 模式用 `getReasonerModelName()`（L223-230）。
5. **真流式**（L255-310）：`Promise.race` 竞速 `chunkQueue` 与 `wake()` 模式——onChunk 入队 → 队列非空即 yield `llm_chunk`；fetch abort 视为 `interrupted`（L254, L314-317）。`signal.aborted` 在回合边界检查（L317）。
6. **Token 统计**：yield `token_usage`（L310）。
7. **95% 压缩**（L354-394）：基于 `usage` 的 prompt_tokens 估算，超 `CONTEXT_LIMIT`（默认 500000，L247）触发 `compactMessages`（context-compactor.ts 5 层）→ yield `compaction` 事件 → 重发压缩后消息。
8. **工具循环**：assistant 消息含 `tool_calls` 时 → `streamExecuteTools`（L401-411，§5.3）→ 结果拼回 messages → 回到第 5 步；无 tool_calls → 结束，return finalOutput。
9. **回合上限**：`MAX_TOOL_ROUNDS`（L246）：plan 模式 `min(config, 5)`，其余取 `DEFAULT_MAX_TOOL_ROUNDS`（@cortex/config，支持 `CORTEX_MAX_TOOL_ROUNDS` env 覆盖，L242-244）。

**hooks 顺序**（TuiHooks 26 钩子调用点）：`onTurnStart` → `onPreToolUse`（streaming-tool-executor 内）→ `onToolStart`/`onToolResult` → `onChunk` → `onTokenUsage` → `onCompaction` → `onPlanGenerated` → `onInterrupted` → `onError` → `onTurnEnd`。

### 5.2 remote-query-loop.ts（237 行）—— 死代码确认

**差异**（vs query-loop.ts）：

| 维度 | query-loop.ts | remote-query-loop.ts |
|---|---|---|
| 引擎位置 | in-process（bridge 直连） | daemon 远端（CortexConnection WS） |
| 入口 | `queryLoop(p)` generator | `remoteQueryLoop(p)` generator（L74-279） |
| 通信 | bridge.streamChat | `conn.ws.startChat({input, mode, agent, sessionId, history})`（L110-121） |
| 事件订阅 | 无 | chat channel（chat.chunk/tool_start/tool_result/complete/error）+ gate channel（gate.request → onGateRequest → resolveGate，L143-172） |
| 工具执行 | 本地 streamExecuteTools | **daemon 端执行**，TUI 只收 tool_start/tool_result 事件 |
| 压缩 | 本地 5 层压缩 | 无（contextWindowSize: 500000 硬编码，L180） |
| maxRounds | 有（config 驱动） | 无 |
| cancel | createRemoteCancel（L289-293） | 同 |

**死代码判定**：`remoteQueryLoop` 全仓库 grep 仅命中自身定义与 `types.ts:160` 的字符串常量 `"remote-query-loop"`；无任何 import/调用。daemon 模式实际路径是 `main.ts:242-249` → `RemoteEngineBridge`（实现 `ITuiEngineBridge`）→ `remote-engine-bridge.ts` 的 `streamChat`（HTTP/WS 封装，非 remote-query-loop）。**结论：remote-query-loop.ts 是 v2 时代遗留的第二代 daemon 客户端，被 v3 的 RemoteEngineBridge 取代，可整文件删除。**

### 5.3 streaming-tool-executor.ts（182 行）

- `classifyCalls(calls)`（L50-59）：按 `reversibilityLevel(name)`（renderer/permission-dialog.ts 的 L1/L2/L3 分级）划分读/写；
- `streamExecuteTools(tools, ctx)`（L118-212）：
  - L1（读，12 个工具）**并行** `Promise.all`（L137-176）；
  - L2/L3（写）**串行**（L179-209），逐个执行；
  - `_checkPermission`（L66-79）调 `onPreToolUse`（即 app.tsx 的权限门控）；
  - assistant 消息含全部 tool_calls + reasoning_content（L133-134）；
  - 中断后不再发起新写操作（检查 aborted）。
- 设计意图：L1 读并行加速、L2/L3 写串行避免竞态。

---

## 6. web/ 子目录

### 6.1 index.ts（222 行）—— startWebUI 启动

- 端口：`options.port ?? CORTEX_WEBUI_PORT ?? 3001`（L109-110）；
- 组装：`StateAggregator(taskBoard, agentPool, panoramaTracker?, healthCollector?)`（L116-123）→ `APIRouter(...)`（L126-134）→ `WSGateway(port)`（L140）；
- 桥接：`gateway.bridgeObserver(observer)`（pipeline channel，L143）；`bridgeTuiEvents(tuiEventBus)`（tui channel，L146-148）；
- PipelineObserver 三级优先级订阅（L157-159）→ 同时喂 StateAggregator / recordEvent / PanoramaTracker；
- **静态服务指向 `tui/web/static/`（getStaticDir，L23-27）——目录不存在**；`createStaticHandler`（L32-82）实现 MIME 表 + 路径穿越防护（L51-56），但 `fs.existsSync` 恒 false → 恒返回 false → 404；
- HTTP 请求处理在 `gateway.start()` 后补 `server.on("request")`（L176-208）：API → 静态 → 404；CORS 预检（L188-197）；
- `startWebUI` **无生产调用方**（main.ts 未接线；仅 `tui/index.ts:103` barrel 导出）。

### 6.2 api-router.ts（430 行）全部路由

| 路由 | 方法 | handler 要点 |
|---|---|---|
| `/state` 或 `/` | GET | `stateAggregator.getSnapshot()` 全量 WebUIState（L268-271） |
| `/nodes` | GET | TaskBoard 全量节点 + 分页 + `?status=` 过滤（L274-286） |
| `/nodes/:id` | GET | 单节点；不存在 → RFC7807 404（L289-301） |
| `/agents` | GET | AgentPool 各类型状态聚合（L304-316） |
| `/agents/:type` | GET | 类型校验 + 单类型状态（L319-331） |
| `/health` | GET | healthCollector.snapshot()（L334-337） |
| `/execute` | POST | 请求体 1MB 限制（L344-355）→ input 非空校验（L400-410）→ **`engineBridge.executeToolCall("execute", {input})`**（L412） |
| `/events` `/events/recent` | GET | 最近事件环形缓存 + 分页 + `?type=` 前缀过滤（L417-428） |
| `/models` `/agents` `/keys` `/tuning` `/config/validate` `/config/version` | 委托 | config-api-handler.handle()（L180-182） |

路由框架：`/api/v1/*` 标准 + `/api/*` 向后兼容双前缀（L114-120）；RFC7807 Problem Details 错误（L226-231）；`X-Request-Id` 链路追踪（L208）；分页封装（L245-263）。

### 6.3 config-api-handler.ts（343 行）

- `/models`：CRUD 模型列表（L51）；`/agents`：agent 配置（L66）；`/keys`：**密钥永不明文返回**——`_maskKeys`（L295-309）只回 envVar 名 + `masked: true`；`/tuning`：调参（L93）；`/config/validate`：配置校验（L100）；`/config/version`：`PROTOCOL_VERSION`（L287，@cortex/protocol）。
- **协议消费点**：`import { PROTOCOL_VERSION } from "@cortex/protocol"`（L32）。

### 6.4 gateway.ts（396 行）—— 手写 WebSocket

- RFC6455 握手：SHA1 + WS_GUID（无 ws 依赖）；
- 帧解析 + mask XOR 4 字节块优化（L326-340）；
- 通道：`bridgeObserver`（pipeline channel）/ `bridgeTuiEvents`（tui channel，L160-167）；
- `broadcast(channel, payload)`（L172-179）；subscribe/unsubscribe 协议（L378-409）。

### 6.5 state-aggregator.ts（270 行）

- `getSnapshot()`（L127-216）：聚合 TaskBoard 节点 / AgentPool 状态 / HealthCollector 快照 / 事件计数（L226-231 分类）；
- 500ms 定时心跳广播（L262-273）+ 事件驱动增量更新；
- `subscribe` → web/index.ts L166 接到 gateway.broadcast("state")。

### 6.6 前端页面结构

**不存在**。`web/static/` 目录缺失；全仓无 `packages/cli/**/*.html`、无 CSS/JS 前端实体。WebUI 的 API/WS 后端完整但无前端消费方——**前端从未落地**（或前端在别处：无证据）。

---

## 7. 状态模型

### 7.1 SessionState（ink/session-reducer.ts:84-106）—— 唯一 Reducer 状态

```ts
interface SessionState {
  agent; messages; taskNodes; tokenUsage; mode;
  streamingContent;      // 流式输出缓冲（append 式）
  recentTools;           // 最近工具列表
  sessionRestored;       // 会话恢复标记
  isProcessing;          // 处理中（输入守卫）
  planNodes; planState;  // plan 状态
  visibleOffset;         // 滚动窗口
  pendingPermission;     // 权限挂起
}
```

25 种 action 要点（L110-140）：
- `SWITCH_AGENT`（L178-188）：清空 streamingContent/plan/tools/permission——**状态联动清空集中在 reducer**；
- `ADD_MESSAGE`（L197-213）：去重（按内容+role 判重，防事件总线重复投递）；
- `TOKEN_UPDATE`（L256-267）：累加；`COMPACTION`（L269-287）：重置计数；`TURN_INTERRUPTED`（L304-329）：幂等；`PLAN_GENERATED`（L333-343）：置 mode="plan"。

### 7.2 状态提升/分散全景

| 状态 | 位置 | 生命周期 |
|---|---|---|
| 会话消息/模式/agent/token | SessionState（reducer） | 进程内 + session-persistence autoSaver |
| 会话快照文件 | session-store.ts（.cortex/sessions） | 跨进程（另一套，与 reducer 无直接连接） |
| 群聊（groups/activeGroupId） | GroupChatManager 全局单例 | 进程内；**不持久化**（session-persistence.ts:57 写死 `groups: []`） |
| plan 状态 | plan-state.json（plan-mode.ts:53） | 跨进程 |
| 焦点/overlay 栈 | FocusManager 单例 | 进程内 |
| 快捷键 | KeyRegistry 单例 | 进程内 |
| 事件流 | TuiEventBus 单例 | 进程内 |
| WebUI 快照 | StateAggregator（独立于 SessionState） | 进程内 |
| agent 池/task board/health | engine 侧（ITaskBoard/IAgentPool/HealthCollector） | 引擎生命周期 |

**状态提升结论**：执行态（SessionState）集中，UI 态（焦点/面板）分散在 app.tsx 本地 state + FocusManager；群聊与 plan 是游离的第三/第四态。

---

## 8. 与 engine/daemon 契约边界

### 8.1 ITuiEngineBridge（packages/shared/src/tui-bridge.ts:16-50）

10 个必选 + 1 个可选方法：

| 方法 | 用途 | TUI 消费点 |
|---|---|---|
| `getChatModelName()` | 聊天模型 | query-loop L223 |
| `getReasonerModelName()` | 推理模型 | query-loop plan 路径 |
| `getToolDefs(agent)` | 工具定义 | streaming-tool-executor / command-mode |
| `streamChat(...)` | 流式 LLM | query-loop 核心 |
| `executeToolCall(name, args)` | 执行工具 | command-mode / web /execute |
| `chat(systemPrompt, msgs, opts)` | 非流式 | context-compactor L4 摘要 |
| `ensureTalkMemory/readTalkMemory/writeTalkMemory` | 昔涟记忆 | talk 模式 |
| `executeWithStream(nodes, onEvent)` | plan 执行 | plan-mode L168 |
| `getMetaAgent?()` | 甘雨规划 | plan-mode L203 |

**实现方**：`EngineBridge`（in-process，services/engine-bridge.ts:77 同时实现 `ICortexApi`）与 `RemoteEngineBridge`（daemon 模式，services/remote-engine-bridge.ts:48）。main.ts:242-249 按 `detectDaemon()` 二选一注入——**TUI 对引擎位置无感知**，这是正确的抽象边界。

### 8.2 绕过 bridge 直连底层的调用（文件:行号）

| 位置 | 直连内容 | 说明 |
|---|---|---|
| query-loop.ts:55,118 | `fs` 读 `.cortex/lore/{agent}/persona-talk.txt` | persona 文件 I/O 绕过 bridge |
| plan-mode.ts:53 | `fs` 读写 `.cortex/plan-state.json` | plan 状态持久化绕过 bridge |
| session-store.ts | `fs` 读写 `.cortex/sessions/*.json` | 会话快照绕过 bridge |
| group-chat.ts:229 | `process.stdout.write`（dissolveGroup） | 直写终端（被 monkey-patch 抑制的主要对象） |
| group-view.tsx:194-195 | 改写 GroupChatManager 方法 | monkey-patch 越过正常渲染接口 |
| web/index.ts:154-155 | `options.panoramaTracker?.onEvent` | 越过 pipeline 正式入口补喂 |

### 8.3 对 protocol 的消费

- `config-api-handler.ts:32,287`：`PROTOCOL_VERSION` 导出到 `/config/version`；
- remote-query-loop（死代码）消费 daemon WS channel 协议（chat/gate）；
- **TUI 主路径不消费 @cortex/protocol**——in-process 模式经 ICortexApi 直调，daemon 模式经 RemoteEngineBridge 序列化。

---

## 9. 重复与冗余

### 9.1 双轨渲染（v4 ANSI vs v5 Ink）

- `renderer/` 8 个文件仅 3 个仍被引用：`sigint-handler`（ink-entry）、`sanitize`（ink-entry/命令输出）、`permission-dialog` 的 `reversibilityLevel`/L1-L3 分级（streaming-tool-executor 与 app.tsx 权限门控）；
- `renderer/tool-log.ts:50,72` 渲染调用已注释（"纯流式模式"）；
- `group-chat.ts` ANSI `renderGroup`（L352-381 光标回退增量重绘）被 `group-view.tsx:195` 置为 no-op——**约 100 行死渲染路径**；
- `renderer/ansi.ts`（318 行）、`diff-viewer.ts`、`token-monitor.ts`、`tool-log.ts` 无活跃调用方。

### 9.2 双持久化

- `session-store.ts`（85 行，SessionSnapshot I/O）与 `ink/session-persistence.ts`（76 行，reducer 适配 + autoSaver）：会话恢复语义分裂——前者是 v3 遗留通用快照，后者是 v5 Ink 会话。`tui.test.ts`/`session-store.test.ts` 覆盖前者，后者无直接测试。

### 9.3 死代码/孤儿导出

| 项 | 证据 | 处置建议 |
|---|---|---|
| remote-query-loop.ts | 全仓无调用方 | 删除 |
| startWebUI | main.ts 未调用，仅 barrel 导出 | 保留为库导出或接线 |
| web/static 服务 | 目录不存在，恒 404 | 待前端落地或删除 |
| renderer/{ansi,diff-viewer,token-monitor,tool-log}.ts | 无活跃调用 | 删除（或等 v4 清理） |
| layout/adapter-ansi.ts | v4 布局（renderAnsiPanel/renderStatusBar） | 查引用后删除 |
| theme/adapter-ansi.ts + renderer/ansi.ts 复用 | 双 ANSI 原语集 | 合并 |
| intent-router.ts 桥接 | 向后兼容重导出 | 可删（直接 import 新管道） |
| GroupChatManager 单例 + group-view 双状态 | manager.messages 与 React state 双份 | 选一 |

### 9.4 hooks.ts 权限钩子名存实亡

```ts
// hooks.ts:32-36（defaultHooks.onPreToolUse）
return { decision: "allow" }  // 注释：L2/L3 由 ConfirmGate 接管
```
实际权限门控在 `app.tsx:338-362`（createExternalHooks）。talkHooks/partyHooks 恒 deny（禁工具）。**defaultHooks 的权限语义与 app.tsx 冲突，属冗余层**。

### 9.5 与 desktop/webui 的重复

| 能力 | TUI | Desktop | WebUI |
|---|---|---|---|
| daemon WS 客户端 | remote-engine-bridge（RemoteEngineBridge） | cortex-bridge.ts:23 `new CortexConnection` + streamChat | （无，直接 in-process bridge） |
| 流式 chat 薄壳 | query-loop streamChat | cortex-bridge.streamChat（L42-63） | /execute → executeToolCall |
| 会话持久化 | session-store + session-persistence | settings.json（ipc-handlers L72-102） | — |
| 状态聚合 | StateAggregator | presence-bridge（Live2D 存在感） | — |

Desktop 对 TUI 零引用（grep 0 命中），两者是 `@cortex/client` 的两个独立消费者；`RemoteEngineBridge`（CLI daemon 模式）与 `CortexBridge`（Desktop）实现同一模式的两套代码。

### 9.6 测试覆盖缺口

已读 tests/ 共 24 个文件，与 tui 相关：

| 覆盖良好 | 缺口 |
|---|---|
| query-loop.test.ts(630) / harness-turn(623) / harness-fault(568) | **remote-query-loop 无测试**（死代码佐证） |
| streaming-tool-executor.test.ts(385) / context-compactor.test.ts(539) | **web/ 全子目录无测试**（api-router/gateway/config/state-aggregator） |
| session-reducer.test.ts(423) / session-store.test.ts(207) | **ink/ 组件无测试**（app.tsx 518 行无单测） |
| intent-router 相关（含于 session-reducer/query-loop 测试） | **plan-mode 仅 FSM 测试**（modes/plan-mode-fsm.test.ts 81 行），生成/审批/执行全流程无覆盖 |
| key-bindings-registry.test.ts(273) / permission-dialog.test.ts(184) | **group-chat / group-view / web/index 无测试** |
| engine-bridge-*.test.ts(191/151) / remote-engine-bridge.test.ts(85) | interaction/（focus/key-registry 部分）缺测试 |

---

## 10. 可下沉原语候选 + 重写影响面

### 10.1 本质是「交互底座」的逻辑与当前耦合位置

| 原语候选 | 当前位置 | 与 UI 耦合度 | 下沉目标 |
|---|---|---|---|
| 对话循环（消息组装/tool 循环/压缩/中断） | query-loop.ts（402 行） | **低**——纯 generator + bridge + hooks，不 import 任何 Ink 组件 | 可直接提取到独立 `core/` 或 @cortex/shared 旁的执行层 |
| 工具流式执行（L1/L2/L3 读写分批） | streaming-tool-executor.ts（182 行） | 低（onPreToolUse 钩子注入） | 同上下沉 |
| 上下文压缩 5 层 | context-compactor.ts（409 行） | 低 | 同上下沉 |
| 意图分类管道 | intent-router/（8 文件 539 行） | **零**——纯函数管道 | 立即可下沉 |
| 生命周期钩子 26 个 | hooks.ts（73 行）+ types.ts TuiHooks | 低 | 随循环下沉 |
| 事件协议（TuiEvent 14 种 + TuiEventBus） | event-bus.ts + types.ts | 低 | 作为统一事件面下沉（Desktop/WebUI 可复用） |
| plan 集成（FSM/生成/审批/执行） | plan-mode.ts（264 行）+ app.tsx 审批短路（use-input-handler L94-134） | **中**——审批词匹配在 UI 层，plan 状态在 reducer | FSM + 生成/执行可下沉；审批词判定保留 UI |
| 权限门控（L1-L3 + ConfirmGate） | app.tsx:338-362 createExternalHooks + renderer/permission-dialog.ts | **高**——PERMISSION_REQUIRED 挂起 Promise 在组件内 | 提取为可注入的 Gate 控制器（组件仅渲染） |
| 会话持久化 | session-persistence.ts + session-store.ts | 中 | 合并为单一存储层 |
| 群聊状态与渲染 | group-chat.ts（457 行，ANSI 渲染残留） | 高（monkey-patch 反证） | 清掉 ANSI 渲染后，仅保留状态机 |

### 10.2 底座重写后 tui/ 各文件处置

**保留（纯 UI 基建，与底座无关）**：
- ink/ 全部展示组件（chat-view/status-bar/task-tree/diff-block/input-bar/splash/command-palette-view/permission-prompt 渲染部分）
- interaction/（key-registry/focus-manager/command-palette + hooks）
- layout/、theme/、animation/ 全部
- ink-entry.tsx（启动接线，改为装配新底座）

**改造（保留文件但重构内部）**：
- app.tsx（518 行）：拆分为 布局壳 + 权限 Gate 控制器 + 命令上下文；执行委托移出
- ink/session-reducer.ts：会话状态瘦身（plan/tools/permission 相关移出或保留为派生状态）
- ink/session-persistence.ts：与 session-store 合并
- ink/hooks/use-input-handler.ts：审批短路改为调用下沉后的 planMode 服务
- web/：若保留 WebUI，接线 startWebUI 到 main.ts；补齐前端或明确下线
- modes/plan-mode.ts：FSM 与执行下沉，UI 侧仅保留状态订阅

**删除**：
- remote-query-loop.ts（死代码）
- renderer/{ansi,diff-viewer,token-monitor,tool-log}.ts（v4 遗产）
- group-chat.ts 的 ANSI renderGroup/dissolveGroup stdout 路径（保留状态机或整体迁入下沉底座）
- hooks.ts 的 defaultHooks 权限恒 allow 段（与 app.tsx 门控二选一）
- intent-router.ts 桥接（直接使用 intent-router/ 新管道）
- web/static 服务段（目录不存在）或补前端

**下沉后新文件形态**（在 tui/ 外，如 packages/cli/src/core/ 或独立包）：
```
core/loop.ts            （query-loop + remote 变体合一，bridge 无关化）
core/tool-executor.ts   （streaming-tool-executor 原样迁移）
core/context.ts         （context-compactor 原样迁移）
core/intent.ts          （intent-router 管道原样迁移）
core/events.ts          （TuiEventBus + TuiEvent 协议）
core/hooks.ts           （TuiHooks 26 钩子类型 + 默认实现）
core/plan-fsm.ts        （plan-mode 的 FSM + 生成/执行）
core/session.ts         （会话模型 + 持久化合并）
core/gate.ts            （权限门控控制器，UI 无关）
```

### 10.3 重写风险提示

1. **app.tsx 是唯一事实执行编排点**：use-input-handler → queryLoop/planMode 的调用链、abort 信号、事件总线转发全部经 app.tsx/ink-entry 注入——下沉时必须先固定 `TuiEvent` 协议与 `TuiHooks` 顺序（tests 已锁定 query-loop 行为，可作为回归基线）；
2. **权限门控的 Promise 挂起**（app.tsx:329-335 resolver 释放）是已知脆弱点（曾修复挂起），下沉时需改为显式 Gate 状态机；
3. **双持久化合并**需迁移 .cortex/sessions 格式，注意 session-store.test.ts 的既有契约；
4. **group 群聊**的 manager 单例 + monkey-patch 是历史债，下沉时直接以「状态机 + 事件」重写，不要保留 ANSI 渲染路径。

---

*报告生成：2026-08-02 · 证据源：packages/cli/src/tui/ 全部 90 文件逐文件阅读 + 交叉引用 packages/shared、packages/desktop、tests/*（行号以本次阅读为准）*
