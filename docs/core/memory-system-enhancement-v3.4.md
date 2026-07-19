# Cortex 记忆系统增强与统合

**定位**：本设计规范定义 Core-3 记忆系统增强方案——将 cyrene 子系统（Judge/Compressor/Resolver）接入 memory-store 的 maintain() 周期管线，同时吸收 openclaw Dreaming 和 Memory Budget 模式。

**关联文档**：Cortex 概念顶层设计 v3.4 §九、cyrene/rag/index.ts、memory-store/src/memory-store.ts

---

## 段一：现状诊断

### 已存在的零件

| 零件 | 位置 | 状态 |
|------|------|------|
| `MemoryStore.maintain()` | `memory-store/src/memory-store.ts:627` | ✅ 周期维护入口，同步方法 |
| `WeightAger` | `memory-store/src/weight-ager.ts` | ✅ 权重老化 + 归档/湮灭候选识别 |
| `CognitiveEngine` | `memory-store/src/cognitive-engine.ts:1-485` | ✅ 贝叶斯评分 + 傅里叶衰减 + 艾宾浩斯 + 联想链 |
| `MemoryStateMachine` | `memory-store/src/memory-state-machine.ts` | ✅ 四态模型（Active→Archived→Frozen→Obliterated） |
| `HybridRetriever` | `memory-store/src/hybrid-retrieval.ts` | ✅ 向量+BM25 混合检索 |
| `BM25Index` | `memory-store/src/bm25-index.ts` | ✅ CJK bigram 分词 |
| `DedupService` | `memory-store/src/dedup-service.ts` | ✅ 内容+向量去重 |
| cyrene `MemoryJudge` | `memory/src/cyrene/memory-judge.ts` | ✅ LLM 从对话提取记忆候选，已移植 |
| cyrene `MemoryCompressor` | `memory/src/cyrene/memory-compressor.ts` | ✅ Reflection + 聚类压缩，已移植 |
| cyrene `MemoryResolver` | `memory/src/cyrene/memory-resolver.ts` | ✅ 冲突检测+解析，已移植 |
| cyrene `MemoryAudit` | `memory/src/cyrene/memory-audit.ts` | ✅ 6 种审计告警码，已移植 |
| cyrene RAG | `memory/src/cyrene/rag/` | ✅ 独立 talk persona RAG（JSON+IVF+BM25+Worldbook） |

### 缺失的零件

| 缺口 | 影响 |
|------|------|
| **cyrene 与 memory-store 无管线连接** | Judge/Compressor/Resolver 是独立模块，从未被 maintain() 调用。LLM 分析能力闲置 |
| **无 Dreaming 后台巩固** | 短期召回信号未被系统性地收集→打分→晋升，只有固定的 20轮硬触发 |
| **无 Memory Budget** | maintain 只做归档/湮灭，没有"按 token 预算裁剪旧记忆"的能力 |
| **cyrene 子系统的 LLM 调用独立于 resilience** | Judge/Compressor/Resolver 的 LLM 调用不走 `resilienceFactory`，无重试/断路器保护 |
| **无跨后端查询统一接口** | talk persona 检索走 cyrene RAG，引擎检索走 memory-store——无统一入口 |

### 当前调用链

```
talk-mode 触发:
  用户输入 → talk persona LLM 响应 → 累计 N 轮
    → MemoryScheduler 判断是否触发
      → MemoryJudge(LLM) 提取候选
        → MemoryManager.writeMemory() 写入 cyrene-memory-store
          → MemoryConflict 检测
            → MemoryResolver(LLM) 解析
              → MemoryCompressor(LLM) 每20轮压缩+Reflection

engine 调度触发:
  TaskNode → agent.execute() → MemoryStore.write() → maintain() 定期
    → WeightAger.freezeStale() + obliterateFrozen()
      → archive() / obliterate()
```

**问题**：两条链路完全平行，互不感知。talk persona 的记忆永远不会进入引擎的 maintain() 管线。

---

## 段二：设计

### 总览

让 `MemoryStore.maintain()` 成为**统一的记忆维护入口**，将 cyrene 的 Judge/Compressor/Resolver 作为 maintain() 的**可选增强阶段**注入。同时吸收 openclaw 的 Dreaming（后台巩固）和 Memory Budget（预算裁剪）模式。

```
maintain() 增强后管线:
  Phase 0: WeightAger（权重老化）         [已有]
  Phase 1: archive/obliterate（归档/湮灭） [已有]
  Phase 2: Dreaming（后台巩固）🆕         短期召回信号→评分→阈值→晋升
  Phase 3: Judge→Compressor（LLM增强）🆕  调用 cyrene 子系统（可选，需 LLM）
  Phase 4: Memory Budget（预算裁剪）🆕    按 token 预算驱逐低权重记忆
```

### 核心接口

```typescript
// 新增：维护阶段枚举
enum MaintainPhase {
  WeightAging = 0,
  ArchiveObliterate = 1,
  Dreaming = 2,
  LlmEnhance = 3,
  Budget = 4,
}

// 新增：Dreaming 召回信号
interface DreamingSignal {
  memoryId: string;
  recallCount: number;       // 近期召回次数
  lastRecalledAt: number;    // 最后召回时间
  source: "search" | "talk"; // 来源
}

// 新增：MemoryBudget 配置
interface MemoryBudgetConfig {
  maxTotalTokens: number;     // 总 token 预算
  maxPerEntryTokens: number;  // 单条上限
  evictPolicy: "lru" | "lfu"; // 驱逐策略
}
```

### 使用路径

| 路径 | 触发者 | 时机 | 产出 |
|------|--------|------|------|
| maintain() 标准路径 | engine bootstrap 周期 | 每次 dispatch 结束后 | 归档+湮灭 |
| Dreaming 路径 | maintain() Phase 2 | 召回信号≥阈值 | 记忆晋升 |
| LLM 增强路径 | maintain() Phase 3 | 累积≥20轮或 24h | 压缩+Reflection |
| Budget 路径 | maintain() Phase 4 | token 超预算 | 驱逐旧记忆 |

### 边界条件（不做什么）

- **不合并存储后端**：SQLite（memory-store）和 JSON（cyrene RAG）保持独立。统一的是维护管线，不是存储层
- **不删除 cyrene/rag 子系统**：它是昔涟 talk persona 的独立 RAG，不在本设计范围内
- **不在 maintain() 中引入异步 LLM 调用阻塞**：Phase 3 通过 `void` fire-and-forget 或独立 worker 执行
- **不改变 MemoryStore 的四态模型**：Archive→Frozen→Obligated 流转不变

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `memory-store/src/memory-store.ts` maintain() 签名 | 保持同步返回 `MaintainReport`，Phase 2-4 通过 fire-and-forget 追加 |
| `memory/src/cyrene/rag/` 全部 | 独立 talk persona RAG，不在本次增强范围 |
| `memory-store/src/weight-ager.ts` | Phase 0/1 逻辑完整 |
| `memory-store/src/memory-state-machine.ts` | 四态模型不变 |

### 要改的

| 文件 | 改动 | 行数估算 |
|------|------|---------|
| `memory-store/src/memory-store.ts` | maintain() 末尾追加 `void this._postMaintain()` fire-and-forget 入口 | ~5 |
| **新建** `memory-store/src/dreaming.ts` | Dreaming 信号收集+评分+晋升 | ~80 |
| **新建** `memory-store/src/memory-budget.ts` | MemoryBudget 裁剪逻辑 | ~60 |
| `memory-store/src/memory-store.ts` | 新增 `recordRecall(memoryId, source)` 用于收集 Dreaming 信号 | ~10 |
| **新建** `memory-store/src/maintain-pipeline.ts` | MaintainPipeline 编排器，组合 Phase 0-4 | ~50 |
| `memory/src/cyrene/memory-scheduler.ts` | 改为导出 Judge/Compressor 的配置信号，供 maintain() 读取 | ~20 |

### 暂不做的

| 事项 | 延期原因 |
|------|---------|
| cyrene LLM 调用接入 resilienceFactory | 需要解决循环依赖：memory→resilience vs resilience→memory |
| 跨后端统一查询接口 | 需要设计 IMemoryBackend 抽象层，属于 Core-4 |
| openclaw Memory Wiki (claims/evidence) | 信念层需要先稳定检索层 |

---

## 段四：实施路径

| Phase | 事项 | 代码量 | 前置依赖 | 验收标准 |
|:---:|------|:---:|---|------|
| P0 | Dreaming 信号收集 `recordRecall()` | ~10行 | 无 | write+read 路径各注入一行信号记录 |
| P0 | Dreaming 后台巩固 | ~80行 | P0 | 日志出现 `[Dreaming] promoted` 标记 |
| P1 | Memory Budget 裁剪 | ~60行 | P0 | 日志出现 `[Budget] evicted N entries` |
| P1 | MaintainPipeline 编排器 | ~50行 | P0,P0 | maintain() 增强后 typecheck 通过 |
| P2 | cyrene 信号对接 | ~20行 | P1 | memory-scheduler 导出信号格式对接 maintain() |
| P3 | cyrene LLM 调用接入 resilience | ~30行 | P2 | Judge/Compressor 调用走 resilienceFactory |
| P4 | 跨后端查询统一接口 | 设计阶段 | P3 | 设计文档完成，不入代码 |

### P0 验收标准

```
1. pnpm typecheck 全绿
2. maintain() 返回的 MaintainReport 中新增 dreamingPromoted 字段
3. 至少一个 recall 信号收集点（read 路径）写入调试日志
```

---

*设计规范 v1.0。代码即真相。测试即实证。CI 即硬防线。*
