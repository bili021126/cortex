# P0+P1 修复验证报告（二次验证 · 逐源码审查）

> 审视 Agent：刻晴（玉衡星，Review Agent）
> 验证日期：2026-05-05
> 方法：逐文件源码审查（search_code + read_file 实际代码行，非依赖旧报告或 dist）
> 上一轮报告：同文件（2026-05-04）—— 本次为逐项重新验证，覆盖 P0 + P1

---

## 总体结论

| 状态 | 数量 | 明细 |
|------|------|------|
| ✅ 已闭合 | 10 | _saveDb try-catch、_deserializeRow JSON.parse 防护、_sqlRead observer 迁移、observer 全通道接入、node.complete success 守卫、claimedBy invariant observer 迁移、Agent 层继承、vitest 版本统一、API Key 硬编码移除、eslint/tsconfig |
| ⚠️ 部分完成 | 1 | .env 双文件 DEEPSEEK_CHAT_MODEL 值冲突（root flash vs engine reasoner） |
| ❌ 待修复 | 1 | CI 缺失（无 GitHub Actions / Docker / 自动化门禁） |

---

## 逐项验证

### ✅ P0-1: _saveDb try-catch 磁盘写入防护

**审查源文件**：`packages/engine/src/memory-store.ts` (line 431–450)

**实际源码**：
```typescript
private _saveDb(): void {
    if (!this._db || !this._dbPath) return;
    try {
      const data = this._db.export();
      const buf = Buffer.from(data);
      fs.writeFileSync(this._dbPath, buf);
    } catch (e) {
      const errMsg = `[MemoryStore] _saveDb 磁盘写入失败: ${String(e).slice(0, 300)}`;
      if (this._observer) {
        this._observer.emit({
          type: "memory.persist_failed",
          priority: PipelinePriority.CRITICAL,
          payload: { dbPath: this._dbPath, error: String(e) },
          timestamp: Date.now(),
        });
      } else {
        console.error(errMsg);
      }
    }
  }
```

**判断**：✅ **已闭合**。try-catch 包裹 `writeFileSync`，catch 块通过 observer 发射 `memory.persist_failed`（CRITICAL 优先级），无 observer 时退化为 `console.error`。磁盘写入失败不再静默吞错。

与上一轮（2026-05-04）状态对比：**此前标记为"半成品/未闭合"**——当时 `_saveDb` 裸调 writeFileSync 无 try-catch。现已完整修复。

---

### ✅ P0-1b: _deserializeRow JSON.parse 防护

**审查源文件**：`packages/engine/src/memory-store.ts` (line ~620–640)

**实际源码**：
```typescript
private _deserializeRow(raw: Record<string, unknown>): MemoryEntry | null {
    try {
      return {
        id: raw.id as string,
        content: JSON.parse(raw.content as string),
        metadata: raw.metadata ? JSON.parse(raw.metadata as string) : undefined,
        // ...其余字段映射
      };
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: "memory.deserialize_failed",
          priority: PipelinePriority.HIGH,
          payload: { id: raw.id, error: String(e).slice(0, 200) },
          timestamp: Date.now(),
        });
      } else {
        console.error(`[MemoryStore] JSON 解析失败，跳过行 ${raw.id}: ${String(e).slice(0, 200)}`);
      }
      return null;
    }
  }
```

**判断**：✅ **已闭合**。`JSON.parse()` 被 try-catch 包裹，损坏行返回 `null` 由调用方 (`_loadFromDb`) 跳过，不崩溃整个 `init()`。两处 JSON.parse 调用（content + metadata）均在同一 try 块内受保护。

---

### ✅ P0-2: _sqlRead observer 迁移 + 退化回退

**审查源文件**：`packages/engine/src/memory-store.ts` (line ~520–545)

**实际源码**：
```typescript
try {
      const stmt = this._db.prepare(sql);
      stmt.bind(params);
      // ... step() loop + deserialize
      stmt.free();
      return rows;
    } catch (e) {
      if (this._observer) {
        this._observer.emit({
          type: "memory.sql_degraded",
          priority: PipelinePriority.HIGH,
          payload: { error: String(e).slice(0, 200) },
          timestamp: Date.now(),
        });
      } else {
        console.warn(`[MemoryStore] SQL 查询退化至内存扫描: ${String(e).slice(0, 200)}`);
      }
      return this._memScanRead(query, now);
    }
```

**判断**：✅ **已闭合**。SQL 查询异常时 observer 发射 `memory.sql_degraded`，退化至 `_memScanRead` 全量扫描。`console.warn` 仅作无 observer 时的 fallback，非主路径。

**收敛说明**：上一轮报告及 roundtable-config 中对 console.warn "不进事件总线"的批评现已不成立——observer.emit 是主路径，console.warn 是兜底。

---

### ✅ P0-3: observer 全通道接入

**审查文件**：`packages/engine/src/memory-store.ts`

**Observer emit 点统计**（`memory-store.ts` 源文件）：

| 事件类型 | 触发位置 | 优先级 |
|----------|---------|--------|
| `memory.persist_failed` | `_saveDb` catch (line ~437) | CRITICAL |
| `memory.sql_degraded` | `_sqlRead` catch (line ~532) | HIGH |
| `memory.deserialize_failed` | `_deserializeRow` catch (line ~625) | HIGH |

所有错误路径均通过 `if (this._observer) { ...emit() } else { console.error/warn }` 模式。构造函数接受 `PipelineObserver` 参数。

**判断**：✅ **已闭合**。observer 接入完整，无遗漏的错误静默路径。

---

### ✅ P1-1: node.complete success 守卫

**审查源文件**：`packages/engine/src/scheduler.ts`

**_dispatchSingle 末尾**（line ~452–458）：
```typescript
// node.complete 仅成功时发射——失败由 _dispatchNode 统一发射 node.failed，避免双重通知
if (result.success) {
  this.observer.emit({
    type: "node.complete",
    priority: PipelinePriority.HIGH,
    payload: { nodeId: node.id, agentType, success: true },
    timestamp: Date.now(),
  });
}
```

**_dispatchMulti 末尾**（line ~524–534）：
```typescript
// node.complete 仅全成功时发射——失败由 _dispatchNode 统一发射 node.failed
if (allSuccess) {
  this.observer.emit({
    type: "node.complete",
    priority: PipelinePriority.HIGH,
    payload: {
      nodeId: node.id,
      perspectives: results.map((r) => r.agentType),
      allSuccess: true,
    },
    timestamp: Date.now(),
  });
}
```

**判断**：✅ **已闭合**。`node.complete` 事件在 `_dispatchSingle` 由 `if (result.success)` 守卫，在 `_dispatchMulti` 由 `if (allSuccess)` 守卫。失败路径由 `_dispatchNode` 统一发射 `node.failed`，无双重发射、无遗漏。

---

### ✅ P1-2: claimedBy invariant observer 迁移

**审查源文件**：`packages/engine/src/scheduler.ts` (line ~498–515)

**实际源码**（`_dispatchMulti` 方法内）：
```typescript
// ── invariant：claimedBy 中每个条目最终要么在 results 中，要么已被 release
if (results.length > 0) {
  const currentNode = this.board.getNode(node.id);
  if (currentNode && currentNode.status !== "failed") {
    const resultTypes = new Set(results.map((r) => r.agentType).filter((t): t is AgentType => t != null));
    for (const at of currentNode.claimedBy) {
      if (!resultTypes.has(at)) {
        this.observer.emit({
          type: "scheduler.invariant_violation",
          priority: PipelinePriority.CRITICAL,
          payload: {
            nodeId: node.id,
            message: `claimedBy 中 ${at} 无对应 result — claimedBy=[${currentNode.claimedBy}], results=[${[...resultTypes]}]`,
          },
          timestamp: Date.now(),
        });
      }
    }
  }
}
```

**判断**：✅ **已闭合**。claimedBy invariant 已从 `console.error` 迁移为 `observer.emit('scheduler.invariant_violation')`（CRITICAL 优先级）。注意：`dist/scheduler.js` 仍为旧版 `console.error`——但 dist 是构建产物，源码为准。

**对比**：`task-board.ts` 中仍有另一 invariant 用 `console.error`（results ↔ claimedBy 对称性校验），但那是不同的断言点，不在本次 claimedBy 修复范围内。

---

### ✅ P1-3: Agent 层统一继承 BaseAgent

**审查范围**：全部 8 个执行型 Agent 源文件

| Agent 类 | 源文件 | 继承声明 | 状态 |
|----------|--------|---------|------|
| CodeAgent | `code-agent.ts:40` | `export class CodeAgent extends BaseAgent` | ✅ |
| ReviewAgent | `review-agent.ts:46` | `export class ReviewAgent extends BaseAgent` | ✅ |
| AnalysisAgent | `analysis-agent.ts:48` | `export class AnalysisAgent extends BaseAgent` | ✅ |
| OpsAgent | `ops-agent.ts:44` | `export class OpsAgent extends BaseAgent` | ✅ |
| LoopAgent | `loop-agent.ts:24` | `export class LoopAgent extends BaseAgent` | ✅ |
| DocGovernAgent | `doc-govern-agent.ts:48` | `export class DocGovernAgent extends BaseAgent` | ✅ |
| InspectorAgent | `inspector-agent.ts:62` | `export class InspectorAgent extends BaseAgent` | ✅ |
| BrowserAgent | `browser-agent.ts:58` | `export class BrowserAgent extends BaseAgent` | ✅ |
| MetaAgent | `meta-agent.ts` | `export class MetaAgent`（独立，不执行节点） | ✅ 合理 |
| ButlerAgent | `butler-agent.ts` | `export class ButlerAgent`（独立，事件观察者） | ✅ 合理 |

**判断**：✅ **已闭合**。8 个执行 Agent 全继承 BaseAgent，共享 execute() → preExecuteHook() → runReActLoop() 调用链。MetaAgent（规划引擎）和 ButlerAgent（事件通知）独立设计合理——它们不执行任务节点，不适用 BaseAgent 契约。

---

### ✅ P1-3b: vitest 版本统一

**审查文件**：`package.json`、各子包 `package.json`、`pnpm-lock.yaml`

| 包 | specifier | resolved (lockfile) |
|----|-----------|---------------------|
| root | `"vitest": "^2.1.0"` | `2.1.9` |
| @cortex/engine | `"vitest": "^2.1.0"` | `2.1.9` |
| @cortex/shared | `"vitest": "^2.1.0"` | `2.1.9` |
| @cortex/testing | `"vitest": "^2.1.0"` | `2.1.9` |

**判断**：✅ **已闭合**。四个包全部声明 `^2.1.0`，pnpm-lock 统一解析为 `2.1.9`。此前北斗报告（beidou-ops-readiness.md）中 root 有 `^4.1.5` 的问题已修复。

---

### ⚠️ P1-4: DEEPSEEK_CHAT_MODEL 环境变量

**审查文件**：`.env`（root）、`packages/engine/.env`

**3a. 命名统一** ✅：

搜索 `DEEPSEEK_MODEL`（不跟随下划线）→ 0 匹配。搜索 `DEEPSEEK_CHAT_MODEL` → 所有代码/配置引用已统一。旧名 `DEEPSEEK_MODEL` 已从代码库中完全清除。

**3b. 双文件值冲突** ❌：

| 变量 | `.env` (root) | `packages/engine/.env` | 冲突？ |
|------|---------------|----------------------|--------|
| `DEEPSEEK_API_KEY` | `sk-1e1f...` | `sk-1e1f...` | 一致 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | `https://api.deepseek.com/v1` | 一致 |
| `DEEPSEEK_CHAT_MODEL` | `deepseek-v4-flash` | `deepseek-reasoner` | ❌ 冲突 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | `deepseek-v4-pro` | 一致 |

**判断**：⚠️ **部分完成**。命名已统一，但 root `.env` 为 `deepseek-v4-flash`，engine `.env` 为 `deepseek-reasoner`——两个值语义不同，运行时加载顺序决定实际使用哪个模型。`vitest.config.ts` fallback 值为 `"deepseek-chat"`，是第三个不同值。

**建议**：删除 `packages/engine/.env`，仅保留 root `.env` 作为唯一环境变量源。或至少将 engine/.env 的 DEEPSEEK_CHAT_MODEL 与 root 同步为 `deepseek-v4-flash`。

---

### ✅ P1-5: API Key 硬编码移除

**审查文件**：`packages/engine/vitest.config.ts`

```typescript
env: {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
},
```

**判断**：✅ **已闭合**。API Key 从 `process.env.DEEPSEEK_API_KEY` 读取，缺失时为空字符串，无硬编码密钥。

---

### ✅ P1-6: eslint 配置

**审查文件**：`eslint.config.mjs`

Flat config 格式（ESLint v10+），包含 `@eslint/js` recommended + `typescript-eslint` recommended。Ignore 覆盖 dist/node_modules/tmp/test-output。TypeScript 规则为 `warn` 级别。

**判断**：✅ **已闭合**。

---

### ✅ P1-7: TaskBoard complete() 等齐逻辑

**审查文件**：`packages/engine/src/task-board.ts`

**实际逻辑**（摘要）：
- 去重：同 agentType 已在 results 中则跳过
- 对称性 invariant：results 中 agentType 必须在 claimedBy 中
- 等齐判断：multi-perspective 场景下 `claimed` Set 与 `done` Set 完全匹配后才置 `done`

**判断**：✅ **已闭合**。

---

### ✅ P1-8: tsconfig 继承统一

三个包（shared/engine/testing）全部通过 `extends: "../../tsconfig.base.json"` 继承根配置。references 链正确：engine → shared，testing → shared，shared 无依赖。

**判断**：✅ **已闭合**。

---

### ❌ P1-9: CI 可重复验证流程

`.github/workflows/` 目录不存在。无 Dockerfile。无 docker-compose.yml。

**当前可用命令**（仅手动）：`pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`

**判断**：❌ **未完成**。无自动化 CI 门禁。

---

## console.warn 全项目统计

| 文件 | 位置 | 用途 | 是否有 observer fallback |
|------|------|------|------------------------|
| `memory-store.ts:543` | `_sqlRead` catch | SQL 退化警告（observer 主路径，console.warn 兜底） | ✅ |
| `scheduler.ts:370` | `_dispatchSingle` | 诊断：非标准 AgentType 节点 | ❌（诊断性质，非错误） |
| `base-agent.ts:143` | `_executeAndRemember` catch | 记忆写入失败（任务成功完成） | ❌（任务层防护，不阻断） |
| `meta-agent.ts:135` | `_parsePlanRaw` catch | JSON 解析失败回退 | ❌（规划层回退） |
| `task-board.ts:213/221` | `removeSubtree` | 孤儿节点警告 | ❌（诊断性质） |

**判断**：`memory-store.ts` 中 `_sqlRead` 的 console.warn 已改为 observer.emit 主路径 + console.warn 兜底。其余 console.warn 均为诊断/回退性质，非错误吞没。

---

## 跨项观察

### 与上一轮（2026-05-04）对比

| 项目 | 上一轮状态 | 本轮状态 | 变化 |
|------|-----------|---------|------|
| _saveDb try-catch | ❌ 半成品（裸调） | ✅ 已闭合 | **修复完成** |
| _deserializeRow JSON.parse | 未单独列出 | ✅ 已闭合 | **新增闭合** |
| _sqlRead observer 迁移 | ⚠️ console.warn 为主 | ✅ observer 为主 | **修复完成** |
| claimedBy invariant | ✅ console.error | ✅ observer.emit | **迁移完成** |
| Agent 继承 | ✅ | ✅ | 不变 |
| vitest 版本 | ✅ | ✅ | 不变 |
| .env 冲突 | ⚠️ | ⚠️ | **未解决** |
| CI 缺失 | ❌ | ❌ | **未解决** |

### P0 核心问题闭合确认

上一轮 roundtable-config 中三人独立发现（★★★ 共识）的 `_saveDb` 静默吞错问题，现已完全闭合：

- `writeFileSync` 被 try-catch 包裹 ✅
- 错误通过 observer.emit('memory.persist_failed') 上报 ✅
- 无 observer 时 console.error 兜底 ✅

**此修复闭合了共识清单中最关键的 P0 残留项。**

### 剩余风险

1. **.env 双文件冲突**（⚠️）：DEEPSEEK_CHAT_MODEL 值不一致持续存在，运行时行为不确定。
2. **CI 缺失**（❌）：无人值守的质量门禁缺失。

---

*刻晴，玉衡星，2026-05-05*
*本轮逐源码审查确认：P0 核心项 _saveDb 静默吞错已闭合。P1 九项中七项确认完成。.env 冲突和 CI 缺失两项持续未解决。*
