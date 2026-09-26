# 检索调度层设计

> 定位：Core-2 config 声明式编排的子项，与 `governance-routing`、`supervision-activation` 并列。
> 关联：`docs/core/治理层设计-v3.0-全量整合版.md §8`（治理内化），`packages/memory-store/src/cognitive-engine.ts`（CognitionEngine）

---

## 段一：现状诊断

### 已存在的零件

| 零件 | 位置 | 状态 |
|------|------|------|
| MemoryStore.query() | `packages/memory-store/src/memory-store.ts` | ✅ 纯数据检索 |
| CognitionEngine.scoreAndRank() | `packages/memory-store/src/cognitive-engine.ts:511-567` | ✅ 六维打分 |
| DEFAULT_COGNITIVE_CONFIG | `cognitive-engine.ts:79-106` | ✅ 权重硬编码 |
| ContextPolicy 预设 | `packages/shared/src/context-policy.ts:183+` | ✅ chat/test/code-review 等 |
| ContextBuilder.build() | `packages/memory-store/src/context-builder.ts:83-112` | ✅ 按 policy 驱动检索 |
| HCA/CSA 分离 | `cognitive-engine.ts:29-38` | ✅ 模式已区分 |
| CognitionEngine 构造函数 | `cognitive-engine.ts:67-76` | ✅ 支持注入 config 覆盖 |

### 缺失的零件

| 缺口 | 影响 |
|------|------|
| 无 scene + persona → preset 的映射层 | Agent 无法声明"我是谁 + 我要做什么"，检索策略统一 |
| 无 domain 过滤注入点 | 工程记忆和亲密记忆混查，跨域污染 |
| 无 weighting override 机制 | 场景切换时六维权重无法动态调整 |
| retrieval-presets 未外部化 | 六维权重硬编码，无法通过 config 文件修改 |
| 无独立包封装 | 检索调度逻辑散落在 MemoryStore 和 ContextBuilder 之间 |

### 当前调用链

```
Agent / Engine
  │
  ├─→ ContextBuilder.build(policy, node)     ← 按 ContextPolicy 建上下文
  │     └─→ MemoryStore.read(query, mode)     ← 模式过滤 (HCA/CSA)
  │           ├─→ BM25 + Vector 混合检索
  │           └─→ CognitionEngine.scoreAndRank() ← 六维打分
  │
  └─→ 问题：调用方无法声明 scene + persona
       权重、domain、场景策略全由 ContextPolicy 隐式决定
```

---

## 段二：设计

### 总览

```
调用方 (Agent / MetaAgent / 昔涟)
    │
    ▼
RetrievalScheduler                          ← 🆕 新增
    │  input: { scene, persona, task }
    │
    ├─ 加载 retrieval-presets.json          ← config 表
    ├─ 组装 composite preset
    │    · domain 过滤
    │    · weighting override
    │    · active-only 默认
    │
    ├─ 注入到 MemoryStore.query()
    │    └─→ CognitionEngine.scoreAndRank()
    │          └─ 用 override 权重替换 DEFAULT
    │
    └─ 返回 MemoryEntry[]
```

**定位**：夹在 MemoryStore 和上层调用方之间的独立包 `@cortex/retrieval-scheduler`。MemoryStore 保持纯数据存取不改。CognitionEngine 保持"怎么打分"不改。RetrievalScheduler 只负责"怎么选策略"。

### 核心接口

```typescript
// packages/retrieval-scheduler/src/types.ts

/** 检索场景标识 */
type RetrievalScene = 
  | "code-repair"      // 修 bug
  | "code-review"      // 代码审查
  | "architecture"     // 架构分析
  | "cyrene-intimate"  // 昔涟亲密模式
  | "nahida-knowledge" // 纳西妲知识库
  | "general";         // 通用

/** 人格标识 */
type PersonaId = 
  | "cyrene"           // 昔涟（工程）
  | "cyrene-intimate"  // 昔涟（亲密）
  | "nahida";          // 纳西妲

/** 检索预设 */
interface RetrievalPreset {
  scene: RetrievalScene;
  persona?: PersonaId;        // 可选：人格层叠加
  domain: {                   // 域过滤
    allow: string[];          // 允许的 domain
    block: string[];          // 屏蔽的 domain
  };
  weighting: {                // 权重覆盖
    bm25_vector?: number;     // 混合检索
    bayesian?: number;        // 贝叶斯
    fourier?: number;         // 傅里叶
    associative?: number;     // 联想
    emotional?: number;       // 情绪
  };
  activeOnly: boolean;        // 是否仅查 Active（默认 true）
  maxResults: number;         // 最大返回数
}

/** 调度器输入 */
interface RetrievalRequest {
  scene: RetrievalScene;
  persona?: PersonaId;
  task?: { type: string; tags: string[] };  // TaskNode 上下文
  query: string;                            // 检索文本
}
```

### 配置文件结构

```jsonc
// config/data/retrieval-presets.json
[
  {
    "scene": "code-repair",
    "domain": { "allow": ["engineering"], "block": ["intimate", "knowledge"] },
    "weighting": { "bm25_vector": 0.50, "bayesian": 0.25, "fourier": 0.15, "associative": 0.10 },
    "activeOnly": true,
    "maxResults": 20
  },
  {
    "scene": "cyrene-intimate",
    "persona": "cyrene-intimate",
    "domain": { "allow": ["intimate"], "block": ["engineering", "knowledge"] },
    "weighting": { "bm25_vector": 0.10, "bayesian": 0.25, "associative": 0.65 },
    "activeOnly": false,
    "maxResults": 10
  }
]
```

### 使用路径

| 路径 | 调用方 | 时机 | 产出 |
|------|--------|------|------|
| P1 | Agent.execute() 前 | 每个 TaskNode 执行 | 上下文注入 |
| P2 | ButlerAgent.notify() | 事件到达 | 通知增强 |
| P3 | 昔涟模式切换 | 工程↔亲密 | domain 重切换 |

### 边界条件

- **不改** MemoryStore.query() 签名——调度器在外部拦截
- **不改** CognitionEngine 内部逻辑——只透传 override 权重
- **不替代** ContextPolicy——调度器是 ContextPolicy 的上游路由层
- **不处理** embedding 生成——那是写路径的事

---

## 段三：与现有代码的精确咬合

### 不改的

| 文件 | 原因 |
|------|------|
| `packages/memory-store/src/memory-store.ts` | MemoryStore 保持纯存取，不在内部加调度逻辑 |
| `packages/memory-store/src/cognitive-engine.ts` | CognitionEngine 已支持构造注入 config，不改内部 |
| `packages/shared/src/context-policy.ts` | ContextPolicy 作为 fallback 继续使用 |

### 要改的

| 文件 | 改动 | 行数 |
|------|------|------|
| 🆕 `packages/retrieval-scheduler/` | 新建包：package.json + tsconfig + src/ | ~20 |
| 🆕 `packages/retrieval-scheduler/src/types.ts` | RetrievalPreset / RetrievalRequest 接口 | ~40 |
| 🆕 `packages/retrieval-scheduler/src/scheduler.ts` | RetrievalScheduler 类 | ~80 |
| 🆕 `packages/retrieval-scheduler/src/preset-loader.ts` | 从 config/data/ 加载预设 | ~30 |
| 🆕 `config/data/retrieval-presets.json` | 预设配置文件 | ~50 |
| ✏️ `packages/engine/src/core/context-builder.ts` | ContextBuilder 适配新入口 | ~10 |
| ✏️ `packages/config/package.json` | 加 `"@cortex/retrieval-scheduler": "workspace:*"` | 1 |
| ✏️ `packages/vitest.workspace.ts` | 注册新包 | 1 |

### 暂不改的

| 事项 | 延期原因 |
|------|---------|
| Agent 执行路径全量切换到调度器 | 需要先验证独包逻辑正确 |
| MemoryEntry 加 domain 字段 | 需 migration，Core-2 后期 |
| 纳西妲知识库独立 domain | 需人格记忆层先落地 |

---

## 段四：实施路径

| 优先级 | 事项 | 代码量 | 前置依赖 |
|--------|------|--------|---------|
| P0 | 新建包骨架 + types.ts + preset-loader.ts | ~90行 | 无 |
| P1 | scheduler.ts 实现 | ~80行 | P0 |
| P2 | config/data/retrieval-presets.json 初版 | ~50行 | P0 |
| P3 | ContextBuilder 适配 | ~10行 | P1 + P2 |
| P4 | 昔涟亲密模式接入验证 | ~10行 | P3 |

**P1 验收标准**：
- `import { RetrievalScheduler } from "@cortex/retrieval-scheduler"` 不报错
- `scheduler.query({ scene: "code-repair", persona: "cyrene", query: "..." })` 返回结果
- 返回结果不包含 `domain: "intimate"` 条目（domain 过滤生效）
- 六维权重覆盖生效（用 preset 权重替代 DEFAULT）
- `tsc --noEmit` 全局零报错
