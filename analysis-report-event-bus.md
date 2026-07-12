# 星盘解读：事件总线 pub/sub 实现与调用 —— 阻断性问题审计报告

> 占卜者：莫娜·梅姬斯图斯  
> 水镜观测范围：全仓事件总线（PipelineObserver / GovernanceEventEmitter / TuiEventBus / NotificationRuntime / SkillPipeline 等）  
> 扫描文件：26 个源文件 + 4 个测试文件  
> 占卜时间：Core-1 阶段

---

## 一、全景星图

```
┌─────────────────────────────────────────────────────┐
│              事件总线拓扑（pub/sub）                    │
├─────────────────────────────────────────────────────┤
│                                                       │
│  GovernanceEventEmitter  ──emit──►  PipelineObserver  │
│  Scheduler                ──emit──►  PipelineObserver  │
│  TaskBoard                ──emit──►  PipelineObserver  │
│  SkillPipeline            ──emit──►  PipelineObserver  │
│  NotificationRuntime      ──emit──►  PipelineObserver  │
│  PipelineObserver._reportError ──►  PipelineObserver  │  ← 递归
│                                                       │
│  PipelineObserver  ──on/sub──►  NotificationRuntime   │
│  PipelineObserver  ──on/sub──►  SkillPipeline         │
│  PipelineObserver  ──on/sub──►  Sentinel/Memory/管家  │
│                                                       │
│  TuiEventBus  ──独立事件总线（TUI 层，不接入以上管线）      │
│                                                       │
└─────────────────────────────────────────────────────┘
```

---

## 二、阻断性问题判定

### 🛑 问题 A：NotificationRuntime 发射 ErrorReported 事件时 payload 形状与 EventPayloadMap 不匹配

**严重级别：⚠️ 潜在运行时崩溃**

**文件**：`packages/engine/src/core/notification-runtime.ts` L110-117

**证据**：
```typescript
// 实际发射的 payload（notification-runtime.ts:115）
this.observer.emit({
  type: PipelineEventType.ErrorReported,
  priority: PipelinePriority.NORMAL,
  payload: { message: `[NotificationRuntime] 发送通知失败: ...` },  // ← { message }
  timestamp: Date.now(),
  notificationType: "WARNING",
});
```

**EventPayloadMap 要求**（`packages/shared/src/infra.ts`）：
```typescript
[PipelineEventType.ErrorReported]: { 
  source: string;    // 必需
  severity: string;  // 必需
  error: string;     // 必需
  hint?: string;     // 可选
};
```

**运行时风险**：
- 下游 handler 按约定类型读取 `payload.source` → 返回 `undefined`
- 下游 handler 读取 `payload.error` → 返回 `undefined`
- 若 handler 执行 `payload.source.toUpperCase()` 或 `payload.error.slice(0, 100)` → **TypeError: Cannot read properties of undefined** → **运行时崩溃**

**下游消费证据**：
- `NotificationRuntime._extractSummary` (L160): `if (payload.error) return \`错误: \${String(payload.error)}\`` — 此处不会崩溃（undefined 走 falsy 分支），但错误信息丢失
- 但通知管线的其他消费者（Sentinel/管家）可能直接 `payload.error.slice(...)` → 崩溃

**修复建议**：
```typescript
payload: {
  source: "notification-runtime",
  severity: "degraded",
  error: `[NotificationRuntime] 发送通知失败: ${String(e).slice(0, 200)}`,
}
```

---

### 🛑 问题 B：GovernanceEventEmitter 缺少 EventPayloadMap 要求的额外字段

**严重级别：⚠️ 潜在运行时问题（当前未直接崩溃，但属于类型契约失效）**

**文件**：`packages/engine/src/core/governance-events.ts`

**EventPayloadMap 要求治理事件 payload 有额外字段**（`packages/shared/src/infra.ts`）：

| 事件类型 | EventPayloadMap 要求的额外字段 |
|---------|-------------------------------|
| `GovernanceAmendmentProposed` | `amendmentId: string` |
| `GovernanceAuditReport` | `auditType: "plan_review" \| "doc_audit" \| "constitution_check"` |
| `GovernanceComplianceViolation` | `violationLevel: "P0" \| "P1" \| "P2" \| "P3"` |
| `GovernanceRoundtableConsensus` | `participants: string[]` |

**实际发射的 payload**：GovernanceEventEmitter 的 `_emit()` 只传入 `GovernanceEventPayload`（`{ type, id, nodeId?, severity, source, summary, detail?, ... }`），不包含上述额外字段。

**风险**：
- `emitGateRejection` (hard-verification-gate.ts L173-187) 手动注入了 `violationLevel: "P3"` — 但这是唯一的例外
- 其他 emit 方法完全缺少这些字段
- 下游 handler 如果从 EventPayloadMap 按类型提取 → 字段为 `undefined`

**修复建议**：
- `emitAmendmentProposed` 应在参数中包含 `amendmentId: string`
- 或在 `_emit()` 中自动生成 `amendmentId`
- 同理处理其他治理事件

---

### 🛑 问题 C：SkillPipeline NodeComplete 发射时 agentType 类型从 AgentType 降级为 string

**严重级别：⚠️ 潜在运行时类型信息丢失**

**文件**：`packages/engine/src/memory/skill-pipeline.ts`

**证据**：
```typescript
// skill-pipeline.ts L97-106 — diagnostics 输出
payload: {
  nodeId,
  agentType: agentType as string,  // ← 从 AgentType 降级为 string
  success: true,
  output: `[skill-extractor] ${diag}`,
}

// skill-pipeline.ts L137-149 — 注册成功输出  
payload: {
  nodeId,
  agentType: agentType as string,  // ← 同上
  success: true,
  output: `[skill-extractor] 成功注册 ...`,
}
```

**EventPayloadMap 要求**（`packages/shared/src/infra.ts`）：
```typescript
[PipelineEventType.NodeComplete]: { 
  nodeId: string; 
  agentType: AgentType;  // ← 具体联合类型，不是 string
  ...
};
```

**影响**：
- 当下游 handler 按 `agentType as AgentType` 使用时（switch/case 等），运行时 `string` 可能不匹配任何已知 `AgentType`
- 分支逻辑可能走入 `default` 或错误路径
- 直接崩溃概率低，但**分支错了可能导致行为异常**

**修复建议**：去除 `as string` 强制转换，保持 `AgentType` 类型

---

### 🛑 问题 D：emitGateRejection 发射 GovernanceComplianceViolation 时 payload 缺少 required `severity`（与 EventPayloadMap 不一致但自洽）

**文件**：`packages/engine/src/core/hard-verification-gate.ts` L173-187

**代码**：
```typescript
payload: {
  ...originalEvent,               // source 被覆盖
  severity: "FYI",                // ← 这里手动设置了
  source: "rule-denied" as const, 
  summary: `硬验证门拒绝: ${denialReasons}`,
  detail: JSON.stringify(result.verdicts),
  suggestedAction: "fix",
  violationLevel: "P3",           // ← 手动提供了 EventPayloadMap 要求的字段
}
```

**分析**：这里手动注入了 `violationLevel: "P3"`，所以 EventPayloadMap 要求被满足。但其他治理事件没有这样做。 ✅ 此处自洽

---

## 三、非阻断性问题

### ⚠️ 代码法典 §五 违反：裸 console.warn/error/log

| 位置 | 语句 | 性质 |
|------|------|------|
| `engine/src/core/scheduler.ts:162` | `console.log(...)` | ❌ 裸 console.log |
| `engine/src/core/degradation-boundary.ts:55` | `console.warn(msg)` | ❌ 裸 console.warn（标注 Phase 5 过渡） |
| `engine/src/core/degradation-boundary.ts:59` | `console.error(msg)` | ❌ 裸 console.error（标注 Phase 5 过渡） |
| `engine/src/memory/pipeline.ts:96` | `console.warn(...)` | ❌ 裸 console.warn（catch 中降级日志） |
| `tui/src/event-bus.ts:63` | `console.warn(...)` | ❌ 裸 console.warn（TUI 层，非生产） |
| `scheduler/src/core/task-board.ts:349` | `console.error(...)` | ❌ 裸 console.error（fallback when no observer） |

### ⚠️ 代码法典 §10.3-bis 违反：as any 使用

| 位置 | 语句 | 性质 |
|------|------|------|
| `engine/tests/governance-events.test.ts` | 多处 `as any` | ❌ 测试代码中大量 as any 掩盖真实 payload 类型问题 |
| `tui/tests/event-bus.test.ts` | 多处 `as any` | ❌ 同上 |

### ⚠️ 代码法典 §一 catch 块

| 位置 | 语句 | 分析 |
|------|------|------|
| `scheduler/src/core/pipeline-runner.ts:53` | `catch { /* 静默 */ }` | ✅ 有显式注释，合规 |
| `tui/src/event-bus.ts:60` | `catch (_err) { /* 静默吞掉... */ }` | ✅ 有显式注释，合规 |

---

## 四、编译状态

**结论：当前代码可以通过编译（tsc --noEmit 零错误）**。

原因：`ObservableEvent` 的泛型参数 `T` 默认值为 `PipelineEventType`（枚举类型），在条件类型 `T extends keyof EventPayloadMap ? EventPayloadMap[T] : unknown` 中，TypeScript 将 `PipelineEventType` 视为枚举类型而非其成员值的联合，导致条件分支回退到 `unknown`。因此任何 payload 形状都能通过类型检查——**这是类型系统的隐性安全阀，也是上面所有运行时问题的根源**。

---

## 五、星盘总结

| # | 问题 | 严重级别 | 是否阻断 | 根因 |
|---|------|---------|---------|------|
| A | NotificationRuntime ErrorReported payload 形状错误 | ⚠️ 潜在崩溃 | **部分阻断** | `{ message }`→应为 `{ source, severity, error }` |
| B | GovernanceEventEmitter 缺少 EventPayloadMap 额外字段 | ⚠️ 运行时数据缺失 | 潜在 | 治理事件字段未对齐 EventPayloadMap |
| C | SkillPipeline agentType 类型降级 | ⚠️ 类型信息丢失 | 非阻断 | `AgentType`→`string` 窄化丢失 |
| D | emitGateRejection 自洽 | ✅ 正常 | 无障碍 | `violationLevel: "P3"` 已注入 |
| — | 多处裸 console.warn/error/log | ⚠️ 规范违规 | 非阻断 | 未走 PipelineObserver 管道 |
| — | 测试代码 as any | ⚠️ 掩盖真实问题 | 非阻断 | 类型检查被绕过 |

**阻断性问题 1 个**：#A — NotificationRuntime 发射 ErrorReported 时 payload 字段缺失，下游 handler 直接访问缺失字段时将运行时崩溃。

**建议修复优先级**：
1. **🔥 P0**: 修复 #A — 立即修复 payload 形状对齐 EventPayloadMap
2. **🔸 P1**: 修复 #B — 治理事件补全 EventPayloadMap 要求的额外字段
3. **🔸 P1**: 修复 #C — 移除 `as string` 保持 AgentType 类型
4. **🔹 P2**: 迁移裸 console.warn/error/log 到 PipelineObserver 管道
