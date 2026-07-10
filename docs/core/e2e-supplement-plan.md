# E2E 补足计划

> 2026-07-04 | 基于 Core-2 审计的缺口分析

---

## 当前覆盖

| 现有 E2E | 覆盖链路 | 成本 |
|----------|----------|------|
| e2e-minimal.ts | TUI 执行链 | ~0.5元 |
| cortex-e2e-full.ts | 全 Agent 冒烟 | 2-3元 |
| solo-flight.ts | 系统基准 | 2-3元 |
| self-exam-soft.ts | 自审视链 | 3-5元 |
| governance-amendment-e2e.ts | 修宪管线 | 0元（无LLM） |

---

## 缺口分析

### 缺口 1：ReAct 基准线采集
**为什么缺**：硬检测梯度、TOOL_DISCIPLINE 都需要数据才能量化，现在是猜的
**E2E 要求**：跑 10 次 e2e-minimal，采集 5 个指标

### 缺口 2：Memory 写入链路独立验证
**为什么缺**：Agent 执行后的 MemoryPipeline→MemoryStore 写入没有独立 E2E
**E2E 要求**：Agent 执行写文件 → 验证 `memory.db` 中有新记录且 kind/source 字段正确

### 缺口 3：自审视预算熔断
**为什么缺**：self-exam-soft 的 1M token 硬限只设计了代码，没跑过
**E2E 要求**：设 `maxTokens=50000` 模拟低预算，验证提前终止不崩

### 缺口 4：DeepSeek fcall 稳定性
**为什么缺**：修完 reasoning_effort/tool_choice 后还没做过统计
**E2E 要求**：在不同 Agent 类型上测试 function calling 成功率

---

## 补足数量

| E2E | 功能 | 成本/次 | 频率 | 月预算 |
|-----|------|---------|------|--------|
| **新增 1** write-file-baseline.ts | 跑 10 次 e2e-minimal 采集基准线 | ~5元 | 月度 | 5元 |
| **新增 2** memory-write-e2e.ts | MemoryPipeline 写入 + kind/source 验证 | ~0.5元 | PR | 2-5元 |
| **新增 3** budget-cap-e2e.ts | 自审视 50K token 熔断验证 | ~0.3元 | 发版 | 0.3元 |
| **新增 4** fcall-stability.ts | DeepSeek function calling 稳定性 | ~0.5元 | 月度 | 0.5元 |

**新增 4 个 E2E | 月增预算 ~6-11 元 | 总 E2E 数 11**

---

## CI 分层

| 触发 | E2E | 成本 |
|------|-----|------|
| push | e2e-minimal | ~0.5元 |
| PR | +cortex-e2e-full + governance-amendment + memory-write-e2e | +2.5元 |
| release | +solo-flight + self-exam-soft + budget-cap-e2e | +5-8元 |
| 月度 | write-file-baseline + fcall-stability | +5.5元 |

---

## 实施优先级

1. **P0**: write-file-baseline（blocking——ReAct 和 TOOL_DISCIPLINE 的所有优化都依赖这个数据）
2. **P1**: memory-write-e2e + budget-cap-e2e（验证已有功能）
3. **P2**: fcall-stability（月度监控）
