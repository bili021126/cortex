# 世界模型仿真层设计

> 定位：场景检索调度层上游的轻量预测外壳。关联：`docs/core/scene-retrieval-scheduler-design.md`（下游调度层）、`docs/core/memory-world-model-design.md`（RIM 世界模型）。
> 数据源：DeepSeek 外部记忆库 #37「仿真层×场景感知调度层联动设计」+ #38「仿真层×Redis 运行时加速方案」

---

## 段一：设计演变——从独立子系统到轻量外壳

### 原始构想

最初计划在记忆系统和场景调度层之间增加一个独立的世界模型仿真子系统，用于预测任务执行风险、资源消耗和失败概率。映射为三层插入：

```
规划层（预测标签）→ 场景调度层（策略调整）→ 执行层（偏差反馈）
```

类比于前向求导（预测）和反向传播（偏差回传修正）。

### 坍缩后定位

仿真层从独立子系统**坍缩为轻量外壳**：

- **不做**因果推理引擎——因果推理交给 LLM 原生能力
- **不做**独立模型训练——零模型维护开销
- **只做**两件事：提示词模板组装 + 偏差回传记录
- 输出是一个结构体 SimulationResult，喂给下游场景调度层

---

## 段二：架构

```
执行前
  │
  ├─ 调用方 (MetaAgent / TaskNode)
  │     │
  │     ▼
  │  SimulationShell.simulate(task, context)
  │     │
  │     ├─ 1. 组装提示词模板
  │     │     └─ 包含：任务描述、历史偏差统计、当前场景
  │     │
  │     ├─ 2. 调用 LLM 获取预测
  │     │     └─ 输出：SimulationResult
  │     │
  │     ├─ 3. 返回给调用方
  │     │     └─ 下游调度层根据 risk labels 调整策略
  │     │
  │     └─ 4. 执行后偏差回传
  │           └─ SimulationShell.recordDeviation(actual, predicted)
  │
  ▼
执行后 → 偏差回传 → Redis 热缓存 → 异步归档到记忆系统
```

### 核心接口

```typescript
// packages/simulation-shell/src/types.ts

interface SimulationResult {
  risk: {
    overall: 'low' | 'medium' | 'high' | 'critical';
    perStep: Array<{
      step: string;
      risk: 'low' | 'medium' | 'high';
      reason: string;
    }>;
  };
  resourceEstimate: {
    tokenCost: number;       // 预估 token 消耗
    latencyMs: number;       // 预估延迟
    memoryOps: number;       // 预估记忆检索次数
  };
  uncertaintyPoints: string[];  // 不确定点列表——触发并行推测执行
}

interface DeviationRecord {
  taskId: string;
  expected: SimulationResult;
  actual: {
    risk: string;
    tokenCost: number;
    latencyMs: number;
    success: boolean;
  };
  delta: {                    // 偏差量
    riskShift: number;        // 风险等级偏移（-2 ~ +2）
    costOverhead: number;     // 实际 / 预估
    latencyDelta: number;     // 毫秒差
  };
  timestamp: number;
}
```

### 可加重方向（Core-2 升级路径）

| 方向 | 描述 | 前置 |
|------|------|------|
| 不确定点 → 并行推测 | uncertaintyPoints 自动触发并行推测执行 | 编排层支持并行分支 |
| 历史偏差均值 → 降级策略 | 当某场景偏差均值超阈值，自动降级检索策略 | Redis 滑动窗口就绪 |
| 闭环感知-预测-反馈 | 偏差回传数据反哺预测模板质量 | 需要足够历史数据 |

---

## 段三：Redis 运行时加速方案

> 原则：Redis 作为热缓存层，不增加新子系统。所有数据以记忆系统为持久化源，Redis 只做热数据加速。

### 四个落点

| 落点 | Redis 数据结构 | TTL | 用途 |
|------|---------------|-----|------|
| 临时偏差热缓存 | Hash `deviation:{scene}` | 3600s | 避免每次穿透到记忆系统做全量检索 |
| SimulationResult 临时存储 | Hash `simresult:{taskId}` | 600s | 编排周期结束后自动过期 |
| 滑动窗口统计 | Sorted Set `deviation:window:{scene}` | — | 场景调度层查询近期偏差均值 O(log N) 毫秒级 |
| 偏差回传队列 | List `deviation:queue` | — | 异步归档不阻塞编排主流程 |

### 数据流

```
SimulationShell
  │
  ├─ simulate() → 读 cache
  │     ├─ Hash `deviation:{scene}` 命中 → 跳过全量检索
  │     └─ 未命中 → 穿透到记忆系统 → 回填缓存
  │
  ├─ simulate() → 写 simresult
  │     └─ Hash `simresult:{taskId}` → 600s 后自动过期
  │
  ├─ recordDeviation() → 写两个位置
  │     ├─ Sorted Set `deviation:window:{scene}`  ← 实时统计
  │     │     └─ score: timestamp, member: riskShift
  │     └─ List `deviation:queue`  ← 异步归档
  │           └─ 后台 worker 消费 → MemoryStore.write()
  │
  └─ SceneScheduler 读滑动窗口
        └─ ZRANGEBYSCORE → O(log N) → 偏差均值 → 策略调整
```

### 缓存策略

| 场景 | 行为 | 数据一致性 |
|------|------|-----------|
| 命中热缓存 | 直接返回 | — |
| 未命中 | 穿透到记忆系统检索 → 回填 Hash | 最终一致 |
| 过期 | 自动删除 | 零持久化负担 |
| 主动失效 | 当偏差回传写入时，更新 Hash + Sorted Set | 强一致 |

---

## 段四：与场景调度层的联动

```
SimulationShell                      SceneScheduler
──────────────────────────────────────────────────────────────────
simulate(task)
  │
  └─ SimulationResult ──────────────→  scene + risk labels
                                         │
                                         ├─ high/critical → 启用保守策略
                                         ├─ medium → 标准预设
                                         └─ low → 快速路径
                                         │
                                         ├─ 读 Sorted Set 偏差均值
                                         │   └─ 高频偏差场景预降级
                                         │
                                         └─ 策略选择完成 → 执行
```

### 联动接口

只需一个 `SimulationResult` 结构体。场景调度层不需要感知仿真层的内部实现——它只消费 risk labels + resource estimates + uncertainty points。

---

## 段五：实现工作量评估

| 组件 | 类别 | 预估行数 |
|------|------|---------|
| SimulationShell 核心类 | 新增 | ~80 |
| SimulationResult 接口 | 新增 | ~30 |
| 提示词模板 | 新增 | ~40 |
| 偏差回传记录 | 新增 | ~50 |
| Redis 缓存适配器 | 新增 | ~60 |
| 滑动窗口查询 | 新增 | ~30 |
| 异步归档 worker | 新增 | ~40 |
| 场景调度层适配 | 修改 | ~20 |
| **合计** | | **~350行** |

关键技术债：零。仿真层不引入新运行时依赖（Redis 客户端在 Cortex 中已有）。

---

> 修订记录
> - 2026-07-03：初版，基于 DeepSeek 外部记忆库 #37 + #38 同步
