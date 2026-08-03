# 四端 UX 调研报告（cli / tui / desktop / webui）

> 2026-06-20 · 状态：调研报告（未动手）
> 范围：页面布局 / 交互逻辑 / 菜单划分——现状盘点 + 优秀设计资产 + 差距建议

---

## 1. CLI（命令行）

### 现状
- **命令树**：15 个扁平命令（run/agent/task/memory/config/schedule/roundtable/confirm/skill/inspect/doctor/doc/setup/version/help），每命令带 alias + 单行描述（`commands/command-list.ts`）
- **结构**：命令注册集中化（COMMAND_DEFS + 工厂延迟创建 handler——无循环依赖）
- **交互**：纯命令式——无子命令分组、无交互向导（除 setup 外）

### 优秀设计资产
- ✅ 命令描述简洁一致（"动词 + 对象 + 一句话结果"）
- ✅ alias 设计合理（run=r / task=t / memory=m / config=c——单字母高频）

### 差距（对标 gh / git）
| 差距 | 建议 |
|---|---|
| **无命令分组** | 15 个命令平铺——建议按域分组（执行/管理/诊断/配置），help 输出分组展示 |
| **help 无示例** | 每个命令缺 usage 示例——对标 gh 的 `gh help <cmd>` 带示例 |
| **无交互式引导** | run/task 高频命令缺交互式参数引导（对标 `gh pr create` 的交互流） |
| **setup 是唯一向导** | 可扩展为 `cortex init`（首启引导：密钥/模型/目录） |

## 2. TUI（已并入 cli——src/tui/）

### 现状（子系统完整度超出预期）
- **布局**：9 种面板预设（chat/tool/permission/status/sidebar/input/taskTree/help/**xilian**（🍀 主题装饰））——`layout/panel-presets.ts`
- **交互**：12 个键位（ctrl+k 命令面板 / ctrl+b 侧边栏 / ? 帮助 / i 聚焦输入 / ctrl+]/[ Agent 切换 / ctrl+p 规划模式 / `}` `{` 面板导航）+ **权限对话框 4 键**（return 批准 / a 全部 / n 拒绝 / s 跳过——模态上下文）——`interaction/key-bindings.ts`
- **模式**：command/plan 模式 + intent-router（意图路由：explicit/pattern/context/confidence 四级分类）
- **渲染**：diff-viewer / permission-dialog / token-monitor / tool-log——**过程可视化完整**
- **主题**：palette/tokens/character-theme/border-chars/motion——**设计 token 体系**

### 优秀设计资产
- ✅ **Lazygit 风格面板导航**（`}` `{` 切面板）——终端用户肌肉记忆友好
- ✅ **键位分类 + 上下文**（global/chat/modal）——冲突管理有设计
- ✅ **命令面板**（ctrl+k）——对标 VS Code，终端里少见的高级交互
- ✅ **过程可视化**（tool-log/token-monitor/diff-viewer）——远超普通 TUI

### 差距（对标 k9s / lazygit / atuin）
| 差距 | 建议 |
|---|---|
| **无布局组合定义** | 面板预设有了，但"默认三栏布局"（侧边栏/聊天/详情）的组合未固化——建议 layout 增加 presets 组合 |
| **键位可发现性** | `?` 帮助面板存在但键位表无分组展示——建议 help 面板按 category 渲染 |
| **无 atuin 式历史** | 命令历史/会话回溯（session-persistence 有但 UI 入口弱） |
| **xilian 主题未全面应用** | 主题装饰只在一个面板——建议全 UI 统一走 theme tokens |

## 3. Desktop（Electron——main/preload/renderer）

### 现状
- **页面**：ChatView（聊天）+ Live2D（昔涟模型）+ presence 引擎（存在性设计）
- **聊天布局**（ChatView.tsx）：标题栏（名字·状态/关闭）→ 消息列表（头像/气泡/时间/操作）→ 输入区（Enter 发送/Shift+Enter 换行）——**标准聊天三明治**
- **细节**：空状态（"昔涟期待与你聊天哦 ✨"）、thinking 徽章、复制/朗读消息操作、粒子背景画布
- **Live2D**：12 个表情（闪耀/问号/星星眼/圈圈眼/墨镜）、嘴型同步、注视追踪、呼吸、点击交互、气泡 opener
- **presence 引擎**（design-spec.ts）：**12 条事件→表情时序规则**（chat.chunk 轻动 / chat.tool_result 闪耀 800ms / gate.request 问号等待 / idle 30s 自动恢复）+ 启动时序（8s 目标：模型加载→健康检测→问候）+ **调色板从 Live2D 贴图提取**（薰衣草紫 #b57edc / 薄荷青 #8fd9c4 / 暖象牙 #fce8dd）

### 优秀设计资产
- ✅ **存在性设计（presence）是顶级资产**——事件→表情→时序的完整规约，桌面宠物领域少见的系统化设计
- ✅ **色值从贴图提取**（design-tokens 收编）——视觉一致性有根
- ✅ **聊天细节完整**（空状态/操作/状态提示）

### 差距（对标桌面宠物 + Discord）
| 差距 | 建议 |
|---|---|
| **无会话列表/历史** | 单窗口聊天——无侧栏会话管理（对标 Discord 左栏） |
| **Live2D 与聊天割裂** | 模型是独立层——建议交互联动（她说话时气泡/表情同步的编排） |
| **无设置界面** | 密钥/模型/外观设置缺失（R11-20 的 settings 通道已有——无 UI） |
| **窗口管理原始** | 无最小化到托盘/开机自启/多窗口（tray.ts 有但浅） |

## 4. WebUI

### 现状
- **未建**（dashboard.html 已不在根——无包无页面）
- 仅存：cli 的 `tui/web/`（gateway/api-router/state-aggregator——**Web 服务端基建已有**——缺前端壳）

### 建议（对标 ChatGPT / Claude web 三栏）
| 差距 | 建议 |
|---|---|
| **无前端壳** | 服务端就绪（web/gateway + state-aggregator）——缺 React 壳：三栏布局（会话列表/主区/侧栏） |
| **无会话管理** | 历史/重命名/搜索（对标 ChatGPT 左栏） |
| **无流式渲染** | tui 的 streaming 逻辑可复用——Web 需流式 UI（SSE 已有） |

## 5. 跨端一致性（核心建议）

**最大资产：design-tokens（CYRENE_PALETTE）+ theme tokens 已存在——四端应统一消费，不再各自维护。**

| 一致项 | 现状 | 建议 |
|---|---|---|
| **色彩** | desktop 已收编 CYRENE_PALETTE；TUI 有独立 palette | TUI 的 palette 同步收编 design-tokens（消除双源） |
| **交互模式** | 三端各自为政 | 统一"确认门交互"（TUI 权限对话框 / desktop gate.request 表情 / web 弹窗）——同一语义不同呈现 |
| **状态词汇** | 各自"在线/思考中" | 统一状态机词汇（idle/thinking/tool/gate/error）——presence 已定义——推广 |
| **消息模型** | desktop 有 Message 结构 | 四端共享消息 schema（role/content/steps/tool 事件）——web 直接复用 |

## 6. 结论

- **desktop 的 presence 设计规约 + TUI 的交互/主题体系是项目最被低估的 UX 资产**——远超"雏形"水平
- **最大缺口**：webui 前端壳（服务端就绪缺壳）+ CLI 命令分组 + desktop 会话管理
- **最优先**：跨端统一 design-tokens 消费（消除双源）+ 确认门交互的一致性

## 7. 外部标杆联网调研对照（2026-06-20 补充）

> 对标：gh（命令分组）/ lazygit（TUI 三原则）/ Claude.ai·ChatGPT·Cursor（AI chat 解剖）/ Replika（AI 伴侣主动式）/ setproduct AI chat 指南 / aiuxplayground 170+ 模式

### 7.1 核心原则提炼（跨端通用）

1. **AI chat 不是 messenger 也不是 chatbot**——是独立品类（生成式/流式/可能自信地错）——界面必须让第三种失败可见可恢复
2. **消息状态 7 种**（queued/thinking/streaming/complete/error/regenerating/stopped）——大多数产品只做 2 种（streaming/done）所以"janky"
3. **lazygit 三原则**：一致性（views 常驻可见）/ 可发现性（数据按需可见）/ 记忆化（vim 式键位 + 命令首字母）
4. **restraint 克制**——"Would this be better as a button?"——chat 不是万能答案；8 成场景是按钮就用按钮
5. **AI 伴侣的主动式**（Replika 2026：proactive check-ins + 记忆）——不是等用户开口
6. **错误必须细分**——"Something went wrong" 是最懒的失败 UX——显示错误类 + 修复动作

### 7.2 Cortex 命中/违反对照（诚实清单）

| # | 标杆原则 | Cortex 现状 | 判定 |
|---|---|---|---|
| 1 | 消息状态 7 种 | desktop 只有 sending/thinking（"思考中…"）；TUI 有 tool-log/token-monitor 但无 stopped/regenerating | ❌ 违反 |
| 2 | **stop 按钮** | desktop ChatView 无 stop（反模式"No stop button during generation"）；TUI 有 sigint-handler | ❌ desktop 违反 |
| 3 | **会话持久化** | desktop messages 是 useState——刷新即空（反模式"No conversation history"）；TUI 有 session-persistence | ❌ desktop 违反 |
| 4 | **错误细分** | desktop 错误是 "[错误] 文本"（generic）；TUI permission-dialog 有细分 | ⚠️ desktop 违反 |
| 5 | **模型标签** | 四端都不显示"哪个模型写的"（反模式"Buried model selector"） | ❌ 违反 |
| 6 | **bubble 反模式** | desktop `.msg__bubble` 圆角气泡——模拟 SMS（"Round bubbles undermine tool framing"——Claude/Cursor 已改扁平全宽） | ⚠️ 值得改 |
| 7 | **lazygit 一致性** | TUI 键位体系已 vim 风格 + 面板导航——符合 | ✅ 已符合 |
| 8 | **lazygit 可发现性** | `?` 帮助面板无 category 分组展示 | ⚠️ 半符合 |
| 9 | **restraint** | CLI 15 命令平铺（无分组）；setup 是唯一交互向导 | ⚠️ 半符合 |
| 10 | **主动式** | desktop presence 引擎已是主动设计（idle/表情时序）——**领先**；但无 proactive check-in（定时问候/记忆提醒） | ✅ 领先 |
| 11 | **AI chat 独立品类** | TUI 的 intent-router/命令面板（ctrl+k）已超越 messenger 模式 | ✅ 领先 |
| 12 | **上下文截断提示** | TUI 有 context-compactor（452 行）——但无"Earlier messages summarized"标记 UI | ⚠️ 半符合 |

### 7.3 可落地改造建议（按命中排序）

**P0（反模式直接命中）：**
1. desktop：消息状态机补全（queued/streaming/error 细分）+ **stop/regenerate 按钮** + **会话持久化**（复用 TUI session-persistence 模式）
2. 四端：**模型标签**（每条 assistant 消息显示模型名——低成本高信任）

**P1（对齐标杆）：**
3. desktop：气泡改扁平全宽（对齐 Claude/Cursor——subtle background 区分替代圆角）
4. TUI：`?` 帮助面板按 category 分组渲染（lazygit 可发现性）
5. CLI：命令按域分组（gh 模式）+ help 带示例

**P2（保持领先）：**
6. desktop：presence 加 proactive check-in（定时问候/记忆提醒——Replika 模式）
7. TUI：context-compactor 加"已摘要"标记 UI

### 7.4 反模式自查清单（Cortex 已遵守的）

- ✅ 无 fake typing 动画（无人工降速）
- ✅ 无 modal-locking（TUI 不锁交互）
- ✅ 无 suggestion 强推（无不可关闭的提示）
- ✅ 无 disclaimer 墙（欢迎态一次）

## 8. Claude Code 设计空间对照（arxiv 2604.14228——2026-06-20 补充）

> 论文《Dive into Claude Code: The Design Space of Today's and Future AI Agent Systems》——5 价值观 + 13 设计原则。**核心洞察：Cortex 的架构原则与论文 13 条高度重合——方向被业界验证，缺的是 harness。**

### 8.1 13 原则 vs Cortex 命中表

| # | Claude Code 原则 | Cortex 对应 | 命中 |
|---|---|---|---|
| 1 | Deny-first with human escalation（拒绝优先+人工升级） | ConfirmGate（L0-L3 分级 + 非交互拒绝） | ✅ 强命中 |
| 2 | Graduated trust spectrum（渐进信任谱系） | trust 分/信任模型（B4 单源） | ✅ 强命中 |
| 3 | Defense in depth（纵深防御） | 版本门控 + 混沌校验 + 门禁五段 | ✅ 命中 |
| 4 | Externalized programmable policy（外部化策略） | config 18 域（agents/engine/tuning） | ✅ 强命中 |
| 5 | Context as scarce resource（上下文稀缺资源） | context-compactor（452 行）+ token-monitor | ✅ 命中 |
| 6 | Append-only durable state（追加式持久状态） | 审计日志/遥测 | ⚠️ 部分（记忆非 append-only） |
| 7 | **Minimal scaffolding, maximal operational harness** | **脚手架克制 ✅——但 operational harness 缺失（评测/轨迹回放）** | ⚠️ 半命中 |
| 8 | Values over rules（价值观>规则） | 宪法七原则 + 确定性护栏 | ✅ 命中 |
| 9 | Composable extensibility（可组合扩展） | 插件/技能/工厂 | ✅ 命中 |
| 10 | **Reversibility-weighted risk（可逆性加权）** | ReversibilityLevel（L0-L3 可逆性分级） | ✅ 强命中 |
| 11 | Transparent file-based config/memory（透明文件配置） | JSON 文件配置（非数据库）+ 可读记忆 | ✅ 强命中 |
| 12 | Isolated subagent boundaries（隔离子 Agent） | 多 agent 隔离 + 工具权限声明 | ✅ 命中 |
| 13 | Graceful recovery（优雅恢复） | resilience 包（重试/熔断/超时） | ✅ 强命中 |

**结论：13 条中 10 条强命中/命中，2 条半命中（append-only 状态、operational harness）——Cortex 的架构骨架被业界最前沿的 agent 系统研究验证。**

### 8.2 论文的设计空间 4 问（Cortex 自问）

1. **Where does reasoning live?**——Cortex：引擎内 query-loop（与 Claude Code 同构）
2. **How many execution engines?**——Cortex：单 queryLoop + 多 agent 调度（同构）
3. **What is the default safety posture?**——Cortex：ConfirmGate 默认拒绝（同构 deny-first）
4. **What is the binding resource constraint?**——Cortex：上下文窗口（同构 context 稀缺）

### 8.3 论文给 Cortex 的两个具体启发

1. **operational harness 是 Claude Code 的刻意投入**（原则 7）——验证了我们的 harness 补全方案（P0 评测层）是业界验证的方向，不是过度工程
2. **Append-only 状态**（原则 6）——Cortex 记忆是可变状态——审计可追溯性弱——后续记忆域可考虑追加式审计日志（与 R11-23 跨存储完整性联动）

## 9. 深推：P0 改造设计（2026-06-20——实现级）

### 9.1 Desktop 消息状态机（7 态补全）

**现状**：ChatView 只有 `sending: boolean` + `thinking?` 徽章——4 个反模式命中。

**设计——MessageState 类型：**
```ts
type MessageState =
  | "queued"        // 已提交未开始（占位气泡 + 脉冲点——无进度条）
  | "thinking"      // 推理阶段（可折叠区块——默认折叠——标签诚实："思考中"）
  | "streaming"     // token 到达（闪烁光标 + 增量 Markdown）
  | "complete"      // 完成（时间戳 + 操作按钮浮现）
  | "error"         // 细分错误（rate-limit/网络/超时/内容过滤——各带修复动作）
  | "regenerating"  // 重新生成（旧回复进 carousel 保留）
  | "stopped"       // 用户中断（保留部分输出 + Continue/Regenerate 两个动作）
```

**Message 接口变更：**
```ts
interface Message {
  id: string; role: Role; content: string; at: number;
  state: MessageState;
  error?: { kind: "rate-limit" | "network" | "timeout" | "content-filter" | "unknown"; hint: string };
  model?: string;                    // §9.4 模型标签
  variantOf?: string;                // regenerating 的 carousel 链
  stoppedAt?: number;                // stopped 状态标记
}
```

**UI 呈现规则：**
- streaming：末尾闪烁光标（CSS `@keyframes blink`——`prefers-reduced-motion` 时禁用）
- error：`[错误]` 文本 → **结构化错误条**（类型标签 + 一句原因 + 单个修复按钮：重试/换模型/缩短提示）
- stopped：保留部分内容 + 内容下方两个按钮（继续生成 / 重新生成）
- regenerating：旧版本收进 `▼ 上一个回复` accordion（保留可对比）

**Stop/Regenerate 控件（Composer 区）：**
- streaming 中：发送按钮位置换成 **■ Stop**（大命中区——接近 composer）
- complete 后：每条 assistant 消息 hover 显示 **↻ Regenerate**（与复制/朗读同排）

### 9.2 Desktop 会话持久化（复用 TUI session-persistence 模式）

**设计：**
- 存储：`localStorage`（键 `cortex.chat.sessions.v1`——会话数组）——首期单会话即可（不建会话列表 UI）
- 时机：`handleSend` 前保存 user 消息；流式完成后保存 assistant 消息；`onClose` 前 flush
- 恢复：ChatView 挂载时读 localStorage → `useState(initial)`
- 上限：最近 50 条（防 localStorage 膨胀）
- **不做**（首期）：多会话/重命名/搜索（§3 差距——P2 再做）

### 9.3 TUI：`?` 帮助面板按 category 分组

**现状**：key-bindings 已有 `category`（navigation/view/agent/action/system）——帮助面板未用。

**设计**：help 面板渲染时按 category 分组（标题 + 键位列表）——复用 key-bindings 的 category 字段——约 20 行改动。

### 9.4 四端模型标签

**设计**：assistant 消息时间戳旁加小标签（`· flash` / `· pro`）——数据源：消息产生时记录 `model`（从 adapter label 或 config 读取）——desktop/TUI/web 三端同一字段。

### 9.5 CLI 命令分组（gh 模式）

**分组设计（command-list.ts 加 group 字段）：**
```
执行类：run / task / schedule
管理类：agent / memory / skill / roundtable / confirm
诊断类：inspect / doctor
配置类：config / setup
服务类：doc
系统类：version / help
```

**help 输出**：按分组渲染（组标题 + 命令列表）——`cortex help <cmd>` 显示 usage 示例（描述补 `examples` 字段）。

### 9.6 实施顺序（依赖链）

| 步骤 | 内容 | 依赖 | 规模 |
|---|---|---|---|
| U1 | desktop 消息状态机（类型 + error 细分 + stop/regenerate） | 无 | 中（ChatView + css） |
| U2 | desktop 会话持久化 | U1（依赖 Message 类型） | 小 |
| U3 | 模型标签（四端） | 无 | 小 |
| U4 | TUI 帮助分组 | 无 | 小 |
| U5 | CLI 命令分组 + help 示例 | 无 | 小 |
| U6 | desktop 气泡扁平化 | U1（同一 css 区域） | 小 |

**建议首刀：U1（状态机）**——4 个反模式中 3 个（stop/错误/regenerate）一次解决。

---
*调研+深推完成——待开拓者决定切入点。*
