# 全量代码审计：问题总录

> 定位：Core-2 过渡阶段的全量基线。逐层逐包审计，按严重度分类，每个问题标注来源（终态报告/硬编码扫描/残余扫描/架构审计）。
> 此文档是概念讨论的前置输入——在讨论"怎么做"之前，先看清"是什么"。

---

## 一、架构层问题

### 1.1 包职责越界（P0）

shared 包定位为"纯类型中枢"，但存在 4 处运行时实现：

| 文件 | 行号 | 内容 | 应迁至 | 状态 |
|------|------|------|--------|------|
| `packages/shared/src/file-lock-manager.ts` | 82 | `InMemoryFileLockManager` 类 | `@cortex/engine` | 自认 FIXME |
| `packages/shared/src/kv-store.ts` | 149 | `InMemoryKvStore<T>` 类 | `@cortex/engine` | — |
| `packages/shared/src/lifecycle.ts` | 71 | `BaseLifecycle` 抽象类 | `@cortex/engine` | — |
| `packages/shared/src/context-policy.ts` | 183 | `PRESET_CONTEXT_POLICIES` 运行时数据 | `@cortex/config` | 已在配置路线图 |

> **影响**：shared 包被 engine/core/CLI 多处 import，这些运行时类通过 shared 间接污染了不应关心运行时的模块。

### 1.2 死代码（P0）

| 文件 | 内容 | 替代 | 状态 |
|------|------|------|------|
| `packages/engine/src/observer/console-bridge.ts` | 完整副本 132 行 | 已从 `@cortex/telemetry` 导入 | engine/src 无任何引用 |

### 1.3 幽灵包（P2）

| 包 | 问题 |
|----|------|
| `packages/toolchain/` | package.json 存在，声明了依赖，但 `src/` 目录不存在 |
| `packages/pm/` | 独立 CLI 工具，源自 solo-flight，无其他包 import，不属于运行时架构 |

### 1.4 代码重复（P1）

| 文件 | 内容 | 重复来源 |
|------|------|---------|
| `packages/engine/src/telemetry/engine-telemetry.ts` | engine-telemetry 副本 | `@cortex/telemetry` 有相同文件，差异仅 `await` vs `void` |

### 1.5 @deprecated 未移除（P2）

| 文件 | 行号 | 标记的导出 |
|------|------|-----------|
| `packages/shared/src/index.ts` | 22-34 | 6 条 `@deprecated` 注释但仍在 barrel 导出：file-lock-manager, kv-store, id-utils, json-utils, context-policy, lifecycle |

---

## 二、配置层问题

### 2.1 硬编码常量和数据（P0×5 + P0×8 共 13 处）

详见子扫结果。核心 5 项：

| # | 文件 | 内容 | 目标表 |
|----|------|------|--------|
| 1 | `shared/src/context-policy.ts:183-302` | `PRESET_CONTEXT_POLICIES` 7 个完整策略 ~120 行 | `context-policies.json` |
| 2 | `shared/src/agent-registry.ts:108-202` | `AGENT_DEFS` 13 个 Agent 定义 + `FULL_TOOLSET` 等 3 套权限表 | `agent-defs.json` + `tool-permissions.json` |
| 3 | `memory-store/src/cognitive-engine.ts:79-106` | `DEFAULT_COGNITIVE_CONFIG` 21 个权重 | `cognition.json` |
| 4 | `memory-store/src/hybrid-retrieval.ts:49-57` | `DEFAULT_HYBRID_CONFIG` 7 个参数 | `hybrid-retrieval.json` |
| 5 | `engine/src/core/notification-runtime.ts:61-69` | `defaultSemantics` 事件→通知映射 7 条 | `governance-routing.json` |

其余 8 项 P0 和 17 项 P1 详见 `docs/core/config-management-deepening.md` 段一。

### 2.2 memory-store 内联常量（P1）

| 文件 | 常量 |
|------|------|
| `packages/memory-store/src/schema.ts:12-38` | `EMBEDDING_DIM=384`, `VECTOR_DEDUP_THRESHOLD=0.95`, `WEIGHT_AGING_FACTOR=0.95`, `STALE_FREEZE_DAYS=30`, `FROZEN_OBLITERATE_DAYS=7`, `MAINTENANCE_WEIGHT_THRESHOLD=0.05`, `SCHEMA_VERSION=5` |

> 应统一到 `@cortex/config`。

### 2.3 重复默认值（P1）

| 位置 A | 位置 B | 重复常量 |
|--------|--------|---------|
| `config/src/engine-defaults.ts:127-128` | `memory-store/src/hybrid-retrieval.ts:49-57` | `retrievalAlpha: 0.45, retrievalBeta: 0.55` |
| `engine/src/core/file-lock-manager.ts:33` | `config/src/engine-defaults.ts` | `DEFAULT_LOCK_TIMEOUT_MS = 30_000` |
| `scheduler/src/dispatch-steps/manifold-gate.ts:19` | `config/src/engine-defaults.ts` | `DEFAULT_ACQUIRE_TIMEOUT_MS = 60_000` |

### 2.4 环境变量 override 不统一

当前仅 `engine-defaults.ts` 有 `_readEnvOverrides()`，其他 config JSON 无此机制。

---

## 三、调度层问题

### 3.1 波浪定义硬编码（P0）

| 文件 | 行号 | 内容 |
|------|------|------|
| `scheduler/src/core/scheduling-implementations.ts:521-526` | L521 | `DEFAULT_WAVE_DEFINITIONS` 4 波 tag→wave 映射 |

### 3.2 策略规则硬编码（P0）

| 文件 | 行号 | 内容 |
|------|------|------|
| `engine/src/core/loop-strategy-registry.ts:76-99` | L76-99 | `canHandle` 阈值（`payload.length < 200` / `payload.length > 500`），`TOOL_DEPENDENCY_TAGS`，`decomposeTags` |

### 3.3 contextPolicy 规则硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `engine/src/core/meta-agent.ts:645-665` | L645-665 | `_resolveContextPolicy()` tag→策略映射 |

### 3.4 Magic Number 兜底（P1）

| 文件 | 行号 | 值 |
|------|------|-----|
| `scheduler/src/core/scheduling-implementations.ts:264` | L264 | `min(reactLoopTimeoutMs, 120_000)` |
| `scheduler/src/core/scheduling-implementations.ts:396` | L396 | `300_000` SequentialDriver 兜底 |
| `engine/src/core/meta-agent.ts:668` | L668 | `_VALID_TIERS` 与 scheduling 重复 |

---

## 四、治理层问题

### 4.1 修复遗留（终态报告 v2.0 已修 48 项）

3 项标记暂缓：

| # | 项 | 原因 |
|---|-----|------|
| PF-03 | Scheduler 的 `stale` timeout 可能误报 `NodeFailed` | 等待调度器整体重构 |
| MD-18 | `NAHIDA_DOC_TYPES` 和 `VALID_TRANSITIONS` 双定义 | 等待 DocGovernAgent 9 子约束全量落地 |
| MD-21 | config 和 runtime 类型未同步 | 等待 config-management-deepening |

### 4.2 governance-pipeline 阶段硬编码（P0）

| 文件 | 行号 | 内容 |
|------|------|------|
| `governance/src/governance-pipeline.ts:385-391` | L385-391 | `DEFAULT_STAGES` 5 阶段顺序硬编码 |

### 4.3 amendment-checks 注册硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `governance/src/amendment-judge.ts:342-347` | L342-347 | 检查项 blocking/weight 注册硬编码 |

### 4.4 通知通道配置硬编码（P0×2 + P1×1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `notification/src/types.ts:58-87` | L58-87 | `DEFAULT_CHANNEL_CONFIGS` 4 通道完整配置 |
| `notification/src/notification-pipe.ts:46` | L46 | `MERGE_TIMEOUT_MS = 5_000` |
| `notification/src/route-table.ts` | 全文件 | 路由表已有 `loadRoutes()` 但默认路由仍硬编码 |

---

## 五、治理层——协作协议

### 5.1 团队协作配置硬编码（P0）

| 文件 | 行号 | 内容 |
|------|------|------|
| `consistency/src/team-collab.protocol.ts:75-81` | L75-81 | `DEFAULT_TEAM_COLLAB_CONFIG` |
| `consistency/src/team-collab.protocol.ts:95-132` | L95-132 | `AGENT_MEMORY_SCOPES` 6 角色域范围 |

---

## 六、TUI 层问题

### 6.1 空 catch 块（P1×10）

覆盖 6 个文件，共约 20 处：

| 文件 | 行号范围 | 处数 |
|------|---------|:--:|
| `packages/tui/src/modes/talk-mode.ts` | 48,65,99,126 | 4 |
| `packages/tui/src/modes/plan-mode.ts` | 36,52,66,166,174,183 | 6 |
| `packages/tui/src/query-loop.ts` | 71,109,123,127 | 4 |
| `packages/tui/src/session-store.ts` | 55,86,100 | 3 |
| `packages/tui/src/context-compactor.ts` | 261 | 1 |
| `packages/tui/src/event-bus.ts` | 72 | 1 |
| `packages/tui/src/multimodal-input.ts` | 88 | 1 |
| `packages/tui/src/sub-agent-summarizer.ts` | 65 | 1 |
| `packages/tui/src/modes/plan-utils.ts` | 72 | 1 |

> 关键路径（记忆写入、会话管理）应至少 log；次要路径可降级但要有 trace。

### 6.2 枚举硬编码（P2）

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/tui/src/modes/party-mode.ts:34-39` | L34-39 | 14 种 `AgentType` 硬编码数组，应从 `Object.values(AgentType)` 动态派生 |

---

## 七、Engine 层问题

### 7.1 base-agent 废弃未移除（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/engine/src/base-agent.ts` | 16 | `@deprecated` 标注"已迁移至 createAgent()"，但文件保留且仍被 src 内部引用 |

### 7.2 空 catch 块（P2×3）

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/engine/src/memory/pipeline.ts` | 407 | 记忆清理静默 |
| `packages/engine/src/plugin/confirm-gate.plugin.ts` | 32 | trustModel 插件缺省静默 |
| `packages/engine/src/registry/doc-registry.ts` | 104 | 索引文件损坏静默 |

### 7.3 inspector-agent 超时硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/engine/src/agents/inspector-agent.ts:14,25` | L14,25 | `SAFE_EXEC_TIMEOUT=60_000`, tsc/test/vitest timeout 默认值硬编码 |

### 7.4 确认门 TTL 硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `scheduler/src/core/confirm-gate.ts:33` | L33 | `BYPASS_TTL_MS = 300_000` |

### 7.5 amendment-timeout 硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `governance/src/amendment-timeout.ts:42-46` | L42-46 | `DEFAULT_TIMEOUT_CONFIG` judgment/draft/stale 天数 |

---

## 八、认知/记忆层问题

### 8.1 BM25 参数硬编码（P2）

| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/memory-store/src/bm25-index.ts:38-39` | L38-39 | `DEFAULT_K1=1.2, DEFAULT_B=0.75` |

### 8.2 BoundaryRegressor 参数硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `memory-store/src/cognitive-engine.ts:381,400,416` | L381,400,416 | `initialThreshold=0.15`, `margin=min(0.03, ...)`, `reset()→0.15` |

### 8.3 scoreAndRank 阈值硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `memory-store/src/cognitive-engine.ts:529,533` | L529,533 | Top-5 扩散上限，`srcScore<0.1` 激活门槛 |
| `memory-store/src/cognitive-engine.ts:579` | L579 | `isForgotten threshold=0.05` |

### 8.4 updateThreshold 阈值硬编码（P1）

| 文件 | 行号 | 内容 |
|------|------|------|
| `memory-store/src/hybrid-retrieval.ts:218-227` | L218-227 | results < 3 宽松，observedMin*0.7，[0.01, 0.95] 范围，>50 历史长度 |

---

## 九、设计层问题

### 9.1 已有 Spec 未实施

| Spec 文档 | 内容 | 状态 |
|-----------|------|------|
| `docs/core/scene-retrieval-scheduler-design.md` | 场景检索调度层 `@cortex/retrieval-scheduler` | ❌ 未实施 |
| `docs/core/config-management-deepening.md` | ConfigRegistry + Schema + 覆盖链 + 热加载 + 漂移检测 | ❌ 未实施 |

### 9.2 Config 声明式编排 5 表

| 表 | 状态 |
|----|------|
| ① governance-routing | ❌ 未建 |
| ② supervision-activation | ❌ 未建 |
| ③ retrieval-presets | ❌ 未建（见 §9.1 检索调度层） |
| ④ amendment-checks | ❌ 未建 |
| ⑤ occlusion-points | ❌ 未建 |

### 9.3 扩展 Config 表（共 13 张）

除上述 5 张外，硬编码扫描发现了 8 张新表需求：

| 表 | 状态 |
|----|------|
| ⑥ cognition.json | ❌ |
| ⑦ hybrid-retrieval.json | ❌ |
| ⑧ agent-defs.json | ❌ |
| ⑨ tool-permissions.json | ❌ |
| ⑩ wave-defs.json | ❌ |
| ⑪ channels.json | ❌ |
| ⑫ pipeline-stages.json | ❌ |
| ⑬ team-collab.json | ❌ |

### 9.4 Core-2 暂缓项

| 项 | 状态 |
|----|------|
| ④ governance normalization | 等待 DS4.1 + A2A |
| DocGovernAgent 9 子约束全量 | 等待 |
| 人格记忆层 | 已设计，未实施 |

---

## 十、统计总览

### 按严重度

| 层 | P0 | P1 | P2 | 合计 |
|----|:--:|:--:|:--:|:----:|
| 一、架构层 | 5 | 1 | 3 | 9 |
| 二、配置层 | 5 | 9 | 3 | 17 |
| 三、调度层 | 2 | 2 | 0 | 4 |
| 四、治理层 | 3 | 1 | 0 | 4 |
| 五、协作协议 | 2 | 0 | 0 | 2 |
| 六、TUI 层 | 0 | 10 | 1 | 11 |
| 七、Engine 层 | 0 | 3 | 3 | 6 |
| 八、认知/记忆层 | 0 | 5 | 1 | 6 |
| 九、设计层 | — | — | — | 2 spec + 13 表 |
| **总计** | **17** | **31** | **11** | **59** |

### 按处理优先级

| 优先级 | 事项 | 项数 | 预估工时 |
|--------|------|:--:|:--:|
| 🔴 立即 | 死代码删除（console-bridge, @deprecated barrel） | 2 | 0.2人天 |
| 🔴 立即 | 幽灵包清理（toolchain, pm） | 2 | 0.1人天 |
| 🔴 立即 | shared 包越界迁移 | 4 | 3人天 |
| 🟡 第一批 | 配置管理基础设施 P0 | 100行 | 1人天 |
| 🟡 第一批 | 检索调度层 P0 | 90行 | 1人天 |
| 🟡 第一批 | 首批 5 张 config 表 | 5×50行 | 2人天 |
| 🟢 第二批 | 扩展 8 张 config 表 | 8×50行 | 3人天 |
| 🟢 第二批 | TUI 空 catch 加日志 | 10处 | 0.5人天 |
| 🔵 第三批 | 认知引擎参数外部化 | 5处 | 1.5人天 |
| 🔵 第三批 | 通知/协作配置外部化 | 5处 | 1.5人天 |
