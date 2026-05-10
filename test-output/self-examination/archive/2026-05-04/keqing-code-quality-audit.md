# 🔍 刻晴 · 代码质量审查报告

**审查范围**: `packages/engine/src/` 全部 24 个模块 + `packages/shared/src/index.ts`  
**审查日期**: 2025-07-17  
**审查标准**: Bug > 风格违规 > 架构矛盾

---

## 🔴 严重 (CRITICAL)

### 1. scheduler.ts — `node.failed` 事件双重发射

**位置**: `_dispatchNode()` 方法, 约 L189 和 L198
**问题**: catch 块中已 emit 了 `node.failed`，随后底部的 `if (!result.success)` 又 emit 一次。异常路径下同一失败被报告两次，污染 PipelineObserver 下游（ButlerAgent 会通知用户两次）。
**建议**: 在 catch 块中设置 `result` 后 skip 底部的失败 emit，或使用 flag 去重。

```typescript
// catch 块中：
result = { nodeId, success: false, error: String(e) };
this.observer.emit({ type: "node.failed", ... }); // 第一次

// 底部：
if (!result.success) {
  this.observer.emit({ type: "node.failed", ... }); // 第二次！重复！
}
```

---

### 2. memory-store.ts — `_saveDb()` 静默吞错，数据丢失风险

**位置**: `_saveDb()` 方法
**问题**: `try { fs.writeFileSync(...) } catch { /* noop */ }` — 磁盘写入失败时完全静默。持久化被 `_persistEnabled=true` 标记为"已启用"，但实际数据可能从未落盘，且无任何错误信号反馈给调用方。
**建议**: 至少记录到 console.error，或返回 boolean 让上层感知。更理想的是引入重试 + 降级通知。

---

### 3. base-agent.ts — 双记忆写入无事务，孤记录风险

**位置**: `_executeAndRemember()` 方法
**问题**: 先 `write(memId)` 写入决策记录，再 `write(ctxMemId)` 写入上下文记录，然后 `link()` 建立关联。若 `ctxMemId` 写入成功但 `link()` 失败（如湮灭态拒绝），`memId` 成为无关联孤记录。反之若 `memId` 成功但 `ctxMemId` 抛异常，同样产生无上下文关联的孤立记忆。
**建议**: 引入简单的两阶段提交或写入前校验，失败时回滚（delete `memId`）。

---

## 🟠 高 (HIGH)

### 4. meta-agent.ts — `_extractJson` 贪婪正则可能误匹配

**位置**: `_extractJson()` 方法
**问题**: `/(\[[\s\S]*\])/` 是贪婪匹配，遇到 LLM 输出中包含多个 JSON 数组时会从第一个 `[` 匹配到最后一个 `]`，吞掉中间所有内容，导致 `JSON.parse` 失败后退化为 fallback。
**建议**: 改用非贪婪 `/\[[\s\S]*?\]/` 并取首个匹配，或优先用 ` ```json ... ``` ` 提取。

---

### 5. meta-agent.ts — `_fallbackNode` 硬编码 tags 且不用计数器

**位置**: `_fallbackNode()`
**问题**:
- `tags: ["analysis"]` 硬编码——不管原任务是什么类型，兜底节点一律标为 analysis，MetaAgent 重规划时读到错误的标签。
- ID 生成用 `Date.now()-0` 而非 `_nodeCounter`，与正常节点的 `task-${now}-${counter}-${index}` 格式不一致，解析 ID 的代码（如 memory-store 的 counter 恢复）可能误判。
**建议**: 至少保留原任务 tags，使用 `_nodeCounter`。

---

### 6. AgentPool — `spawn()` 与 `canSpawn()` 空值处理不一致

**位置**: `agent-pool.ts`
**问题**: `spawn()` 用 `this.active.get(agentType)!`（非空断言），而 `canSpawn()` 用 `this.active.get(agentType)!` 但在调用前已检查 config 存在性。`spawn()` 也先检查了 config，逻辑等价但风格不一致——一个靠前置检查保证、另一个也靠前置检查却用了 `!`。`count()` 用 `??` 优雅降级。三种风格共存。
**建议**: 统一使用 `??` 或统一前置守卫，避免 `!` 非空断言。

---

### 7. InspectorAgent / OpsAgent / LoopAgent — 与 BaseAgent 重复代码

**位置**: `inspector-agent.ts`, `ops-agent.ts`, `loop-agent.ts`
**问题**: 三个 Agent 类各自实现 `wakeup()` / `execute()` / `shutdown()`，状态机逻辑与 BaseAgent 一模一样。InspectorAgent 甚至有自己的 `_runInspection` ReAct 循环（独立于 `react-helper.ts` 的 `runReActLoop`）。此外，这三个 Agent 都不接 MemoryStore，无法享受记忆增强执行。
**建议**: 让它们 extend BaseAgent（如 ReviewAgent/CodeAgent 那样），InspectorAgent 的特殊前置采集逻辑可通过覆盖 `execute()` 或模板方法注入。

---

### 8. task-board.ts — `removeSubtree` 留下 running/done/failed 孤儿

**位置**: `removeSubtree()`
**问题**: 只删除 `pending`/`claimed` 节点，`running`/`done`/`failed` 节点保留在 Map 中但 parentId 已指向被删除的节点，成为孤立节点。后续 `getPendingNodes()` 不会返回它们（状态不符），但它们永久占据内存，且 `getAllNodes()` 仍返回这些无父节点。
**建议**: 至少记录警告日志；或者对于 done/failed 节点保留（历史记录），但标记 orphan。

---

## 🟡 中 (MEDIUM)

### 9. confirm-gate.ts — `handleTimeout()` 死代码

**位置**: `handleTimeout()` 方法
**问题**: 整个代码库中没有任何调用方使用此方法。注释声称 "L2/L3 超时阻塞，L1 超时默认拒绝"，但实际超时逻辑在 `waitFor()` 的 setTimeout 中实现。
**建议**: 删除或接入实际调用链。

---

### 10. memory-store.ts — `peek()` 浅冻结，深层可变

**位置**: `peek()`
**问题**: `Object.freeze(copy.content)` 和 `Object.freeze(copy.metadata)` 只冻结第一层。`content`/`metadata` 内的嵌套对象仍然可变，这与注释声称的"返回冻结副本，禁止直接修改内部状态"矛盾。
**建议**: 用 `structuredClone()` 做深拷贝，或在文档中明确标注"仅浅冻结"。

---

### 11. toolkit.ts — `delete_file` 不加文件锁

**位置**: `execute()` 方法
**问题**: 只有 `write_file` 路径走了 `FileLockManager`，`delete_file`（同为 L3 不可逆操作）直接执行不加锁。如果 Agent A 在读某文件时 Agent B 删除了它，读操作拿到过期数据。
**建议**: `delete_file` 也走锁流程（写锁，排斥一切）。

---

### 12. memory-store.ts — `_loadFromDb` 计数器恢复依赖 ID 格式

**位置**: `_loadFromDb()`
**问题**: 用 `entry.id.split("-").pop()` 恢复 `_memCounter`，假设 ID 格式永远是 `prefix-timestamp-counter`。若未来 MetaAgent 改变 ID 生成策略（如 UUID），计数器恢复将全部失效，后续 `write()` 可能产生 ID 碰撞。
**建议**: 在 MemoryEntry 中增加 `sequenceNumber` 字段，或改用独立的全局自增计数器持久化。

---

## 🟢 低 (LOW)

### 13. llm-adapter.ts — 缓存序列化无版本号

**位置**: `saveCache()` / `loadCache()`
`saveCache()` 输出的 JSON 无 schema 版本号。未来 `LlmResponse` 结构变更后，旧缓存文件加载会静默产生类型不匹配的数据。建议加 `version` 字段。

### 14. scheduler.ts — `_findMatchingAgent` 中 `node.type` 加分逻辑脆弱

```typescript
if (score > 0 && node.type === type) score += 1;
```
`node.type`（如 "implementation"）恰好等于 AgentType 枚举值（如 "code"）时才加分，绝大多数情况下不会命中。这个加分意图（类型匹配优先）几乎无效，且语义混淆——TaskNode.type 和 AgentType 是两个不同的概念空间。

### 15. react-helper.ts — `MAX_LOOPS` 硬编码，各 Agent 无法定制

InspectorAgent 自己定义了 `MAX_LOOPS = 12`，而 `runReActLoop` 固定用 24。不同 Agent 可能需要不同循环上限，但共享函数不接受此参数。

---

## 📋 架构观察

| 维度 | 评价 |
|------|------|
| **模块边界** | ✅ 清晰。Engine/Shared 分离干净，Agent 类各司其职。 |
| **状态管理** | ⚠️ AgentPool + TaskBoard 各自维护状态，Scheduler 是唯一的协调者但无显式事务边界。 |
| **错误传播** | ⚠️ MemoryStore 的 `_saveDb` 静默失败 + Scheduler 的 `_dispatchNode` 异常吞并——错误路径存在多个"消失点"。 |
| **代码复用** | ⚠️ BaseAgent 设计良好，但 Ops/Loop/Inspector 未继承——复用率可进一步提升。 |
| **测试覆盖** | ❓ 本次未审查测试文件，但 toolkit 全部 stub 意味着集成测试依赖 mock 注入。 |

---

## 🏷️ 给同行审查员的备忘录

> 1. **scheduler.ts `_dispatchNode` 的双重 emit** 是本次最紧迫的 bug——所有失败节点都会触发两次通知，下游 ButlerAgent 会刷屏。下一个审查此文件的人请先确认这个问题是否已修复。
>
> 2. **MemoryStore 的持久化是"乐观持久化"**——写入内存就算成功，磁盘落盘是异步 best-effort。如果你在审查涉及数据一致性的需求，这是关键攻击面。
>
> 3. **InspectorAgent 的 `_collectFacts` 用 `require("node:child_process")` 动态导入**——这在 ESM 模块中会触发运行时警告甚至失败（取决于 Node 版本和 package.json 的 type 字段）。如果你审查构建/部署相关代码，务必检查这个点。
>
> 4. **MetaAgent 的 prompt 工程非常重**（PLANNING_SYSTEM ~100 行，REPLAN_SYSTEM ~70 行），任何 prompt 微调都可能显著改变规划质量。审查规划质量问题时，优先怀疑 prompt 而非解析逻辑。

---

## 最终审查意见

**哼，勉强通过。** 代码骨架清晰，设计意图可辨，但存在几处必须修复的硬伤：

- 🔴 **scheduler 双重 emit** —— 修，立刻修。
- 🔴 **MemoryStore 静默吞错** —— 至少加个 console.error，别装死。
- 🟠 **三个 Agent 类拒绝继承 BaseAgent** —— 这是在给自己找麻烦，下次加功能要改三份。

修完上述问题后，可以进入集成测试轮次。
