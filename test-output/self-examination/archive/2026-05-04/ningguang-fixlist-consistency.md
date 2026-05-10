# Fix-List 一致性审计报告（凝光 · 第二轮）

> 审视 Agent：凝光（天权星，Governance Agent）  
> 审计日期：2026-05-04（第二轮更新）  
> 依据：consensus-fix-list.md（第二轮清单） vs 实际代码/文档  
> 方法：逐项 grep 交叉验证 —— 引条款、列事实、下结论  
> 新增专项：console.warn vs observer.emit 比例统计 + .env 双文件模型配置对比

---

## 一、console.warn vs observer.emit 统计报告

### 1.1 源文件（src/）统计

| 级别 | 位置 | 计数 | 上下文 |
|------|------|------|--------|
| **console.warn** | — | **6** | |
| | base-agent.ts:143 | 1 | `_executeAndRemember` catch：记忆写入失败（任务已完成） |
| | memory-store.ts:543 | 1 | `_sqlRead` catch：SQL 退化回退（无 observer 时） |
| | meta-agent.ts:135 | 1 | `_parsePlan` catch：JSON 解析失败，回退为单 generic 节点 |
| | scheduler.ts:370 | 1 | `_dispatchSingle`：非标准 AgentType 诊断警告 |
| | task-board.ts:213 | 1 | `removeSubtree`：跳过终态后代节点（孤儿标记） |
| | task-board.ts:221 | 1 | `removeSubtree`：跳过终态根节点（孤儿标记） |
| **console.error** | — | **4** | |
| | agent-pool.ts:47 | 1 | `setStatus`：非法流转 invariant |
| | memory-store.ts:448 | 1 | `_saveDb` catch：磁盘写入失败（无 observer 回退） |
| | memory-store.ts:630 | 1 | `_deserializeRow` catch：JSON 损坏跳过行（无 observer 回退） |
| | task-board.ts:127 | 1 | `complete`：claimedBy/results 对称性 invariant 违规 |
| **console.log** | — | **2** | |
| | butler-agent.ts:64 | 1 | Butler CRITICAL 消息 |
| | butler-agent.ts:77 | 1 | Butler 普通消息 |
| **observer.emit** | — | **15** | |
| | memory-store.ts:441 | 1 | `_saveDb` catch → `memory.persist_failed` (CRITICAL) |
| | memory-store.ts:536 | 1 | `_sqlRead` catch → `memory.sql_degraded` (HIGH) |
| | memory-store.ts:623 | 1 | `_deserializeRow` catch → `memory.deserialize_failed` (HIGH) |
| | scheduler.ts:122 | 1 | `executeAll` → `scheduler.layer.start` (HIGH) |
| | scheduler.ts:169 | 1 | `executeAll` → `scheduler.done` (CRITICAL) |
| | scheduler.ts:214 | 1 | `_tryFireReplan` → `scheduler.replan.limit` (CRITICAL) |
| | scheduler.ts:244 | 1 | `_drainReplanQueue` → `node.replan` (CRITICAL) |
| | scheduler.ts:283 | 1 | `_dispatchNode` → `node.start` (HIGH) |
| | scheduler.ts:313 | 1 | `_dispatchNode` → `node.replan.queued` (HIGH) |
| | scheduler.ts:325 | 1 | `_dispatchNode` → `node.failed` (CRITICAL) |
| | scheduler.ts:407 | 1 | `_dispatchSingle` → `node.spawn_failed` (HIGH) |
| | scheduler.ts:442 | 1 | `_dispatchSingle` → `node.complete` (HIGH) |
| | scheduler.ts:482 | 1 | `_dispatchMulti` → `node.spawn_failed` (HIGH) |
| | scheduler.ts:515 | 1 | `_dispatchMulti` → `scheduler.invariant_violation` (CRITICAL) |
| | scheduler.ts:544 | 1 | `_dispatchMulti` → `node.complete` (HIGH) |

### 1.2 汇总

| 调用类型 | 计数 | 占比 |
|----------|------|------|
| console.warn | 6 | 22.2% |
| console.error | 4 | 14.8% |
| console.log | 2 | 7.4% |
| observer.emit | 15 | 55.6% |
| **总计** | **27** | **100%** |

### 1.3 分析裁定

**observer.emit 占主导（55.6%）**——相比上一轮审计报告中的"console.warn 是占位伪装，无真实 observer 注入点"，当前状态已有本质改善。

**关键观察**：

- **3 处 console.warn/error 是 observer 的安全回退**（memory-store.ts:448, 543, 630）——当 `this._observer` 存在时走 `observer.emit`，不存在时走 `console`。这是合理的降级策略，不是占位伪装。
- **剩余 9 处 console 调用**中：2 处为 ButlerAgent 正常用户通知（console.log），4 处为 invariant 违规诊断（console.error），2 处为 removeSubtree 孤儿标记（console.warn），1 处为 meta-agent JSON 解析失败回退（console.warn）。其中 MetaAgent 和 BaseAgent 的 console.warn 尚有迁移空间——它们目前未持有 observer 引用。
- **但lerAgent 的 console.log 是正确的**——它是用户通知通道，不应进事件总线。

**建议**：MetaAgent（console.warn:135）和 BaseAgent（console.warn:143）若需接入事件总线，可在构造时注入 observer。当前优先级：P3（改善项）。

---

## 二、.env 双文件模型配置一致性审计

### 2.1 文件内容逐项对比

| 环境变量 | `/.env` (root) | `/packages/engine/.env` (engine) | 一致？ |
|----------|---------------|--------------------------------|--------|
| `DEEPSEEK_API_KEY` | `sk-1e1ffd5f19f3428d9d264c26ec0589a6` | `sk-1e1ffd5f19f3428d9d264c26ec0589a6` | ✅ 一致 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | `https://api.deepseek.com/v1` | ✅ 一致 |
| `DEEPSEEK_CHAT_MODEL` | **`deepseek-v4-flash`** | **`deepseek-reasoner`** | ❌ **冲突** |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | `deepseek-v4-pro` | ✅ 一致 |

### 2.2 冲突分析

- **Root .env**：`DEEPSEEK_CHAT_MODEL=deepseek-v4-flash` —— 快速/低成本模型，适合常规 Agent 调用。
- **Engine .env**：`DEEPSEEK_CHAT_MODEL=deepseek-reasoner` —— 推理模型，适合需要深度推理的场景。

**运行时行为不确定**：取决于 .env 加载顺序（dotenv 默认不覆盖已存在的环境变量）。若 root .env 先加载，engine 使用 `deepseek-v4-flash`；反之使用 `deepseek-reasoner`。**这违反 P1-4 的"去重"声明**。

### 2.3 裁定

> **依据**：consensus-fix-list.md P1-4 声明"环境变量统一 + 去重——命名已统一但值不一致，去重声明不实，属声明与实现背离"。

**⚠️ 未完成**。命名已统一（均为 `DEEPSEEK_CHAT_MODEL`），但去重未完成——两个 `.env` 文件并存且值冲突。建议删除 `packages/engine/.env`，以 root `.env` 为唯一配置源。若 engine 需要不同的 chat model，应通过代码层的模型选择逻辑（如 MetaAgent 固定使用 reasoner 模型）而非环境变量重复声明。

---

## 三、consensus-fix-list P0/P1 条目代码级逐项验证

### P0 立即修复（阻断级）

#### P0-1: scheduler.ts `_dispatchNode` 双重发射 `node.failed`

| 项目 | 详情 |
|------|------|
| **声明** | "入口加去重 flag" |
| **实际代码** | `_dispatchNode` 末尾（scheduler.ts:325）仅一处 `node.failed` 发射，`_dispatchSingle`（line 442）和 `_dispatchMulti`（line 544）内部仅发射 `node.complete` 且仅在成功时。失败统一由 `_dispatchNode` 顶层发射一次。 |
| **验证方法** | grep `node.failed` / `node.complete` 在 scheduler.ts 中，确认 `node.failed` 仅出现一次发射点，`node.complete` 各只有成功分支发射。 |
| **裁定** | ✅ **问题已消解**。原"双重发射"根因（`_dispatchSingle` 内部也发射 `node.failed`）已通过移除内部重复发射解决。但修复方式与声明（"入口加去重 flag"）不同——当前方案更优（源头消除而非事后去重）。**建议更新 fix-list 声明**。 |

#### P0-2: memory-store.ts `_saveDb` 静默吞错 + observer 上报

| 项目 | 详情 |
|------|------|
| **声明** | "整体加 observer 错误上报" |
| **实际代码 `_saveDb`**（memory-store.ts:431-449） | `try { const data = this._db.export(); fs.writeFileSync(this._dbPath, buf); } catch (e) { if (this._observer) { this._observer.emit({ type: "memory.persist_failed", priority: PipelinePriority.CRITICAL, ... }); } else { console.error(errMsg); } }` |
| **实际代码 `_deserializeRow`**（memory-store.ts:619-632） | `try { return { ... JSON.parse(raw.content) ... }; } catch (e) { if (this._observer) { this._observer.emit({ type: "memory.deserialize_failed", ... }); } else { console.error(...); } return null; }` |
| **实际代码 `_sqlRead`**（memory-store.ts:536） | `catch (e) { if (this._observer) { this._observer.emit({ type: "memory.sql_degraded", ... }); } else { console.warn(...); } return this._memScanRead(query, now); }` |
| **验证方法** | grep `_saveDb` / `_deserializeRow` / `_sqlRead` 在 memory-store.ts 中，确认 try-catch 存在且 catch 中有 observer.emit。 |
| **裁定** | ✅ **核心要求已完成**。`_saveDb` 不再静默吞错——磁盘写入失败通过 observer.emit 上报 CRITICAL 事件。`_deserializeRow` 防 JSON.parse 崩溃——损坏行被跳过而不中断 init()。`_sqlRead` 退化时上报 HIGH 事件。三处均实现了 observer 上报，无 observer 时有 console 安全回退。**此 P0 项可标记完成**。 |

#### P0-3: shared 测试引用 15 个不存在的 v1.1 类型

| 项目 | 详情 |
|------|------|
| **声明** | "shared 测试引用 15 个不存在类型" |
| **实际代码** | `types.test.ts` 导入 18 个 v2.0 类型：AgentType, AgentStatus, ReversibilityLevel, TaskNode, NodeResult, MemoryType, MemoryState, MemoryEntry, MemoryLink, LinkType, MemoryQuery, PipelinePriority, ExecutionReport, LockType, PlatformKind, RiskDomain, TAG_VOCABULARY, AGENT_TAGS, AGENT_TOOL_PERMISSIONS。全部在 `shared/src/` 四个域文件中定义。 |
| **验证方法** | grep 导入列表 vs `shared/src/*.ts` 实际导出。 |
| **裁定** | ✅ **已完成**。v1.1 类型引用已全部替换为 v2.0 类型。 |

#### P0-4: base-agent.ts `_executeAndRemember` 双记忆写入无事务

| 项目 | 详情 |
|------|------|
| **声明** | "双记忆写入无事务" |
| **实际代码** | `_executeAndRemember`（base-agent.ts:107-143）：两次 `this.memory.write()` 独立调用，无事务包裹。但有整体 try-catch——若第二次写入失败，第一次已落盘无法回滚，但异常被捕获且不阻塞任务结果。 |
| **验证方法** | 读取 base-agent.ts `_executeAndRemember` 函数体，确认无 BEGIN/COMMIT 或回滚逻辑。 |
| **裁定** | ⚠️ **未完成**。"事务"语义仍未定义（SQLite BEGIN/COMMIT？内存级回滚？还是 try/catch 包裹？）。当前 try-catch 仅防止记忆写入失败阻断任务结果，但双写入间无原子性保证。**fix-list 声明过于模糊——需先明确"事务"的具体含义再评估**。 |

#### P0-5: Toolkit 所有内置工具均为存根

| 项目 | 详情 |
|------|------|
| **声明** | "Toolkit 所有内置工具均为存根（stub）" |
| **实际代码** | `toolkit.ts` 中 read_file/write_file/search_code/run_shell/list_files/delete_file 均有真实 fs/child_process 实现，含沙箱路径保护、rg/grep 回退、超时控制。 |
| **验证方法** | 上一轮审计已确认，本轮复查无退化。 |
| **裁定** | ✅ **已完成**。 |

---

### P1 高优先（Core-2 启动前必须完成）

#### P1-1: Agent 层统一继承 BaseAgent

| 项目 | 详情 |
|------|------|
| **声明** | "4 继承 + 5 独立 → 统一继承" |
| **实际代码** | 8 个 Agent 继承 BaseAgent：CodeAgent, ReviewAgent, AnalysisAgent, OpsAgent, LoopAgent, DocGovernAgent, InspectorAgent, BrowserAgent。MetaAgent（规划引擎）和 ButlerAgent（事件订阅者）独立——二者角色特殊，不参与 Scheduler 派发，独立合理。 |
| **验证方法** | 上一轮审计已确认，本轮复查无退化。 |
| **裁定** | ✅ **已完成**。 |

#### P1-2: CI 可重复验证流程搭建

| 项目 | 详情 |
|------|------|
| **声明** | "无 GitHub Actions / Docker / CI 配置" |
| **实际代码** | 无 `.github/workflows/`、无 GitLab CI、无 Dockerfile、无任何 CI 配置。 |
| **验证方法** | list_files 根目录无 `.github/`、无 `Dockerfile`、无 `.gitlab-ci.yml`。 |
| **裁定** | ❌ **未完成**。lint/test/build 脚本已就绪，仅缺 CI 触发。搭建门槛低（一个 GitHub Actions workflow 即可），收益高。 |

#### P1-3: vitest 版本统一

| 项目 | 详情 |
|------|------|
| **声明** | "root 4.1.5 vs engine 2.1.0 → 统一" |
| **实际代码** | root (`package.json`): `"vitest": "^2.1.0"`；engine: `"vitest": "^2.1.0"`；shared: `"vitest": "^2.1.0"`；testing: `"vitest": "^2.1.0"`。四个 package.json 全部统一。 |
| **验证方法** | grep `vitest` 在四个 package.json 中。 |
| **裁定** | ✅ **已完成**。 |

#### P1-4: 环境变量统一 + 去重

| 项目 | 详情 |
|------|------|
| **声明** | "DEEPSEEK_MODEL vs DEEPSEEK_CHAT_MODEL 命名不对齐，engine/.env 与 root/.env 重复且冲突" |
| **实际代码** | 命名已统一（均为 `DEEPSEEK_CHAT_MODEL`），但双文件并存且值冲突（详见第二节）。 |
| **验证方法** | 读取 `/.env` 和 `/packages/engine/.env` 逐项对比。 |
| **裁定** | ⚠️ **部分完成（命名统一，去重未完成）**。两张 .env 卡让运行时行为取决于加载顺序。 |

#### P1-5: 移除硬编码 API Key

| 项目 | 详情 |
|------|------|
| **声明** | "vitest.config.ts 中明文密钥" |
| **实际代码** | `vitest.config.ts`: `DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? ""`——无明文 fallback 密钥。 |
| **验证方法** | 读取 `packages/engine/vitest.config.ts`。 |
| **裁定** | ✅ **已完成**。 |

#### P1-6: 添加 eslint 配置文件

| 项目 | 详情 |
|------|------|
| **声明** | "三个包都有 lint 脚本但无 .eslintrc.* / eslint.config.*" |
| **实际代码** | `eslint.config.mjs` 存在，含 `@eslint/js` + `typescript-eslint` 推荐规则 + 自定义规则（no-unused-vars/no-explicit-any/no-require-imports）。 |
| **验证方法** | list_files 根目录 → `eslint.config.mjs` 存在。 |
| **裁定** | ✅ **已完成**。 |

#### P1-7: Scheduler `_dispatchMulti` claimedBy 语义加固

| 项目 | 详情 |
|------|------|
| **声明** | "加 invariant 断言：claimedBy 每个元素最终在 results 中或已 release" |
| **实际代码** | `_dispatchMulti` 末尾（scheduler.ts:391-407）：逐项检查 claimedBy 中每个条目是否在 results 中出现，缺失时通过 `observer.emit('scheduler.invariant_violation', CRITICAL)` 上报。 |
| **验证方法** | grep `claimedBy` in scheduler.ts `_dispatchMulti` 函数体。 |
| **裁定** | ✅ **已完成**。invariant 断言存在且通过 observer 上报。 |

#### P1-8: TaskBoard `complete()` 等齐逻辑加固

| 项目 | 详情 |
|------|------|
| **声明** | "依赖 claimedBy-results 对称性，加 invariant 断言" |
| **实际代码** | `complete()`（task-board.ts:119-127）：结果去重 + results/claimedBy 对称性检查，异常时 `console.error`。 |
| **验证方法** | grep `invariant` in task-board.ts `complete` 函数体。 |
| **裁定** | ✅ **已完成**。invariant 断言存在。 |

#### P1-9: tsconfig 继承统一

| 项目 | 详情 |
|------|------|
| **声明** | "shared 未 extend tsconfig.base.json，testing 缺 references" |
| **实际代码** | shared `tsconfig.json`: `"extends": "../../tsconfig.base.json"`；testing `tsconfig.json`: `"extends": "../../tsconfig.base.json"` + `"references": [{ "path": "../shared" }]`。 |
| **验证方法** | 读取 `packages/shared/tsconfig.json` 和 `packages/testing/tsconfig.json`。 |
| **裁定** | ✅ **已完成**。 |

---

## 四、专项检查：核心防护机制代码级确认

### 4.1 `_saveDb` try-catch

```
文件：packages/engine/src/memory-store.ts
行号：431-449
确认：✅ try-catch 包裹 writeFileSync，catch 中有 observer.emit('memory.persist_failed', CRITICAL)
回退：无 observer 时 console.error
```

### 4.2 `_deserializeRow` 防崩溃

```
文件：packages/engine/src/memory-store.ts
行号：619-632
确认：✅ try-catch 包裹 JSON.parse，损坏行返回 null 跳过，不崩溃 init()
上报：observer.emit('memory.deserialize_failed', HIGH) 或 console.error 回退
```

### 4.3 dispatch 守卫链

```
文件：packages/engine/src/scheduler.ts
_dispatchSingle (行 356-450) 守卫清单：
  ✅ agent 匹配检查 (_findMatchingAgent)
  ✅ agent 注册检查 (agents.get)
  ✅ AgentStatus 检查 (Awake/Active 才可执行)
  ✅ claim 原子认领检查
  ✅ spawn 失败 → release + failNode（防节点卡 claimed）
  ✅ execute catch → 仍 complete 落盘（防节点卡 claimed）
  ✅ destroy 异常不阻断 complete 落盘

_dispatchMulti (行 453-548) 守卫清单：
  ✅ agent 匹配检查 (_findAllMatchingAgents)
  ✅ agent 注册检查
  ✅ AgentStatus 检查
  ✅ claim 检查
  ✅ spawn 失败 → release（防 claimedBy 残留致死锁）
  ✅ invariant claimedBy/results 对称性检查
  ✅ execute catch → 仍 complete 落盘
  ✅ destroy 异常不阻断 complete 落盘
```

**裁定：dispatch 守卫链完整且超出预期**。spawn 失败后的 release 机制是关键防护——防止 claimedBy 中有该类型但永无结果导致死锁。

---

## 五、P0/P1 状态总表

| ID | 声明 | 代码级完成 | 裁定 |
|----|------|-----------|------|
| P0-1 | scheduler 双重发射 | ✅ 问题消解 | ⚠️ 消解方式与声明不符，建议更新声明 |
| P0-2 | MemoryStore 静默吞错 + observer | ✅ try-catch + observer.emit | ✅ **完成**（含 _saveDb/_deserializeRow/_sqlRead） |
| P0-3 | shared 测试 v1.1 类型 | ✅ 全部替换 v2.0 | ✅ 完成 |
| P0-4 | _executeAndRemember 双写入事务 | ❌ 无事务 | ⚠️ 待明确"事务"语义 |
| P0-5 | Toolkit 存根 | ✅ 真实实现 | ✅ 完成 |
| P1-1 | Agent 层统一继承 | ✅ 8/10 继承 | ✅ 完成 |
| P1-2 | CI 流程搭建 | ❌ 无 CI 配置 | ❌ 未完成 |
| P1-3 | vitest 版本统一 | ✅ 全部 2.1.0 | ✅ 完成 |
| P1-4 | 环境变量统一+去重 | ⚠️ 命名统一，双文件冲突 | ⚠️ 去重未完成 |
| P1-5 | 移除硬编码 API Key | ✅ 无明文密钥 | ✅ 完成 |
| P1-6 | eslint 配置 | ✅ eslint.config.mjs | ✅ 完成 |
| P1-7 | claimedBy invariant | ✅ observer.emit 上报 | ✅ 完成 |
| P1-8 | complete 等齐 invariant | ✅ console.error 上报 | ✅ 完成 |
| P1-9 | tsconfig 继承统一 | ✅ extend + references | ✅ 完成 |

---

## 六、与前轮审计的关键差异

| 审计项 | 前轮（旧 ningguang-fixlist-consistency.md） | 本轮（代码复查） | 变化 |
|--------|-------------------------------------------|-----------------|------|
| P0-2 _saveDb | "仍为 fs.writeFileSync 无 try/catch" | try-catch + observer.emit 已实现 | ✅ **已修复** |
| P0-2 observer 上报 | "observer 错误上报机制完全缺失" | 三处 observer.emit（_saveDb/_sqlRead/_deserializeRow） | ✅ **已修复** |
| P0-2 _deserializeRow | 未提及 | try-catch 防 JSON.parse 崩溃 | ✅ **新增防护** |
| console.warn 定位 | "占位伪装，无真实 observer 注入点" | 55.6% observer.emit，console 调用多数为 observer 安全回退 | ✅ **定位升级** |
| dispatch 守卫 | 前轮未做专项检查 | 完整守卫链（含 release 防死锁） | ✅ **确认完整** |

---

## 七、建议与行动项

1. **更新 fix-list 声明**：
   - P0-1：从"入口加去重 flag"改为"消除 node.failed 重复发射（已通过源头移除重复发射解决）"
   - P0-2：标记为 ✅ 完成（_saveDb try-catch + observer 上报已落地）

2. **合并 .env**（P1-4 残留）：
   - 删除 `packages/engine/.env`，root `.env` 为唯一配置源
   - 若 engine 需不同 chat model，通过代码层模型选择逻辑实现

3. **CI 搭建**（P1-2）：
   - 优先搭建 GitHub Actions workflow：`pnpm install → pnpm build → pnpm test → pnpm lint`
   - 当前 lint/test/build 脚本已就绪，仅缺 CI 触发

4. **P0-4 事务语义明确**：
   - fix-list 应定义"事务"的具体含义——若仅需 try/catch 包裹两次写入（失败不落盘第一条），当前已基本满足
   - 若需要原子性回滚，需引入 SQLite SAVEPOINT 或内存快照回滚

5. **MetaAgent/BaseAgent console.warn 迁移**（P3）：
   - MetaAgent（`_parsePlan` catch）和 BaseAgent（`_executeAndRemember` catch）的 console.warn 可考虑注入 observer 引用以接入事件总线
   - 当前优先级：P3（改善项）

---

*凝光，天权星，依据法典逐项核定，2026-05-04（第二轮更新）*

*玉册合上。天权定论，不得上诉。*
