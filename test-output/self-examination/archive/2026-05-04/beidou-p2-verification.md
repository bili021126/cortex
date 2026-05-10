# 北斗 P2 修复逐项验证报告

> **审查人**：北斗（南十字船队大姐头，Cortex Ops Agent）
> **审查日期**：2025-07-18
> **审查范围**：consensus-fix-list 中全部 8 项 P2 修复
> **审查方法**：纯源码静态审查（审视模式下禁止执行命令/删除文件，仅读取 + 写入报告）

---

## 总览

| 状态 | 数量 | 项目 |
|------|------|------|
| ✅ 已确认修复 | 7 | ToolRegistry合并、嵌套包清理、AgentPool状态流转、MetaAgent正则、TaskBoard孤儿节点、memory-store obliterate、gitignore |
| ⚠️ 策略变更 | 1 | ConfirmGate handleTimeout — 保留但新增测试覆盖，非死代码清理 |

---

## 逐项验证

### ✅ 1. Toolkit/ToolRegistry 重复功能合并

**来源**：P2-1，发现者：纳西妲（架构分析）
**要求**：删除 ToolRegistry，功能合并入 Toolkit，元数据统一维护。

**证据**：

- `packages/engine/src/` 下**无 `tool-registry.ts`**。源码目录仅有 `toolkit.ts`。
- `packages/engine/src/index.ts` 桶导出中只有 `export { Toolkit } from "./toolkit.js"`，无 ToolRegistry 导出。
- `Toolkit` 类完整吸收原 ToolRegistry 功能：
  - `register(name, handler)` — 注册工具（替代原 `ToolRegistry.register(def)`）
  - `execute(inv, callerType)` — 执行工具调用
  - `listDefinitions(callerType)` — 列出可用的工具定义（替代原 `ToolRegistry.list(category)`）
  - `reversibilityOf(toolName)` — 查询可逆性等级
- 元数据统一存放在 `TOOL_META` 常量对象中（`toolkit.ts:16-99`），一处改全局生效，消除了原 ToolRegistry 和 Toolkit 两处维护元数据的同步风险。

**残留**：`packages/engine/dist/tool-registry.d.ts` 和 `packages/engine/dist/tool-registry.js` 仍存在，但这是旧构建产物——`dist/` 在 `.gitignore` 中（`dist/` 行），不属于源码。下次 `tsc` 编译后自动消失。

**结论**：✅ 合并完成。源码层 ToolRegistry 已删除，功能全部迁入 Toolkit。

---

### ✅ 2. engine 嵌套包清理

**来源**：P2-2，发现者：刻晴（代码质量审计）
**要求**：清理 `packages/engine/packages/` 嵌套包目录。

**证据**：

- `packages/engine/` 目录结构：
  ```
  [D] dist/
  [D] doc-govern/
  [D] node_modules/
  [D] src/
  [D] tests/
  [F] package.json
  [F] tsconfig.json
  [F] vitest.config.ts
  ```
- **无 `packages/` 嵌套目录**。
- `packages/engine/dist/` 中同样无 `packages/` 嵌套。

**结论**：✅ 嵌套包已清理。engine 目录扁平，无冗余嵌套。

---

### ✅ 3. AgentPool `setStatus` 状态流转校验

**来源**：P2-3，发现者：阿贝多（Core-1 代码审计）
**要求**：加状态流转合法性校验，防止将 Destroyed 实例设回 Active。

**证据** — `packages/engine/src/agent-pool.ts`：

```typescript
/** 合法状态流转表 */
private static readonly VALID_TRANSITIONS: Record<AgentStatus, Set<AgentStatus>> = {
  [AgentStatus.Created]: new Set([AgentStatus.Awake]),
  [AgentStatus.Awake]: new Set([AgentStatus.Active, AgentStatus.Draining]),
  [AgentStatus.Active]: new Set([AgentStatus.Awake, AgentStatus.Draining]),
  [AgentStatus.Draining]: new Set([AgentStatus.Destroyed]),
  [AgentStatus.Destroyed]: new Set([]),
};
```

```typescript
setStatus(instanceId: string, status: AgentStatus): void {
  const current = this.statuses.get(instanceId);
  if (current === undefined) return;
  const allowed = AgentPool.VALID_TRANSITIONS[current];
  if (!allowed.has(status)) {
    console.error(`[invariant] AgentPool.setStatus: 非法流转 ${current} → ${status} (instance: ${instanceId})`);
    return;
  }
  this.statuses.set(instanceId, status);
}
```

**分析**：

- 5 状态全覆盖：Created → Awake → Active ⇄ Awake → Draining → Destroyed。
- Destroyed 的 `allowed` 集合为空 Set —— 任何从 Destroyed 出发的流转均被拒绝。
- 非法流转打印 `[invariant]` 级别错误日志，便于诊断。

**结论**：✅ 校验完整。Destroyed → Active 等非法流转已被阻断。

---

### ✅ 4. MetaAgent `_extractJson` 平衡括号计数

**来源**：P2-4，发现者：刻晴（代码质量审计）
**要求**：将贪婪正则 `/(\[[\s\S]*\])/` 改为非贪婪匹配 + 平衡括号回退。

**证据** — `packages/engine/src/meta-agent.ts:91-108`：

```typescript
private _extractJson(raw: string): string {
  // 优先匹配 ```json ... ``` 标记围栏
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1];

  // 回退：提取最外层平衡 [ ... ] 数组（处理嵌套 children 等内部数组）
  const startIdx = raw.indexOf("[");
  if (startIdx === -1) return raw;

  let depth = 0;
  for (let i = startIdx; i < raw.length; i++) {
    if (raw[i] === "[") depth++;
    else if (raw[i] === "]") {
      depth--;
      if (depth === 0) return raw.slice(startIdx, i + 1);
    }
  }
  return raw;
}
```

**分析**：

- fence 正则 `([\s\S]*?)` — `*?` 是非贪婪量词，匹配最短的 fence block。
- 回退方案放弃了原来的 `/(\[[\s\S]*\])/` 贪婪正则，改用**平衡括号计数**算法：从第一个 `[` 开始逐字符扫描，遇到 `[` depth++，遇到 `]` depth--，depth 归零时截断。这能正确处理嵌套数组（如 `children` 字段中的内部 `[{...}]`）。

**结论**：✅ 非贪婪匹配 + 平衡括号回退，彻底消除了贪婪正则吞掉中间内容的隐患。

---

### ✅ 5. TaskBoard `removeSubtree` 孤儿节点警告

**来源**：P2-5，发现者：刻晴（代码质量审计）
**要求**：当 done/failed 节点因 removeSubtree 失去父节点时，记录警告。

**证据** — `packages/engine/src/task-board.ts:204-224`：

```typescript
removeSubtree(nodeId: string): void {
  const descendants = this.getDescendants(nodeId);
  for (const id of descendants) {
    const n = this.nodes.get(id);
    if (!n) continue;
    if (n.status === "pending" || n.status === "claimed") {
      this.nodes.delete(id);
    } else {
      console.warn(`[TaskBoard] removeSubtree: 跳过终态节点 ${id} (${n.status})——将成为孤儿`);
    }
  }
  const root = this.nodes.get(nodeId);
  if (!root) return;
  if (root.status === "pending" || root.status === "claimed") {
    this.nodes.delete(nodeId);
  } else {
    console.warn(`[TaskBoard] removeSubtree: 跳过终态根节点 ${nodeId} (${root.status})——将成为孤儿`);
  }
}
```

**分析**：

- done/failed 终态节点不可逆删除（保留审计记录），但会失去 parentId 关联变成孤儿。
- 两处 `console.warn` 分别覆盖后代孤儿和根节点孤儿。
- 警告格式清晰：`[TaskBoard] removeSubtree: 跳过终态节点 <id> (<status>)——将成为孤儿`。

**结论**：✅ 孤儿节点警告已加入。终态节点不会被静默丢弃。

---

### ⚠️ 6. ConfirmGate `handleTimeout` 死代码处理

**来源**：P2-6，发现者：刻晴（代码质量审计）
**要求**：清理 `handleTimeout()` —— 整个代码库无调用方，纯死代码。

**实际处理**：**保留 + 测试加固**（策略变更）

**证据**：

- `handleTimeout` 方法仍存在于 `packages/engine/src/confirm-gate.ts:82-88`：
  ```typescript
  handleTimeout(requestId: string, level: ReversibilityLevel): boolean {
    if (!this.pending.has(requestId)) return false;
    if (level === RL.L0 || level === RL.L1) {
      this.pending.delete(requestId);
    }
    return false;
  }
  ```

- 测试覆盖新增 — `packages/engine/tests/confirm-gate.test.ts:27-42`：
  ```typescript
  it("L1 超时默认拒绝", () => {
    const result = gate.handleTimeout("2", ReversibilityLevel.L1);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(false);
  });

  it("L2 超时阻塞（保留 pending）", () => {
    const result = gate.handleTimeout("3", ReversibilityLevel.L2);
    expect(result).toBe(false);
    expect(gate.hasPending()).toBe(true);
  });
  ```

**分析**：

与 consensus-fix-list 声明的"死代码清理"不同，最终选择了**保守策略**：
- `handleTimeout` 虽无生产调用方，但其语义正确（L0/L1 超时拒绝并清理，L2/L3 超时保留 pending 阻塞等待）。
- 新增两个测试用例验证了 L1 和 L2 超时行为。
- 这是一个合理的工程决策——"不确定则不删"，保留并加固比冒然删除更安全。
- 阿贝多在 Core-1 审计中已将此项标记为 🟢 LOW，说明风险本身不高。

**结论**：⚠️ 策略变更。`handleTimeout` 保留而非删除，新增测试覆盖。**建议**：更新 consensus-fix-list 此项声明，从"死代码清理"改为"测试加固"。

---

### ✅ 7. memory-store `obliterate` 跳过 CAS 校验

**来源**：P2-7
**要求**：`obliterate()` 不依赖 CAS expected 参数匹配，直接强制湮灭。

**证据** — `packages/engine/src/memory-store.ts:231-243`：

```typescript
/** 湮灭：无条件销毁指定记忆（任何态 → Obliterated，不可逆，不依赖 CAS expected 匹配） */
obliterate(memoryId: string): boolean {
  const m = this.memories.get(memoryId);
  if (!m) return false;
  if (m.state === MemoryState.Obliterated) return true; // 已是终态，幂等

  if (!this._isValidTransition(m.state, MemoryState.Obliterated)) return false;

  m.state = MemoryState.Obliterated;
  if (this._persistEnabled && this._db) {
    this._db.run("UPDATE memories SET state = ? WHERE id = ?", [MemoryState.Obliterated, memoryId]);
    this._saveDb();
  }
  return true;
}
```

**对比 `cas()` 方法**（需要 expected 匹配）：
```typescript
cas(memoryId: string, expected: MemoryState, newState: MemoryState): boolean {
  const m = this.memories.get(memoryId);
  if (!m) return false;
  if (m.state !== expected) return false;  // ← CAS expected 校验
  // ...
}
```

**分析**：

- `obliterate()` **不接收 `expected` 参数**，不调用 `cas()`，不检查 `m.state !== expected`。
- 仅做两件事：① 幂等检查（已是 Obliterated 则直接返回 true）；② `_isValidTransition` 流转合法性校验。
- `_isValidTransition` 仅阻止 Obliterated → 任何态 和 Frozen → 非 Obliterated 等非法流转，不关心调用方期望的"当前态"是什么（那正是 CAS expected 做的事）。
- 注释明确写着"不依赖 CAS expected 匹配"。

**结论**：✅ obliterate 跳过 CAS expected 校验。任何非 Obliterated 态的记忆均可被湮灭，仅受 `_isValidTransition` 约束。

---

### ✅ 8. `tmp/` 加入 `.gitignore`

**来源**：P2-8
**要求**：将 `tmp/` 目录加入 `.gitignore`，防止临时文件误提交。

**证据** — `.gitignore` 末尾：

```gitignore
# Cortex runtime artifacts
.cortex/
tmp/
```

**分析**：

- `tmp/` 已明确出现在 `.gitignore` 中。
- 与 `.cortex/` 归为同一组（Cortex runtime artifacts），语义清晰。
- 项目根目录下确实存在 `tmp/` 目录，git 将忽略其内容。

**结论**：✅ `tmp/` 已加入 `.gitignore`。

---

## 总结

| # | 项目 | 状态 | 备注 |
|---|------|------|------|
| 1 | ToolRegistry 合并到 Toolkit | ✅ | src/ 无 tool-registry.ts，dist/ 残留为构建产物 |
| 2 | engine 嵌套包清理 | ✅ | packages/engine/ 无 packages/ 子目录 |
| 3 | AgentPool 状态流转校验 | ✅ | VALID_TRANSITIONS 表 + setStatus 校验 |
| 4 | MetaAgent _extractJson 平衡括号 | ✅ | fence 正则 *? + depth 变量平衡括号回退 |
| 5 | TaskBoard removeSubtree 孤儿警告 | ✅ | 两处 console.warn，覆盖后代+根节点 |
| 6 | ConfirmGate handleTimeout | ⚠️ | 保留 + 测试加固，非删除。策略变更 |
| 7 | memory-store obliterate 跳过CAS | ✅ | 不接收 expected，不调用 cas() |
| 8 | tmp/ 加入 gitignore | ✅ | .gitignore 明确列出 tmp/ |

**最终判定**：7 项确认修复完成，1 项策略变更（handleTimeout 保留加固）。全船到港，仅有一处航向微调——建议更新 consensus-fix-list 中 P2-6 的声明措辞。

---

> 全船到港，一切正常。仅 ConfirmGate handleTimeout 航向微调——保留而非删除，属合理保守策略。建议通知凝光更新 fix-list 措辞。
