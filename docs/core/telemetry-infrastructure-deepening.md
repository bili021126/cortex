# 遥测基础设施深化设计

> 定位：原则五（统一可观测）的落地升级。在所有裂合操作之前先建基础设施——不是改业务逻辑，是给现有路径加观测点。
> 关联：`docs/cortex-evolution-master-plan.md`、`docs/audit/novel-concepts-conflict-check.md` 冲突 3/5/6/7。

---

## 段一：现状诊断——观测盲区

### 已覆盖的

| 域 | 覆盖方式 | 状态 |
|----|---------|------|
| Agent 执行 | `PipelineObserver.emit()` | ✅ |
| Scheduler 调度 | `PipelineObserver.emit()` | ✅ |
| 确认门 | `ConfirmGate.recordDecision()` | ✅ |
| 工具调用 | `Toolkit.execute()` 审计 | ✅ |

### 盲区（关键路径无观测）

| 盲区 | 影响 | 冲突号 |
|------|------|--------|
| 配置加载/覆盖/热加载/校验失败 | 配置变动的因果关系不可追溯 | 冲突 3 |
| 检索策略选择（为什么用这组权重） | 检索质量无法调试 | — |
| Domain 过滤（挡掉了什么） | 域隔离失效无法发现 | 冲突 7 |
| 空 catch 静默（频率/类型/位置） | 系统健康状态盲区 | 冲突 6 |
| 通知路由决策（事件走到了哪个通道） | 治理信号不可追溯 | 冲突 5 |
| 记忆写入/预热/遗忘 | 记忆生命周期不透明 | — |

### 当前架构瓶颈

```
PipelineObserver.emit()
  │
  ▼
NotificationPipe
  │
  └── 当前只有"发生了什么"（what）
      没有"为什么发生"（why）
      没有"没发生什么"（what didn't happen）
      没有"改变了什么"（what changed）
```

---

## 段二：设计

### 2.1 三层遥测模型

```
┌─────────────────────────────────────────────────────────────┐
│                    TelemetryLayer                           │
│                                                             │
│  L1: EventBus（已有）                                       │
│       PipelineObserver.emit() → 结构化事件                   │
│       覆盖：执行流、调度流 ✅                                │
│                                                             │
│  L2: AuditTrail（新增）                                     │
│       审计日志——不是事件，是决策记录                          │
│       覆盖：配置变更、domain 过滤、降级统计                  │
│       特点：低频率、压缩存储、可查询                          │
│                                                             │
│  L3: MetricCounter（新增）                                  │
│       实时计数器——不记录单条，只记录统计                     │
│       覆盖：降级频率、检索延迟、缓存命中率                    │
│       特点：高频、内存化、定期 flush                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 新增事件类型（EventBus 扩展）

```typescript
// packages/shared/src/infra.ts PipelineEventType 新增

// 配置域
'ConfigOverrideApplied',      // 环境变量/用户级覆盖了默认值
'ConfigReloaded',             // 热加载完成
'ConfigSchemaViolation',      // Schema 校验失败（启动时致命）

// 检索域
'RetrievalStrategySelected',  // 检索策略被选择（记录：为什么选这组权重）
'DomainGateUpdated',          // 域门控切换

// 记忆域  
'MemoryWarmupInitiated',      // 预热开始
'MemoryObliterationTriggered',// 遗忘触发

// 降级域
'DegradationThresholdBreached', // 降级计数器超阈值
```

### 2.3 审计日志（AuditTrail）

```typescript
// packages/telemetry/src/audit-trail.ts

interface AuditEntry {
  timestamp: number;
  category: 'config' | 'domain-gate' | 'degradation' | 'retrieval';
  action: string;
  detail: Record<string, unknown>;  // 不存完整 payload，存摘要
}

class AuditTrail {
  // 配置类
  recordConfigOverride(key: string, source: 'env' | 'user' | 'project', oldValue: unknown, newValue: unknown): void;
  recordConfigReload(watchPath: string, changedKeys: string[]): void;
  recordConfigViolation(schemaName: string, errors: string[]): void;

  // 域门控
  recordDomainFilter(query: string, allowed: string[], blocked: string[], stats: { allowed: number; blocked: number }): void;

  // 降级
  recordDegradation(source: string, level: 'trace' | 'escalate', errorType: string): void;

  // 持久化：追加写入，定期 rotate
  flush(): Promise<void>;
}
```

#### 实施现状（2026-09-26 实测回填）

上面的接口是提案形状，落地时不同，且本段新增两条实测结论：

**接口出入**（以 `packages/telemetry/src/audit-trail.ts` 为准）

- 判型字段是 `type`（`"config_override" | "config_reload" | "config_violation" | "domain_filter" | "degradation"`），不是 `category`
- `flush()` / `close()` 是**同步** `void`（内部 `fs.fsyncSync` / `fs.closeSync`）
- `recordDomainFilter` 的 stats 是 `{ total, allowedCount, blockedCount }`
- 另有读取端 `queryBySpan(spanId)`（提案里没有，后来按 NP-6 的化解方案补的）

**`config_violation` 是幂等的**（`type: config_violation` 与其他 record* 语义不同）

`config_violation` 描述的是**配置的当前状态**，不是「发生了一件事」。同一 `(schemaName, errors)`
在同一个日志世代内只落盘一次——首次调用时从 `audit.jsonl` 播种签名集，之后走内存缓存；后到的重复观测不追加。

这是被实测逼出来的：`recordBootstrapAudit` 每次 `bootstrapEngine` 都无条件记录 `config.warnings`，
而跨字段校验警告是**仓库配置的静态属性**、不随运行变化。实测 `audit.jsonl` 里同一签名累积 **882 条**
（单条约 1966 字节 ≈ 1.73 MB），占该文件 2.55 MB 的 **68%**；`engine/tests/integration/audit-bootstrap.test.ts`
的 T2/T3 当时正是靠这堆残留才「通过」的——**假绿**。

去重必须在磁盘上完成：每次 bootstrap 都是新进程、新实例，进程内 Set 挡不住。签名用 NUL/SOH 分隔且
**不做排序**——不同顺序视为不同状态。`errors` 变化即签名变化，仍记新条目，不会掩盖真实的配置修复。
**幂等只适用于 `config_violation`**：其余 record* 是事件，逐次追加。并发写入者为尽力而为语义（不做锁，最坏各记一次）。

**容量：`定期 rotate` 至今未实现，且比提案担心的宽松得多**

`AuditTrail` 构造函数以 `"a"` 打开 `<logDir>/audit.jsonl`，`_append` 走 `fs.writeSync`，
**没有大小上限也没有轮转**。但剔除上述重复后实测真实体量是：删掉 881 条重复后该文件从 2,603,117 字节
降到 **92,267 字节**（443 条，跨度 56 天，约 0.6 MB/年）。所以轮转不是当下的痛点——
真正的教训是**先看数据再定紧迫度**：此前按未去重的文件估算出「约 16 MB/年」，那个数字是错的。

`FileTransport` 同样没有轮转（当前未接线，属潜在陷阱：若按 observability 双通道案把 Logger 提上来，需要一并考虑）。

### 2.4 降级计数器（MetricCounter）

```typescript
// packages/telemetry/src/metric-counter.ts

class MetricCounter {
  // 降级统计
  incrementDegradation(source: string): void;          // 每次 silent 降级 +1
  
  // 检索统计
  recordRetrievalLatency(ms: number): void;
  recordCacheHit(): void;
  recordCacheMiss(): void;
  
  // 门控
  onDegradationBreached(source: string, count: number): void;

  // 每 N 秒 flush 一次
  startPeriodicFlush(intervalMs: number): void;
}
```

当 `silent` 计数器超过阈值 → emit `DegradationThresholdBreached` 事件。

### 2.5 EventPayloadMap 补充

```typescript
// packages/shared/src/infra.ts EventPayloadMap 新增

'ConfigOverrideApplied': {
  key: string;
  source: 'env' | 'user' | 'project';
  oldValue: unknown;
  newValue: unknown;
};
'ConfigReloaded': {
  watchPath: string;
  changedKeys: string[];
};
'ConfigSchemaViolation': {
  schemaName: string;
  errors: { path: string; message: string }[];
};
'RetrievalStrategySelected': {
  scene: RetrievalScene;
  persona?: PersonaId;
  preset: string;
  weighting: Record<string, number>;
  domainGate: { allow: string[]; block: string[] };
};
'DomainGateUpdated': {
  from: string[];
  to: string[];
  triggeredBy: 'scene-change' | 'persona-change' | 'manual';
};
'DegradationThresholdBreached': {
  source: string;
  silentCount: number;
  threshold: number;
  action: 'upgrade-to-trace' | 'upgrade-to-escalate';
};
```

### 2.6 数据流

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ ConfigRegistry│    │ DomainGate   │    │ Degradation  │
│ 覆盖/热加载   │    │ 过滤决策     │    │ Boundary     │
│ 校验失败      │    │              │    │              │
└──┬───────────┘    └──┬───────────┘    └──┬───────────┘
   │                   │                   │
   ├─→ AuditTrail ──→  │                   ├─→ MetricCounter
   │  (写文件)         ├─→ AuditTrail      │   (内存计数)
   │                   │  (写文件)          │       │
   └─→ PipelineObserver│                   │   阈值触发
      .emit() ←────────┘                   │       │
          │                                ├─→ PipelineObserver
          ▼                                │   .emit()
    NotificationPipe                        │
```

L1 EventBus 处理"需要治理流感知的"事件。L2 AuditTrail 处理"需要事后审计但不需实时通知的"。L3 MetricCounter 处理"高频统计不需要存每条的"。

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `packages/scheduler/src/core/pipeline-observer.ts` | emit 接口不改 |
| `packages/notification/src/notification-pipe.ts` | 通道语义不改 |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| ✏️ `packages/shared/src/infra.ts` | PipelineEventType 新增 7 个 + EventPayloadMap 补充 | ~40 |
| 🆕 `packages/telemetry/src/audit-trail.ts` | AuditTrail 类 | ~60 |
| 🆕 `packages/telemetry/src/metric-counter.ts` | MetricCounter 类 | ~50 |
| ✏️ `packages/telemetry/src/index.ts` | 导出新模块 | 2 |
| ✏️ `packages/engine/src/bootstrap/bootstrap-engine.ts` | 启动时初始化 TelemetryLayer | ~10 |

### 集成点（在各包中插桩）

| 集成位置 | 桩内容 | 行数 |
|---------|--------|------|
| `config/registry.ts` | 覆盖/热加载/校验 → AuditTrail + emit | ~15 |
| `retrieval-scheduler/scheduler.ts` | 策略选择 → emit RetrievalStrategySelected | ~5 |
| `retrieval-scheduler/domain-gate.ts` | 过滤 → AuditTrail | ~5 |
| `engine/degradation-boundary.ts` | 降级 → MetricCounter + 阈值 emit | ~15 |
| `memory-store/memory-store.ts` | 预热/遗忘 → emit | ~5 |

### 暂不改的

| 事项 | 延期原因 |
|------|---------|
| 检索延迟/缓存命中率 MetricCounter | 检索调度层先落地 |
| 全量空 catch 改造（23处） | Degradation Boundary Phase 4 |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | PipelineEventType + EventPayloadMap 补充 | ~40行 | 无（纯类型） |
| P1 | AuditTrail + MetricCounter 骨架 | ~110行 | P0 |
| P2 | bootstrap 集成 + config 插桩 | ~25行 | P1 |
| P3 | 检索调度层插桩（等新包建完） | ~10行 | 检索调度层 P1 |
| P4 | Degradation Boundary 插桩（等统一） | ~15行 | Degradation Boundary |

**P1 验收标准**：
- `AuditTrail.recordConfigOverride()` 写入文件，JSONL 格式
- `MetricCounter.incrementDegradation()` 计数正确
- 阈值触发后 emit `DegradationThresholdBreached`
- `tsc --noEmit` 零报错 + 新增 contract test 验证 PayloadMap
