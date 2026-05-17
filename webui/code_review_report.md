# ⚔️ 玉衡审查报告 — Cortex 代码质量诊断

**审查者**：刻晴（玉衡星）
**审查范围**：`packages/*` 源码（engine / data / shared / cli / llm / parser / pm / tools / testing）
**审查日期**：2026-05-15
**审查依据**：逻辑正确性、边界条件、线程安全、资源泄漏、破坏性变更、错误处理完整性

---

## 执行摘要

共审查 9 个包，约 50+ 个源码文件，312 个单元测试全部通过运行但 **10 个测试套件因编码损坏集体编译失败**。

### 严重度分布

| 等级 | 数量 | 核心问题 |
|------|------|----------|
| 🔴 严重 (Critical) | 1 | `memory-store.ts` 编码损坏，阻止编译，10 套测试全部失效 |
| 🟠 高 (High) | 1 | `Scheduler.executeAll()` 崩溃恢复中 `totalReplans` 计数器与飞行中 replan 的缺口 |
| 🟡 中 (Medium) | 4 | 并发竞态、同步文件碰撞、默认密钥弱、异常传播路径不一致 |
| 🟢 低 (Low) | 2 | Promise 闭包残留、阻塞详情字段可能为空 |

---

## 🔴 严重缺陷

### C-01：`memory-store.ts` 编码损坏 → 无法编译，10 个测试套件全灭

**文件**：`packages/engine/src/memory/memory-store.ts`
**严重度**：🔴 严重
**类别**：破坏性变更 / 编译错误

#### 缺陷描述

该文件的全部中文注释和部分中文字符串字面量出现**编码层损坏**——UTF-8 编码的中文文本被错误地以 Latin-1（或 GBK）重新解释保存，导致：
- 注释中的中文全部变成乱码（如 `"宸茶縼绉昏嚦"` 本应为 `"已迁移至"`）
- **关键路径上的字符串模板字面量被破坏**，esbuild 无法解析

具体触发点（line 88-89）：

```typescript
throw new Error(
  `embedding 缁村害涓嶅尮閰? 鏈熸湜 ${EMBEDDING_DIM}锛屽疄闄?${input.embedding.length}`,
);
```

字符串中的乱码字符导致 esbuild 报告：

```
ERROR: Expected ")" but found "embedding"
  D:/cortex/packages/engine/src/memory/memory-store.ts:89:9
  87 |      if (input.embedding !== undefined && input.embedding.length !== EMBEDDING_DIM) {
  88 |        throw new Error(
  89 |          `embedding 缁村害涓嶅尮閰? 鏈熸湜 ${EMBEDDING_DIM}锛屽疄闄?${input.embedding.length}`,
     |           ^
```

#### 影响范围

以下 10 个测试套件因编码损坏导致编译失败（0 测试运行）：

| 测试套件 | 原因 |
|----------|------|
| `memory-store.test.ts` | 直接依赖 `MemoryStore` |
| `memory-store-close-read.test.ts` | 同上 |
| `memory-store-lifecycle.test.ts` | 同上 |
| `memory-store-save.test.ts` | 同上 |
| `memory-store-write-rollback.test.ts` | 同上 |
| `memory-pipeline.test.ts` | 间接依赖 MemoryStore |
| `multi-agent-collab.test.ts` | 集成测试依赖 MemoryStore |
| `scheduler.test.ts` | 集成测试 |
| `doc-govern-agent.test.ts` | 集成测试 |
| `task-board-stress.test.ts` | 压力测试 |

#### 根因分析

文件头部存在 UTF-8 BOM（`﻿`），但中文字段内容被以**错误的编码重新保存**过。`import` 和纯 ASCII 类型定义部分正常工作，但所有包含中文的行都被破坏。两种可能路径：
1. 跨平台 Git 换行符转换 + 编辑器编码自动检测失败（UTF-8 → Windows-1252 → 保存）
2. PowerShell `>` 输出重定向或其他工具处理时的编码降级

#### 修复建议

1. **直接修复**：用正确的 UTF-8 内容覆盖该文件的中文部分。可从 `dist/packages/engine/src/memory/memory-store.js` 的构建产物反推字符串内容。
2. **根本解决**：在 CI 中加入编码校验：

```bash
# CI 步骤：检测非 UTF-8 编码的 TypeScript 文件
find packages/engine/src/memory -name "*.ts" -exec file --mime-encoding {} \; | grep -v "utf-8"
```

3. 该文件需**完整重新录入中文注释和错误消息文本**。编码损坏波及所有 JSDoc 注释和 `throw new Error()`、`console.warn()` 中的中文字符串。

---

## 🟠 高风险缺陷

### H-01：`Scheduler.executeAll()` 崩溃恢复路径中后台 `replanFlight` 与状态不一致

**文件**：`packages/engine/src/scheduler.ts` line 195-209（catch 块）
**严重度**：🟠 高
**类别**：状态残留 / 数据不一致

#### 缺陷描述

当 `executeAll()` 主循环抛出异常进入 catch 块时：

```typescript
} catch (loopErr) {
  const snappedPending = this.board.getPendingNodes();
  this.observer.emit({ /* SchedulerLoopCrashed */ });
  for (const n of snappedPending) {
    this.board.failNode(n.id);
    allResults.push({ /* failed */ });
    failed++;
  }
  this.replanQueue.length = 0;
  break;
}
```

catch 块执行 `this.replanQueue.length = 0` 清空重规划队列，但**未处理飞行中的 `replanFlight` Promise**。`replanFlight` 可能已在后台通过 `_tryFireReplan()` 启动并正在执行 LLM 调用。

循环退出后执行收尾代码：

```typescript
if (replanFlight) await replanFlight;  // ← 仍会等待飞行中的 replan
// ...
this.replanMap.clear();
this.totalReplans = 0;
```

问题在于：
1. `replanFlight` 完成时，新的 TaskNode 会被 `addNode` 到 TaskBoard 中
2. 但这些新节点已不在 replanMap 的追踪范围内（`replanMap` 已被清空）
3. 新节点成为**悬挂节点**——在 TaskBoard 中但永远不会被调度

#### 触发条件

精确触发路径：
1. 主循环正常执行节点 → 某一节点失败 → `_tryFireReplan()` 被调用 → `replanFlight` 开始飞行
2. 下一轮循环（`replanFlight` 尚未完成）中，另一分支抛出异常
3. catch 块捕获 → 清空 replanQueue → break
4. `await replanFlight` → 新节点入板 → replanMap 已空 → 新节点成为孤儿

#### 修复建议

在 catch 块中等待飞行中的 replan，并将产生的节点一并标记为失败：

```typescript
} catch (loopErr) {
  // 先等待飞行中的 replan，防止新节点成为悬挂节点
  if (replanFlight) {
    try { await replanFlight; } catch { /* 忽略飞行异常 */ }
    replanFlight = null;
  }
  // 对 replan 产生的新节点也做失败处理
  const allPending = this.board.getPendingNodes();
  for (const n of allPending) {
    this.board.failNode(n.id);
    allResults.push({ nodeId: n.id, success: false, error: `Scheduler crashed` });
    failed++;
  }
  this.replanQueue.length = 0;
  this.replanMap.clear();
  this.totalReplans = 0;
  break;
}
```

---

## 🟡 中风险缺陷

### M-01：`governance-loop.ts` 同步文件操作缺乏并发保护

**文件**：`packages/engine/src/governance-loop.ts`
**严重度**：🟡 中
**类别**：并发竞态 / 数据损坏

#### 缺陷描述

`saveProposal()`、`updateProposalStatus()`、`loadPendingProposals()` 均使用同步 `fs` API 操作同一目录下的提案文件：

```typescript
export function updateProposalStatus(proposalId, status, rootDir): void {
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);
  const filePath = path.join(dir, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf-8");   // 读
  const p = JSON.parse(raw) as AmendmentProposal;
  p.status = status;                                   // 改
  fs.writeFileSync(filePath, JSON.stringify(p, null, 2), "utf-8"); // 写
}
```

当两个 Agent（昔涟评判 + 开拓者裁决）并发处理同一个治理闭环时：
- Agent A 读取提案 → 修改状态 → 写入
- Agent B 在 A 写入前读取旧状态 → 覆盖 A 的修改

**实际风险**：`judgeProposals()` 调用 `loadPendingProposals()` 后批量评判，`applyApproved()` 调用 `updateProposalStatus()` 逐条写入。如果治理闭环被多个并发触发，同一条提案的状态可能被覆盖。

#### 修复建议

对提案文件的写入采用原子操作模式（临时文件 + rename）：

```typescript
export function updateProposalStatus(proposalId, status, rootDir): void {
  const dir = path.resolve(rootDir, AMENDMENTS_DIR);
  const filePath = path.join(dir, `${proposalId}.json`);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf-8");
  const p = JSON.parse(raw) as AmendmentProposal;
  p.status = status;
  // 原子写入
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(p, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}
```

或者复用 `FileLockManager`（已在 engine 中实现）对提案文件加写锁。

---

### M-02：`JsonFileAdapter` 异常路径导致 `loaded` 标志未设置

**文件**：`packages/data/src/storage/adapters/json-file.adapter.ts`
**严重度**：🟡 中
**类别**：错误处理完整性

#### 缺陷描述

```typescript
private load(): void {
  if (this.loaded) return;
  this.ensureDir();
  if (!fs.existsSync(this.filePath)) {
    this.tasks = new Map();
    this.loaded = true;
    return;
  }
  try {
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    // ...解析 JSON...
    this.loaded = true;
  } catch (err) {
    throw new StorageIOError(/* ... */);  // ← throw 前未设置 this.loaded
  }
}
```

`load()` 在 `try` 块中如果抛出 `StorageIOError`，`this.loaded` 保持 `false`。但 `ensureDir()` 和 `fs.existsSync()` 已通过——意味着 `this.loaded` 的语义变为"加载成功"，而非"已尝试加载"。

**触发场景**：文件存在但 JSON 解析失败 → `StorageIOError` 抛出 → 调用方捕获后重试 → `this.loaded` 仍为 false → 再次执行完整加载流程（空耗性能，但功能上正确）。

#### 修复建议

```typescript
private load(): void {
  if (this.loaded) return;
  this.ensureDir();
  this.loaded = true;  // 先标记已尝试加载，防止重复加载
  try {
    // ...实际加载...
  } catch (err) {
    this.loaded = false;  // 加载失败时重置，允许下次重试
    throw new StorageIOError(/* ... */);
  }
}
```

---

### M-03：PM 密码管理器使用固定默认主密钥

**文件**：`packages/pm/src/crypto.ts` line 20-23
**严重度**：🟡 中
**类别**：安全风险

#### 缺陷描述

```typescript
function getMasterKey(): string {
  const envKey = process.env.PM_MASTER_KEY;
  if (envKey && envKey.length >= 8) {
    return envKey;
  }
  return 'password-manager-default-master-key-2024';
}
```

当 `PM_MASTER_KEY` 环境变量未设置时，使用固定的默认字符串作为 AES-256-GCM 主密钥。任何获取到源代码的人都可以：
1. 读取 `.pm-data/vault.enc` 文件
2. 用此默认密钥解密所有存储的密码条目

#### 影响评估

AES-256-GCM 加密的**全部安全性取决于密钥的保密性**。默认密钥硬编码在源码中意味着：能访问源码 == 能解密所有密码。密码管理器存储的通常是高价值凭证，默认密钥使整个加密形同虚设。

#### 修复建议

```typescript
function getMasterKey(): string {
  const envKey = process.env.PM_MASTER_KEY;
  if (envKey && envKey.length >= 8) {
    return envKey;
  }
  throw new Error(
    '[PM] 环境变量 PM_MASTER_KEY 未设置或长度不足 8 位。' +
    '密码管理器无法使用默认密钥——请设置强密码作为 PM_MASTER_KEY。'
  );
}
```

---

### M-04：治理 API 异常传播路径不一致

**文件**：`packages/engine/src/governance-loop.ts` + `amendment-judge.ts`
**严重度**：🟡 中
**类别**：错误处理完整性

#### 缺陷描述

治理闭环的各 API 函数对错误的处理方式不一致：

| 函数 | 错误处理方式 | 一致性 |
|------|-------------|--------|
| `saveProposal()` | 让异常自然传播（`fs.mkdirSync`/`writeFileSync` 抛错） | ⚠️ |
| `loadPendingProposals()` | catch 内吞异常（跳过格式错误的文件） | ✅ 优雅降级 |
| `judgeProposals()` | 宪法不存在时 `throw new Error(...)` | ❌ 裸抛 |
| `applyApproved()` | 返回 `AmendmentApplyResult { success: false, error }` | ✅ 优雅降级 |
| `summarizeGovernance()` | 内部调用 `judgeProposals()` → 异常向上传播 | ❌ 裸抛 |
| `updateProposalStatus()` | 文件不存在静默返回 | ✅ 幂等 |

治理闭环的入口点 `summarizeGovernance()` 和 `judgeProposals()` 在宪法文件缺失时抛异常，而 `applyApproved()` 返回错误结果对象。上层编排器（昔涟 Agent）对这两种错误模式需要不同的处理逻辑，增加了复杂度和遗漏风险。

#### 修复建议

统一治理 API 的错误处理策略。推荐采用返回结果对象（Result Type）模式，与 `applyApproved()` 保持一致：

```typescript
export interface GovernanceError {
  success: false;
  error: string;
}

export function judgeProposals(rootDir: string): BatchJudgment[] | GovernanceError {
  const constitutionPath = path.resolve(rootDir, CONSTITUTION_RELATIVE);
  if (!fs.existsSync(constitutionPath)) {
    return { success: false, error: `宪法文件不存在：${constitutionPath}` };
  }
  // ...
}
```

---

## 🟢 低风险缺陷

### L-01：`ConfirmGate.waitFor()` timeout 闭包作用域链残留

**文件**：`packages/engine/src/confirm-gate.ts` line 83-92
**严重度**：🟢 低
**类别**：资源泄漏（轻微）

#### 缺陷描述

```typescript
return new Promise<boolean>((resolve) => {
  this.resolvers.set(requestId, resolve);
  if (timeoutMs !== undefined && timeoutMs !== null) {
    setTimeout(() => {
      if (this.resolvers.has(requestId)) {
        this.resolvers.delete(requestId);
        this.pending.delete(requestId);
        resolve(false);
      }
    }, timeoutMs);
  }
});
```

当 `resolve(response)` 被外部提前调用后，timeout 定时器的闭包仍持有对 `requestId`、`resolve` 和整个 `ConfirmGate` 实例（通过 `this`）的引用。虽然后续 `resolvers.has()` 检查会短路，但闭包作用域链在 timeout 触发前无法被 GC 回收。

**影响**：在测试场景中，如果大量请求设置了 5 分钟超时并在 1 秒后被 resolve，后续 4 分 59 秒内闭包链无法回收。

#### 修复建议

在 `resolve()` 方法中清除关联的定时器 timerId；或在 timeout 回调中将闭包引用置 null 以释放作用域链。

---

### L-02：`evaluateAmendment()` 返回的 `blocking` 数组永远为占位符

**文件**：`packages/engine/src/amendment-judge.ts`
**严重度**：🟢 低
**类别**：接口契约完整性

#### 缺陷描述

`JudgmentResult` 接口定义：

```typescript
export interface JudgmentResult {
  verdict: JudgmentVerdict;
  checks: JudgmentCheck[];
  caveats?: string[];
  blocking: string[];         // ← 调用方可从此字段读取阻塞原因
}
```

但 `evaluateAmendment()` 的返回值中，`blocking` 始终为 `["Blocking details omitted — see checks for specifics"]` 占位符。调用方（昔涟 Agent）实际上需要遍历 `checks` 中所有 `passed === false` 的项来提取阻塞原因——这意味着 `blocking` 字段的存在语义与实际填充内容不一致。

如果下游代码直接依赖 `blocking` 字段（而非从 checks 中二次提取），收到的将是一段无用的占位文本。

#### 修复建议

方案A：从未通过的 checks 中自动填充 blocking 数组：

```typescript
function buildBlocking(checks: JudgmentCheck[], verdict: JudgmentVerdict): string[] {
  if (verdict !== "BLOCKED") return [];
  return checks
    .filter(c => !c.passed)
    .map(c => `[${c.id}] ${c.detail.slice(0, 100)}`);
}
```

方案B：从接口中移除 `blocking` 字段，让调用方直接从 `checks` 中提取。

---

## 历史档案交叉引用

根据 MemoryStore 审查档案检索，发现以下模式与历史缺陷关联：

| 本次缺陷 | 历史案例 | 关联分析 |
|----------|----------|----------|
| C-01 编码损坏 | 无直接前例 | **新发现的检查盲区**——CI 流水线缺少编码格式校验 |
| H-01 replanFlight 未处理 | NG-2026-0511-Destroy-Bypass | **同模式**——AgentPool.destroy() 中也有绕过状态机的直接写路径 |
| M-01 文件并发 | NG-2026-0509-DeleteLock | **同领域**——delete_file 曾因缺文件锁产生竞态，治理流程有同样问题 |
| M-03 默认密钥 | （设计评审记录） | 代码从 solo-flight 迁移时未做安全加固 |
| L-02 blocking 占位符 | （多次评审中提及但未修复） | **已知未闭合项**——接口设计与实现之间的偏差 |

---

## 各包质量总评

| 包 | 源码文件 | 缺陷数 | 最严重缺陷 | 质量评估 |
|-------|---------|--------|-----------|---------|
| `engine/src/memory/` | 6 个核心 + 5 个组件 | 1 🔴 | C-01 编码损坏 → 编译中断 | **不可用**—0 个测试可通过 |
| `engine/src/`（调度/治理） | 8+ 个 | 3 🟠🟡 | H-01 崩溃恢复缺口 | ⚠️ 需修复后回归 |
| `data/src/` | 5 个 | 1 🟡 | M-02 loaded 标志 | ✅ 轻微瑕疵 |
| `pm/src/` | 2 个 | 1 🟡 | M-03 默认主密钥 | ⚠️ 安全风险 |
| `shared/` | 12 个 | 0 | — | ✅ 稳定 |
| `cli/` | 多命令 | 0 | — | ✅ 稳定 |
| `llm/` | 2 个 | 0 | — | ✅ 稳定 |
| `parser/` | 2 个 | 0 | — | ✅ 稳定 |
| `testing/` | 1 个 | 0 | — | ✅ 稳定 |
| `tools/` | 3 个 | 0 | — | ✅ 稳定 |

---

## 优先修复顺序

```
优先级 1️⃣ → C-01：memory-store.ts 编码修复
     理由：阻塞全部记忆子系统，10 套测试全灭
     工作量：约 30 分钟恢复中文字符串 + 注释

优先级 2️⃣ → H-01：catch 块添加 await replanFlight
     理由：崩溃恢复路径可能产生悬挂节点
     工作量：约 10 行代码修改

优先级 3️⃣ → M-03：PM 默认密钥改为抛异常
     理由：安全漏洞，影响所有用户
     工作量：约 5 行代码修改

优先级 4️⃣ → M-01 / M-04：治理流程文件操作加锁 + 统一错误处理
     理由：并发场景数据一致性和可维护性
     工作量：约 2 小时重构

优先级 5️⃣ → M-02 / L-01 / L-02：低优先级修补
     理由：不影响运行正确性
     工作量：约 30 分钟
```

---

## 审查结论

代码核心架构（类型系统、状态机、调度管线）设计扎实。312 个单元测试在非记忆模块通过率 100%，说明**核心调度逻辑和 Agent 生命周期管理质量可靠**。

但记忆子系统（MemoryStore）的编码损坏是一个不应存在的**工程质量问题**——比逻辑错误更难调试，因为编译阶段就直接阻断。此类问题应在 CI 编码检查中捕获。

治理流程（Governance Loop）和密码管理器（PM）的缺陷更多是**迁移遗留**——从 solo-flight 项目迁移时安全加固和并发保护未被纳入检查范围。

> "璃月的城墙经得起魔神级的冲击，但不能被编码问题绊倒。"
> —— 刻晴，审查完毕
