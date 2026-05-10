# 刻晴·玉衡御史 质量侦察报告

**审查范围**: `packages/engine/src/` 全部 23 个源文件  
**审查焦点**: 异常处理、状态机完整性、资源清理、假守卫  
**审查者**: 玉衡星·刻晴  
**日期**: 审判日

---

## 目录

1. [🔴 致命伤 — 假守卫与状态机绕过](#1)
2. [🟠 硬伤 — 逻辑缺陷与边界遗漏](#2)
3. [🟡 皮外伤 — 设计瑕疵与代码气味](#3)
4. [🟢 建议 — 可优化项](#4)
5. [汇总表](#5)

---

<a name="1"></a>
## 🔴 致命伤（数据损坏 / 死锁 / 静默吞错）

### 🔴 F-1: AgentPool.destroy 绕过状态机校验 — 假守卫

**文件**: `agent-pool.ts` L96–L106  
**源码**:

```ts
destroy(agentType: AgentType, instanceId: string): void {
  const current = this.statuses.get(instanceId);
  if (current !== undefined && current !== AgentStatus.Destroyed) {
    if (current !== AgentStatus.Draining) {
      console.warn(
        `[agent-pool] destroy 绕过状态机: ${current} → Destroyed (instance: ${instanceId})，强制清理`,
      );
    }
    // 直接置状态，不经过 setStatus——绕过流转校验，语义为"强制清理"一致
    this.statuses.set(instanceId, AgentStatus.Destroyed);
  }
  this.active.get(agentType)?.delete(instanceId);
  this.statuses.delete(instanceId);
}
```

**问题**: `destroy()` 直接操作 `statuses` Map 并原地 `delete`，完全绕过 `setStatus()` 的 `VALID_TRANSITIONS` 表驱动校验。注释自称"强制清理"，但：

1. `VALID_TRANSITIONS` 表定义了从 `Draining`→`Destroyed` 的合法路径，`destroy()` 允许**任意状态**直接跳 `Destroyed`（然后立即删除记录）。
2. `onInvariant` 回调仅 `console.warn`，不阻止操作——看门人喊了"抓贼"但没锁门。
3. 如果从 `Created` 或 `Active` 直接跳到 `Destroyed`，`AgentPool.count()` 等统计会失去该实例，但下游若持有过时的 instanceId 引用会收到 `undefined` 而非预期状态。

**影响**: 🔴 状态机守卫被 `destroy()` 方法完全架空。"强制清理"场景可理解，但应通过 `setStatus(Draining)` → `setStatus(Destroyed)` 两步合法路径完成，而非直接写私有字段。

---

### 🔴 F-2: ConfirmGate.bypassAll() — 无生产环境防护

**文件**: `confirm-gate.ts` L18  
**源码**:

```ts
/** 测试模式：跳过所有确认，直接放行 */
bypassAll(): void { this._bypass = true; }

/** 判定是否需要确认 */
needsConfirmation(level: ReversibilityLevel): boolean {
  if (this._bypass) return false;    // ← 无条件放行
  return level === RL.L2 || level === RL.L3;
}
```

**问题**: `_bypass` 开关无任何环境检测。若在生产代码路径中不小心调用了 `bypassAll()`：
- 所有 L3（删除文件、跑脚本）操作将**静默放行**，用户无感知。
- 无超时自动复位、无环境断言、无日志告警。

**影响**: 🔴 测试钩子泄漏到生产环境，直接削弱确认门的核心安全职责。

---

### 🔴 F-3: ReAct 循环崩溃时 success 为 true（误报成功）

**文件**: `react-helper.ts` L75–L80, L83–L91  
**源码**:

```ts
} catch (e: any) {
  // ReAct 循环崩溃：保留已完成轮次的中间输出...
  finalOutput = `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e?.message ?? e)}]`;
  break;
}

return {
  nodeId: node.id,
  agentType: callerType,
  success: finalOutput !== undefined,    // ← crash 后 finalOutput 被赋值 → success = true
  output: finalOutput,
  error: finalOutput === undefined ? "Exceeded max loops without final answer" : undefined,
};
```

**问题**: 循环崩溃后 `finalOutput` 被设为错误消息字符串，导致 `success` 为 `true`。下游（Scheduler、MemoryStore）检查 `result.success` 时会误判本次执行为成功，但实际上 Agent 崩溃了。崩溃信息被藏在 `output` 字段里。

**影响**: 🔴 静默吞错（以"成功"姿态传递崩溃信息）。下游依赖 `success` 做决策的逻辑（如重规划判定）会被误导。

---

<a name="2"></a>
## 🟠 硬伤（逻辑漏洞 / 重复代码 / 边界未覆盖）

### 🟠 H-1: BaseAgent.status 降级到 _localStatus 绕过 Pool

**文件**: `base-agent.ts` L24–L30  
**源码**:

```ts
get status(): AS {
  if (this._pool && this._instanceId) {
    const s = this._pool.getStatus(this._instanceId);
    if (s !== undefined) return s;     // ← 仅检查 undefined，不检查 Pool 是否认识该实例
  }
  return this._localStatus;            // ← 静默降级
}
```

**问题**: 当 `_pool` 存在但 `getStatus()` 返回 `undefined`（实例未注册/已销毁），或 `_instanceId` 为 null 时，静默降级到 `_localStatus`。这意味着：
1. Agent 实例在 Pool 中已被 `destroy()` 删除，但 `status` getter 会返回过时的 `_localStatus`。
2. 测试中 `_pool` 为 null 时无任何流转校验——任何状态跳转都允许。

**影响**: 🟠 组合使用 `_pool` 权威源方案时，此降级路径可能掩盖 Pool 与 Agent 之间的状态不一致。

---

### 🟠 H-2: FileLockManager 无自动定期清理过期锁

**文件**: `file-lock-manager.ts` L98–L109  
**源码**:

```ts
/** 全局清理所有过期锁（建议定时器调用） */
cleanStaleLocks(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [filePath, entry] of this.locks) {
    if (now - entry.acquiredAt > this.timeoutMs) {
      this.locks.delete(filePath);
      cleaned++;
    }
  }
  // ...
}
```

**问题**: `cleanStaleLocks()` 注释说"建议定时器调用"，但类内部未启动任何定时器。只有 `acquire()` 和 `isLocked()` 调用时才会触发单文件清理 `_cleanStaleLock()`。如果某文件的锁过期后没有任何后续操作触及该文件，过期锁将永久驻留。

**影响**: 🟠 在长时间运行的进程中，若 Agent 崩溃后不再访问某文件，该文件的锁标记不会自动回收。虽然 `acquire()` 路径上有清理逻辑，但这依赖于外部触发。

---

### 🟠 H-3: Scheduler 无 shutdown/cleanup 机制

**文件**: `scheduler.ts`（全文搜索无 shutdown 方法）  
**源码**: 缺省

**问题**: `Scheduler` 类无 `shutdown()` 或 `close()` 方法。注册的 Agent、replanMap、replanQueue 等状态无法优雅释放。当进程关闭时：
- Agent 不会被通知 shutdown（尽管 BaseAgent 定义了 shutdown，但 Scheduler 不调）
- 正在执行的异步 replan 可能被中断
- 无信号告知 MemoryStore 做 final flush

**影响**: 🟠 优雅关闭路径缺失，可能导致内存数据未持久化。

---

### 🟠 H-4: MemoryStore LB 写操作在 closing 后仍执行部分路径

**文件**: `memory-store.ts` — `_safeDbRun` 和写方法（write/updateAccessCount/link）  
**源码**:

```ts
private _safeDbRun(sql: string, params: unknown[], opName: string): void {
  if (!this._db) return;    // ← 只检查 _db 存在性，不检查 lifecycle
  // ...
}
```

**问题**: `_safeDbRun` 仅检查 `!_db`，不检查 `_lifecycle !== "closing"`。在 `close()` 已调用（`_lifecycle` 设为 `"closing"`，`_db` 尚未置 undefined）的窗口期内，新写入仍可调用 `_db.run()`。虽然 `close()` 会执行 final flush，但 closing 期的写入可能丢失或造成竞态。

**影响**: 🟠 closing 状态的写入防护不完整。

---

<a name="3"></a>
## 🟡 皮外伤（代码气味 / 边界异常）

### 🟡 M-1: search_code 工具静默吞 rg 错误

**文件**: `toolkit.ts` — search_code handler  
**源码**:

```ts
try {
  output = execFileSync("rg", [...], { ... });
} catch {
  // rg 不可用或超时 → 退回简单 grep
  output = this._grepFallback(searchRoot, query);
}
```

**问题**: 空 catch 块 `catch { }` 静默吞掉 rg 的 stderr（如 rg 版本不兼容、权限错误、二进制损坏）。用户看到 grep 回退结果但不知道 rg 为什么失败。

**影响**: 🟡 调试困难——rg 错误被彻底隐藏。

### 🟡 M-2: BaseAgent 中文字段注释编码问题

**文件**: `base-agent.ts`（多个方法注释）  
**源码**: `鎵ц鍓嶉挬瀛愨€斺€斿瓙绫诲彲瑕嗗啓姝ゆ柟娉曟敞鍏ュ墠缃簨瀹為噰闆嗭紙濡?tsc ...`

**问题**: 中文字符在运行时 console 输出时可能出现编码损坏。非功能性但影响可维护性。

**影响**: 🟡 代码可读性受损。

### 🟡 M-3: AgentPool spawn 无超时/重试

**文件**: `agent-pool.ts` L49–L56  
**源码**:

```ts
spawn(agentType: AgentType, instanceId: string): boolean {
  const config = this.configs.get(agentType);
  if (!config) return false;
  const instances = this.active.get(agentType)!;
  if (instances.size >= config.maxInstances) return false;
  // ...
}
```

**问题**: `maxInstances` 达到上限时直接返回 `false`，无等待队列或重试机制。在高并发场景下可能导致某些 Agent 类型持续饥饿。

**影响**: 🟡 当前单线程场景无影响，但为后续并发扩展埋坑。

---

<a name="4"></a>
## 🟢 建议（可优化项）

### 🟢 S-1: FileLockManager 增加自动定期扫描

建议在构造函数中启动一个 `setInterval` 定时器，每 `timeoutMs / 2` 间隔执行 `cleanStaleLocks()`，并暴露 `stopAutoCleanup()` 方法用于 shutdown。

### 🟢 S-2: ReAct 循环崩溃应标记 success = false

将 crash 处理改为：

```ts
} catch (e: any) {
  return {
    nodeId: node.id,
    agentType: callerType,
    success: false,
    output: undefined,
    error: `[ReAct loop crashed at iteration ${loops}/${maxLoops}: ${String(e?.message ?? e)}]`,
  };
}
```

保留中间输出的需求可以通过 `output` 字段放 `partialOutput` 实现，但不应影响 `success`。

### 🟢 S-3: ConfirmGate.bypassAll() 增加环境断言

```ts
bypassAll(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("ConfirmGate.bypassAll() called in production — forbidden");
  }
  this._bypass = true;
}
```

### 🟢 S-4: Scheduler 增加 shutdown 方法

遍历所有注册 Agent 调 `agent.shutdown()`，等待 inflight replan 完成，清空队列。

### 🟢 S-5: _safeDbRun 增加 lifecycle 检查

```ts
private _safeDbRun(sql, params, opName): void {
  if (!this._db || this._lifecycle !== "active") return;
  // ...
}
```

### 🟢 S-6: AgentPool.destroy 改用合法路径

```ts
destroy(agentType, instanceId): void {
  const current = this.statuses.get(instanceId);
  if (current !== undefined && current !== AgentStatus.Destroyed) {
    // 走合法路径：先 Draining 再 Destroyed
    this.setStatus(instanceId, AgentStatus.Draining);
    this.setStatus(instanceId, AgentStatus.Destroyed);
  }
  this.active.get(agentType)?.delete(instanceId);
  this.statuses.delete(instanceId);
}
```

---

<a name="5"></a>
## 汇总表

| 编号 | 定级 | 分类 | 模块 | 概要 |
|------|------|------|------|------|
| F-1 | 🔴 致命 | 假守卫 | AgentPool | `destroy()` 绕过 `VALID_TRANSITIONS` 表 |
| F-2 | 🔴 致命 | 假守卫 | ConfirmGate | `bypassAll()` 无生产环境防护 |
| F-3 | 🔴 致命 | 异常处理 | react-helper | 循环崩溃标记 `success=true`，误报成功 |
| H-1 | 🟠 硬伤 | 状态机 | BaseAgent | status 降级到 `_localStatus` 绕过 Pool |
| H-2 | 🟠 硬伤 | 资源清理 | FileLockManager | 无自动定时清理过期锁 |
| H-3 | 🟠 硬伤 | 资源清理 | Scheduler | 无 shutdown/cleanup 方法 |
| H-4 | 🟠 硬伤 | 资源清理 | MemoryStore | closing 期写入防护不完整 |
| M-1 | 🟡 皮外伤 | 异常处理 | Toolkit | search_code 静默吞 rg 错误 |
| M-2 | 🟡 皮外伤 | 维护性 | BaseAgent | 注释编码损坏 |
| M-3 | 🟡 皮外伤 | 设计 | AgentPool | spawn 无等待队列 |
| S-1 | 🟢 建议 | 资源清理 | FileLockManager | 加自动定时器扫描 |
| S-2 | 🟢 建议 | 异常处理 | react-helper | 崩溃应标记 success=false |
| S-3 | 🟢 建议 | 假守卫 | ConfirmGate | 加 NODE_ENV 断言 |
| S-4 | 🟢 建议 | 资源清理 | Scheduler | 加 shutdown |
| S-5 | 🟢 建议 | 状态机 | MemoryStore | _safeDbRun 加 lifecycle 检查 |
| S-6 | 🟢 建议 | 假守卫 | AgentPool | destroy 改用合法流转路径 |

**总结**: 3 个 🔴 致命伤集中在**假守卫**（F-1/F-2）和**误报成功**（F-3），核心问题是有守卫逻辑但关键路径绕过了它。4 个 🟠 硬伤主要是**资源清理路径不完整**（H-2/H-3/H-4）和**状态降级风险**（H-1）。3 个 🟡 皮外伤不影响功能。建议优先修复 F-1/F-2/F-3，这是 Pipeline 的底线安全。

---

*备忘录归档：此报告已写入 test-output/self-examination-soft/keqing-quality-recon.md。下一轮审查同一模块时请先翻此页。*
