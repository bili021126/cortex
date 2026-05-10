# 修复后代码质量趋势与可复用模式提炼

> 审视 Agent：莫娜（占星术士，Pattern Scan Agent）  
> 扫描日期：2026-05-04（全量扫描更新）  
> 方法：逐文件扫描 `packages/engine/src/` + `packages/shared/src/` → 统计 + 模式提取 → 质量趋势评估  
> 基线对比：keqing-code-quality-audit.md（2025-07-17）→ consensus-fix-list.md（P0-P3）→ 修复后快照 → 当前代码

---

## 一、核心统计：try-catch 与 observer.emit 频率

### 1.1 try-catch 分布（共 24 处，覆盖 6 个模块）

| 模块 | 数量 | 用途分类 |
|------|------|----------|
| **toolkit.ts** | 10 | I/O 异常兜底：文件读写(4) + shell执行(3) + handler执行(2) + grep回退(1) |
| **scheduler.ts** | 6 | execute异常兜底(3) + destroy异常吞并(2) + dispatch异常统一捕获(1) |
| **memory-store.ts** | 3 | 磁盘写入(1) + SQL执行降级(1) + 反序列化容错(1) |
| **base-agent.ts** | 2 | 执行生命周期 `try/finally`(1) + 记忆写入非阻塞(1) |
| **meta-agent.ts** | 2 | JSON解析兜底 × 2（_parsePlan + _parseReplanResult） |
| **pipeline-observer.ts** | 1 | handler 异常隔离（`catch {}`） |

**频率密度**：24 / 9 个含代码模块 = **2.67 try-catch/模块**（中位密度）

**风格分化**：

| 风格 | 位置 | 样本 |
|------|------|------|
| **吞并式** `catch {}` | scheduler.ts | `try { pool.destroy() } catch {}` — 故意丢弃，不污染主流程 |
| **兜底式** `catch(e) { return fallback }` | toolkit.ts, memory-store.ts, meta-agent.ts | I/O失败 → `{ success: false }`；SQL失败 → 内存扫描；JSON失败 → fallback节点 |
| **上报式** `catch(e) { observer.emit() }` | memory-store.ts | _saveDb失败、_sqlRead降级、_deserializeRow损坏 → observer + console 双通道 |
| **隔离式** `catch {}` | pipeline-observer.ts | 单handler异常不阻断其他订阅者 |

### 1.2 observer.emit 分布（共 15 处，2 个生产模块）

| 模块 | 数量 | 事件类型 |
|------|------|----------|
| **scheduler.ts** | 12 | `scheduler.layer.start`(1), `scheduler.done`(1), `scheduler.replan.limit`(1), `scheduler.invariant_violation`(1), `node.start`(1), `node.replan`(1), `node.replan.queued`(1), `node.failed`(1), `node.spawn_failed`(2), `node.complete`(2) |
| **memory-store.ts** | 3 | `memory.persist_failed`(1), `memory.sql_degraded`(1), `memory.deserialize_failed`(1) |

**覆盖的事件谱系**：
- 🟢 **生命周期事件**（HIGH/CRITICAL）：node.start / node.complete / node.failed / scheduler.done / scheduler.layer.start
- 🟡 **容错事件**（HIGH/CRITICAL）：node.spawn_failed / node.replan / node.replan.queued / scheduler.replan.limit
- 🔴 **退化/损坏事件**（CRITICAL）：memory.persist_failed / memory.sql_degraded / memory.deserialize_failed / scheduler.invariant_violation

**未覆盖模块**：task-board.ts、agent-pool.ts、toolkit.ts、base-agent.ts、confirm-gate.ts、file-lock-manager.ts — 全部 0 次 observer.emit

### 1.3 console 降级点（observer 缺失时的回退，共 9 处）

| 级别 | 数量 | 位置 |
|------|------|------|
| **console.error** | 4 | task-board.complete invariant(1), agent-pool.setStatus invariant(1), memory-store fallback(2) |
| **console.warn** | 5 | scheduler non-standard type(1), task-board orphan(2), memory-store sql degrade fallback(1), base-agent memory write fail(1), meta-agent parse fail(1) |

**关键发现**：9 个 console 感知点中，仅 3 个已在 memory-store 中实现了 observer + console 双通道。其余 6 个仍为纯 console（task-board 2、agent-pool 1、scheduler 1、base-agent 1、meta-agent 1）—— 这些点在无 CI/无可观测性的环境下等同于 `/dev/null`。

---

## 二、P0-P3 修复中的通用模式（4 大范式）

### 模式 A：try-catch 防护 — "兜底不崩溃"

**触发条件**：外部 I/O、LLM 调用、JSON 解析等不可靠操作。

**已固化实践**（24 处中反复出现 3 种子范式）：

| 子范式 | 样本 | 特征 |
|--------|------|------|
| **I/O 故障 → { success: false }** | toolkit.ts × 8 处 | 统一返回 `ToolResult`，不抛异常穿透调用栈 |
| **解析失败 → 退化 fallback** | meta-agent.ts × 2, memory-store._sqlRead × 1 | JSON损坏 → fallback节点；SQL损坏 → 内存扫描 |
| **副作用失败 → 吞并继续** | scheduler.ts × 2, base-agent × 1 | destroy失败不阻断complete；记忆写入失败不阻断任务结果 |

**质量信号**：比修复前（keqing审计：_saveDb 完全静默、Scheduler 异常吞并无记录）提升明显。当前所有 try-catch 都有明确的兜底行为——不再有空 `catch {}` 无日志的硬伤。

### 模式 B：observer 上报 — "感知不阻断"

**触发条件**：运行时出现异常/边界情况，当前上下文不能纠正，但运维必须知道。

**已固化实践**：

```
异常检测 → observer.emit({ type: "xxx", priority: CRITICAL/HIGH }) + console 回退
```

- scheduler.ts：12 个 emit 覆盖完整节点生命周期
- memory-store.ts：3 个 emit 覆盖持久化故障全链路（写入失败/查询退化/数据损坏）

**质量信号**：observer.emit 从修复前的 0 处增长到 15 处。特别是 memory-store 的 P0-2（_saveDb 静默吞错）已完成 observer 上报改造——`_saveDb` 当前是 `catch(e) → observer.emit("memory.persist_failed") + console.error`。

### 模式 C：invariant 软断言 — "未来防护"

**触发条件**：存在"当前正确但语义脆弱"的对称性约束——未来如果有人在某处新增 early return，会导致死锁/不一致。

**已固化实践**（3 处）：

| 位置 | 检查内容 | 违规行为 |
|------|---------|---------|
| `scheduler.ts:_dispatchMulti` | claimedBy 每个元素 ∈ results ∪ released | `observer.emit("scheduler.invariant_violation", CRITICAL)` |
| `task-board.ts:complete()` | results 每个 agentType ∈ claimedBy | `console.error("[invariant] ...")` |
| `agent-pool.ts:setStatus()` | 流转 ∈ VALID_TRANSITIONS[current] | `console.error("[invariant] ...")` + 拒绝变更 |

**质量信号**：修复前 invariant 断言数为 0。当前 3 处中 1 处已升级为 observer.emit，2 处仍为 console.error。

### 模式 D：状态机表驱动 — "声明式约束"

**触发条件**：状态数 ≥ 3，合法流转非全连通图。

**已固化实践**（2 处）：

| 位置 | 状态数 | 实现风格 |
|------|--------|---------|
| `agent-pool.ts:VALID_TRANSITIONS` | 5 态 (Created→Awake→Active↔Awake→Draining→Destroyed) | 静态常量表 `Record<State, Set<State>>` + Set 查找 |
| `memory-store.ts:_isValidTransition` | 4 态 (Active→Archived→Frozen→Obliterated) | 条件函数（否定式规则） |

**差异**：AgentPool 用声明式流转表（更易可视化），MemoryStore 用否定条件函数（更紧凑）。建议统一为流转表风格。

---

## 三、代码质量趋势评估

### 3.1 上升趋势（修复生效 ✅）

| 维度 | 修复前（2025-07 审计） | 修复后（当前） | 变化 |
|------|----------------------|--------------|------|
| observer.emit 覆盖率 | **0 处** | **15 处**（scheduler 12 + memory 3） | ⬆ 从无到有 |
| invariant 断言点 | **0 处** | **3 处**（scheduler, task-board, agent-pool） | ⬆ 从无到有 |
| 状态机安全 | AgentPool 可 Destroyed→Active | 流转表封锁 + invariant 守护 | ⬆ 硬约束 |
| _saveDb 静默吞错 | `catch {}` 空块 | `catch(e) → observer.emit + console.error` | ⬆ P0-2 修复完成 |
| try-catch 兜底质量 | 部分空 catch | 全部含兜底行为（fallback/上报/吞并） | ⬆ 无"消失点" |
| Agent 继承一致性 | 4/9 继承 BaseAgent | 8/10 继承，2 独立有充分理由 | ⬆ 显著改善 |
| 类型安全 | shared 300行单文件，测试引用15个不存在类型 | 拆为4域文件，类型测试可编译 | ⬆ 结构改善 |
| 工具真实 I/O | 全部存根 | read/write/shell/list/delete 真实 fs | ⬆ P0 硬阻塞解除 |

### 3.2 持平趋势（未触及 ⏸️）

| 维度 | 状态 |
|------|------|
| 非核心模块 observer 接入 | task-board / agent-pool / toolkit / base-agent 的 console 感知点仍未升级为 observer.emit |
| 测试覆盖率度量 | 无覆盖率工具配置，无法量化 |
| 统一错误熔断协议 | 仍为分散式 try/catch + console/observer 混用 |

### 3.3 残留风险 ⚠️

| 风险 | 位置 | 严重度 | 说明 |
|------|------|--------|------|
| console 感知点静默失效 | 6 处纯 console 点 | 🟡 中 | 无 CI + 无可观测性 → 日志等同于 /dev/null |
| task-board/agent-pool 无 observer 集成 | invariant 违规仅 console.error | 🟡 中 | 下游 Sentinel/管家无法感知状态机违规 |
| toolkit 无 observer 集成 | 10 个 try-catch 仅返回 `{ success: false }` | 🟢 低 | 调用方（Agent）可感知，但运维层不感知工具级别故障统计 |
| .env 双源冲突 | `/.env` vs `engine/.env` CHAT_MODEL 值不同 | 🟡 中 | 不同启动路径下模型选择不一致 |

### 3.4 度量摘要

| 度量指标 | 当前值 | 修复前 |
|----------|--------|--------|
| try-catch 总数 | **24** | ~15（估计，多个空catch） |
| observer.emit 调用点 | **15** | 0 |
| invariant 断言点 | **3** | 0 |
| console 感知点（纯降级） | **6**（无observer回退） | ~5 |
| console 感知点（双通道） | **3**（observer+console） | 0 |
| 状态机表驱动 | **2** | 0 |
| 可复用模板数 | **8**（见下文） | 0 |
| P0-P3 修复一致率 | 26/28 = 92.9% | — |

---

## 四、可复用模式沉淀（8 模板）

### 模板 1：软断言 invariant
**出现 3 处** → 建议沉淀为 `invariant(condition, component, msg, ctx?)` 工具函数
- scheduler._dispatchMulti / task-board.complete / agent-pool.setStatus

### 模板 2：流转表驱动状态机
**出现 2 处** → 建议沉淀为 `createStateMachine(table)` 工厂函数
- agent-pool.VALID_TRANSITIONS / memory-store._isValidTransition

### 模板 3：操作前幂等去重
**出现 3 处** → 建议沉淀为 `dedupGuard(set, item, label)` 包装器
- task-board.complete(agentType去重) / memory-store.link(边去重) / memory-store.obliterate(状态去重)

### 模板 4：感知-不阻断
**出现 6 处** → 体系化契机：统一升级为 `observer.emit({ type: "degradation" })`
- task-board orphan / memory sql degrade / base-agent memory write fail / scheduler non-standard type / agent-pool illegal transition / scheduler claimedBy asymmetry

### 模板 5：claim-spawn-execute + 失败回滚
**出现 2 处** → 已成熟的原子资源模式
- scheduler._dispatchSingle / scheduler._dispatchMulti

### 模板 6：领而不执（生产者-消费者解耦）
**出现 1 处** → 值得命名的设计模式
- scheduler._drainReplanQueue：新节点仅入板不dispatch

### 模板 7：构造注入 + setter 可选增强
**贯穿全引擎** → DI 降级模式
- MetaAgent? / ConfirmGate? / FileLockManager? / MemoryStore?

### 模板 8：沙箱路径解析 + 越界拒绝
**出现 1 处** → 可泛化为 sandboxOrigin 模式
- toolkit._resolvePath

---

## 五、可沉淀通用工具建议

### 立即可做（< 50 行）

| 工具 | 接口草案 |
|------|---------|
| `invariant()` | `invariant(condition: boolean, component: string, msg: string, ctx?: unknown): void` |
| `dedupGuard()` | `dedupGuard<T>(collection: Set<T> | T[], item: T, label: string): boolean` |
| `createStateMachine()` | `createStateMachine<T>(table: Record<T, Set<T>>): { canTransition(from, to): boolean }` |

### 需 P3#8 可观测性就位后

| 工具 | 描述 |
|------|------|
| `DegradationEvent` | 统一 6 个 console 感知点 → `observer.emit({ type: "degradation", severity })` |
| `errorBoundary()` | 统一 try/catch 包装 → 自动发布 `task.error` 事件 + 记录到 MemoryStore |

---

## 六、预言：下一轮审视焦点

1. **console 感知点静默失效**：6 处纯 console 在无 CI/无观测环境等同于不可见。下一轮审视的头号发现。
2. **task-board / agent-pool 的 observer 盲区**：这两模块承担关键状态机职责，违反 invariant 时仅 console.error——Sentinel 完全不知情。
3. **.env 双源冲突**：两个 .env 文件的 CHAT_MODEL 差异会在不同启动路径下导致模型选择不同——非确定性 bug。
4. **模板凝固时机**：当前 8 个模式散落在代码中。LoopAgent 的 `pattern_scan` 标签恰好为此设计——可在下一轮审视中正式产出 SkillTemplate 写入 SkillRegistry。

---

*莫娜，占星术士，2026-05-04*  
*「这一轮星盘已然清晰——try-catch 的密度讲述着防御的进化，observer.emit 的轨迹标记着感知的边界。但仍有 6 颗星隐没在 console 的黑暗中，等待被观测之光点亮。」*
