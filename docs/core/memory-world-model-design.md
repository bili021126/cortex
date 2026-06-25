# 记忆层 RIM + 世界模型改造设计

> 定位：场景检索调度层的世界模型版本。将 RIM 的 V/M/C 三层映射到记忆层的读写路径。关联：`docs/core/scene-retrieval-scheduler-design.md`、`docs/analysis/rim-world-model-cortex-insights.md`。

---

## 段一：现状——被动记忆模型

```
事件发生 → MemoryStore.write()  →  存（无预测）
查询发生 → MemoryStore.query()  →  CognitionEngine 打分 → 返回
            ↑ 完全被动，等外部来调
```

### 缺失

| 缺口 | 影响 |
|------|------|
| 无预测编码（V） | 写入时不标注"未来在什么场景有用"，导致检索盲查 |
| 无预测检索（M） | 场景切换时不预判需要什么记忆，每次冷启动 |
| 无域门控（C） | 工程记忆和亲密记忆混在一起打分，效率低且不安全 |
| 无原子操作事件 | 记忆的读/写/遗忘/域切换不可追溯，权轴 Agent 无法审计 |

---

## 段二：设计——主动记忆模型

### 总览

```
                    MemoryWorldModel
                    ┌──────────────────────────────────────────────┐
                    │                                              │
  事件 →─────────→ │ V: PredictiveEncoder                          │
  (Agent执行,       │    write 时附加 scene×persona 预测标记       │
   用户输入,        │    "这条记忆未来在什么场景有用？"            │
   系统事件)        │                                              │
                    │ M: PredictiveRetriever                       │
  场景 →─────────→ │    场景切换时预判需要哪些记忆 → 预热          │
  (scene+persona)   │    "当前场景接下来需要什么记忆？"            │
                    │                                              │
                    │ C: DomainGateController                      │
                    │    只激活相关域，不相关域完全不参与检索       │
                    │    "当前应该激活哪些记忆域？"                │
                    │                                              │
                    └──────────────┬───────────────────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
          MemoryStore        MemoryStore        MemoryStore
           (不改)             (不改)             (不改)
```

MemoryStore 保持纯存取不动。MemoryWorldModel 在外面包三层。

### V 层——预测编码（写路径）

```typescript
// packages/retrieval-scheduler/src/predictive-encoder.ts

interface PredictiveEncoding {
  content: string;
  embedding: number[];
  relevancePredict: {           // 🆕 预测张量——写时附加，读时利用
    scenes: RetrievalScene[];   // "未来可能在这些场景被需要"
    personas: PersonaId[];      // "未来可能被这些人格检索"
    decayCurve: number[];       // "预测的重要性衰减曲线"
  };
}

class PredictiveEncoder {
  encode(
    entry: MemoryEntry,
    context: { scene: RetrievalScene; persona: PersonaId; taskType: string }
  ): PredictiveEncoding {
    return {
      ...entry,
      relevancePredict: {
        // 规则驱动（Phase 1），未来可升级为 LLM 驱动
        scenes: this.inferScenes(context),
        personas: this.inferPersonas(context),
        decayCurve: this.defaultDecay(entry.weight),
      },
    };
  }
}
```

### M 层——预测检索（读路径）

```typescript
// packages/retrieval-scheduler/src/predictive-retriever.ts

class PredictiveRetriever {
  onSceneChange(from: RetrievalScene, to: RetrievalScene): void {
    const predicted = this.predictRelevant(to);
    this.memoryStore.warmup(predicted); // 🆕 预热：frozen/warm → active
  }

  predictRelevant(scene: RetrievalScene): MemoryEntry[] {
    return this.memoryStore.query({
      domain: sceneToDomain(scene),
      relevanceFilter: {
        scenes: { $in: [scene] },     // 只查预测过"在这个场景有用"的条目
      },
    });
  }
}
```

### C 层——域门控（检索入口）

```typescript
// packages/retrieval-scheduler/src/domain-gate.ts

class DomainGateController {
  private activeDomains: Set<string> = new Set(["engineering"]);

  setActiveDomains(scene: RetrievalScene, persona: PersonaId): void {
    this.activeDomains = this.loadGateConfig(scene, persona);
  }

  apply(memoryStore: IMemoryStore): void {
    memoryStore.setDomainFilter({
      allow: [...this.activeDomains],
      // block 的不参与检索——不是查完再过滤，是检索时不激活
    });
  }
}
```

### 原子操作事件（横切——Mem:* 事件流入遥测因果链）

MemoryWorldModel 的每个关键操作 emit 遥测事件，携带 `causalChain`：

```typescript
// packages/retrieval-scheduler/src/memory-events.ts

// V 层——写入事件
PipelineObserver.emit('Mem:Written', {
  entryId: string,
  domain: MemoryDomain,
  scene: RetrievalScene,
  causalChain: { spanId, directCause: prevEventId, upstreamEvents: [...] }
});

// M 层——策略选择事件
PipelineObserver.emit('Mem:RetrievalStrategySelected', {
  scene: RetrievalScene,
  persona: PersonaId,
  preset: string,
  weighting: Record<string, number>,
  causalChain: { spanId: querySpanId }
});

// C 层——域切换事件
PipelineObserver.emit('Mem:DomainGateUpdated', {
  from: string[],
  to: string[],
  triggeredBy: 'scene-change' | 'persona-change' | 'manual',
  causalChain: { spanId, directCause: sceneChangeEventId }
});

// 遗忘事件
PipelineObserver.emit('Mem:ObliterationTriggered', {
  entryId: string,
  reason: string,
  causalChain: { spanId, directCause: maintenanceEventId }
});
```

**关键约束**：
- 记忆操作事件不是记忆内容本身——它们是记忆操作的审计记录。
- `Mem:Written` 的 payload 不包含记忆内容，只包含 entryId + domain + scene。内容走 MemoryStore 存储。
- 所有 Mem:* 事件共享同一个 spanId（如果它们属于同一个操作上下文）。
- 权轴 Agent（凝光/钟离/Sentinel）订阅 Mem:* 事件进行审计和态势感知。

### 与 CognitionEngine 的关系

```
MemoryWorldModel               CognitionEngine              MemoryStore
─────────────────────────────────────────────────────────────────────────

V: PredictiveEncoder           不改                          write()
   写时附加预测标记
                               ↓
M: PredictiveRetriever         scoreAndRank()                query()
   场景切换 → 预判 → warmup    （预热后打分更快）
                               ↓
C: DomainGateController        仅对被激活域打分              domain 过滤
   只激活相关域                不激活的域不参与
```

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `packages/memory-store/src/memory-store.ts` | MemoryStore 纯存取不变 |
| `packages/memory-store/src/cognitive-engine.ts` | 打分算法不变，域门控在外面过滤 |
| `packages/shared/src/context-policy.ts` | ContextPolicy 作为 fallback |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| 🆕 `packages/retrieval-scheduler/src/predictive-encoder.ts` | V 层编码 | ~50 |
| 🆕 `packages/retrieval-scheduler/src/predictive-retriever.ts` | M 层预测检索 | ~60 |
| 🆕 `packages/retrieval-scheduler/src/domain-gate.ts` | C 层域门控 | ~40 |
| ✏️ `packages/shared/src/memory.ts` | MemoryEntry 加 `domain` 字段 | 1 |
| ✏️ `packages/shared/src/memory.ts` | MemoryQuery 加 `domainGate` 参数 | 3 |

### Core-2 升级路径（Phase 3+）

| 事项 | 描述 |
|------|------|
| V 层 LLM 驱动 | 从规则推断 scene 升级为 LLM 推断（当前规则已够用） |
| M 层 LLM 预测 | 场景切换时 LLM 预判需要加载的记忆（当前规则已够用） |
| 影响预测 | "改 A 包 B 包会炸吗？"——需要 DependencyGraph + 代码变更 diff |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | domain-gate.ts（C 层——最基础） | ~40行 | 检索调度层 P0 |
| P1 | predictive-encoder.ts（V 层） | ~50行 | MemoryEntry 加 domain |
| P2 | predictive-retriever.ts（M 层） | ~60行 | V 层 + C 层 |
| P3 | LLM 驱动升级 | ~40行 | 规则版验证通过 |
