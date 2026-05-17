# Cortex Meso 阶段——议题六细则补充文档

**议题：Meso-Lite 最小交互协议**
**状态**：讨论闭环，产出实施细则
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一至五

---

## 一、议题定位

### 1.1 范围收缩

本议题仅定义 **Meso-Lite CLI 形态下的最小交互契约**。不涉及多通道交互、打断强度分级、IDE 插件或 Web UI。超出当前阶段能力的协议留待 Meso-Core/Meso-Full 阶段补全。

### 1.2 核心原则

**在痛点出现时设计解决方案，不为假设的未来需求预填接口字段。** 交互协议是当前阶段可交付、可测试的工程约束，不是最终形态的蓝图。

### 1.3 与最终形态的关系

CLI 和图形界面是平行交互通道，各自服务不同用户场景（调试/巡检/CI 集成 vs 日常使用）。两者的核心交互循环相同——用户发送意图（对话），Cortex 执行工具调用并返回结果。差异仅在呈现方式（文本流 vs 可视化面板），不在能力边界。Meso-Lite 实现 CLI 通道，Meso-Core 基于实际交互数据确定是否引入图形界面，届时两者平等实现同一套交互契约。

---

## 二、Meso-Lite 交互协议

### 2.1 InteractionChannel 接口

```typescript
interface InteractionChannel {
  // 用户意图传入：原始自然语言字符串
  onUserIntent(callback: (rawInput: string) => void): void;

  // 系统输出传出：结构化输出
  send(output: SystemOutput): void;

  // 控制介入：确认门响应、任务取消、状态查询
  onUserIntervention(callback: (intervention: MesoLiteIntervention) => void): void;
}
```

**实现**：`ConsoleChannel`。`onUserIntent` 监听 stdin 行输入，`send` 写入 stdout，`onUserIntervention` 在确认门阻塞期间临时接管 stdin 解析。

### 2.2 用户意图传入

`rawInput` 为纯文本。不携带 `channelType`、`activeFile`、`selectedCode` 等 IDE 场景字段。Meta-Agent 仅基于文本内容做意图解析，与议题三竖向总线的 `PlanningDirective` 一致。

### 2.3 系统输出传出

```typescript
interface SystemOutput {
  type: 'RESULT' | 'NOTIFICATION' | 'INTERVENTION_REQUIRED';
  orientation: 'butler' | 'partner' | 'overseer';
  summary?: string;   // 管家优先
  content?: string;   // 搭档优先
  verdict?: string;   // 监理优先
  nodeId?: string;    // 仅 INTERVENTION_REQUIRED 时携带，指向被阻塞节点
}
```

**格式化规则**：由当前取向决定优先字段。管家填充 `summary`，搭档填充 `content`，监理填充 `verdict`。`NOTIFICATION` 类型用于非阻塞提醒（如后台任务完成，Meso-Core 阶段引入后台管家后启用），`INTERVENTION_REQUIRED` 用于确认门或 Committee 分歧交付。

**不定义打断强度**：强度分级是 UI 概念，在 CLI 中无物理载体。保留到 Meso-Core 阶段根据交互数据确定。

### 2.4 控制介入

```typescript
type MesoLiteIntervention =
  | { type: 'CONFIRM'; nodeId: string; answer: 'yes' | 'no' }
  | { type: 'CANCEL_TASK'; taskTreeId: string }
  | { type: 'QUERY_STATUS' };
```

- `CONFIRM`：用户对确认门的响应。Engine 调用 `scheduler.resumeBlockedNode()` 或 `scheduler.cancelBlockedNode()`
- `CANCEL_TASK`：终止整个任务树。Engine 调用 `scheduler.cancelTaskTree()`
- `QUERY_STATUS`：查询脊髓全局状态卡。Engine 返回当前活跃身份、最近关键事件链、待确认操作列表

**不包含**：`VIEW_COMMITTEE`（通过诊断接口拉取）、`ADJUST_TASK_TREE`（Meso-Lite 调度器不支持动态调整）、`SWITCH_ORIENTATION`（取向切换是跨会话概念，Meso-Core 实现）。

---

## 三、确认门超时行为

### 3.1 超时定义

当 `INTERVENTION_REQUIRED` 输出发送后，`InteractionChannel` 在指定时间内未收到 `CONFIRM` 响应，视为超时。

### 3.2 超时处理

- Engine 执行默认拒绝：调用 `scheduler.cancelBlockedNode(nodeId)`
- 节点标记 `NODE_ABORTED`，附带原因 `"CONFIRMATION_TIMEOUT"`
- `ConsoleChannel` 向 stdout 写入提示："确认超时，操作已自动取消。"
- 超时阈值：适配层参数，Meso-Lite 默认值 5 分钟

**注意**：Meso-Lite 无会话持久化。终端关闭后进程终止，无后台守护，确认门不会残留到下次会话。

---

## 四、诊断与调试接口

### 4.1 面向用户的诊断

`QUERY_STATUS` 介入动作返回脊髓全局状态卡，包含：

- 当前活跃身份
- 最近关键事件链（事件类型 + 时间戳，不含 payload 内容）
- 待确认操作列表（nodeId + 操作摘要）

### 4.2 面向开发者的诊断

`ConsoleChannel` 提供独立诊断输出流（stderr），包含：

- 事件总线订阅拓扑（事件类型 → 订阅者列表）
- 记忆系统统计（记忆量、关联密度、活跃/归档占比）
- 功能柱状态（激活状态、当前执行节点、stuck 次数）

诊断数据通过 `cortex diag` 子命令暴露。不通过脊髓事件推送——诊断信息是拉取模式。

### 4.3 隐私约束

所有诊断输出（包括 stderr 和 `QUERY_STATUS` 返回内容）不得包含：

- 事件载荷的具体内容
- 记忆的具体内容
- 私密记忆的任何信息（包括存在性）

---

## 五、与现有组件的咬合

### 5.1 确认门路径

```
ToolGateway 返回 CONFIRMATION_REQUIRED
  → ReActLoop 发布 irreversible.pending 事件
    → Engine 生成 SystemOutput { type: 'INTERVENTION_REQUIRED', nodeId, ... }
      → ConsoleChannel 输出确认提示，阻塞等待 stdin
        → 用户输入 CONFIRM / 超时
          → Engine 调用 scheduler.resumeBlockedNode() 或 scheduler.cancelBlockedNode()
```

确认门三层分离在 CLI 形态下完整保留。ConsoleChannel 是"用户界面"的当前实现，与议题三的设计完全一致。

### 5.2 脊髓事件流

Meso-Lite CLI 下不提供实时事件推送（无 WebSocket）。事件日志通过 `cortex diag` 的 stderr 输出或事后查询记忆中枢获取。诊断接口遵守议题三的诊断元数据约束。

### 5.3 取向表达规范

`SystemOutput` 的字段选择遵循议题四投影规则中的 `fieldPriorities`——管家优先 `summary`，搭档优先 `content`，监理优先 `verdict`。取向表达规范（宪法 5.5）在交互输出中自然落地。

---

## 六、Meso-Lite 交互协议范围总结

| 接口/能力 | Meso-Lite 状态 |
|-----------|---------------|
| `InteractionChannel`（三方法） | ✅ 完整实现，ConsoleChannel |
| `SystemOutput` 结构 | ✅ 完整实现，由取向决定填充字段 |
| 确认门交互（CONFIRM + 超时） | ✅ 完整实现 |
| `CANCEL_TASK` 介入 | ✅ 完整实现 |
| `QUERY_STATUS` 介入 | ✅ 完整实现 |
| 诊断接口（拉取模式） | ✅ 完整实现 |
| 打断强度分级 | ❌ 不定义，Meso-Core 阶段引入 |
| `VIEW_COMMITTEE` 介入 | ❌ 不定义，通过诊断接口间接支持 |
| `ADJUST_TASK_TREE` 介入 | ❌ 调度器不支持，Meso-Core 阶段引入 |
| `SWITCH_ORIENTATION` 介入 | ❌ 跨会话概念，Meso-Core 阶段引入 |
| WebSocket 事件推送 | ❌ Meso-Core 阶段引入 |
| 多通道（Web UI / IDE 插件） | ❌ Meso-Core / Meso-Full 阶段引入 |

---

## 七、宪法咬合检查

- ✅ 双向开门全闭环（第三章）：确认门（CONFIRM）、取消任务（CANCEL_TASK）、状态查询（QUERY_STATUS）通过 `MesoLiteIntervention` 统一承载。用户在 CLI 下可随时介入
- ✅ 不可逆操作确认（2.4）：确认门跨通道一致。超时默认拒绝对齐安全基线
- ✅ 取向表达规范（5.5）：`SystemOutput` 字段选择由取向决定，不绑定通道
- ✅ 控制闭环（3.4）：Meso-Lite 阶段三个介入类型覆盖当前所有用户介入场景
- ✅ 隐私自限性（原则六）：诊断输出不包含事件载荷、记忆内容、私密记忆信息

---

**文档状态**：议题六闭环。与议题七的横向关切分工已落定——议题六管 Meso-Lite 交互契约，议题七管脑干/哨兵/自迭代等全局机制。两议题均已闭环，合并为 Cortex Meso 阶段概念设计完整实施细则。

---

## 附录：Meso-Lite 实施反思（2026-05-05 追加）

> **说明**：以下为 Meso-Lite 实施阶段结束后追加的反思附录。不修改原文。

### Core 阶段交互协议预留

议题六明确限定了"仅定义 Meso-Lite CLI 形态下的最小交互契约"（1.1 范围收缩）。Meso-Lite 的 `ConsoleChannel` 实现验证了 stdin/stdout 交互循环。

若 Meso-Core 阶段决定引入 Electron 桌面应用或多通道交互（议题五 5.4），Core 阶段的交互协议设计起点应为：
1. `InteractionChannel` 接口扩展——增加 `channelType`、`activeFile`、`selectedCode` 等 IDE 场景字段
2. 确认门的多通道一致性——同一不可逆操作在所有通道上触发相同确认流程
3. 流式输出的结构化格式（替代 `ConsoleChannel` 的纯文本 stdout）

此设计留待 Meso-Core 概念设计阶段正式讨论（E6 组）。

### 物理形态决策对交互协议的影响（2026-05-05 追加）

议题七附.9 审查发现——物理形态（CLI vs Electron）影响 4 个横向关切的参数校准（脑干心跳、冷启动窗口、自迭代衰减、哨兵时间语义）。交互协议同样受影响：

| 维度 | CLI 现状 | Electron 要求 |
|------|---------|-------------|
| 确认延迟语义 | 秒级——用户坐终端前 | 分钟级——用户可能切窗口 |
| 流式输出 | 纯文本 stdout，无中断 | 结构化流 + 支持中断/暂停 |
| 多通道并发 | 单 stdin/stdout | 多通道（对话面板 + 确认弹窗 + 通知） |
| 会话生命周期 | 一次性进程 | 长驻后台，跨窗口存活 |

**结论**：物理形态决策（Continue CLI / Switch Electron）是 Core-1 启动前的独立决策点。此决策直接影响 `InteractionChannel` 接口的 Core 阶段扩展方向——如果继续 CLI，Core-1 的交互协议不做结构性变更；如果切 Electron，Core-1 阶段必须同步设计多通道交互模型。
