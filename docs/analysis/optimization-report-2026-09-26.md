# Cortex 优化与体检报告

**日期**：2026-09-26
**范围**：门禁健康度 / 运行时数据无界增长 / 在途改动收尾 / 全仓体检
**基线**：`8ceb7d67`（本轮起点）→ `f05196e5`（代码提交结束，7 个提交；本报告为第 8 个）

---

## 0 · 摘要

| # | 事项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 门禁 2/5 步红 → 5/5 全绿 | ✅ 已修 | 3960/3965 passed，14 skipped，276 个测试文件 |
| 2 | `notifications.db` 无界增长 | ✅ 已修 + 已回收 | 1975.1 MB / 9,693,314 行 → 0.7 MB / 3,059 行 |
| 3 | 在途改动收尾 | ✅ 7 个提交，工作区已清 | `git status` 仅剩 2 个未跟踪目录 |
| 4 | 依赖环 | ✅ 无环 | 28 包 / 76 条 import 边 |
| 5 | 依赖漏洞 | ⚠️ 32 条，**生产依赖 0 条** | `pnpm audit --prod` exit 0 |
| 6 | 零消费导出 | ✅ 3.0% | 16/535 |
| 7 | 文档漂移 | ⚠️ 口径失真，实为 69% 历史 | 见 §5 |

---

## 1 · 门禁：此前卡在第 2 步，后三步从未执行

**现象**：`npx tsx scripts/ci-gate.ts` 在 `[门禁 2/5] eslint` 处退出。

```
packages/scheduler/src/dispatch-steps/execute-step.ts
  4:15  error  'AgentTracker' is defined but never used.  @typescript-eslint/no-unused-vars
✖ 1 problem (1 error, 0 warnings)
```

**为什么后果比一行 import 大**：门禁栈是 `tsc → eslint → critical-fixes → vitest → coverage`，串行短路。eslint 挂掉意味着**混沌校验、276 个测试文件、覆盖率阈值这三步在本轮之前一次都没跑过**。

**根因**：在途改动给 `execute-step.ts` 加了 `ctx.agentTracker?.recordHeartbeat(...)`，同时加了 `import type { AgentTracker }`。但该类型是经 `types.ts` 的 `DispatchCtx` 传入的，本地 import 从未被引用。

**修复**：删除该行（`c9e49a44` 的父提交）。

**修后**：

```
🔒 [门禁 1/5] tsc -b 全量增量编译检查...        ✅
🔒 [门禁 2/5] eslint packages/**/src...         ✅
🔒 [门禁 3/5] critical-fixes 混沌校验...        ✅
    vitest 按包串行 — unit + verify + contract (276 个文件，14 个 llm/integration/e2e/manual 跳过)
    28/28 包全绿
✅ 门禁通过   Tests: 3960/3965 passed | 14 skipped
🔒 [门禁 4.5/5] 活性层评测（eval report）...     ✅
```

---

## 2 · P0 · `notification_queue` 无界增长

### 2.1 证据（修复前实测）

| 指标 | 读数 |
|---|---|
| 文件体积 | 1975.1 MB |
| 总行数 | 9,693,314 |
| `acked = 0` | **9,693,314（100%，`acked = 1` 为 0）** |
| 时间跨度 | 2026-08-01 → 2026-09-21 |
| 2026-08-03 单日 | 7,014,623 行 |
| 2026-08-04 单日 | 2,622,680 行 |
| 事件类型 | `error.reported` 4,925,035 + `node.failed` 4,768,185 + `scheduler.loop_crashed` 1 |
| 通道 | `important` 9,693,220 / `urgent` 1 |
| 索引 | `idx_nq_channel(channel)`、`idx_nq_timestamp(timestamp)` |
| `PRAGMA user_version` | 1 |

### 2.2 根因：不是风暴，是设计

旧 `cleanup()`：

```sql
DELETE FROM notification_queue WHERE timestamp < ? AND acked = 1
```

只删已确认行。而 `ImportantChannel.push()` 要求：

```ts
event.ackRequired = false;   // channels.ts:183
...
this.persistence.persist(event);   // 写库时 acked 恒为 0
```

且**整条 important 通道没有任何 ack 路径**——`markAcked` 只从 `UrgentChannel.ack()` 调用（`channels.ts:128`）。

结论：**important 通道的行永远进不了清理条件，从设计上就不可能被回收。** 那次风暴只是把设计缺陷放大成了 1.97 GB。

附带缺陷：`loadPending` 的查询是

```sql
WHERE channel = ? AND acked = 0 ORDER BY timestamp ASC LIMIT 500
```

而索引只有两个单列——**每次调用都要在 969 万行上过滤后在内存排序**。

另有一处死配置：`ChannelConfig.persistTtlMs`（默认 24h）**全仓库零消费**，只 `types.ts` 里被赋值；`loadPending` 内部此前硬编码 7 天。

### 2.3 修复

- **三段式保留**（`persistence.ts`）：已确认行按传入 TTL、未确认行按 7 天硬上限（`UNACKED_RETENTION_MS`）、总量按 50,000 行兜底（`MAX_ROWS`，风暴防线）。
- **三处触发**：`_init()` 启动一次 / 读路径节流 5 分钟 / 每写 10,000 行——风暴期间不必等节流窗口。
- **schema v1 → v2**：
  - 新增 `idx_nq_load(channel, acked, timestamp)` —— 覆盖 `loadPending` 全查询
  - 新增 `idx_nq_cleanup(acked, timestamp)` —— 覆盖 cleanup 的两个 `DELETE`
  - 删除 `idx_nq_channel` —— 它是 `idx_nq_load` 的最左前缀，任何用得上的查询复合索引都覆盖，留着只白付写入代价
- **迁移链改写**：原 `if (current < 1)` 块里写着 `user_version = SCHEMA_VERSION`——若把 SCHEMA_VERSION 直接提到 2，新建库会一步跳到 2 而**跳过 v2 迁移块**，索引永远建不出来。已改成每步推进到该步版本号。

### 2.4 验证

单元测试：`packages/notification` 76 → **81** 个用例全绿（新增 5 个回归：未确认行过期清理 / 保留期内不误删 / 行数上限 / 写入路径自清理 / v1→v2 迁移）。行覆盖 **89.92%**（阈值 71%）。

真实库上跑修复后的类：

| 阶段 | 体积 | 行数 | user_version | 命名索引 |
|---|---|---|---|---|
| 处理前 | 1975.1 MB | 9,693,314 | 1 | `idx_nq_channel`, `idx_nq_timestamp` |
| 迁移 + 清理后（VACUUM 前） | 2367.7 MB | 3,059 | **2** | `idx_nq_load`, `idx_nq_cleanup`, `idx_nq_timestamp` |
| VACUUM 后 | **0.7 MB** | 3,059 | 2 | 同上 |

保留的 3,059 行全部来自 2026-09-20/21，在 7 天保留期内，属正常保留。

备份：`D:\cortex\.cortex\backup\notifications-pre-purge-2026-09-26.db`（1975 MB，逐行一致，9,693,314 行）。

### 2.5 生产注意事项

迁移 + 清理在 969 万行上耗时 **162.9 秒**（建两个复合索引 + 删 969 万行）。本次是靠一次性脚本在守护进程停止时做的；**如果今后再有类似体量的积压，daemon 启动会被阻塞三分钟**。行数上限（50,000）就是为不再出现这种体量而设的兜底。

---

## 3 · 上游：那 963 万条事件从哪来

链路（`packages/engine/src/planning/notification-runtime.ts`）：

1. `NotificationRuntime.start()` 订阅 PipelineObserver 的 **CRITICAL / HIGH / NORMAL 全部事件**（`start()` 里三次 `observer.on`）。
2. 语义映射把 `error.reported` 与 `node.failed` 都定为 `WARNING` → **Important 通道**。
3. `_eventToNotification()` 构造 `NotificationEvent` 时**从不设置 `mergeKey`**。
4. 于是 `NotificationPipe.push()` 的归并分支永不进入，`ImportantChannel.push()` 把**每一条**事件落盘。

而 `NotificationPipe.setMergeRules()` —— **生产代码零调用**（全仓只有测试调用它）。

**即：整套「同源归并」子系统在上线路径上完全没生效。** 8/03–8/04 的 963 万条中 `error.reported` 4,925,035 与 `node.failed` 4,768,185 数量近乎相等，符合「每次调度失败同时产出一条 node.failed 与一条 error.reported」的 1:1 放大。

**建议（本轮未做）**：给 `ErrorReported` / `NodeFailed` 补 `mergeKey`（如 `nodeId` 或错误指纹），并在 bootstrap 里调一次 `setMergeRules`。否则下一次调度崩溃循环会原样重演，只是这次会被行数上限截断在 50,000 行——**磁盘安全了，但根因还在**。

---

## 4 · 体检各项

### 4.1 依赖环 ✅

```
[dep-cycle] 28 packages, 76 import edges
[dep-cycle] OK - no package-level cycles
```

### 4.2 零消费导出 ✅ 16/535 = 3.0%

| 包 | 导出 | 零消费 |
|---|---|---|
| notification | 23 | **0** |
| telemetry | 47 | **0** |
| config | 280 | 5（`DIR_LORE`、`FILE_PERSONA_PROFILE`、`FILE_PERSONA_PERSONALITY`、`DOMAIN_VALIDATORS`、`registerAllDomains`） |
| shared | 185 | 11（多为 `SPAN_PREFIX_*` 常量、`KvStore` 一族） |

### 4.3 依赖漏洞 ⚠️ 32 条，但生产依赖 0 条

```
pnpm audit（含 dev）         → 32 vulnerabilities：critical 2 / high 15 / moderate 14 / low 1
pnpm audit --prod            → 0（exit 0）
```

**全部落在构建与测试工具链**，不是运行时风险。可修版本一览（`overrides` 即可闭合）：

| 模块 | 严重度 | 修复版本 | 备注 |
|---|---|---|---|
| vitest | critical | >=3.2.6 / >=4.1.11 | UI server 任意文件读+执行；仅 Vitest UI 监听时 |
| brace-expansion | high ×5 | >=2.1.4 / >=5.0.9 | 已有 `patches/brace-expansion@5.0.6.patch`，但版本未提 |
| nanoid | high ×2 | >=3.3.18 | |
| postcss | high/moderate | >=8.5.23 | |
| vite | high ×2 / moderate | >=6.4.3 | `server.fs.deny` Windows 绕过 |
| undici | high / moderate ×4 | >=7.29.0 | |
| browserslist | high ×2 | >=4.28.7 | |
| glob | high | >=10.5.0 | |
| esbuild | moderate/low | >=0.28.1 | |

### 4.4 覆盖率 ✅

notification 改动后：Statements 89.92% / Branches 73.71% / Functions 95.89% / Lines 89.92%（阈值 71%）。

### 4.5 文档漂移 ⚠️ 原口径失真

`scripts/doc-drift-check.ts` 报 **272 条**。但该脚本扫的是整棵 `docs/`，包含 `docs/archive/**` 与嵌套的 `docs/constitution/archive/**` 里的历史设计稿。按出现次数同口径拆分后：

| 分类 | 条数 |
|---|---|
| **仅出现在历史文档**（archive / analysis / auditing） | **168** |
| 仅出现在活跃文档 | 45 |
| 活跃与历史文档都有引用 | 32 |
| 合计（本机重算 245，与脚本 272 的差额来自代码语料口径差异） | 245 |

那 45 条「只在活跃文档」的集中在少数设计稿：`core/cortex-tui-v2-final-design.md`（11 条：ToolCard / FocusRouter / DiffRenderer / OverlayManager / StdinBuffer / TaskTreeRenderer…）、`core/telemetry-design-principles.md`（7 条）、`core/Committee-session-协议设计.md`（5 条）——**是「设计已写、实现未做」，不是「改名后失修」**。

脚本第 72 行自己也写着 `may be forward-design or deprecated symbols - manual check`。**建议**：把 `archive|analysis|auditing` 排除后再判定，否则这个信号永远是 272 条噪声。

---

## 5 · 分级清单

### 必修（本轮已修）

- 门禁 lint 阻断 → 后三步从未执行
- `notification_queue` 无界增长（设计缺陷，非偶发）

### 建议（未做，需你定）

1. **上游无去重**：`_eventToNotification` 不设 `mergeKey` + `setMergeRules` 生产零调用 → 归并子系统是死代码。详见 §3。
2. **`persistTtlMs` 全仓零消费**：`ChannelConfig` 里声明并赋值，无任何读取方。配置与行为脱钩——要么接进 `cleanup`，要么删掉。
3. **Important 通道恢复窗口被钉死**：`loadPending` 恒取**最旧 500** 条。本次实测该通道 3,059 行未确认，恢复时只读得到最旧的 500 条，其余 2,559 条要等旧的过了 7 天被删才轮得到——FIFO 饥饿。
4. **依赖漏洞**：生产依赖干净，但建议按 §4.3 加 `overrides` 收敛工具链。
5. **迁移耗时提醒**：见 §2.5，别再让库长到千万行。
6. **人设语气别进工程文档**：本轮清掉一处（README 句末的 `～♪`）。

### 不修

- doc-drift 的 168 条历史漂移——`archive/` 里的历史设计稿本就不该跟代码同步，要求它们一致等于把归档当成活文档。
- `.git` pack 968 MB：`git count-objects -vH` 显示 `prune-packable: 0`、`garbage: 0`，`gc` 榨不出东西，不是问题。
- `.archived` 8.5 GB / `.cortex` 2.1 GB：按指示不动磁盘。

---

## 6 · 待你定

- **未跟踪目录**：`learn-agent/agent.ts`（4 KB，仓库根下的散件，不在任何包里）与 `法律文书-输出/`（4 份 .docx）。`法律文书-输出/` 是私人文件，建议加进 `.gitignore` 或不入库；两者我都没动。
- **备份**：`D:\cortex\.cortex\backup\notifications-pre-purge-2026-09-26.db`（1975 MB）。确认无碍后可删——留着的话它比清理后的库大 2800 倍。

---

## 7 · 本轮提交

```
f05196e5 docs: 记录 2026-09-19 修复与 V4.1 升级，并修两处文档 defect
548db50c chore(config): DeepSeek V4 → V4.1 模型迁移
eda4b9b8 test(engine): loop-strategy-registry 补 beforeEach 重置静态管道
03db57a4 fix(desktop): 页面卸载时清理 canvas 截图定时器
22346cae fix(notification): notification_queue 保留策略 + 复合索引——修无界增长
d8f82da1 fix(observability): 空 catch(() => {}) 补日志——静默吞错改为可诊断
c9e49a44 fix(scheduler): 接线 AgentTracker 心跳 + Promise.all 改 allSettled 保证 cleanup 必达
```

每个提交都过了仓库的 `pre-commit` 钩子（engine test 926 passed | 1 skipped）。

全量门禁（`ci-gate --json`）跑过一次全绿，覆盖的是**当前已提交的全部代码内容**；门禁跑完之后只改过 `README.md` 与 `docs/constitution/…v3.8.md` 两份文档，不含代码。
