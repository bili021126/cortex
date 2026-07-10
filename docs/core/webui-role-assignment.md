# Cortex WebUI 定岗定责定位定域

> 基于：webui-architecture-design.md  
> 原则：谁建谁维护，谁碰谁负责。每个模块只有一个人口。

---

## 一、子 Agent 分工

| Agent | 岗（职责） | 域（文件范围） | 禁止碰 |
|-------|-----------|---------------|--------|
| **executor** | 施工——写代码、改样式、加组件 | `packages/tui/src/web/` 全部 `.ts`/`.tsx` | 不碰 `packages/engine/`、不碰 `packages/scheduler/` |
| **gatekeeper** | 门禁——编译验证、契约检查、PR前审查 | 全仓 `tsc --noEmit`，`packages/tui/` 优先 | 不改代码，只报告 |
| **curious** | 侦察——调研新需求、读现有代码、验证假设 | 读权限全仓，写权限仅 `test-output/` | 不碰 `src/` 和 `packages/*/src/` |
| **advisor** | 决策——技术方案权衡、架构建议 | 仅输出建议文档，不改代码 | 不碰任何源文件 |

---

## 二、WebUI 模块定域

```
packages/tui/src/web/
│
├── gateway.ts          ← 域：WS + HTTP 服务       负责人：executor
├── state-aggregator.ts ← 域：状态聚合             负责人：executor
├── api-router.ts       ← 域：REST API             负责人：executor
├── index.ts            ← 域：启动入口             负责人：executor
│
└── static/
    ├── src/
    │   ├── types.ts         ← 域：前端类型定义    负责人：executor
    │   ├── hooks/            ← 域：数据层          负责人：executor
    │   └── components/
    │       ├── Layout.tsx         ← 域：布局骨架   负责人：executor
    │       ├── Canvas/            ← 域：画布面板   负责人：executor
    │       └── IdePanel/          ← 域：IDE 面板   负责人：executor
    ├── vite.config.ts      ← 域：构建配置        负责人：executor
    └── package.json         ← 域：依赖管理        负责人：executor
```

**原则**：每个文件只有一个负责人。executor 建，gatekeeper 审，curious 探，advisor 议。

---

## 三、数据域边界

```
引擎层 (engine/scheduler/telemetry)
  │  输出：ObservableEvent, TaskNode[], AgentStatus[], HealthSnapshot
  │  不暴露：内部 Scheduler 状态、MemoryStore 原始数据
  ↓
WSGateway (packages/tui/src/web/gateway.ts)
  │  职责：序列化 → JSON → WebSocket push
  │  不处理业务逻辑
  ↓
StateAggregator (packages/tui/src/web/state-aggregator.ts)
  │  职责：三源聚合 → 统一 WebUIState
  │  只读快照，不修改引擎状态
  ↓
前端 hooks (useCortexState.ts)
  │  职责：WS 连接 → React state
  │  不直接调引擎 API
  ↓
前端组件
    职责：渲染，纯展示
    不包含业务逻辑
```

**红线**：前端不直接调 `engine.scheduler.execute()`。所有操作通过 `/api/execute` 转发。

---

## 四、组件岗位

每个组件有且仅有一个明确的"它负责什么"：

| 组件 | 定责 | 输入 | 输出 |
|------|------|------|------|
| TelemetryDashboard | 显示系统健康数字 | WebUIState.stats + health | 纯渲染 |
| EventPipeline | 显示实时事件流 | PipelineEvent[] | 纯渲染 |
| AgentForest | 显示 Agent 状态卡片 | AgentStatusSnapshot[] | 纯渲染 |
| TaskSlice | 显示任务节点树 | TaskNodeSnapshot[] | 纯渲染 |
| NotificationFeed | 显示通知时间线 | PipelineEvent[] (筛选) | 纯渲染 |
| ConfirmGate | 显示确认弹窗 | pendingPermission | approve/deny 回调 |
| GovernanceDashboard | 显示宪法合规 | AuditReport + AmendmentLog | 纯渲染 |
| ConfigSnapshot | 显示配置只读快照 | EngineConfig | 纯渲染 |
| ApiUsageCard | 显示 API 用量 | TokenUsage 聚合 | 纯渲染 |
| TraceDetail | 显示 LLM 调用链 | 展开的节点数据 | 纯渲染 |
| Sidebar | 显示系统脉搏 | WebUIState 摘要 | 导航回调 |
| CodeEditor | 代码浏览/编辑 | 文件树 + 文件内容 | 保存回调 |

---

## 五、新增模块流程

1. **curious** 侦察 → 输出调研报告到 `test-output/`
2. **advisor** 审议 → 输出方案建议（不改代码）
3. **executor** 施工 → 建文件、写代码
4. **gatekeeper** 门禁 → `tsc --noEmit` + 契约检查
5. 主 Agent 验收 → 汇报用户
