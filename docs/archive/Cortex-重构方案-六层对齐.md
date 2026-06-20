# Cortex 重构方案——六层对齐 + 角色标注 + 接口统一

**原则**：核心稳定，边缘可动。只加固，不加新功能。每步之后跑 `pnpm typecheck && pnpm test`。

**审计基线**：engine 63 文件零跨层泄漏。测试 78 文件 884 用例 98.7% 通路率。

---

## Phase 1：治理层角色标注（~30 行，不改逻辑）

治理层 12 组件中有 6 个缺少 `@role` 文件头标签。

| # | 文件 | 角色 |
|---|------|------|
| 1 | `core/notification-runtime.ts` | 观察者 |
| 2 | `core/governance-events.ts` | 观察者 |
| 3 | `core/shutdown-warden.ts` | 恢复者 |
| 4 | `plugin/pipeline-observer.plugin.ts` | 观察者 |
| 5 | `plugin/consistency-layer.plugin.ts` | 观察者 |
| 6 | `plugin/trust-model.plugin.ts` | 恢复者（预留） |

**验收**：grep `@role` 在 `packages/engine/src/core/` 和 `plugins/` 下命中 ≥ 12 个文件。

---

## Phase 2：六层归属标注（~40 行，不改逻辑）

对 engine/src/ 下非 bootstrap 的 50 个文件，在文件头添加 `@layer` 标签。

| 层 | 文件数 | 标签 |
|----|--------|------|
| 交互层 | 6 | `@layer 交互层` |
| 规划-执行层 | 14 | `@layer 规划-执行层` |
| 治理层 | 10 | `@layer 治理层` |
| 技能-工具层 | 5 | `@layer 技能-工具层` |
| 记忆层 | 3 | `@layer 记忆层` |
| 基础设施 | 12 | `@layer 基础设施（bootstrap/plugin）` |

**验收**：grep `@layer` 在 engine/src/ 下命中 ≥ 50 个文件。

---

## Phase 3：治理层 ReplanManager 角色修正（~10 行，微调）

`packages/engine/src/core/scheduler.ts` 中的 ReplanManager 当前被标记为 Scheduler 的私有成员。重构：

1. 将 ReplanManager 的调用点显式标注 `// @role 恢复者——仅 MetaAgent 通过 Scheduler 调用`
2. 将 `ResiliencePolicyFactory` 在 `bootstrap-engine.ts` 中的注册点标注 `// @role 恢复者——仅执行层调用`

**验收**：grep `恢复者` 在 engine/src/ 下命中 ≥ 3 处（ReplanManager 调用点 + ResiliencePolicyFactory 注册点 + resilience-integration.ts 头注释）。

---

## Phase 4：层间接口文档化（~20 行，不改逻辑）

在 `packages/engine/src/bootstrap/bootstrap-engine.ts` 的 §6.2 接线块中，为每个跨层接线添加注释标注层间关系：

```typescript
// 治理层→交互层：权轴桥接
const decisionBridge = new DecisionGateBridge(observer, gate);
// 规划-执行层→技能-工具层：技能注入
metaAgent.setSkillRegistry(skillRegistry);
// 治理层（观察者）→ 订阅
observer.on(PipelinePriority.CRITICAL, sentinelHandler);
```

**验收**：bootstrap-engine.ts §6.2 中每条接线有 `层A→层B：关系` 注释。

---

## Phase 5：审计文档归档

将本次重构审计文档链接到宪法和治理层设计：

- `docs/core/Cortex-重构审计-六层对齐扫描.md` ← 保留，标记为 `@since v3.0`
- `docs/core/治理层设计-v3.0-全量整合版.md` ← 已有
- 宪法 v3.0 §十一 ← 已有引用

---

## 不做的事

| 事项 | 原因 |
|------|------|
| 移动文件到新目录 | engine 包内组织已经清晰，移动会破坏 import 路径 |
| 拆分大文件 | Scheduler/MetaAgent 的大函数是性能热路径，不在此轮动 |
| 重命名类/接口 | 不做 breaking change |
| 新增 E2E 测试 | 重构不改行为，现有测试足够 |

---

## 总计

5 个 Phase，~100 行注释改动，零逻辑变更。Phase 1-4 可并行执行。

每 Phase 完成后跑 `pnpm typecheck && pnpm --filter @cortex/engine exec vitest run --reporter=verbose`，确保 884/884 全绿。
