# Cortex TUI v2 设计终稿

> 综合 A(时序+渲染推演) B(布局设计) C(交互逻辑) D(反推演/代码对照)
> 以代码现实为锚——所有组件名、差距、迁移路径均对应实际文件

---

## 一、现状诊断

### 实际组件清单（对照代码）

| 组件 | 文件 | 状态 |
|------|------|:--:|
| DiffRenderer | renderer/diff-renderer.ts | ✅ |
| Layout (fill/bottom 两层) | renderer/layout.ts | ✅ |
| ChatLog (流式消息) | renderer/chat-log.ts | ✅ |
| StatusBar (spinner+计时) | renderer/status-bar.ts | ✅ |
| Footer (信息条) | renderer/footer.ts | ✅ |
| OverlayManager (单弹窗) | renderer/overlay.ts | ✅ |
| TaskTreeRenderer | renderer/task-tree.ts | ✅ |
| ToolCard (三态卡片) | renderer/tool-card.ts | ✅ |
| SigintHandler (三段式) | renderer/sigint-handler.ts | ✅ |
| TuiEventBus (pub-sub) | event-bus.ts | ✅ |
| TokenMonitor | token-monitor.ts | ✅ |
| PersonaHeader (writeln 直出) | persona-header.ts | ⚠️非 TuiComponent |
| TuiHooks (26 Hook, 全 no-op) | types.ts + hooks.ts | ⚠️仅定义 |

**未实现的关键组件**: FocusRouter, InputPipeline(KeyParser+StdinBuffer), OverlayStack(多弹窗), ViewportCoordinator(空间分配)

### 两条断裂

1. **事件层**: PipelineObserver(引擎) ↛ TuiEventBus(TUI)——引擎事件不驱动 UI 刷新
2. **交互层**: readline 独占 stdin——组件(Overlay/TaskTree)无法接收独立键盘事件

### 差距清单（按反推演实际发现）

🔴 可立即修（不改架构，6 项，~30分钟）:
| # | 问题 | 位置 |
|---|------|------|
| F1 | chatLog.addUser() 从未调用——用户消息不可见 | tui-repl.ts: chat/talk/plan case |
| F2 | 回复截断到 80 字符——全文丢失 | tui-repl.ts:328,338,348 |
| F3 | plan_generated 事件无人订阅 | tui-repl.ts: _bindTuiEvents |
| F4 | 模式切换不清理 toolCard/taskTree/overlay | tui-repl.ts: handleInternalCommand("mode") |
| F5 | talk 模式未传 talkHooks（工具调用未阻止） | tui-repl.ts:343 |
| F6 | 切换出 plan 不清理 planState | tui-repl.ts:457 |

🟡 需架构改动（7 项）:
| # | 问题 | 涉及模块 |
|---|------|---------|
| A1 | PipelineObserver→TuiEventBus 桥接 | engine-bridge, event-bus, tui-repl |
| A2 | DiffRenderer 整帧渲染→真正行级差分 | diff-renderer.ts |
| A3 | OverlayManager→OverlayStack(多弹窗+焦点隔离) | overlay.ts |
| A4 | ConfirmGate 对接 TUI Overlay（不走 raw stderr） | confirm-gate, overlay, tui-repl |
| A5 | PlanModeState 状态机（非法流转检测） | plan-mode.ts, tui-repl.ts |
| A6 | TaskTree 键盘交互（j/k/Space/Enter） | task-tree.ts |
| A7 | PersonaHeader→TuiComponent（纳入 DiffRenderer） | persona-header.ts |

🔵 Core-3 依赖（4 项）:
| # | 问题 | 依赖 |
|---|------|------|
| C1 | readline→raw stdin (InputPipeline) | Pi TUI StdinBuffer + Kitty协议 |
| C2 | FocusRouter 焦点栈 | raw stdin 就位后才能做 |
| C3 | 三省审议实质化（凝光/钟离/霜凝激活） | Committee session 机制 |
| C4 | ButlerAgent 管家层（通知铃/调度心跳） | 独立进程通信 |

---

## 二、目标架构

### 终端四层分区（演进后）

```
┌── Header(1行) ───────────────────────────────────┐
│  🧪 阿贝多 [code] · 首席炼金术士    📋 planning │
├── Viewport(fill) ────────────────────────────────┤
│                                                    │
│  ┌ ChatLog ────────────────────────────────────┐  │
│  │ ▶ 用户输入                                    │  │
│  │ ◆ AI 回复（软换行，终端宽度自适应）             │  │
│  │   ┌ ToolCard: read_file ────┐ (内联可折叠)   │  │
│  │   │ ✅ 12ms · 245 lines       │                │  │
│  │   └─────────────────────────┘                │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌ TaskTree (plan模式) ────────────────────────┐  │
│  │ 📋 任务计划 (3 节点)                          │  │
│  │  ✓ code: 初始化结构                           │  │
│  │  ⏳ review: 代码审查                           │  │
│  │  ○ test: 运行测试                              │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
├── Overlay(cover) ────────────────────────────────┤
│  GateDialog / AgentSelector / PermissionDialog     │
├── StatusBar(1行) ────────────────────────────────┤
│  ⠋ LLM 思考中 · 12s                               │
└── Footer(1行) ───────────────────────────────────┘
   mode: plan | agent: meta
```

### 组件树（演进后）

```
App
├── PersonaHeader (TuiComponent)       ← 现在: writeln 直出
├── ViewportCoordinator (新增)          ← 现在: Layout flat 堆叠
│   ├── ChatLog                        ← 已有，需加软换行+内联ToolCard+滚动
│   │   └── ToolCard (内联)            ← 现在: 独立 fill 组件
│   └── TaskTree                       ← 已有，需加键盘交互
├── OverlayStack (新增)                 ← 现在: OverlayManager 单弹窗
│   ├── GateDialog
│   ├── AgentSelector
│   └── PermissionDialog
├── StatusBar                          ← 已有
└── Footer                             ← 已有
```

### ViewportCoordinator 空间分配（演进后）

```
H = 终端行数
固定: Header(1) + StatusBar(1) + Footer(1) = 3
viewport = H - 3

按模式分配:
  chat/talk:  ChatLog 占 viewport
  plan:       TaskTree 70% + ChatLog 30% (ChatLog 最少 5 行)
  overlay:    viewport 缩小 35%，Overlay 占释放空间
```

---

## 三、交互模型

### 状态机（Plan 流程——基于 real code）

```
idle ─→ plan_gen ─→ plan_ready ─→ approved ─→ executing ─→ gate ─→ done ─→ idle
  │        │           │             │            │           │
  └─Ctrl+C→idle        └─Ctrl+C→idle              └─Ctrl+C→abort→idle

每态标注 stdin 归属 + 渲染内容（见 C 三-场景1）
```

其他流程（Talk/Overlay/ModeSwitch）见 C 三-场景2/3/4。

### InputPipeline（演进后——Core-3）

```
StdinBuffer (raw bytes → key events)
  → KeyParser (VT100/xterm → KeyEvent)
    → ListenerChain (global shortcut → mode filter → focused)
      → FocusRouter (焦点栈, LIFO)
        → Component.handleKey()
```

当前: readline.on("line") → _dispatchTuiMode。无焦点栈、无 raw mode。

### 事件总线（演进后）

| 事件 | 来源 | 消费 | 现状 |
|------|------|------|:--:|
| llm_chunk | queryLoop | ChatLog 流式追加 | ✅ |
| tool_start/result | executeTools | ToolCard 更新 | ✅ |
| node_transition | Scheduler | TaskTree 刷新 | ✅ |
| plan_generated | planMode | TaskTree 构建 | ❌ F3 |
| overlay_show/dismiss | OverlayStack | FocusRouter 切换 | ❌ A3 |
| engine_error | PipelineObserver | StatusBar+Overlay | ❌ A1 |
| system_resize | process.stdout | Layout 重分配 | ✅ |

### 异常恢复

1. **引擎崩溃**: consumeGenerator catch → statusBar.stop → stdin drain → 回 idle
2. **stdin 竞态**: while(process.stdin.read()) drain + sigint.reset → 回 idle（当前已实现）
3. **resize**: Layout.setTerminalSize → 全量差分重绘（当前已实现）

---

## 四、演进路径

### 对照（修正错误数据）

| 维度 | Pi | OpenClaw | Claude Code | Cortex 现在 | Cortex v2 |
|------|-----|----------|-------------|------------|-----------|
| 输入 | raw stdin | readline | raw stdin | readline | raw stdin |
| 渲染 | 差分引擎 | 差分引擎 | 流式追加 | 绝对定位差分 | 真差分 |
| 组件 | Container树 | ChatLog+ToolCard | 单列流 | Layout flat | 树+FocusRouter |
| Overlay | OverlayStack | 插件审批 | 内联覆盖 | 单弹窗 | OverlayStack |
| 帧调度 | 16ms throttle | 即时渲染 | 即时 | nextTick | 16ms throttle |

### P0: 即刻修复（30 分钟，不改架构）

F1-F6 全部修:
- chatLog.addUser(input) 在每个 dispatch case 的 consumeGenerator 之前
- 去掉 .slice(0,80)
- _bindTuiEvents 加 plan_generated 订阅
- mode switch 加 toolCard/taskTree/overlay/planState 清理
- talk case 传入 hooks

### P1: 组件规范化（1-2 天）

- PersonaHeader → TuiComponent（纳入 DiffRenderer）
- ChatLog 软换行（终端宽度自适应，不再 80 字符硬截断）
- ToolCard 内联到 ChatLog（助手消息内渲染卡片）
- PlanModeState FSM（状态转移表替代手动 bool 赋值）

### P2: 差分引擎升级（2-3 天）

- 双缓冲区（front/back buffer）
- 仅输出变化行
- CSI 2026 同步锁防撕裂
- viewport 追踪（滚动/新增/删除自适应）

### P3: OverlayStack + Gate 对接（2-3 天）

- OverlayManager→OverlayStack（push/pop 多弹窗）
- ConfirmGate 走 OverlayStack（不再 raw stderr 透传）
- Overlay 焦点捕获（show 时暂停 readline，dismiss 恢复）

### P4: PipelineObserver 桥接（1-2 天）

- engine-bridge 中 subscribe PipelineObserver → 转发 TuiEventBus
- TUI 订阅引擎事件（node/error/lifecycle）→ 驱动 UI 刷新

### P5: raw stdin（Core-3，2-3 天）

- readline→ProcessTerminal（Pi 引擎）
- StdinBuffer + KeyParser
- FocusRouter 焦点栈
- Kitty 键盘协议

**总计（不含 P5）: 6-11 天**

---

## 五、即刻行动

按反推演实际发现——6 项全修，30 分钟:

| # | 文件 | 改动 |
|---|------|------|
| F1 | tui-repl.ts:chat/talk case | consumeGenerator 前加 chatLog.addUser(input) |
| F2 | tui-repl.ts:328,338,348 | 去掉 .slice(0,80)，用 sanitizeRenderableText 净化全文 |
| F3 | tui-repl.ts:_bindTuiEvents | 加 tuiEventBus.on("plan_generated", ...) → taskTree + ChatLog |
| F4 | tui-repl.ts:handleInternalCommand("mode") | 加 toolCard.clear()+taskTree.reset()+overlay.dismiss() |
| F5 | tui-repl.ts:343 | talkMode 调用传入 hooks 参数 |
| F6 | tui-repl.ts:457 | 切换出 plan 时 clearPlanState+reset session.planState |

**顺序**: F1→F2(并行) → F3→F4→F5→F6 → 立即开始 P1
