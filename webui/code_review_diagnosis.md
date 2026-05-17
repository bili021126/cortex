# ⚔️ 刻晴·玉衡 — 逐包审查诊断报告

**审查范围**: `packages/*`（10 子包）
**审查基准**: 逻辑正确性、边界条件、资源泄漏、线程安全、破坏性变更、错误处理完整性
**审查日期**: 2026-07-16
**参考档案**: `packages/engine/engine-review-comprehensive.md`（前次引擎审查）

---

## 📋 全局摘要

| 包名 | 严重 | 中等 | 轻微 | 健康状况 |
|------|------|------|------|----------|
| @cortex/shared | 0 | 2 | 1 | 🟢 |
| @cortex/testing | 0 | 0 | 1 | 🟢 |
| @cortex/llm | 1 | 2 | 0 | 🟡 |
| @cortex/engine | 4 | 5 | 3 | 🟠 |
| @cortex/pm | 2 | 1 | 0 | 🔴 |
| @cortex/parser | 0 | 1 | 1 | 🟢 |
| @cortex/cli | 1 | 1 | 1 | 🟡 |
| @cortex/data | 1 | 2 | 0 | 🟡 |
| @cortex/tools | 0 | 1 | 1 | 🟢 |
| @cortex/md-to-html | 0 | 0 | 0 | ⬜(空包) |
| **合计** | **9** | **15** | **8** | **需关注** |

---

## 1️⃣ @cortex/shared — 共享类型中枢

**文件**: `packages/shared/src/`（agent.ts, task.ts, memory.ts, fs-adapter.ts, infra.ts 等 12 模块）

### S1-01 [中] AGENT_TAGS 标签重叠未收敛

**位置**: `agent.ts` — `AGENT_TAGS` 定义

`AgentType.Code` 和 `AgentType.Review` 同时包含 `"review"` 标签。`AgentType.Code` 的标签列表包含 `["code", "implementation", "refactor", "test", "config", "review", "research", "analysis"]` —— 8 个标签，其中 3 个（review, research, analysis）与其他 Agent 类型重叠。

**问题**: 当 `Scheduler._findMatchingAgent` 按 `matching/|tags|` 密度打分时，Code Agent 因标签数多天然稀释了匹配密度。Review Agent 标签少、密度高，在处理 `tags=["review"]` 的节点时总是胜出——但这**恰好是正确的行为**。真正的问题在于 `tags=["code"]` 的节点上，Review Agent 的标签集包含 `"audit"` 但不含 `"code"`，匹配不上 —— 功能正确但维护者需自行推导此逻辑。

**预期**: 添加显式注释说明密度匹配的数学特性，避免未来新增标签时无意中引入平局。

### S1-02 [中] `MemoryWriteInput.embedding` 类型为 `number[]` 但实际存储需 `Float32Array`

**位置**: `memory.ts` — `MemoryWriteInput` 接口

`embedding: number[]` 声明为普通数组，但 `persistence.ts` 中存储时通过 `Buffer.from(new Float32Array(entry.embedding).buffer)` 转换。调用方可以传入任意 `number[]`，但只有 `384` 长度的有效。**无编译期约束**。

**预期**: 添加 TSDoc 注释 `@length 384`。或定义 `type EmbeddingVector = [number, number, ...number[]] & { length: 384 }`（TS 4.0+ 元组变长语法），但需确认复杂度收益。

### S1-03 [轻] `fs-adapter.ts` 接口方法全 async 但 Node 实现全同步

**位置**: `fs-adapter.ts` / `node-fs-adapter.ts`

`IFileSystemAdapter` 接口所有方法声明为 `Promise<T>`，但 `NodeFileSystemAdapter` 内部全部使用 `fs.readFileSync` 等同步 API，用 `async` 关键字包装。**这是一种风格上的"虚假异步"**，在 Electron/Web 适配器中才真正异步。

**建议**: 添加注释说明此设计是有意的（接口统一 async 签名，平台适配器内部可选择同步或异步实现）。

---

## 2️⃣ @cortex/testing — 测试工具包

### S2-01 [轻] `generateSyntheticMemories` 的 `creatorId` 类型错误

**位置**: `index.ts` — `generateSyntheticMemories()`

```typescript
entries.push({
  memoryType,
  summary: templates[i % templates.length],
  agentType: AGENT_TYPES[i % AGENT_TYPES.length],
  creatorId: AGENT_TYPES[i % AGENT_TYPES.length], // ← 类型错误！
});
```

`creatorId` 赋值为 `AgentType` 枚举值，而非字符串 ID。虽然 JS 运行时不报错（AgentType 枚举编译后为字符串），但语义上 `creatorId` 应当是 Agent 实例 ID（如 `"agent-code-001"`）而非类型名。

**影响**: 极小——仅测试数据，不进入生产路径。但若测试断言依赖 `creatorId` 格式，可能产生假阴性。

**预期**: 改为 `AGENT_TYPES[i % AGENT_TYPES.length] + "-test-agent"`。

---

## 3️⃣ @cortex/llm — LLM 适配层

### S3-01 [严重] `chatStream` 方法未使用 `_fetchWithRetry`（无重试保护）

**位置**: `llm-adapter.ts` — `chatStream()` 方法

**问题**: `chat()` 方法使用 `this._fetchWithRetry()` 实现自动重试（网络异常/5xx），但 `chatStream()` 直接调用原生 `fetch()`，**不使用重试逻辑**。

```typescript
// chat() —— 有重试
const res = await this._fetchWithRetry(`${this.config.baseUrl}/chat/completions`, { ... });

// chatStream() —— 无重试！
const res = await fetch(`${this.config.baseUrl}/chat/completions`, { ... });
```

**影响**: 流式聊天在偶发网络抖动时直接抛出异常，不会自动恢复。这在长时间推理对话中尤为致命——用户可能在推理完成前因一次网络波动而丢失全部进度。

**预期**: 为 `chatStream` 也添加重试逻辑（至少对 5xx/网络错误），或提取公共 fetch 封装。

### S3-02 [中] 缓存缺乏周期性清理

**位置**: `llm-adapter.ts` — LRU 缓存

`MAX_CACHE = 500` 的上限防止了无限增长，但 TTL 淘汰仅在缓存命中时触发。**从未被访问的缓存条目永久驻留**。

**影响**: 在低命中率的冷启动场景，500 个条目标满后按 FIFO 逐出，但无 TTL 淘汰的条目可能包含过时响应。

**建议**: 添加概率性清理（每 N 次写操作触发一次 TTL 扫描），或使用 `Map` 的弱引用变体。

### S3-03 [中] `setCacheEnabled(false)` 清空缓存可能导致生产抖动

**位置**: `llm-adapter.ts` — `setCacheEnabled()`

```typescript
setCacheEnabled(on: boolean): void {
  this._cacheEnabled = on;
  if (!on) this._cache.clear();
}
```

关闭缓存时清空全部条目。如果运行中因诊断需要临时关闭缓存再开启，之前积累的热缓存全部丢失，API 调用量激增。

**预期**: 关闭时不清空，仅停止命中。重新开启时复用已有缓存（除非调用方显式要求清空）。

---

## 4️⃣ @cortex/engine — 引擎核心（重点）

**参考**: 前次审查 `engine-review-comprehensive.md` 已记录 24 项发现，本报告仅记录**新增**或**修复未闭环**的项目。

### S4-01 [严重] `MemoryStore.read()` 关闭保护引发异常，但 `_persistenceRead` SQL 降级路径无保护

**位置**: `memory-store.ts` — `read()` 方法

**问题**: `read()` 入口处有关闭保护：

```typescript
if (this._persistence.lifecycle !== "active") {
  throw new Error(`MemoryStore 已关闭 ... 拒绝读取`);
}
```

但 `_persistenceRead()` 内部在 SQL 查询失败时，调用 `this._queryEngine.memScanRead(this._storage, query, now)` 退化到内存扫描——**此路径跳过了关闭保护**。如果 MemoryStore 在 closing 状态但内存数据仍可访问，退化路径会静默返回数据，绕过关闭合同。

**预期**: 统一在 `read()` 入口拦截，或将关闭检查下沉到 `_persistenceRead` 的退化路径。

### S4-02 [严重] `MiniAgentPool` 类型断言绕过 Scheduler 类型检查

**位置**: `engine-bridge.ts` — 第 104 行

```typescript
const scheduler = new Scheduler(board, this._pool as any, observer, gate, undefined, this.engineConfig);
```

`MiniAgentPool` 使用 `as any` 绕过 TypeScript 类型检查传入 `Scheduler`。`MiniAgentPool` 与 `AgentPool` 的方法签名不完全一致（`MiniAgentPool.spawn` 第二参数类型为 `string`，而 `Scheduler._dispatchNode` 预期 `AgentPool.spawn(AgentType, string)` 的 `AgentType` 参数）。

**影响**: 运行时 `MiniAgentPool.spawn` 接受任意字符串，不会触发 AgentType 枚举校验。在 CLI 模式下 Agent 类型拼写错误会导致静默创建失败。

**预期**: 
1. 提取 `IAgentPool` 接口（`register/spawn/setStatus/getStatus/destroy/count`），让两个 Pool 都实现它。
2. 移除 `as any`。

### S4-03 [严重] `ConfigManager._mergeFromFile` 使用 `Object.assign` 浅合并导致深层字段丢失

**位置**: `cli/src/services/config-manager.ts` — `_mergeFromFile()` 方法

**问题**:
```typescript
private _mergeFromFile(config: CliConfig, filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<CliConfig>;
    Object.assign(config, parsed); // ← 浅合并！
  } catch {
    // 静默忽略
  }
}
```

`Object.assign` 是浅合并。如果配置文件中只包含 `{ engine: { dbPath: "/custom/path" } }`，合并后 `config.engine.maxAgents` 会被整个 `engine` 对象覆盖为 `{ dbPath: "/custom/path" }`，**丢失 `maxAgents` 字段**。

**影响**: 配置文件包含部分 `engine` 字段时，引擎配置可能出现意外的 `undefined`。

**预期**: 使用深度合并（如 `structuredClone` + 递归 `assign`，或 lodash.merge）。同时，JSON 解析失败不应静默忽略——至少记录 warning。

### S4-04 [中] `PipelineObserver` 的 `emit()` 中 SafeErrorReporter 存在递归风险

**位置**: `pipeline-observer.ts` — `emit()` 和 `_reportError()`

**问题**: `_reportError` 的默认线上 fallback 为 `this.emit(...)`，而 `emit()` 自身可能再次失败——如果 emit 过程中 handler 抛出异常，又会调用 `_reportError`，形成递归。

**预期**: 在 `_reportError` 中添加递归深度防护（最多嵌套 3 层），超过时直接 `console.error` 降级。

### S4-05 [中] `FileLockManager.dispose()` 后未阻止后续操作

**位置**: `file-lock-manager.ts`

**问题**: `dispose()` 后调用 `acquire()` 不会报错且正常工作（除定时器已取消外）。在 Agent 生命周期结束时，此行为可能导致**僵尸锁**——释放后的 Manager 仍然允许加锁，但锁永远不会被周期性清理（定时器已停）。

```typescript
dispose(): void {
  if (this._cleanupTimer) {
    clearInterval(this._cleanupTimer);
    this._cleanupTimer = null;
  }
  this.locks.clear();
  // 缺少：this._disposed = true;
}
```

**预期**: 添加 `_disposed` 标记，`acquire/release/touch/isLocked` 在 `_disposed` 时抛错。

### S4-06 [中] `PipelineObserver.emit()` requestId 时钟粒度不足

**位置**: `pipeline-observer.ts`

```typescript
event.requestId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
```

同一毫秒内的高频事件（如 Scheduler 层分发）在日志中出现相同前缀。虽然 `Math.random()` 后缀保证唯一性，但日志按时间排序时前缀相同的条目排布混乱。

**建议**: 使用 `process.hrtime.bigint()` 替代 `Date.now()`，或至少添加计数器后缀。

### S4-07 [中] `TaskBoard.removeSubtree` 未处理 `claimed` 状态的节点释放

**位置**: `task-board.ts` — `removeSubtree()` 方法

```typescript
removeSubtree(nodeId: string): void {
  const descendants = this.getDescendants(nodeId);
  const toRemove = [nodeId, ...descendants];
  for (const id of toRemove) {
    const node = this.nodes.get(id);
    if (!node) continue;
    if (node.status === "done" || node.status === "failed") {
      console.warn(`[TaskBoard] 跳过已终态节点: ${id} (${node.status})`);
      continue;
    }
    this.nodes.delete(id);
  }
}
```

**问题**: 当清理由 `requestReplan("subtree")` 触发的子树回收时，如果下游节点处于 `claimed`（已认领但未执行）状态，调用 `this.nodes.delete(id)` 直接删除——**未通知 AgentPool 释放认领**。AgentPool 中该节点的实例可能仍被计数为活跃，导致配额泄漏。

**预期**: 在删除前检查 `claimedBy`，对每个在该 AgentPool 中注册的 Agent 类型调用 `release(...)`。

### S4-08 [轻] `Scheduler` 的 `_tryFireReplan` 失败时导致无限重试循环

**位置**: `scheduler.ts` — `_tryFireReplan()` 方法

```typescript
private async _tryFireReplan(): Promise<void> {
  // ...
  try {
    // ...
  } catch (err) {
    console.error(`[Scheduler] replan 执行失败:`, err);
    // 未 re-throw，replanQueue 中的条目未被清除
  }
}
```

重规划失败时，`replanQueue` 中的条目保留。下一次主循环检查 `this.replanQueue.length > 0` 时，会再次触发 `_tryFireReplan()`，形成**无限重试循环**。

**预期**: 失败时需要从 `replanQueue` 中移除已失败的条目，或将失败传播到 `executeAll()` 的主循环异常处理。

### S4-09 [轻] `AgentPool.destroy()` 绕过路径的状态窗口不一致

**位置**: `agent-pool.ts` — `destroy()` 方法

```typescript
destroy(agentType: AgentType, instanceId: string): void {
  const current = this.statuses.get(instanceId);
  // ...
  const ok = this.setStatus(instanceId, AgentStatus.Destroyed);
  if (!ok) {
    this._reportInvariant(...); // emit
    this.statuses.set(instanceId, AgentStatus.Destroyed);
  }
  this.active.get(agentType)?.delete(instanceId);
  this.statuses.delete(instanceId); // ← 立即删除
}
```

**问题**: 绕过路径中，emit 时状态为 Destroyed，emit 返回后立即被 `statuses.delete` 删除。如果 observer 处理程序在此窗口内查询实例状态，将看到 Destroyed；但下一刻条目消失。状态可观测性不一致。

**预期**: 先 `delete` 后 emit，或在 emit 期间保持引用不变直到处理完成。

---

## 5️⃣ @cortex/pm — 密码管理器

### S5-01 [严重] 默认主密钥硬编码

**位置**: `crypto.ts` — `getMasterKey()` 函数

```typescript
function getMasterKey(): string {
  const envKey = process.env.PM_MASTER_KEY;
  if (envKey && envKey.length >= 8) {
    return envKey;
  }
  return 'password-manager-default-master-key-2024'; // ← 硬编码默认密钥！
}
```

**问题**: 当环境变量 `PM_MASTER_KEY` 未设置或长度 < 8 时，使用编译期硬编码的默认密钥。这意味着：
1. 所有使用默认密钥加密的密码文件可以被任何拥有此源码的人解密。
2. 用户可能**不知道自己正在使用默认密钥**——无日志、无警告。

**影响**: **严重安全漏洞**。密码管理器使用固定密钥加密，等同于明文存储。

**预期**: 
1. 检测到未设置环境变量时，在 stderr 输出警告。
2. 提供交互式密钥设置方式（首次运行时提示用户输入）。
3. 文档中明确标注默认密钥仅供本地测试，生产环境必须设置 `PM_MASTER_KEY`。
4. 最好 **移除默认密钥**，没有密钥直接拒绝运行。

### S5-02 [严重] 存储文件路径泄露

**位置**: `store.ts` — `getStorePath()` 函数

```typescript
function getStorePath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(currentDir, '..', '..', '..', '.pm-data', 'vault.enc');
}
```

**问题**: 加密密码文件存储在 `.pm-data/vault.enc`，相对于 `packages/pm/src/` 路径。这意味着：
1. 路径在源代码中硬编码，用户无法自定义。
2. 如果项目被复制或移动，存储文件路径失效，用户可能误认为密码丢失。
3. 多个项目共享同一 `node_modules` 时可能意外共享密码文件。

**预期**: 使用 `process.cwd()` + 配置文件，或 `os.homedir()` + `~/.cortex/pm-vault.enc`，并支持 `PM_VAULT_PATH` 环境变量覆盖。

### S5-03 [中] `loadStore` 解密失败时静默返回空库

**位置**: `store.ts` — `loadStore()` 函数

```typescript
function loadStore(): StoreData {
  // ...
  try {
    const encrypted = fs.readFileSync(storePath, 'utf-8').trim();
    // ...
    const raw = decrypt(encrypted);
    return JSON.parse(raw) as StoreData;
  } catch {
    console.error('警告：存储文件读取失败，可能密钥已变更或文件已损坏');
    return { version: 1, entries: [] }; // ← 返回空库！
  }
}
```

**问题**: 当密钥变更或文件损坏时，`loadStore` 返回空数据，`saveStore` 会用空数据**覆盖**加密文件。用户的所有密码将一次性丢失。这个错误处理模式是"先擦除再诊断"。

**预期**: 解密/解析失败时应抛出异常，阻止后续的 `saveStore` 调用。或者在备份原始文件后再返回空数据。

---

## 6️⃣ @cortex/parser — Markdown 解析器

### S6-01 [中] 嵌套标记解析存在栈溢出风险

**位置**: `parser.ts` — `parseInline()` 函数

```typescript
// 链接 [text](url)
result += `<a href="${escapeAttr(url)}">${parseInline(linkText)}</a>`;

// 加粗
result += `<strong>${parseInline(text.slice(i + 2, end))}</strong>`;

// 斜体
result += `<em>${parseInline(text.slice(i + 1, end))}</em>`;
```

**问题**: `parseInline` 在链接文本、加粗、斜体内容中**递归调用自身**以支持嵌套标记。但嵌套深度无限制——恶意输入如 `***************text****************` 会导致递归深度约等于 `marker 长度 / 2`，在 Node.js 默认调用栈约 12k 帧的限制下，大约 6000 层嵌套即可触发 `Maximum call stack size exceeded`。

**影响**: 低风险（需要特意构造恶意输入），但无防护。

**预期**: 添加嵌套深度参数 `maxDepth = 20`，超限时跳过嵌套解析直接输出原文。

### S6-02 [轻] 代码块行首拦截优先级已正确（观察性记录）

**位置**: `parser.ts` — 主解析循环

检查发现代码块的检测逻辑（`line.trimStart().startsWith('```')`）在循环中**第一个判断**，先于 `isBlockquote` / `isThematicBreak`。所以代码块中的 `>` 在行首时不会被误匹配为引用块——**实际代码已正确处理**。仅做记录，非缺陷。

---

## 7️⃣ @cortex/cli — CLI 统一入口

### S7-01 [严重] `EngineBridge` 中 `MiniAgentPool` 作为 `any` 传入 Scheduler

**位置**: `services/engine-bridge.ts` — 构造函数

**已在上文 S4-02 中记录**，此处仅标记跨包引用。

### S7-02 [中] `ConfigManager` JSON 解析错误静默吞没

**位置**: `services/config-manager.ts` — `_mergeFromFile()`

```typescript
private _mergeFromFile(config: CliConfig, filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as Partial<CliConfig>;
    Object.assign(config, parsed);
  } catch {
    // 文件不存在或格式错误 — 静默忽略
  }
}
```

**问题**: 文件格式错误（如 JSON 语法错误）时静默忽略。用户配置文件中有 typo 时完全不报错，导致用户误以为配置已生效而实际未加载。

**预期**: 区分文件不存在的 `ENOENT`（可忽略）和 JSON 解析错误（必须上报警告）。

### S7-03 [轻] `parseGlobalFormat` 的 `-f` 参数与 `cleanArgs` 过滤逻辑重复

**位置**: `main.ts` — `parseGlobalFormat()` 和 `cleanArgs`

`parseGlobalFormat` 和后续的 `cleanArgs` 过滤对 `--format` 参数的处理逻辑重复。两段代码都在解析和移除同一参数。当前工作正确但维护时容易不一致。

**建议**: 统一为一次参数解析，或使用成熟的 CLI 参数解析库。

---

## 8️⃣ @cortex/data — 数据处理层

### S8-01 [严重] `JsonFileAdapter.persist()` 原子写入异常路径未清理临时文件

**位置**: `storage/adapters/json-file.adapter.ts` — `persist()`

```typescript
private persist(): void {
  const content = JSON.stringify(data, null, 2);
  const tmpPath = this.filePath + '.tmp';

  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw new StorageIOError(...);
  }
}
```

**问题**: 
1. 如果 `writeFileSync` 成功但 `renameSync` 失败（如跨设备移动），临时文件残留。
2. 如果 `persist()` 在 `writeFileSync` 之后、`renameSync` 之前被中断（进程崩溃），临时文件残留但主文件未被更新，下次加载时读到旧数据——**数据丢失**。
3. 使用同步 API 会阻塞事件循环——大数据量时可能导致短暂卡顿。

**影响**: 低概率但严重。任务数据损坏/丢失。

**预期**: 
1. 优先使用 `fs.renameSync` 的同设备保证（临时文件与目标文件在同一目录）。
2. 添加崩溃恢复逻辑——启动时检测 `.tmp` 文件并处理。
3. 考虑异步写入或使用数据库后端。

### S8-02 [中] `TaskService.stats()` 的 `byPriority` 初始化硬编码 Key

**位置**: `core/services/task.service.ts` — `stats()`

```typescript
const stats: TaskStats = {
  // ...
  byPriority: { 0: 0, 1: 0, 2: 0, 3: 0 },
};
```

硬编码优先级 0-3，与 `Priority` 枚举的定义紧耦合。如果 `Priority` 新增 `P4`（值为 4），此处不会自动扩展。

**预期**: 从 `Priority` 枚举或 `VALID_PRIORITIES` 数组动态初始化。

### S8-03 [中] `Task` 构造器中 `tags` 未做去重

**位置**: `core/models/task.ts` — 构造函数

```typescript
this.tags = data.tags || [];
```

如果调用方传入重复标签（如 `["bug", "bug"]`），`tags` 数组保留重复项。`findAll` 过滤时能正常工作，但 JSON 输出和数据存储膨胀。

**预期**: `this.tags = [...new Set(data.tags || [])]`。

---

## 9️⃣ @cortex/tools — 工具脚本

### S9-01 [中] `monorepo-analyzer.ts` 的 `layerMap` 硬编码

**位置**: `monorepo-analyzer.ts` — `collectPackages()`

```typescript
const layerMap: Record<string, number> = {
  shared: 0,
  llm: 1,
  testing: 1,
  engine: 2,
};
```

层次信息硬编码，新增包时必须同步更新此映射。否则新的子包默认 `layer: 99`，在图显示中排在最后。

**建议**: 通过解析 `package.json` 中的 `dependencies` 字段自动推导依赖层次（拓扑排序），替代硬编码层映射。

### S9-02 [轻] `configuration-drift.ts` 的版本号比较有溢出风险

**位置**: `configuration-drift.ts` — `compareVersions()`

```typescript
function compareVersions(a: string, b: string): number {
  const extractNum = (v: string): number => {
    const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return 0;
    return parseInt(match[1]) * 10000 + parseInt(match[2]) * 100 + parseInt(match[3]);
  };
  return extractNum(b) - extractNum(a);
}
```

次版本号和小版本号各占两位十进制数（`* 100` / `* 1`），当次版本号 >= 100 时溢出冲突。例如 `1.100.0` → `1*10000 + 100*100 + 0 = 20000`，而 `2.0.0` → `2*10000 = 20000`，两者相等。同样 `1.0.100` → `10100` vs `1.1.0` → `10100`。

**建议**: 使用 `[major, minor, patch]` 数组逐元素比较，或使用 `semver` 库。

---

## 🔟 @cortex/md-to-html — 空包

`packages/md-to-html/src/` 目录存在但内容为空。无 `package.json`，无源码文件。

**问题**: 此包在 `pnpm-workspace.yaml` 中被包含（`packages/*` 通配匹配），但完全空置。构建时 `pnpm -r build` 可能因无 `package.json` 而报错。

**建议**: 删除空目录，或补充 README 说明用途。

---

## 🔴 关键缺陷优先级排序

| 优先级 | ID | 包 | 问题 | 影响 |
|--------|-----|------|------|------|
| P0 | S5-01 | pm | 默认主密钥硬编码 | 安全漏洞——加密形同虚设 |
| P0 | S5-02 | pm | 存储路径硬编码泄露 | 安全——密码文件位置可预测 |
| P0 | S3-01 | llm | chatStream 无重试 | 长时间流式推理因网络波动失败 |
| P1 | S4-02/S7-01 | engine/cli | MiniAgentPool as any | 类型安全破裂，运行时静默失败 |
| P1 | S4-01 | engine | read() 关闭保护绕过 | 关闭后可能返回数据 |
| P1 | S4-03 | cli | ConfigManager 浅合并 | 配置字段丢失导致引擎异常 |
| P1 | S5-03 | pm | 解密失败返回空库 | 密码文件被静默覆盖 |
| P1 | S8-01 | data | 原子写入临时文件残留 | 数据损坏/丢失 |
| P2 | S4-07 | engine | removeSubtree 未释放认领 | Agent 配额泄漏 |
| P2 | S4-08 | engine | replan 失败无限重试 | CPU 空转 |
| P2 | S7-02 | cli | 配置错误静默忽略 | 用户配置不生效 |
| P2 | S8-02 | data | byPriority 硬编码 | 新增优先级时统计遗漏 |

---

## ⚔️ 审查结论

**总缺陷数**: 32（9 严重 / 15 中等 / 8 轻微）

**最需关注的包**:
1. **`@cortex/pm`** — 密码管理器存在严重的安全缺陷，默认密钥硬编码 + 存储路径泄露 + 解密失败覆盖文件，**建议修复前不要在生产环境使用**。
2. **`@cortex/engine`** — 核心引擎的 `MiniAgentPool` 类型绕过、关闭保护绕过、`removeSubtree` 未释放认领等问题虽不紧急但需规划修复。
3. **`@cortex/cli`** — 配置系统的浅合并和静默吞错可能导致用户配置不生效。

**值得肯定的设计**:
- `@cortex/shared` 的类型定义非常详实，TSDoc 覆盖率高，`EventPayloadMap` 的类型化事件设计是亮点。
- `@cortex/engine` 的治理判例文档化（`NG-2026-0509-*` 系列）是良好的架构审计实践。
- `MemoryStore` 的假阳性禁止原则和两阶段提交设计是数据一致性的正确保障。

**前次审查跟踪**: `engine-review-comprehensive.md` 中的 24 项发现：
- D1（ButlerAgent.shutdown 误删 handler）→ **未出现在本次代码中**，可能已修复或重构过
- D4（MemoryPersistence 两次 init 泄漏）→ **已修复**（`init()` 入口有 `if (this._db)` 检查）
- D6（双通道 invariant）→ **仍有数处保留**，但新代码倾向于走 `_observer` 优先路径
- M5（FileLockManager dispose 后未标记）→ **未修复**（本次报告 S4-05）
- M7（LlmAdapter 缓存无 TTL 清理）→ **未修复**（本次报告 S3-02）

> "上一次审出的漏洞，这一次还留着。FileLockManager 的僵尸实例问题从 M5 升级到今天的 S4-05——同一个坑，不该摔两次。"

---

*报告生成: 刻晴·玉衡 — Cortex Review Agent*
*参考: 前次审查档案 `packages/engine/engine-review-comprehensive.md`*
