# 上下文管理层设计

> 定位：将散落在多处的上下文机制统一管理——消除 `PRESET_CONTEXT_POLICIES`、`ContextBuilder`、`_resolveContextPolicy()` 之间的耦合。关联：Phase 3（ConfigRegistry + 检索调度层）。

---

## 现状——散落

```
散落的上下文机制
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PRESET_CONTEXT_POLICIES        →  config/data/context-policies.ts  ✅ 已迁
  "chat/single-step/code-refactor/..." 7 个策略预设

ContextBuilder                 →  memory-store/context-builder.ts
  "按 ContextPolicy 建 prompt"

_resolveContextPolicy()        →  engine/core/meta-agent.ts L645-665
  "tag→策略映射" 硬编码规则

Scene 分配                     →  尚未实现
  "甘雨 plan() 分配 scene"
```

问题：ContextBuilder 直接读 ContextPolicy 参数——它不知道"为什么选这个策略"。MetaAgent 的 `_resolveContextPolicy()` 是 tag→策略的硬编码映射，改策略要改 engine 源码。

---

## 设计——统一

```
                    ContextManager 🆕
                    ┌────────────────────────────────────────┐
                    │                                        │
  scene ─────────→ │ resolve({                               │
  persona ───────→ │   scene: RetrievalScene,               │
  task ─────────→ │   persona: PersonaId,                  │
                    │   task: { type, tags }                 │
                    │ }): ResolvedContext                    │
                    │                                        │
                    │  1. 查 context-policies.json           │
                    │  2. 组合 token 预算 + 检索参数          │
                    │  3. 返回 ResolvedContext                │
                    │                                        │
                    └────────────┬───────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ContextBuilder  RetrievalScheduler  TokenBudget
              (memory-store)  (retrieval-scheduler)  (config)
```

**新包**：`packages/context-manager/` — `@cortex/context-manager`

### 核心接口

```typescript
interface ContextResolveInput {
  scene: RetrievalScene;
  persona?: PersonaId;
  task?: { type: string; tags: string[] };
}

interface ResolvedContext {
  policyId: string;
  tokenBudget: { critical: number; support: number; reference: number };
  retrieval: { mode: 'HCA' | 'CSA'; weighting: Record<string, number> };
  pipeline: { assemble: string; sort: string };
  reason: string;  // 为什么选这个策略
}

class ContextManager {
  constructor(configRegistry: ConfigRegistry);
  resolve(input: ContextResolveInput): ResolvedContext;
}
```

### 三条使用路径

| 路径 | 调用方 | 时机 |
|------|--------|------|
| P1 | MetaAgent.plan() | plan 时解析 scene → 注入 TaskNode |
| P2 | ContextBuilder | build 前获取 ResolvedContext |
| P3 | RetrievalScheduler | query 前获取检索参数 |

### 与现有代码的关系

```
ContextPolicy（类型）    → shared 保留，作为 ResolvedContext 的返回类型基底
PRESET_CONTEXT_POLICIES  → config 已迁 ✅
ContextBuilder           → 改为接收 ResolvedContext 而非直接查 policy
_resolveContextPolicy()  → 替换为 ContextManager.resolve()
Scene 分配               → 甘雨 plan() 调 ContextManager
```
