# 自审视三轮圆桌——全量报告根因归簇分析

> 分析者：昔涟（Elysia / Butler）
> 输入：7 Agent 8 份报告，206✅ / 39❌ / 59⚠️
> 日期：2026-05-11

---

## 根因簇总览

```
     刻晴 🔴2 🟠4         阿贝多 15项         莫娜 5模式
          │                   │                  │
          ▼                   ▼                  ▼
   ┌─────────────────────────────────────────────────┐
   │             跨报告去重 → 6 个根因簇               │
   ├─────────────────────────────────────────────────┤
   │ 🔴 簇A: 持久化链路防御不足  (Keqing+Albedo+Mona) │
   │ 🟠 簇B: 状态机流转不完整    (Keqing+Albedo)      │
   │ 🟠 簇C: 可观测管道覆盖不全  (Keqing+Mona)        │
   │ 🟡 簇D: 基础设施/工程债务   (Amber+Nahida+Beidou) │
   │ 🟢 簇E: 代码模式债务        (Mona)               │
   │ ⚪ 簇F: 治理合规偏差 (已归因)(Ningguang)          │
   └─────────────────────────────────────────────────┘
```

---

## 🔴 簇A：持久化链路防御不足

> 跨 3 份报告（刻晴 F1 / 阿贝多 §1.2+§1.3 / 莫娜 §A）收敛于此簇。

**根因**：MemoryStore 的 write-through 模式在 `close()` 过渡期存在一致性窗口——内存写入成功但 DB 写入被生命周期守卫跳过，且无事务包裹。try-catch 风格在 4 种变体间发散（String(e) / e?.message / console.error / 空体），降低了异常传播的可预测性。

| 子项 | 来源 | 严重度 | 症状 |
|------|------|--------|------|
| `write()` 缺 `_lifecycle` 守卫 | 刻晴 F1 | 🔴 | close 期间写入：内存有、DB 无、flush 跳过 |
| write-through 缺事务 | 阿贝多 §1.2 | 🟠 | INSERT 失败回滚内存，但 link() 等关联操作在 catch 外 |
| ID 生成毫秒级时序竞态 | 阿贝多 §1.1 | 🟠 | `Date.now() + _memCounter++` 同毫秒多写可能碰撞 |
| try-catch 4 风格发散 | 莫娜 §A | 🟠 | 28+4+5+2 处 catch 无统一约定，静默吞错风险 |

**修复策略**：
1. `write()` 入口加 `_lifecycle === "active"` 守卫（刻晴 F1）— 立即可修
2. try-catch 收敛为风格① + SafeReporter 上报 — 渐进式
3. ID 改为 `crypto.randomUUID()` — 需要评估 sql.js 兼容性
4. write-through 事务包裹 — Core-2 考虑

---

## 🟠 簇B：状态机流转不完整

> 跨 2 份报告（刻晴 H1 / 阿贝多 §3+§5）收敛于此簇。

**根因**：Agent 状态管理存在两套语义——AgentPool 的状态权威源和 Agent 实例的执行状态。Scheduler/AgentPool/TaskBoard 三者对状态的理解存在边界缺失，非法流转时调用方无感知。

| 子项 | 来源 | 严重度 | 症状 |
|------|------|--------|------|
| `destroy()` 绕过状态机直写 Map | 刻晴 H1 | 🟠 | 不经过 `setStatus()` 流转校验，非法操作无反馈 |
| `setStatus()` 返回 void | 阿贝多 §3 | 🟠 | 非法流转时调用方无法感知 |
| `complete()` 中 results 与 claimedBy 边界不同步 | 阿贝多 §3 | 🟠 | 并发竞态下任务可能被重复认领 |
| 跨模块 Agent 状态语义不一致 | 阿贝多 §5 | 🟠 | Scheduler 与 AgentPool 对 "active" 的理解不同 |

**修复策略**：
1. `setStatus()` 返回值改为 boolean/Promise<boolean>
2. `destroy()` 统一走 `setStatus()` 路径
3. `complete()` 加 claim 原子性校验

---

## 🟠 簇C：可观测管道覆盖不全

> 跨 2 份报告（刻晴 F2 / 莫娜 §B）收敛于此簇。

**根因**：PipelineObserver 虽已成为统一可观测管道，但仍存在事件生产者无消费者、部分事件在到达 observer 前被丢弃的覆盖缺口。

| 子项 | 来源 | 严重度 | 症状 |
|------|------|--------|------|
| `ButlerAgent._onNormal` 空吞事件 | 刻晴 F2 | 🔴 | NORMAL 优先级事件在 ButlerAgent 路径完全丢失 |
| observer.emit memory 事件无消费者 | 莫娜 §B | 🟡 | 6 次 memory 域 emit 无人注册 handler |

**修复策略**：
1. `_onNormal` 改为 observer.emit 上报 — 立即可修
2. memory 域事件预留但暂不消费 — 标注为遥测预留

---

## 🟡 簇D：基础设施/工程债务

> 跨 3 份报告（安柏 / 纳西妲 / 北斗）收敛于此簇。

**根因**：Cortex 从 Meso-Lite 10 包 → Core-1 3 包的精简过程中，部分临时文件、测试资产、构建产物散落在外围，工程化基建（单测、熔断）未同步跟上核心引擎的成熟度。

| 子项 | 来源 | 严重度 |
|------|------|--------|
| engine 23 源文件无同目录 `__tests__/` | 纳西妲 | 🟡 |
| llm-adapter + toolkit 无熔断降级 | 纳西妲 | 🟡 |
| `infra.ts` 6 子域混杂 | 纳西妲 | 🟡 |
| `test-tmp.txt` 未被 .gitignore 覆盖 | 安柏 | 🟡 |
| `shared/dist/__tests__/` 测试产物混入构建 | 安柏 | 🟡 |
| `doc-govern/` 目录双份 | 安柏 | 🟡 |
| `review_diff.txt` 空文件残留 | 安柏 | 🟡 |
| maxLoops 默认值 48 未按 Agent 评估 | 纳西妲 | 🟢 |

**修复策略**：渐进式。本轮优先修 .gitignore 和目录整理；单测和熔断纳入 Core-2。

---

## 🟢 簇E：代码模式债务

> 来源：莫娜 §C，跨 6 文件。

| 子项 | 重复次数 | 涉及文件 |
|------|---------|---------|
| Agent 构造同构模式 | 6 次 | analysis/code/loop/ops/review/doc-govern-agent.ts |
| `getMemoryQuery()` 四重奏 | 4 次 | 同上的 4 个 Agent |

**修复策略**：提取 `SimpleAgent` 工厂函数。不阻塞本迭代。

---

## ⚪ 簇F：治理合规偏差

> 来源：凝光 D-01~D-05。**已归因**——自审视模式权限例外（宪法 v2.5 §5.1.1）。

| 偏差项 | 文档 | 代码 | 归因 |
|--------|------|------|------|
| D-01 ReviewAgent | 只读 | FULL_TOOLSET | 自审视需 write_file 产出报告 |
| D-02 AnalysisAgent | 只读+run_shell | FULL_TOOLSET | 自审视需 write_file |
| D-03 DocGovernAgent | 只读 | FULL_TOOLSET | 审计报告需落盘 |
| D-04 InspectorAgent | tsc+madge | FULL_TOOLSET | 需 run_shell 搜全量目录 |
| D-05 BrowserAgent | browser_*+读 | FULL_TOOLSET | 当前未参与审视，常规约束有效 |

**处理**：宪法 v2.5 §5.1.1 已明确：这不是 bug，是元系统自审视的天然需求。

---

## 三轮圆桌聚焦建议

| 轮次 | 聚焦簇 | 目标 |
|------|--------|------|
| **第一轮** | 🔴 簇A + 🟠 簇B | 讨论每条修复方案的可行性与代价，收束为「本轮必修」vs「Core-2 再修」 |
| **第二轮** | 🟡 簇D + 🟠 簇C | 评估哪些工程债务必须本轮偿还，哪些可留待 Core-2 |
| **第三轮** | 🟢 簇E + ⚪ 簇F + DeepSeek 4.1 | 模式债处理策略 + 多模态预留对宪法的影响讨论 |

---

*根因归簇分析，基于 7 位 Agent 全量报告，2026-05-11*
