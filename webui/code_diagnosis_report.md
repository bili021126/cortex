# 📋 Cortex Packages 代码审查诊断报告

**审查人：** 刻晴（玉衡 — Review Agent）  
**审查范围：** `packages/` 下 11 个子包（shared, engine, cli, data, llm, pm, tools, factory, parser, notification, testing）  
**审查日期：** 2026-07-22（第四次审查）  
**历史档案追溯（MemoryStore）：** 上次审查（2026-07-22 第三次审查）报告了 10 项问题，其中 4 项已修复、6 项遗留。本次审查验证了全部遗留项状态，发现 **3 项新缺陷** 并修正 **2 项状态判定**。

---

## 总览

| 严重级别 | 本轮新增 | 上一轮遗留 + 状态修正 | 合计 |
|---------|---------|----------------------|------|
| 🔴 Critical | 0 | 0 | 0 |
| 🟠 High | 1 | 0 + (1→状态变更) | 1 |
| 🟡 Medium | 2 | 2 + (1→状态变更) | 4 |
| 🔵 Low / 建议 | 0 | 0 | 0 |
| **总计** | **3** | **2+2** | **5** |

---

## ✅ 上一轮已修复项确认

### ✅ H-01: `_rememberResult` catch 未清理半成品 Pending 条目（已修复）
**文件：** `packages/engine/src/memory/pipeline.ts`  
**证据：** catch 块已实现半成品清理逻辑：
```typescript
catch (memErr) {
  try { if (memId !== undefined) memory.cas(memId, MemoryState.Pending, MemoryState.Archived); } catch { /* 静默 */ }
  try { if (ctxMemId !== undefined) memory.cas(ctxMemId, MemoryState.Pending, MemoryState.Archived); } catch { /* 静默 */ }
  // ...
}
```
变量 `memId` / `ctxMemId` 已提升至 try 块外声明（`let`），catch 可访问。注释标注 `@fix H-01`。**确认关闭。**

### ✅ M-01: TaskBoard.complete 多视角等齐后静默丢弃后续 Agent 失败结果（已修复）
**文件：** `packages/engine/src/core/task-board.ts`  
**证据：** Multi-perspective 路径中，去重判断已移至状态等齐判断之后：
```typescript
// 先写入结果
node.results.push({...});
// 等齐判断
if (claimed.size === done.size && ...) { node.status = "done"; }
// 去重在后（保留最后一个结果）
```
注释标注 `@fix M-01`。**确认关闭。**

### ✅ M-02: JsonFileAdapter.ensureDir 仍是同步 I/O（已修复）
**文件：** `packages/data/src/storage/adapters/json-file.adapter.ts`  
**证据：** 使用 `await mkdir(dir, { recursive: true })` 替代同步 `mkdirSync`。注释标注 `@fix M-02`。**确认关闭。**

### ✅ M-04: ConfirmGate.dispose() 静默 `resolve(false)` 阻塞上游（已修复）
**文件：** `packages/engine/src/core/confirm-gate.ts`  
**证据：** `dispose()` 改用 `reject(new ConfirmGateDisposedError(id))`，上游通过 try-catch 可区分"用户拒绝"和"引擎关闭"。注释标注 `@fix M-04`。**确认关闭。**

### ✅ N-04: NotificationPipe._flushMerged 时间窗口条件短路（已修复）
**文件：** `packages/notification/src/notification-pipe.ts`  
**证据：** `events.length > 0` 恒真条件已被移除，仅依赖时间窗口 `now - firstTimestamp >= windowMs`。注释标注 `@fix N-04`。**确认关闭。**

---

## ⚠️ 上一轮遗留项状态修正

### 🔄 N-02 → 状态变更：bootstrap.ts assemble 函数并非异步（不适用原诊断）
**文件：** `packages/factory/src/bootstrap.ts` + `packages/factory/src/assemblers/`  
**旧诊断：** "四个函数均为 async（返回 Promise），用 void 调用，异步错误静默吞没"  
**实际情况：** 审查了所有 4 个 assemble 函数的签名和实现——

| 函数 | 签名 | 实际行为 |
|------|------|---------|
| `assembleAgents()` | `(definitions: AgentDefinition[]): AgentAssemblyResult` | **同步** — for 循环 + Map 操作 |
| `assembleEventRouter()` | `(config: CortexAgentsConfig): AssembledEventRouter` | **同步** — 直接返回对象 |
| `assembleCommittee()` | `(rules: CommitteeRule[]): AssembledCommittee` | **同步** — for 循环分类 |
| `assembleTelescope()` | `(_overrides?): TelescopeConfig` | **同步** — spread 合并默认值 |

**修正判定：** 原 N-02 诊断不成立——所有 assemble 函数是纯同步数据转换，不存在异步错误吞没问题。

**新发现（N-06）：** 但这些函数的 **返回值全部被忽略**——见下方新增缺陷。

---

## ⚠️ 上一轮遗留项（仍未修复）

### M-03 🟡 Medium — MemoryStore.write() 去重路径 DB 更新失败静默吞错

**文件：** `packages/engine/src/memory/memory-store.ts`（`write` 方法）  
**状态：** ⚠️ **仍未修复**（已持续 3 轮审查）

**证据（两处相同的空 catch 模式）：**
```typescript
// SHA256 精确去重路径：
exactDup.accessCount++;
exactDup.lastAccessedAt = Date.now();
if (this._persistence.isEnabled) {
  try {
    this._persistence.run(/* UPDATE ... */);
    this._persistence.scheduleFlush();
  } catch { /* DB 更新失败静默降级 */ }  // ← 空 catch
}
return exactDup.id;

// 向量相似去重路径（完全相同的模式）：
similar.accessCount++;
similar.lastAccessedAt = Date.now();
if (this._persistence.isEnabled) {
  try {
    this._persistence.run(/* UPDATE ... */);
    this._persistence.scheduleFlush();
  } catch { /* DB 更新失败静默降级 */ }  // ← 空 catch
}
return similar.id;
```

**触发条件：** `this._persistence.run()` 抛出任意瞬态异常（DB 连接抖动、SQLite 锁定超时）。

**后果：**
1. 内存中的 `accessCount++` 已执行但 DB 未更新
2. 进程重启后 accessCount 回退
3. 空 catch 完全不可观测——没有日志、没有事件、没有计数器回滚

**修复建议：**
```typescript
catch {
  exactDup.accessCount--;   // 回滚内存计数器
  this._observer?.emit({
    type: PipelineEventType.MemorySqlDegraded,
    priority: PipelinePriority.NORMAL,
    payload: { operation: "write.dedup", detail: "DB UPDATE 失败，accessCount 已回滚" },
    timestamp: Date.now(),
  });
}
```

---

### N-05 🟡 Medium — LlmAdapter 文件编码损坏，持续不可读

**文件：** `packages/llm/src/llm-adapter.ts`  
**状态：** ⚠️ **仍未修复**

**证据：** 文件编码仍为 UTF-8 → GBK 乱码。所有中文注释显示为乱码字符序列（如 `鈹€鈹€鈹€ 閫傞厤鍣?鈹€鈹€鈹€...`），约 80% 注释内容无法阅读。

**后果：** 开发人员无法阅读文件中约 300 行中文注释（架构说明、方法职责描述、修复标注），增加后续维护的认知负担。

**修复建议：** 用正确的 UTF-8 编码重新保存文件。

---

## 🔴 本轮新增缺陷

### N-06 🟡 Medium — bootstrap.ts 中 assemble 函数返回值全部被忽略，组装逻辑空转

**文件：** `packages/factory/src/bootstrap.ts`  
**严重级别：** Medium（代码异味 + 设计不一致）

**证据：**
```typescript
// 四个 assemble 函数的返回值全部被忽略：
assembleAgents(agentDefs);              // 返回 AgentAssemblyResult { configs, byKey }
assembleEventRouter(agentsConfig);      // 返回 AssembledEventRouter { routeTable, mergeRules }
assembleCommittee(agentsConfig.eventRouting.committeeRules ?? []); // 返回 AssembledCommittee { urgent, normal }
assembleTelescope();                     // 返回 TelescopeConfig { provider, strategy, ... }
```
BootstrapResult 直接使用原始配置，而非 assemble 的输出：
```typescript
const result: BootstrapResult = {
  agentDefinitions: agentDefs,                    // ← 原始 Object.values
  eventRouting: agentsConfig.eventRouting,        // ← 原始配置
  // ...
};
```

**后果分析：**
1. **死代码** — assemble 函数的计算成果无人消费。如果 assemble 函数内含校验、默认值注入、数据转换，这些工作全部白做
2. **维护陷阱** — 未来开发者可能往 assemble 中添加重要的转换逻辑，但因为返回值被忽略，这些逻辑不会影响最终结果
3. **不一致** — 第一阶段 `loadAll` 的结果被使用，第三阶段 assemble 的结果却被丢弃

**修复建议（二选一）：**
```typescript
// 方案 A（推荐）：使用 assemble 的输出构造 BootstrapResult
const assembledAgents = assembleAgents(agentDefs);
const assembledRouter = assembleEventRouter(agentsConfig);
// ...
const result: BootstrapResult = {
  agentDefinitions: assembledAgents.configs,
  eventRouting: {
    routeTable: assembledRouter.routeTable,
    mergeRules: assembledRouter.mergeRules,
  },
  // ...
};

// 方案 B（最小改动）：移除死调用，注释标注"当前返回值由调用方直接从原始配置提取"
// assembleAgents(agentDefs);  // 删除或注释
```

---

### N-07 🟠 High — pm/store.ts 解密失败静默返回空存储，saveStore 会无意识地覆盖加密数据

**文件：** `packages/pm/src/store.ts`（`loadStore` 函数）  
**严重级别：** 🟠 High（数据丢失风险）

**证据：**
```typescript
function loadStore(): StoreData {
  const storePath = ensureStoreDir();
  if (!fs.existsSync(storePath)) {
    return { version: 1, entries: [] };
  }
  try {
    const encrypted = fs.readFileSync(storePath, 'utf-8').trim();
    if (!encrypted) {
      return { version: 1, entries: [] };
    }
    const raw = decrypt(encrypted);        // ← 可能因密钥变更抛出异常
    return JSON.parse(raw) as StoreData;
  } catch {
    console.error('警告：存储文件读取失败，可能密钥已变更或文件已损坏');
    return { version: 1, entries: [] };    // ← 空 store！
  }
}

function addEntry(...): PasswordEntry {
  const store = loadStore();                // ← 解密失败 → 空 store
  // ...
  saveStore(store);                         // ← 用空 store 覆盖原加密文件！
}
```

**触发条件：** 用户变更 `PM_MASTER_KEY` 环境变量后首次执行 `addEntry()` 或任何修改操作。

**后果分析：**
1. `decrypt()` 因密钥不匹配抛出异常
2. catch 返回空 StoreData
3. `addEntry()` 向空 store 添加条目后调用 `saveStore()` → 用新加密数据覆盖原文件
4. **即使后续用户发现密钥错了，原始密码数据已被不可逆覆盖**
5. 唯一的 `console.error` 防护在终端日志中极易被丢弃

**修复建议：**
```typescript
function loadStore(): StoreData {
  const storePath = ensureStoreDir();
  if (!fs.existsSync(storePath)) {
    return { version: 1, entries: [] };
  }
  try {
    const encrypted = fs.readFileSync(storePath, 'utf-8').trim();
    if (!encrypted) {
      return { version: 1, entries: [] };
    }
    const raw = decrypt(encrypted);
    return JSON.parse(raw) as StoreData;
  } catch (e) {
    throw new Error(
      `密码存储文件解密失败：密钥可能已变更或文件已损坏。\n` +
      `原错误: ${(e as Error).message}\n` +
      `提示：如果已更换 PM_MASTER_KEY，请先使用旧密钥导出数据。`,
    );
  }
}
```

---

### N-08 🟡 Medium — parser.ts 斜体/加粗解析在三级嵌套（`***text***`）时输出错误

**文件：** `packages/parser/src/parser.ts`（`parseInline` 函数）  
**严重级别：** 🟡 Medium（渲染不正确）

**证据：** 解析器按"加粗检查 → 斜体检查"顺序执行。对于 `***text***`：

```
输入: ***text***
      0123456789
```
- i=0: 加粗 `**` 匹配 → `end = indexOf('**', 2)` → 找到 `text[5..6]='**'`
- 输出 `<strong>${parseInline('text*')}</strong>` → 递归中 `*` 无匹配斜体
- **实际输出：** `<strong>text*</strong>`
- **预期输出：** `<strong><em>text</em></strong>`

**后果：** `***text***` 在 Markdown 中表示"加粗的斜体"，当前解析器错误地将末尾 `*` 吞入加粗内容。

**触发条件：** 任何使用 `***text***` 语法（加粗+斜体叠加）的 Markdown 文档均受影响。

**修复建议：** 在加粗匹配后检查 `text[end+2]` 是否后跟 `*` 或 `_`：

```typescript
// 加粗匹配成功后：
const afterBold = text.slice(end + 2);
if (afterBold.startsWith('*') || afterBold.startsWith('_')) {
  // ***text*** 三级嵌套场景，改为先解析斜体再解析加粗
  // 处理逻辑...
}
```

更彻底的方案：将 `***` 作为独立的三级嵌套标记在加粗之前单独处理。

---

## 📋 状态变更汇总

| 编号 | 原级别 | 原状态 | 新状态 | 原因 |
|------|--------|--------|--------|------|
| H-01 | 🟠 High | 未修复 | ✅ 已修复 | catch 块已实现半成品清理 |
| N-02 | 🟠 High | 未修复 | 🔄 不适用（见 N-06） | assemble 函数实为同步 |
| M-01 | 🟡 Medium | 未修复 | ✅ 已修复 | 去重判断已移至等齐后 |
| M-02 | 🟡 Medium | 未修复 | ✅ 已修复 | ensureDir 已改为异步 |
| M-04 | 🟡 Medium | 未修复 | ✅ 已修复 | dispose 改用 reject |
| N-04 | 🟡 Medium | 新增 | ✅ 已修复 | events.length>0 已移除 |

## 📊 最终遗留项清单

| 编号 | 级别 | 文件 | 问题 | 状态 |
|------|------|------|------|------|
| M-03 | 🟡 | `engine/src/memory/memory-store.ts` | 去重路径 DB 更新失败空 catch | ⚠️ 未修复 |
| N-05 | 🟡 | `llm/src/llm-adapter.ts` | 文件编码损坏 | ⚠️ 未修复 |
| **N-06** | 🟡 | `factory/src/bootstrap.ts` | assemble 返回值被忽略 | 🆕 新增 |
| **N-07** | 🟠 | `pm/src/store.ts` | 解密失败静默覆盖加密数据 | 🆕 新增 |
| **N-08** | 🟡 | `parser/src/parser.ts` | 三级嵌套斜体/加粗解析错误 | 🆕 新增 |

---

> **审查结论：** 历史遗留问题修复进展良好（6 项中 4 项已修），但本轮发现了 3 项新缺陷。其中 **N-07（密码存储数据静默覆盖）** 是安全风险级别最高的，建议优先修复。M-03 的空 catch 已持续 3 轮审查未修，建议纳入下次迭代的修复计划。
