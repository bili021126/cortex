# Cortex 链路管理体系

> 2026-07-09 | 12 流 × 7 核心链路 × 治理矩阵（本轮全清）

---

## 十二流状态

| # | 流 | 状态 | E2E | 已知问题 | Core-2 |
|---|-----|------|-----|----------|--------|
| 1 | TUI 执行 | ✅ 通 | core-smoke + baseline | 硬检测梯度待定 | 产出路径注入 |
| 2 | Engine Bootstrap | ✅ 通 | ❌ 无 | 插件降级已加 | adapter 工厂收束 |
| 3 | LLM Adapter | ✅ 通 | e2e-minimal + fcall-stability | extraBody 收敛 ✅ | Core-3 |
| 4 | Agent 执行 | ✅ 通 | core-smoke + baseline | 78%首次写盘 | 基准线已收集 |
| 5 | Toolkit | ✅ 通 | ❌ 无 | ConfirmGate fail-closed ✅ | 烟绯 Agent 化 |
| 6 | Memory 写入 | ✅ 通 | memory-write | P0-01~09 全清 ✅ | FSM 已接入 ✅ |
| 7 | Observer | ✅ 通 | core-smoke | 17处遥测全接入 | 遥测深度 |
| 8 | Skill | ✅ 通 | skill-e2e | 结晶闭环 ✅ | 终态 |
| 9 | 自审视 | ✅ 通 | self-exam + budget-cap | 空状态守护已加 | 对称攻防 ✅ |
| 10 | CI | ✅ 通 | ❌ 无 | lint 0 error | baseline 对比 |
| 11 | WebUI | ⚠️ 未实现 | ❌ 无 | 全链路缺 | UI 抄范式 |
| 12 | ConfirmGate | ✅ fail-closed | confirmgate-smoke | 信任分已迁移 ✅ | 终态 |

---

## 核心链路健康指标

```
TUI 执行链  写盘成功率 100%（baseline 9/9）
            平均 loopsUntilWrite: 3.7
            首次成功率: 78%

LLM 适配链  DeepSeek 全 200，零 400
            reasoning_effort 守卫 ✅
            tool_choice 不传 ✅
            extraBody 仅 reasoner ✅
            JSON.parse try-catch ✅

记忆写入链  kind 推断 ✅ | source 注入 ✅
            P0-01~09 全清 ✅
            并行写入 _serializedFlush ✅
            FSM guard（commit/rollback）✅

技能加载链  25/27 模板自动加载
            skill-e2e: deriveStatus trial/active/deprecated ✅
            queryByTags 过滤+权重排序 ✅

自审视链    43文件11元 → 4文件对称攻防
            空状态守护（tsc/vitest/lint/dep）✅
            预算熔断 budget-cap-e2e ✅

ConfirmGate  fail-open → fail-closed ✅
            bypassAll isTestEnv 守卫 ✅
            as any 类型绕过已移除 ✅
```

---

## 治理规则

| 链路 | 验收标准 | 失败时 |
|------|----------|--------|
| TUI 执行 | core-smoke ALL PASSED | 阻 Release |
| 编译 | 25 包 tsc 零错 | 阻 PR |
| Lint | engine 0 error | 阻 PR |
| 测试 | engine 0 failed（flaky 已 skip） | 阻 PR |
| LLM 适配 | 平均首次写盘率 ≥70% | 告警 |
| 自审视 | 检测率 > 10%（对称攻防后重测） | 告警 |

---

## E2E 分层执行

```
push    → core-smoke (~0.5元)
PR      → +cortex-e2e-full + memory-write + skill-e2e
release → +solo-flight + self-exam-soft + budget-cap
月度    → write-file-baseline + fcall-stability
```

## 最终状态说明

> 截至 2026-07-09，Core-2 全量评审 P0/P1 问题全部修复：
> - Flash→Pro 降级从 error.status 改为 message 提取 ✅
> - chatStream stream_options 注入 ✅
> - confirm() TTL 过期检查 ✅
> - memory-bridge barrel 本地引用 ✅
> - MemoryEntryStateMachine FSM 已接入（commit/rollback guard）✅
> - Engine 拆分完成（memory-bridge 分离为独立组件）✅
> - 开发规范 `dev-standards.md` 已发布 ✅

---

## 设计文档索引

| 链 | 文档 |
|----|------|
| 自审视 | `docs/core/world-model-simulation-layer.md` |
| ConfirmGate | `docs/core/confirmgate-agent-design.md` |
| Core-2 审计 | `docs/core/core-2-audit.md` |
| E2E 计划 | `docs/core/e2e-supplement-plan.md` |
| 全流图 | `docs/core/full-flow-map.md` |
| 第一批改造 | `docs/core/core-2-batch1-design.md` |
| 全量评审 | `test-output/full-code-review-20260706.md` |
| Gap 扫描 | `test-output/architecture-gap-scan-2026-06-29.md` |
