# Cortex 三端（CLI / TUI / 桌面端）工程落地化论证与技术路线论证

> 撰写：2026-08-11 ｜ 配套：docs/analysis/audit-full-2026-08-11.md（全量审计）
> 方法：30 包全包扫描 + 三端并行源码深潜 + 既有审计基线（06-20 解剖 / 08-05 全量 / 08-07 桌面端）对比
> 定位：为 Core-3 阶段的交互层决策提供可执行的论证——每条路线均给出方案对比、落地步骤、证据、收益成本与验证方式

---

## 〇、总纲：三端一体化的收敛判断

Cortex 交互层当前的架构事实（2026-08-11 实测）：

```
            ┌─────────────────────────────────────────────┐
            │               @cortex/server (daemon)        │
            │   engine 唯一宿主 · REST 15 路由 · WS 11 通道 │
            └───────────────┬─────────────────────────────┘
                            │ HTTP + WS（手写 RFC6455 网关）
              ┌─────────────┼──────────────┬───────────────┐
              ▼             ▼              ▼               ▼
     ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐
     │  CLI (冻结) │  │   TUI     │  │  Desktop   │  │  WebUI(无)   │
     │ 17 命令     │  │ Ink 5 体系 │  │ Electron   │  │  设计稿存在   │
     │ 双宿主桥    │  │ +ANSI 残留 │  │ 双窗+Live2D│  │  未落代码     │
     └────────────┘  └───────────┘  └────────────┘  └──────────────┘
              ▲             ▲              ▲
              └─────────────┴── @cortex/client SDK（28 REST + WS）──┘
```

**核心判断**：daemon 化收敛已是既定方向（2026-08-06 冻结决策），三端未来的正确形态是**共享 client SDK 的瘦客户端群**。当前主要矛盾不是"做不做"，而是三端各自积累的**历史债清理次序**与**协议面收敛**。论证顺序：CLI（清理降格）→ TUI（收敛深化）→ 桌面端（补全落地），最后给出合并路线图。

---

## 一、CLI 端：降格为薄 daemon 客户端的完整论证

### 1.1 现状事实（代码证据）

| 维度 | 事实 | 证据 |
|---|---|---|
| 冻结声明 | package.json 描述："冻结状态（2026-08-06）——daemon 唯一宿主，CLI 内嵌 engine 第二宿主路径已冻结——仅安全修复，R14 起审计不覆盖" | packages/cli/package.json |
| 入口门控 | `isDirectRun()` 命中即打印废弃提示并 `process.exit(0)`，仅 `CORTEX_ENABLE_CLI=1` 才执行 | main.ts:337-349 |
| 双宿主 | 内嵌路径：bootstrapLlm→Toolkit→bootstrapMcp→EngineBridge.setBootstrapConfig（622 行）；远程路径：detectDaemon(3210)→RemoteEngineBridge（407 行） | main.ts:170-191、services/engine-bridge.ts、services/remote-engine-bridge.ts |
| 命令体系 | 17 个注册命令（run/agent/task/memory/config/schedule/roundtable/confirm/skill/inspect/doctor/doc/setup/version/help/eval/status），工厂模式 | commands/command-list.ts:40-126 |
| 依赖面 | 15 个 workspace 包 + ink/react 三件（仅 TUI 用） | package.json dependencies |
| 死代码 | platform.ts 整文件、talk 三件套、rebootstrapIfNeeded、_currentRollbackTaskId（恒 "executeToolCall"）、子命令查表死分支等 10+ 处 | 审计 D8 |

### 1.2 技术路线方案对比

| 方案 | 内容 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A. 维持冻结不动** | 保持现状，仅安全修复 | 零成本 | 冻结边界无执行载体（D3）；死代码与双宿主持续腐化；TUI 演进受限（同包内） | ❌ 不可持续 |
| **B. 降格改造（推荐）** | 删除内嵌 engine 路径，CLI 变为纯 RemoteEngineBridge 客户端 + 命令壳；TUI 独立逻辑继续演进 | 依赖面 15→4（client/shared/config/protocol）；死代码批量清除；冻结边界实体化；与 daemon 化方向一致 | 离线模式（无 daemon）不可用——需 daemon 常驻 | ✅ 推荐 |
| **C. 整体删除 cli 包** | TUI 迁入独立包或 desktop，命令能力并入 daemon | 最彻底 | TUI 失去终端入口（与"CLI 与 IDE 同一灵魂"的既定原则冲突）；命令体系需重建 | ❌ 过度 |

**推荐 B 的依据**：① 远程路径已是 daemon 可用时的唯一实际路径（main.ts 探测到 daemon 即跳过全部本地初始化）；② 内嵌路径的装配与 engine 正式 bootstrap 分叉（MiniAgentPool 手工拼装），属于已确认的"第二实现"——正是 Core-3 目标 1（消除重复实现）的直接消灭对象；③ 冻结声明本身预示了 B，只是未执行。

### 1.3 落地步骤（B 方案）

```
Step 1  冻结边界实体化（0.5 天）
  - ci-gate.ts 登记 cli 冻结包清单 + src 变更白名单门禁（D3 修复）
  - cli/PACKAGE_POSITIONING.md 重写为冻结后定位（消除 D11 漂移）

Step 2  死代码清除（1 天，删即可，无行为影响——均为无引用/无赋值项）
  - 删 platform.ts / talk 三件套 / rebootstrapIfNeeded / fetchToolDefs / setCurrentAgent
  - 删 injectAgentManifestsToRegistry / getConfigStores / _currentRollbackTaskId
  - 删 roundtable join stub、inspect report 空壳、CommandRegistry 子命令死分支
  - 删 bootstrap/{llm,mcp,config}.ts（本地引擎装配全部移除，main.ts:170-191 删除）

Step 3  资产下沉（1-2 天）
  - serializeMsg（LlmMessage→DTO）→ 下沉 @cortex/client（协议面能力，桌面端同样需要）
  - detectDaemon → 下沉 @cortex/client（三端共用探测逻辑）
  - deepMerge/_searchUp → 并入 @cortex/config（D4 配置双轨修复）
  - SlashCommandParser → 下沉 @cortex/skill-kit（通用交互底座）

Step 4  命令壳瘦身（1 天）
  - 命令保留 17 个但全部改走 RemoteEngineBridge；依赖裁剪至 client/shared/config/protocol
  - status.ts 端口硬编码改走 config（D4 双源修复）
  - help.ts 幽灵命令清除（cortex repl / daemon start——D11）

Step 5  验证
  - CI 全绿（含新增的冻结白名单门禁）；TUI 全功能走 daemon 回归；`CORTEX_ENABLE_CLI` 门控移除
```

### 1.4 收益与成本

- **收益**：依赖面 15→4；死代码 10+ 处清除；"双宿主"从代码事实变为历史；冻结边界从声明变为门禁；CLI 与 desktop 共享 client 层后维护面收敛。
- **成本**：约 4-5 人日；离线模式消失（daemon 是唯一宿主——本就如此，daemon 可 `cortex-daemon` 一键拉起）。
- **风险**：TUI 依赖 cli 包内的服务层——Step 3 下沉期间 TUI 需同步改 import；建议 Step 2/3 合并执行避免中间态。

---

## 二、TUI 端：保持 Ink 5、收敛双体系、补齐测试

### 2.1 现状事实（代码证据）

| 维度 | 事实 | 证据 |
|---|---|---|
| 渲染体系 | Ink 5 组件体系（app/chat-view/status-bar/input-bar/task-tree/group-view/permission-prompt/splash/command-palette，约 40+ 文件）与旧 ANSI 直写体系（renderer/ 8 文件）并存 | packages/cli/src/tui/ |
| 交互协议 | `TuiEvent` 14 种联合类型；intent 路由（classifyIntent→task/command/chat 三分类）；ITuiEngineBridge 契约；TuiHooks 对标 Claude Code 26 Hook 的 8 组 | tui/types.ts:28-42、tui/intent-router.ts、shared/tui-bridge.ts |
| 流式渲染 | ink@5.2.1 补丁（eraseLines→cursorUp+eraseDown，Windows ConHost 修复）；50ms chunk 节流（createChunkThrottle）；STREAM_SET 全量覆盖防丢字；中断消息过滤 | patches/ink@5.2.1.patch、use-input-handler.ts:49-84/219-232 |
| v2 设计落地度 | P0 六项基本落地（plan_generated 订阅修复、MultiLineText、事件桥）；P5（raw stdin/Kitty）纸面 | cortex-tui-v2-final-design.md 逐项核对 |
| 测试 | reducer/键位/事件总线/权限对话框/query-loop 已覆盖（测试文件 10+）；**零 .tsx 组件测试、use-input-handler 零覆盖** | packages/cli/tests/ |
| 渲染入口 | startInkTui()；main.ts 在 INK_MODE 下 stdout 重定向 engine.log、抑制 console.log | tui/ink/ink-entry.tsx:36、main.ts:115-150 |

**Claude Code 对标落地度**（既有对标清单逐项核对）：

| 对标能力 | 落地状态 | 代码证据 |
|---|---|---|
| 会话持久化（退出保存/恢复） | ✅ 已落地 | tui/ink/session-persistence.ts |
| 5 层上下文压缩管线 | ✅ 已落地（渐进压缩，不触 persona 本体） | tui/context-compactor.ts |
| StreamingToolExecutor 并发（读并行/写串行） | ✅ 已落地 | tui/streaming-tool-executor.ts |
| 26 个可编程 Hook 生命周期 | 🔶 8 组已定义（会话/请求/压缩/错误/输入/模式/流式/节点），扩展面保留 | tui/types.ts:187-256（TuiHooks） |
| 子 Agent 消息摘要化（防共享历史膨胀） | ❌ 未落地——群聊历史直接共享 | group-chat.ts |
| Todo/进度面板 | 🔶 TaskTree 组件已有雏形 | tui/ink/task-tree.tsx |
| 权限对话框 UX | ✅ 已具备（ConfirmGate 基础 + PermissionPrompt） | tui/ink/permission-prompt.tsx |

> 对标结论：7 项中 4 项已落地、2 项有雏形、1 项（子 Agent 摘要化）空白——差距集中在群聊深化的历史治理，与 v2 设计 P3（群聊架构）同向。

### 2.2 技术路线方案对比

| 方案 | 内容 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A. 保持 Ink 5，收敛清理（推荐）** | 清 ANSI 死代码；SET_MODE 清理；补组件测试；远程路径优先 | 两轮重构资产（补丁/节流/reducer/动画）全部保留；成本低；风险小 | 无 raw stdin（键位能力上限受 Ink 约束） | ✅ 推荐 |
| **B. 迁移 xterm.js/自研渲染** | 替换 Ink，接 raw stdin + Kitty 协议 | 键位协议完全自主（v2 设计 P5 目标） | 放弃两轮重构资产；重写渲染层（月级）；与"冻结中 cli 包"耦合冲突 | ❌ 现阶段否定 |
| **C. TUI 迁出 cli 为独立包** | 新 packages/tui，clients 依赖 | 解耦冻结包；独立演进 | 大迁移；与降格改造（CLI 路线 Step 2/3）顺序冲突——先清后迁更优 | ⏸️ 降格完成后再评估 |

**推荐 A 的依据**：① 流式/Windows 终端问题已围绕 Ink 建立完整防御栈（补丁+节流+覆盖+动画），迁移收益低；② v2 设计"真差分引擎"与 Ink reconcile 语义重复——设计文档自身已承认；③ 用户可见价值优先在"远程路径完善 + 测试补齐"，而非渲染底层更换；④ 若未来确需 Kitty 级输入（Core-3 之后），可评估 `useStdin` 原始字节流旁路，不必全量迁移。

### 2.3 落地步骤（A 方案）

```
Step 1  双体系收敛（1 天——D1 修复）
  - 按 tui/ink/ 引用关系清点 renderer/ 未被引用文件（权限路径收敛为 PermissionPrompt 单一实现）
  - token-monitor/tool-log 若被引用则迁移为 Ink 组件，否则删除
  - 清点 event-bus/query-loop 与 ink 体系的接线，明确唯一入口

Step 2  reducer 状态机补全（0.5 天——D6 修复）
  - SET_MODE 附带 planState/toolCard/overlay 复位（对齐 v2 设计 F4/F6）

Step 3  测试补齐（2-3 天——D9 修复）
  - use-input-handler 核心分发链（257 行）——最高优先
  - FocusManager / CommandPaletteController / intent-router pipeline
  - App 组件依赖注入化后做渲染级测试（ink-testing-library 或帧断言）

Step 4  远程路径深化（与 CLI 降格协同）
  - remote-query-loop 事件映射与本地 query-loop 共享一致性测试
  - 50ms 节流改为可配置 + 背压统计（消除硬编码）

Step 5  P5 评估（Core-3 决策点）
  - 若群聊/多 Agent 交互需要序列键与组合键，评估 useStdin 原始字节流旁路方案
  - 输出评估结论后再决定是否动 Ink input 层
```

### 2.4 收益与成本

- **收益**：权限路径单实现（安全关键）；模式切换状态污染消除；核心分发链从零覆盖到有门禁；远程/本地事件一致性可自动验证。
- **成本**：约 5-7 人日。
- **风险**：Step 1 清 ANSI 残留时若误删被引用文件（如 sigint-handler 被 ink 层复用）——先跑引用扫描再删；Step 3 组件测试需 app.tsx 依赖注入化改造（572 行），建议注入面最小化。

---

## 三、桌面端：协议对齐 → client 原语 → 画布式落地

### 3.1 现状事实（代码证据）

| 维度 | 事实 | 证据 |
|---|---|---|
| 包结构 | desktop（Electron 双窗）/ client（SDK 7 文件）/ server（daemon 单类编排）/ protocol（纯类型，零运行时依赖）四层 | packages/{desktop,client,server,protocol} |
| Electron | 双窗：mainWindow 600×800 桌宠窗 + chatWindow 1180×800 聊天窗；contextIsolation:true / sandbox:false（R13 归因 ESM preload） | main/index.ts、preload/index.ts |
| Live2D | PIXI 管线 + 动态 import pixi-live2d-display/cubism4；点击穿透（readPixels alpha 采样）；拖拽冻结 ticker 防重影 | renderer/live2d/* |
| Presence | 12 条时序规则 + 14 种事件映射 + 三态空闲行为 + 五阶段 boot 序列（**boot-sequence 从未实例化**） | renderer/presence/* |
| client SDK | 28 REST 方法（http-client.ts 实测）+ WS 订阅（指数退避重连/发送队列/订阅恢复） + streamChat 高层封装 | client/src/* |
| daemon | 手写 RFC6455 WS 网关 + 15 REST 路由 + 会话 GC + gate-bridge（300s 超时自动拒绝）+ 通知桥 | server/src/* |
| 画布式 UI | 唯一持久项（对话流+通知铃+状态机 34/34 测试）落地；**瞬态组件层几乎为零**（无任务树/圆桌/修宪 diff）；设置面板已接真（settingsData 覆盖静态值，静态仅 fallback——F12 修正） | renderer/chat/ChatView.tsx:348-362 |

### 3.2 技术路线方案对比（桌面端演进）

| 方案 | 内容 | 优点 | 缺点 | 判定 |
|---|---|---|---|---|
| **A. 四层收敛 + 画布增量落地（推荐）** | 先修协议裂口（D2）与双份维护（D5），再补 client 原语（确认门/通知 ack），最后以"事件管线+确认门+任务树"三块瞬态组件兑现画布式 UI | 每步独立可验证；与 Core-3 目标 5（配置外化）同向 | 画布式 UI 落地周期长（需分阶段） | ✅ 推荐 |
| **B. 全量画布式重写** | 按 webui-architecture-design 六面板直接重写 renderer | 一步到位 | 协议面未修时上层无意义；风险大；与"痛点驱动"原则（阶段跃迁三原则 B）冲突 | ❌ 否定 |
| **C. 保持 IM 现状** | 只修缺陷不动结构 | 最小成本 | 画布式 UI 长期停留在设计稿；宪法同构（瞬态组件）无法兑现 | ❌ 与既定架构原则冲突 |

**推荐 A 的依据**：① 画布式 UI 的宪法同构意义（瞬态组件=事件驱动生命周期）依赖底层事件流稳定——先修协议裂口是前置条件；② client 原语（resolveGate/ackNotification）是 desktop 与未来 webui 的共同依赖，先补原语再建 UI 可复用；③ 阶段跃迁三原则（数据驱动/痛点驱动/测试匹配）明确禁止在未稳定的协议面上堆 UI。

### 3.3 落地步骤（A 方案）

```
Step 1  协议对齐（1-2 天——D2 修复）
  - 决策：补齐 daemon 的 models/keys/tuning/events/config 路由 vs client 收敛方法集
  - 推荐：先收敛 client（capabilities 声明 false 的方法降级为显式 NotSupportedError），路由补齐作为 P2
  - 加契约测试：client 方法集 ⊆ daemon 路由 ∩ capabilities 声明（防再次裂口）

Step 2  桌面端收敛（1-2 天——D5/D10 修复）
  - IPC_CHANNELS 单一来源（preload 导出，renderer import）
  - Presence 类型改由 WSServerEventByChannel 派生；删 boot-sequence 或接线；删 global.d.ts 未暴露接口
  - WS 令牌统一为 ~/.cortex/ws-token 文件路径解析（消除双通道）
  - init(projectRoot) 参数语义对齐（daemonPort?）

Step 3  client 原语补全（1-2 天——D7 修复）
  - 确认门 UI 封装：resolveGate 高层 API + ChatView 确认列表（resolve/reject 按钮）
  - 通知 ack 接入：desktop 收 notification 后回执 ackNotification（S2-12 闭环）
  - gate 分级视觉化：READ_ONLY 白名单（13 工具免确认）之外按 L1/L2/L3 分级展示（webui 设计稿要求）

Step 4  画布式增量落地（3-5 天，分三块）
  - 第一块：事件管线面板（pipeline/state 通道 → 滚动事件流，瞬态浮现）
  - 第二块：确认门面板（Step 3 的 UI 容器化，gate.request 浮现、resolve 消隐）
  - 第三块：任务树面板（node_start/node_complete → 树状任务卡片，完成即消失）
  - 每块独立可验证：瞬态组件"产生即出现、结束即消失"为验收标准

Step 5  验证
  - message-state-machine 测试扩展至确认门/任务树状态；presence-bridge 事件转换单测补齐
  - WS 流式断点攻坚（08-07 审计遗留 U1）：消息分发层闭环验证（ipc-handlers 回推 + preload listener 生命周期）
```

### 3.4 收益与成本

- **收益**：契约面闭合（404 风险消除）；通知/确认门闭环（桌面端真正可用）；画布式 UI 从设计稿兑现为三块可用组件；双份维护消除。
- **成本**：约 8-12 人日。
- **风险**：WS 流式断点（U1）是既有遗留——Step 1/3 前需先确认 chat 流式分发闭环（ChatView 已接 streamChat 第 494 行，但分发层 7 轮未通）；建议 Step 0 加"流式冒烟验证"。

---

## 四、跨端协同与合并路线图（对齐 Core-3 五大目标）

### 4.1 三端与 Core-3 目标映射

| Core-3 目标 | 三端落点 |
|---|---|
| ① 接口彻底稳固，消除重复实现与重复定义 | CLI 双宿主收敛（B 路线 Step 2）；TUI 双渲染体系收敛（A 路线 Step 1）；config-manager 并入 @cortex/config |
| ② Logger 全面接入关键模块 | cli/tui 的 console 收敛（承接 08-05 H1/M4，本轮 D 组未重复） |
| ③ 状态机全面检验 | TUI SET_MODE 状态复位（D6）；桌面端确认门/任务树状态机测试扩展 |
| ④ 记忆/调度/任务/执行四层压力测试 | 三端不直接涉及，但 eval-gate 落地（08-05 H3）是三端行为回归的前提 |
| ⑤ 运行时配置全面外化，为桌面端配置接入准备 | 桌面端设置面板（现为静态假数据）→ 走 client 的 config 域 API（D2 修复后）；CLI 端口/配置单源化（D4） |

### 4.2 合并路线图（建议执行顺序）

```
Phase 0（0.5 天）  前置验证
  - 桌面端 WS 流式冒烟（确认 U1 现状，决定 Phase 3 是否插入攻坚）

Phase 1（4-5 天）  CLI 降格（B 路线全步骤）
  - 产出：cli 依赖 15→4、死代码清零、冻结门禁实体化、资产下沉 4 项
  - 验收：CI 全绿 + TUI 全功能走 daemon 回归 + 无 CORTEX_ENABLE_CLI 门控

Phase 2（3-4 天）  TUI 收敛（A 路线 Step 1-3）
  - 产出：ANSI 残留清除、SET_MODE 复位、核心分发链测试落地
  - 验收：权限路径单实现 + use-input-handler 覆盖率 > 0（门禁内）

Phase 3（3-5 天）  协议对齐 + client 原语（桌面端 Step 1-3）
  - 产出：契约测试、IPC/类型单源化、确认门 UI + 通知 ack 闭环
  - 验收：契约测试全绿 + 桌面端 gate.request 可 resolve + 通知回执可达

Phase 4（3-5 天）  画布式增量落地（桌面端 Step 4）
  - 产出：事件管线/确认门/任务树三块瞬态组件
  - 验收：瞬态组件生命周期验收（产生即出现、结束即消失）+ 状态机测试扩展

Phase 5（决策点）   TUI P5 评估 + WebUI 立项评估
  - 依据 Phase 2 后的输入能力实测 + 群聊深化需求，决定是否动 Ink input 层
  - WebUI 立项以 client 原语完备（Phase 3）为前提，评估六面板设计稿
```

**总计**：约 14-20 人日，五个阶段各自独立可验收，任何阶段可单独暂停不影响其他端。

### 4.3 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| TUI 依赖 cli 服务层，Phase 1 下沉期间中间态编译断裂 | 中 | 高 | Phase 1 Step 2/3 合并；每步后跑 typecheck |
| WS 流式断点（U1）在 Phase 3 才暴露为根因问题 | 中 | 高 | Phase 0 前置冒烟，确认后把攻坚插入 Phase 1 |
| 契约测试过严导致 Phase 3 阻塞（client 方法收敛需要三端同步改） | 中 | 中 | 收敛动作单独成 commit，先改 client 再改调用方 |
| 画布式瞬态组件与现有 ChatView 布局冲突 | 低 | 中 | 以独立面板容器先行，验证后再考虑融入 ChatView |

---

## 四·五、外部生态验证（2026-08-11 联网调研）

> 三端并行联网调研（29 次检索 + 8 次全文抓取），完整报告见 three-front-external-ecosystem-2026-08-11.md。核心验证：

| 决策 | 外部验证结果 | 对路线图的调整 |
|---|---|---|
| CLI 降格为 daemon 客户端 | ✅ 行业仅 Claude Code 明确 daemon 化；CocoIndex 有同构重构先例；主流 AI CLI 均未依赖 commander 系（自研 Registry 冻结面正确） | Phase 1 验收清单新增 daemon 生命周期四件套边界测试（Claude Code daemon 缺陷实录：Windows 启动失败/stop 误杀/残留干扰） |
| TUI 保持 Ink 5 | ✅ Ink 是 Claude Code/Gemini CLI/Qwen Code 共用底座（2026-08 实测 v7.1.1，39.6k★） | Phase 5 决策点新增：Ink v5→v7 + React 19 对齐时机评估（当前滞后 2 个 major） |
| TUI P5 raw stdin | ✅ Node 侧 kitty-keys 库现成；⚠️ xterm.js CSI-U 未合并（Web 端缺口） | P5 落地路径已明确（kitty-keys），Web 端缺口标注 |
| 桌面端不换 Tauri | ✅ WebView2 对 Live2D/透明窗存疑 + Rust 重写成本；Electron+Live2D+AI 是 2026 桌宠主流组合 | 维持 Electron；版本升级（41+）列入 Phase 3 前置 |
| sandbox:false 债 | ✅ 官方方案：preload 打包单文件 CJS + 恢复 sandbox:true；2026 有沙箱绕过 CVE-2026-70608 | **优先级升至 Phase 0**（原 Phase 3） |
| pixi-live2d-display | ❌ 已停止迭代（0.5.0-beta 最后版）——冻结依赖 | Phase 3 新增：Live2DManager 渲染层抽象 + 官方 CubismWebFramework 备选 |
| IPC 双份手维护 | ✅ 行业四层模式与 client 原语计划吻合 | Phase 3 以单份 TS 类型源生成双端 |
| 权限确认 UX | ✅ 行业转向分层授权（93% 批准率数据驱动）而非堆弹窗 | Phase 4 确认门面板按分层授权设计 |

---

## 五、结论

1. **CLI 降格**是已决策方向（2026-08-06 冻结）的执行补完——不是新路线，是让声明变成事实。
2. **TUI 保持 Ink 5**——两轮重构资产已验证，收敛与测试优先于渲染底层更换；raw stdin 留作 Core-3 决策点。
3. **桌面端四层收敛优先于画布落地**——协议裂口与双份维护不修，画布式 UI 是空中楼阁；瞬态组件分三块增量兑现宪法同构。
4. 三端共享 client SDK 的瘦客户端形态是最终稳态，所有阶段都朝这一个方向收敛——与 Core-3"接口稳固、消除重复实现、配置外化"三大目标直接同向。

---

*论证完成——证据索引：packages/{cli,desktop,client,server,protocol}/src/**、docs/analysis/audit-full-2026-08-11.md、docs/analysis/{cli-anatomy-report,desktop-anatomy-report,desktop-audit-2026-08-07}、docs/core/cortex-tui-v2-final-design.md、PACKAGE_POSITIONING.md*
