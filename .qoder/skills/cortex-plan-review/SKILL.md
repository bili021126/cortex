---
name: cortex-plan-review
description: Review code changes after an agent executes a Cortex engineering plan. Cross-references every new/modified file against the plan document, verifies the "do not modify" list was respected, runs typecheck, and outputs a scored review. Use after another agent completes work on Core-2-过渡阶段-全面接入改造计划.md or any similar engineering plan.
---

# Cortex Plan Review — 计划执行后审查

## 流程清单

```
Task Progress:
- [ ] 阶段一：文件清单对照（plan 事项 × git status）
- [ ] 阶段二：逐文件质量审查（文件头 + API + 验收标准）
- [ ] 阶段三：不改清单校验
- [ ] 阶段四：typecheck 验证（全量 + 逐包）
- [ ] 阶段五：双路径回退检查（如适用）
- [ ] 阶段六：评分输出
```

## 阶段一：文件清单对照

1. 读取 plan 文档（如 `docs/core/Core-2-过渡阶段-全面接入改造计划.md`）
2. 运行 `git status --short` 获取所有变更
3. 将 `??`（新增）文件按 Phase 归类：

| Phase | 预期文件 |
|-------|---------|
| Phase 0 | `prompt-manager.ts` |
| Phase 1 | `loop-strategy-registry.ts`, `task-router.ts`, `environment-aware-router.ts`, `sentinel-signal-filter.ts` |
| Phase 2 | `governance-events.ts`, `decision-gate-bridge.ts`, `semantic-layer.ts` |
| Phase 3 | `resilience-integration.ts`, `notification-runtime.ts` |
| Phase 4 | `intent-clarification.md` |
| Phase 5 | `pattern-extractor-integration-assessment.md` |

标记遗漏：plan 里有但 git status 没有 → 标红。

## 阶段二：逐文件质量审查

对每个新增文件：
1. 读前 80 行，检查文件头注释：职责描述、设计原则、`@since` 标注
2. 对照 plan 步骤验证核心 API 已实现（如 `LoopStrategyRegistry` 有 `register/selectByRule/getAdvisorContext/get/list`）
3. 对照 plan 验收标准逐条打勾

## 阶段三：不改清单校验

从 plan 文档末尾"不改的东西"表中提取列表，逐一验证：

| 不改项 | 检查方法 |
|--------|---------|
| `resolvePipeline()` switch/case | grep 确认无变更 |
| `PipelineCtx` 接口 | grep 确认无新增字段 |
| `TaskNode` 接口 | grep 确认无新增字段 |
| Agent `execute()` 签名 | grep 确认签名不变 |

## 阶段四：typecheck 验证

```bash
# 全量
pnpm typecheck

# 逐包（新增文件所在的包）
pnpm --filter @cortex/engine exec tsc -b tsconfig.src.json
pnpm --filter @cortex/scheduler exec tsc -b tsconfig.src.json
pnpm --filter @cortex/notification exec tsc
pnpm --filter @cortex/shared exec tsc
```

区分新增错误 vs 预存错误：交叉比对新增文件和报错行。

## 阶段五：双路径回退检查

如果 Phase 0（prompt-kit）已执行：
- 检查 `meta-agent.ts` 的 `_planningPrompt()` 同时保留 `PromptManager` 路径和 `parts.join("\n")` 回退路径
- 检查策略顾问上下文在两个路径中都有注入

## 阶段六：评分输出

按四个维度评分：

| 维度 | 满分 | 扣分条件 |
|------|------|---------|
| 完整性 | 3 | plan 事项有遗漏 |
| 咬合精度 | 3 | 改了不改清单中的项 |
| 防御性 | 2 | 缺少去噪/冷却/防重复等防御设计 |
| 测试覆盖 | 2 | 无测试文件扣 2，部分扣 1 |

输出格式：
```
总评分：X/10
扣分项：
- [维度] 具体原因
建议：
- [行动项]
```
