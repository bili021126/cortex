# UX 深度调研补充（2026-08-05）

> 承接 ux-anatomy-report-2026-06-20.md（§9 U1-U6 方案）——本文件做**实施级深化**
> 外部参照：Vercel AI SDK UI 错误处理模式、Grasp 流中断/加载状态管理、主流 AI 聊天端（Claude/ChatGPT/Cursor）交互观察

---

## 1. 消息状态机 U1 实施级设计（desktop 首选）

### 1.1 状态枚举（7 态 → 细化为 10 态）

现有 7 态（idle/sending/streaming/complete/error/stopped/regenerating）**不够**——拆出错误子类与中断态：

```
MessageState =
  | "idle"            // 占位/初始
  | "queued"          // 已提交未开始（网络/队列中）
  | "sending"         // 请求已发出，等待首 token
  | "streaming"       // 流式输出中（含 thinking 子阶段）
  | "complete"        // 正常完成
  | "stopped"         // 用户主动停止（stop 按钮）
  | "interrupted"     // 网络中断（可恢复——重试语义不同于 stopped）
  | "error_timeout"   // 超时（LLM 无响应）
  | "error_fatal"     // 不可恢复错误（认证/模型不可用）
  | "regenerating"    // 重新生成中（原内容保留灰显）
```

### 1.2 状态转换表（完整——含所有边）

```
idle ──submit──→ queued ──ack──→ sending ──first-token──→ streaming
  ▲                                                │
  │                                                ├─complete──→ complete
  │                                                ├─stop(用户)──→ stopped
  │                                                ├─net-error──→ interrupted
  │                                                ├─timeout──→ error_timeout
  │                                                └─fatal──→ error_fatal

stopped ──regenerate──→ regenerating ──first-token──→ streaming
error_timeout ──retry──→ queued
interrupted ──retry──→ queued
error_fatal ──(仅)──→ 清空/新会话（不可重试）
regenerating ──stop──→ stopped（回到原 complete 内容）

complete/stopped/error_* ──edit-and-resubmit──→ queued（输入框内容回填）
```

**关键设计决策**：
1. **stopped ≠ interrupted**：stopped 是用户意图（保留已生成部分，可 regenerate）；interrupted 是网络故障（可 retry，语义是"接着发"）——混在一起会让用户困惑（Claude Code 的 stop 后不能续，ChatGPT 的断网重试是续传——两种语义不同，分开）
2. **error 分三类**：timeout（可重试）/ fatal（不可——认证/配额/模型消失）/ interrupted（网络——重试=续传）——错误提示文案不同
3. **regenerating 保留原内容灰显**：用户要对比新旧——直接覆盖是坏 UX（ChatGPT 的编辑后重新生成也是对比式）

### 1.3 各状态的 UI 表现（desktop 渲染规格）

| 状态 | 消息气泡 | 操作按钮 | 辅助 |
|---|---|---|---|
| queued | 灰底 + "等待中…" | 取消（cancel） | 无 |
| sending | 骨架闪烁 | 取消 | 显示已耗时（>5s 才显示——避免闪动） |
| streaming | 光标逐字 + thinking 折叠 | **stop**（红色方块） | token 计数（可选——低调） |
| complete | 正常 | regenerate / copy | 耗时 + 模型标签 |
| stopped | 正常 + "已停止"角标 | **regenerate**（主）/ copy | 保留已生成内容 |
| interrupted | 半透明 + "连接中断" | **retry**（主）/ 放弃 | 不丢已生成部分 |
| error_timeout | 红色边框 + "超时" | **retry**（主） | 显示耗时 |
| error_fatal | 红色 + 具体原因 | 无（仅"新建会话"） | 原因文案（认证失败等） |
| regenerating | 原内容灰显 + 新流 | stop | 对比视图（可选 v2） |

### 1.4 实现要点（与 Cortex 现状的咬合）

- **状态机放哪**：desktop renderer 的 `useMessageState` hook（纯 reducer——`useReducer` + 转换表常量）——不依赖框架
- **事件源**：daemon 的 SSE 事件（stream 开始/增量/结束/错误）+ 用户操作（submit/stop/regenerate/retry）——**H5 的 WS 复用会话**已打通通道
- **错误分类的判定**：SSE 的 error 事件 payload 带 `kind`（timeout/fatal/network）——server 侧在 emit 时分类（daemon.ts 的 error 处理处加分类字段）
- **停止的实现**：AbortController（renderer 侧）→ 通知 daemon 取消流 → daemon 中止 LLM 调用（react-loop 的 abort 通道——**D3 的 degraded 消费**已处理半途失败）
- **测试**：状态机的纯 reducer 单测（转换表全覆盖——每边一个用例）——不需要 UI 测试（reducer 可测）

### 1.5 与其他端的一致性

| 端 | U1 的应用 | 差异点 |
|---|---|---|
| desktop | 完整状态机（10 态） | 主战场 |
| webui | 相同 reducer（复用） | 无桌面专属能力（如系统通知） |
| cli/tui | 简化（sending→complete/error 为主） | 终端无流式精细状态——用 spinner + 行尾状态符 |
| 消息协议 | MessageState 字段进 DTO | 三端共享（protocol 包） |

---

## 2. 外部对标：AI SDK 错误处理模式（ai-sdk.dev）

### 2.1 关键模式提炼

1. **流中途错误的处理**（AI SDK 官方推荐）：如果 assistant 响应在流式过程中出错——**同时移除部分响应和对应的用户消息**（"remove both the partial assistant response and its user message"）——**而不是**保留残片让用户困惑
   - **Cortex 对照**：interrupted 态保留部分内容（可 retry 续传）——**与 AI SDK 不同**（AI SDK 是移除重来）——**决策**：Cortex 保留（续传语义更适合长任务——AI SDK 面向短聊天，Cortex 面向任务型）
2. **加载状态的细分**（Grasp 课程）：连接中断 + 细粒度 loading 状态——sending/streaming 分离（已有）+ 中断恢复（补）
3. **错误消息的上下文感知**（Figr）：错误文案要适配严重度/语气——**Cortex 对照**：error_fatal 的文案要具体（"认证失败——请检查 API Key"而非"出错了"）

### 2.2 对 U1 的三条修正

1. **error_fatal 时输入框不清空**（保留用户输入——AI SDK 移除消息的模式对任务型太重）
2. **streaming 中显示耗时**（>5s——长任务的心理预期管理）
3. **interrupted 的 retry 文案**："继续发送"（而非"重试"——语义是续传不是重来）

---

## 3. 其他 UX 深化要点（U2-U6 的补充）

### 3.1 U2（输入区）：slash 命令的发现性

- **输入 `/` 弹出命令面板**（模糊搜索 + 分类）——Claude Code 的模式（`/` 即唤起）
- **命令的"最近使用"优先**（LRU）——减少重复输入
- **tab 补全**（命令名 + 参数）

### 3.2 U3（会话列表）：三种排序

- **最近使用**（默认）/ **按 agent 分组** / **按日期归档**
- 会话重命名（内联编辑）——长会话必须有名字

### 3.3 U4（流式输出）：thinking 折叠

- **thinking 默认折叠**（只显示"思考中…"）——点击展开
- **流式时折叠区不闪动**（debounce 更新——每 500ms 或内容稳定）

### 3.4 U5（错误恢复）：重试的幂等

- retry 必须**幂等**（同一请求重发不产生重复副作用）——daemon 侧用 requestId 去重（已有 inflight 去重模式延伸）

### 3.5 U6（设置面板）：模型标签

- 每个模型的**当前状态徽章**（可用/降级/不可用——来自 envRouter 的健康状态——**D2 接线后数据源就绪**）
- 模型切换的**影响提示**（"切换后当前会话继续用旧模型"——避免误解）

---

## 4. 实施顺序与依赖

```
U1 消息状态机（首刀——依赖：H5 WS 通道 ✅ / D3 degraded ✅ / server error 分类【新——小】）
  ↓
U5 重试幂等（依赖：requestId 去重【小】）
  ↓
U4 thinking 折叠（依赖：SSE 的 thinking 分段【检查现状】）
  ↓
U3 会话排序（独立）
  ↓
U2 slash 命令面板（依赖：命令注册表【检查现状】）
  ↓
U6 模型标签（依赖：envRouter 健康状态暴露【D2 接线已通——补 API】）
```

**U1 的前置只有一处新代码**：server 的 error 事件加 `kind` 分类字段（daemon.ts 的 error emit 处——~15 行）。

---

## 5. 风险与边界

- **状态机过度设计**：10 态对简单场景重——**措施**：reducer 是纯函数，用不到的态不渲染（UI 层只响应它关心的态）
- **interrupted 续传的复杂度**：续传需要 server 支持（半途流恢复）——**措施**：v1 的 interrupted 退化为"retry=重发全量"（语义先对，续传 v2）
- **不做**：多模态输入（先文本）、语音、移动端适配（三端桌面/网页/TUI 优先）

---

*深化完成——U1 实施时按 §1 直接落地（状态枚举/转换表/UI 规格/事件源均定）。*
