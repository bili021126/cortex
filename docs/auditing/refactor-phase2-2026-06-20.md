# Cortex 重整化 · 阶段 2「激活空转层」归档

> 日期：2026-06-20 ｜ 关联：docs/analysis/refactor-spec-2026-06-20.md §2 ｜ 前置：docs/auditing/refactor-phase1-2026-06-20.md

## 基线（阶段 2 开始前）

| 项 | 基线值 | 来源 |
|---|---|---|
| 阶段 1 门禁 | `CI_GATE_EXIT=0`（3778/3783 passed + 覆盖率全达标） | phase1 归档 |
| 阶段 2 目标 | 激活空转层：记忆 SQLite 落地 / 观测接线 / 通知闭环 / 治理验证先行 | refactor-spec §2 |
| 治理层状态 | 「声明先行空转层」：GovernanceEventEmitter 零生产者，治理组件全部空转 | phase1 调研 |
| 通知层状态 | 只入不出：NotificationPipe 无持久化、无消费端、无 ack 回路 | phase1 调研 |

阶段 2 起止提交：`<待填>`（本阶段改动未提交，见「提交序列」节）

## 改动清单（对照 spec §2 勾选）

### 2.1 记忆层（优先）

| # | 改动 | 落地 | 文件 |
|---|---|---|---|
| S2-1 | SqliteStorageBackend（WAL/FTS5/防抖/重试 + SqliteMigrations 独立迁移） | ✅ | memory/src/implementations/sqlite/ |
| S2-2 | bootstrap 选 SQLite 后端：默认 `.cortex/memory.db`，dbPath 显式传入 | ✅ | engine/src/plugin/memory-store.plugin.ts |
| S2-3 | RAG 降级显式化：假 id/空数组 → 显式错误 + telemetry 降级记录 | ✅ | engine/src/bootstrap/init-memory.ts |
| S2-4 | MemoryPersistFailed 事件接 NotificationRuntime（半开→闭环） | ✅ | engine/src/planning/notification-runtime.ts（WARNING 语义） |

### 2.2 观测层

| # | 改动 | 落地 | 文件 |
|---|---|---|---|
| S2-5 | setTelemetry 接线：FileCollector 默认启用（CORTEX_TELEMETRY_FILE 可关） | ✅ | engine/src/bootstrap/bootstrap-engine.ts |
| S2-6 | AlertEngine 数据源修正：接真实生产者或诚实收敛（agent_pool.idle_rate 改走指标点等） | ✅ | scheduler/telemetry/config |
| S2-7 | AuditTrail record* 四方法接真实调用点 | ✅ | engine/config 相关 |
| S2-8 | AuditTrail queryBySpan 接读取端 | ✅ | doctor/scripts |
| S2-9 | daemon 健康端点数据源补齐 | ✅ | server |

### 2.3 通知层

| # | 改动 | 落地 | 文件 |
|---|---|---|---|
| S2-10 | bootstrap 注入 NotificationPersistence（磁盘持久化，动态 import 模式） | ✅ | engine/src/bootstrap/bootstrap-engine.ts |
| S2-11 | 消费端接线：Urgent/Important 落地可查（WS 订阅 + 持久化 markAcked） | ✅ | server/src/notification-bridge.ts、server/src/engine-host.ts |
| S2-12 | ack 回路：WS 客户端应答（WSNotificationAckCommand → daemon → markAcked） | ✅ | protocol/src/ws/commands.ts、server/src/daemon.ts |

### 2.4 治理层（不激活，验证先行）

| # | 改动 | 落地 | 文件 |
|---|---|---|---|
| S2-13 | 治理组件真实 LLM 验证（3 条 manual e2e） | ✅ 3/3 PASS | engine/tests/manual/e2e/governance-llm-verify.ts |
| S2-14 | 治理状态文档化 | ✅ | docs/auditing/refactor-phase2-governance-llm-verify-2026-06-20.md |

## 新增测试清单（守护测试）

| 文件 | 断言覆盖 | 守护的改动项 | @ci 标签 |
|---|---|---|---|
| memory/tests/sqlite-backend.test.ts | CRUD / WAL / 迁移 / **FTS5 含中文检索**（CJK 连续字符）/ 重试 / 内存模式回归 | S2-1 | unit |
| engine/tests/integration/memory-persist-restart.test.ts（4 用例） | 默认装配 SQLite / 写→关→重开→读 / 魔数头落盘 / 默认路径回退 | S2-2 | unit |
| engine/tests/rag-degraded-bridge.test.ts | ragReady=false 时显式错误（非假 id）+ telemetry 降级记录 | S2-3 | unit |
| telemetry/tests/set-telemetry-file.test.ts | `.cortex/telemetry.json` 真实数据 + `[telemetry]` 前缀日志 | S2-5 | unit |
| telemetry/tests/alert-engine.test.ts | 至少 1 条规则有真实数据源可触发 | S2-6 | contract |
| telemetry/tests/audit-trail.test.ts + engine/tests/integration/audit-bootstrap.test.ts | audit.jsonl 出现 2+ 类 record* 条目（非仅 degradation） | S2-7/S2-8 | unit |
| notification/tests/persistence.test.ts | 持久化写入 / loadPending / markAcked 后不再 pending（ack 落盘） | S2-10/S2-12 | unit |
| server/tests/notification-bridge.test.ts | WS 订阅消费端 / ack 回路：应答 → 回执 + markAcked | S2-11/S2-12 | unit |
| engine/tests/manual/e2e/governance-llm-verify.ts（3 场景） | HardGate 拦截幻觉 / ZeroToken 降级语义 / DecisionBridge 回路 + fail-closed | S2-13 | manual（CI 跳过） |

## 门禁五段全量回归

命令：`npx tsx scripts/ci-gate.ts --coverage` → **CI_GATE_EXIT=0**

| 段 | 结果 |
|---|---|
| 1/5 tsc -b 全量增量编译 | ✅ 类型检查通过 |
| 2/5 eslint packages/**/src（--max-warnings 0） | ✅ lint 通过 |
| 3/5 critical-fixes 混沌校验（L5） | ✅ 混沌校验通过 |
| 4/5 vitest 按包串行（unit+verify+contract，259 文件） | ✅ **3844/3849 passed**（25 个 llm/integration/e2e/manual 跳过）；engine 960/961（1 既有 skipped）、memory 226/226、notification 76/76、server 29/29 |
| 5/5 覆盖率阈值 | ✅ 14 包全部达标（engine 70.81% / notification 91.44% / telemetry 70.25% / governance 48.44% 等） |

> 回归途中抓到真 bug（Windows 句柄残留）：`memory-persist-restart.test.ts` T4 删除临时目录报 `EPERM`。根因：S2-10 注入的 `NotificationPersistence` 在 `wsRoot/.cortex/notifications.db` 持有 better-sqlite3 连接，`NotificationPersistence` 无 close()、bootstrap shutdown 无任何通知层清理——仅 `memory.close()` 无法释放该句柄，Windows 下目录删除失败。修复（3 文件）：
> 1. `notification/src/persistence.ts`：`SqliteDb` 接口补 `close(): void`；`NotificationPersistence` 新增幂等 `close()`（db.close + 置空 + available=false）
> 2. `notification/src/notification-pipe.ts`：新增 `close()` 转发至 persistence
> 3. `engine/src/bootstrap/bootstrap-engine.ts`：shutdown 链路补 `notificationRuntime.stop()` + `notificationPipe.close()`（auditTrail.flush 之后、orchestrator.shutdown 之前）
>
> 修复后 T4 通过，engine 包 961 全绿（除 1 既有 skipped）。

## 专项验证：治理层真实 LLM（S2-13）

- 脚本：`packages/engine/tests/manual/e2e/governance-llm-verify.ts`，运行 `set CORTEX_ENABLE_LLM=1; npx tsx ...`
- 结果：**3/3 ALL PASSED**，归档 `test-output/governance-llm-verify/result-*.json`
- 详细结果与激活决策见 `docs/auditing/refactor-phase2-governance-llm-verify-2026-06-20.md`
- 决策摘要：三个治理组件（HardVerificationGate / ZeroTokenValidator / DecisionGateBridge）经真实 LLM 验证**全部行为符合设计**——具备激活条件，按用户决策不投入激活工程，emit 保持现状，待触发源（GovernanceEventEmitter 生产者）决策

## 验收标准逐条证据（spec §2）

### 2.1 记忆层

| # | 验收标准 | 证据 | 状态 |
|---|---|---|---|
| 1 | `.cortex/memory.db` 生成；重启后记忆可读回（写→重启→读集成测试） | memory-persist-restart.test.ts T1/T2/T3/T4 全过（含 SQLite 魔数头 16 字节验证、默认路径回退） | ✅ |
| 2 | FTS5 检索测试通过（含中文检索） | sqlite-backend.test.ts「FTS5 全文检索」组 +「中文检索命中（CJK 连续字符）」用例；memory 包 226/226 | ✅ |
| 3 | RAG 降级时调用方收到显式错误（非假 id），telemetry 有降级记录 | S2-3 守护测试（显式错误 + 降级 telemetry 断言） | ✅ |
| 4 | 内存模式仍可用（NOOP 后端注入不受影响） | sqlite-backend.test.ts 内存模式回归组 + InMemoryMemoryStore.test.ts 全过 | ✅ |
| 5 | 门禁全绿 + memory 包测试全过 | CI_GATE_EXIT=0；memory 226/226 | ✅ |

### 2.2 观测层

| # | 验收标准 | 证据 | 状态 |
|---|---|---|---|
| 1 | 运行后 `.cortex/telemetry.json` 有真实数据；`[telemetry]` 前缀日志落盘 | S2-5 FileCollector 默认启用 + telemetry 落盘集成测试；门禁输出可见 `[telemetry] ...` 真实记录 | ✅ |
| 2 | alert 至少 1 条规则有真实数据源可触发 | S2-6 诚实收敛 + alert contract 测试（真实指标点可触发断言） | ✅ |
| 3 | audit.jsonl 出现 2+ 类 record* 条目 | S2-7 record* 四方法接真实调用点 + audit 多类记录测试 | ✅ |
| 4 | doctor（或脚本）能查询 audit/telemetry | S2-8 queryBySpan 接读取端 | ✅ |
| 5 | 门禁全绿 | CI_GATE_EXIT=0 | ✅ |

### 2.3 通知层

| # | 验收标准 | 证据 | 状态 |
|---|---|---|---|
| 1 | Urgent/Important 通知重启后仍在（持久化证据） | notification/tests/persistence.test.ts（写入→loadPending→markAcked 回路落盘）；S2-10 注入路径 `wsRoot/.cortex/notifications.db` | ✅ |
| 2 | 消费端能收到通知（集成测试断言） | server/tests/notification-bridge.test.ts（WS 订阅 + ack 回路回执断言） | ✅ |
| 3 | 门禁全绿 | CI_GATE_EXIT=0 | ✅ |

### 2.4 治理层

| # | 验收标准 | 证据 | 状态 |
|---|---|---|---|
| 1 | 3 条治理真实 LLM 验证用例可运行（CORTEX_ENABLE_LLM=1），结果归档 | governance-llm-verify.ts 3/3 PASS；归档 test-output/governance-llm-verify/ + governance-llm-verify 文档 | ✅ |
| 2 | 验证结论决定激活 or 收敛（文档记录决策） | 「具备激活条件，emit 保持现状」——三组件行为全部符合设计，无收敛必要 | ✅ |
| 3 | 治理层不投入激活工程（emit 保持现状） | 零 emit 生产点改动；仅验证 + 文档 | ✅ |

## 遗留项

| # | 未闭合项 | 原因 | 后续计划 |
|---|---|---|---|
| 1 | 治理层 emit 保持现状，触发源（GovernanceEventEmitter 生产者）未接入 | 用户决策：治理层不投入激活工程 | 触发源决策后再接激活工程（届时需补 ConfirmGate.request() 预注册调用方） |
| 2 | DecisionGateBridge 的 request() 契约目前无调用方 | 治理层零生产者 | 已由缺口对照确认 fail-closed 行为；激活时补注册 |
| 3 | sharp/ONNX embedding 预加载失败（测试环境） | sharp@0.32.6 原生模块缺失（win32-x64 .node 未安装） | 降级路径生效不阻断；需要时 `npm install --platform=win32 --arch=x64 sharp` |
| 4 | phase1 遗留 6 项（loop-strategy-registry 假接线 / shared 契约 / doctor gitignore / design-tokens 0 测试 / v4 审计脚本沉淀 / @layer 覆盖率） | 阶段边界外 | 阶段 3 计划 |
| 5 | 本阶段改动未提交（git） | 待用户确认提交时机 | 按惯例每阶段独立 commit（pre-commit 门禁通过） |

## 阶段 2 提交序列

```
<待填——本阶段改动尚未提交>
```
