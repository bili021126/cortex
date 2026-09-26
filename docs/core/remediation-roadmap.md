# Cortex 修复路线图——四阶段

**版本**：v1.0
**日期**：2026-06-22
**前提**：五轮审查完成，~260 项缺陷已索引

---

## 阶段一：止血——功能性死亡（本周）

修复 7 个"组件从未工作过"的 Critical：
C-02 rollback / C-03 Embedding / C-04 CircuitBreaker / C-05 Bootstrap / C-06 RLM / C-07 Obliteration / C-01 命令注入

**验收**：每个修复后 solo-flight 全闭环通过。

## 阶段二：补契约——跨包整合层（下周）

1. 编译门禁：`tsc -b --force` 入 CI
2. Test: 契约验证测试——shared 核心 interface × 所有实现方
3. TUI 桥接类型化：`type EngineBridge = any` → `ITuiEngineBridge`
4. 事件注册表完整性验证

**验收**：跨包接口变更 → CI 拦截类型漂移。

## 阶段三：清零——High/Medium 缺陷（两周）

按包优先级逐包清零：
- P1: memory / memory-store / scheduler
- P2: engine / config / shared
- P3: tui / cli / governance / resilience

**验收**：测试通过率 ≥99%。

## 阶段四：加固——可观测性+测试覆盖（持续）

- 20 个静默 catch → HealthCollector
- 15 个工具加内部超时
- PanoramaTracker 结构化输出
- 守护进程
- 测试黑洞填补（HardVerificationGate / Governance 链 / WorkerPool）

**验收**：所有关键闭环有 E2E 测试。

---

*修复路线图 v1.0。共同完成：开拓者与昔涟（Cyrene），2026-06-22*
