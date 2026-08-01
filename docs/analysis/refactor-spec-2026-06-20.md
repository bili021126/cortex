# Cortex 重整化 Spec（2026-06-20）

> 前置文档：[行为契约漂移全景调研](refactor-drift-survey-2026-06-20.md) → [重整化蓝图](refactor-blueprint-2026-06-20.md)
> 用户硬性要求：**不半途而废**——每阶段必须有完整验收标准与测试流程归档；庞大测试体系（273 文件 / 3776 用例）的定位是**兜底**：重构中守护行为不回归，重构后验证行为真实生效。

## 0. 目标与总纲

### 0.1 重整目标
把"宣称架构"与"活架构"统一：五大空转层（CLI 旁路 / 治理空转 / 观测只进不出 / 通知只入不出 / 记忆 SQLite 未落地）逐层复位，消灭双源与假迁移，建防再漂移机制。

### 0.2 总纲（每阶段强制四步，缺一不可）
1. **基线**：跑门禁五段 + 相关包测试，记录基线结果（归档）
2. **重构**：按本 spec 改动清单执行
3. **全量回归**：门禁五段全绿 + 专项验证（零消费审计对比 / 运行时证据）
4. **归档**：验收记录写入 `docs/auditing/` 与测试流程文档

### 0.3 兜底体系（全程不破）
- **门禁五段**：tsc → eslint --max-warnings 0 → critical-fixes → vitest（3776 用例）→ coverage（--coverage）
- **零消费审计**：v4 扫描（DEAD/LEAK/PUB_API_UNCONSUMED）
- **契约测试**：layer-contract / event-payload-map / cross-pkg 系列
- 任何阶段提交前必须 pre-commit 门禁通过；测试红即停，先修测试再前进

---

## 1. 阶段 1：真相复位（低风险，先做）

### 1.1 改动清单
| # | 改动 | 文件 |
|---|---|---|
| S1-1 | shared/toolkit.ts 三 enum + toReversibilityClass 删除 → config 单源，4 个消费方改 import | shared/src/toolkit.ts、config/src/vocabularies/tool-enums.ts、消费方 |
| S1-2 | 死依赖 4 处声明删除（doctor→tools、memory→config、server→memory-store、server→tools） | 4 个 package.json |
| S1-3 | design-tokens 孤儿包决策：接入 desktop 主题或删除（决策点） | design-tokens/、desktop/ |
| S1-4 | @cortex/factory 幽灵注释清除（bootstrap/factory/bootstrap.ts 改为真实包内路径说明） | engine/src/bootstrap/factory/bootstrap.ts |
| S1-5 | daemon 健康端点去硬编码：router.ts:144-161 接真实 HealthCollector.snapshot() | server/src/http/router.ts |
| S1-6 | WS 未知命令 default: break 加日志（不静默） | server/src/daemon.ts:309-330 |
| S1-7 | 文档同步：CLI 现状声明（交互层基底定位）、PACKAGE_POSITIONING.md 三处依赖列修正（desktop/memory-store/llm）、五流六层 @layer 覆盖率如实标注（24/75） | PACKAGE_POSITIONING.md、docs/core/*、docs/analysis/* |
| S1-8 | memory-store.ts:499 @see FIND-002 误报标记清理（可选） | memory-store/src/memory-store.ts |
| S1-9 | A 类迁移声明剩余 22 条逐条核对，产出核对表（附录 A） | 多文件（核对为主，改动视结果） |

### 1.2 验收标准（全部满足才进入阶段 2）
1. `grep ToolCategory\|ReversibilityLevel\|TrustLevel` 在 shared/src 零命中；config/vocabularies/tool-enums.ts 为唯一定义源
2. 4 处死依赖声明删除后 `pnpm install --lockfile-only` 通过；doctor/memory/server 源码零 `@cortex/tools|config|memory-store` import
3. design-tokens 决策落地：接 desktop 主题（有真实 import）或删除（包目录移除 + workspace 配置清理）
4. daemon `/api/v1/daemon/health` 返回真实 snapshot（含真实 degradations 计数），新增测试断言非硬编码
5. WS 未知命令日志出现于 console-bridge 链路（ErrorReported）
6. 门禁五段全绿；v4 零消费审计：DEAD/LEAK/PUB_API 数字对比归档（预期 DEAD 40 下降、shared LEAK 下降）
7. 测试流程归档完成（阶段 1 归档文档）

### 1.3 守护测试
- 现有：layer-contract.test.ts（依赖契约）、event-payload-map.test.ts、全部 3776 用例
- 新增：`server/tests/daemon-health.test.ts`（健康端点真实性）、`shared/tests/toolkit-single-source.test.ts`（config 单源断言：shared 无 enum 定义）

---

## 2. 阶段 2：激活空转层（中风险）

### 2.1 记忆层（优先）
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S2-1 | 按 memory/DESIGN.md 落地 `SqliteStorageBackend`（实现 MemoryStoreBackend：WAL、FTS5 全文检索、防抖刷写、重试），含 SqliteMigrations 独立迁移定义 | memory/src/implementations/sqlite/ |
| S2-2 | bootstrap 选 SQLite 后端：memory-store.plugin.ts 默认 `.cortex/memory.db`，`dbPath` 显式传入 | engine/src/plugin/memory-store.plugin.ts |
| S2-3 | RAG 降级显式化：ragReady=false 时不再返回假 id/空数组，抛显式错误 + 降级状态入 telemetry | engine/src/bootstrap/init-memory.ts |
| S2-4 | 持久化写入失败不静默：MemoryPersistFailed 事件接 NotificationRuntime（半开→闭环） | memory 相关 emit 点 |

**验收标准**：
1. `.cortex/memory.db` 文件生成；重启进程后记忆可读回（真实持久化证据：写→重启→读 集成测试）
2. FTS5 检索测试通过（含中文检索）
3. RAG 降级时：调用方收到显式错误（非假 id），telemetry 有降级记录
4. 内存模式仍可用（测试注入 NOOP 后端不受影响）
5. 门禁全绿 + memory 包测试全过

**守护测试**：新增 `memory/tests/sqlite-backend.test.ts`（CRUD/WAL/迁移/FTS5）、`engine/tests/integration/memory-persist-restart.test.ts`（写→重启→读）、RAG 降级显式化测试

### 2.2 观测层
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S2-5 | `setTelemetry` 接线：bootstrap 调用 setTelemetry(FileCollector)（默认启用，CORTEX_TELEMETRY_FILE 可关） | engine/src/bootstrap/bootstrap-engine.ts |
| S2-6 | AlertEngine 数据源修正：agent_pool.idle_rate 改走 telemetry 指标点；context.inflate/llm.request_body_size 接真实生产者或从 PRESET_ALERT_RULES 移除（诚实收敛） | scheduler/telemetry/config |
| S2-7 | AuditTrail record* 四方法接真实调用点（config override / 违规 / 域过滤） | engine/config 相关 |
| S2-8 | AuditTrail queryBySpan 接读取端（doctor 命令或脚本） | doctor/scripts |
| S2-9 | daemon 健康端点（阶段 1 已接）→ 数据源补齐 | server |

**验收标准**：
1. 运行引擎后 `.cortex/telemetry.json` 有真实数据；`[telemetry]` 前缀日志落盘
2. alert 规则至少 1 条有真实数据源可触发（构造触发场景，测试断言 alert 面板有告警）
3. audit.jsonl 出现 2+ 类 record* 条目（非仅 degradation）
4. doctor（或脚本）能查询 audit/telemetry
5. 门禁全绿

**守护测试**：新增 telemetry 落盘集成测试、alert 数据源 contract 测试、audit 多类记录测试

### 2.3 通知层
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S2-10 | bootstrap 注入 NotificationPersistence（磁盘持久化，复用 notification/persistence.ts 动态 import 模式） | engine/src/bootstrap/bootstrap-engine.ts |
| S2-11 | 消费端接线：Urgent/Important 落地可查（至少：日志 + 文件）；desktop/webui 订阅通道（按 UI 端进展） | notification 消费端 |
| S2-12 | ack 回路：重要通知经 WS 客户端应答（gate 相关） | server/notification |

**验收标准**：
1. Urgent/Important 通知重启后仍在（持久化证据）
2. 消费端能收到通知（集成测试断言）
3. 门禁全绿

**守护测试**：通知持久化集成测试、消费端订阅测试

### 2.4 治理层（不激活，验证先行）
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S2-13 | 治理组件真实 LLM 验证环境：manual e2e 补治理验证用例（HardVerificationGate / ZeroTokenValidator / DecisionGateBridge 各 1 条真实 LLM 场景） | engine/tests/manual/ |
| S2-14 | 治理状态文档化：docs 标注"待真实 LLM 验证后激活" | docs/ |

**验收标准**：
1. 3 条治理真实 LLM 验证用例可运行（CORTEX_ENABLE_LLM=1 环境），结果归档
2. 验证结论决定激活 or 收敛（文档记录决策）
3. 治理层不投入激活工程（emit 保持现状）

---

## 3. 阶段 3：协议与入口统一（需阶段 1-2 稳定）

### 3.1 CLI 交互层基底化
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S3-1 | query-loop 直连 LlmAdapter 改走 engine 正式入口（streamChat/chat-loop） | cli/src/tui/query-loop.ts |
| S3-2 | 工具执行接 ConfirmGate/BoundaryGuard（消除 toolkit.execute 直调旁路） | cli/src/tui/engine-bridge.ts |
| S3-3 | CLI run 命令接 MetaAgent 规划（消除单节点绕过） | cli/src/commands/run.ts |
| S3-4 | 交互原语下沉：对话/工具/规划统一入口，desktop/tui/webui 消费同一底座 | cli/src/ |

**验收标准**：
1. TUI 对话/工具调用走 engine 链路（集成测试断言：记忆写入、观测记录、权限门经过）
2. CLI run 产生规划轨迹（audit 有 plan 记录）
3. desktop/webui 通过 client→server→engine 链不受影响（回归）
4. 门禁全绿

### 3.2 协议单契约
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S3-5 | server 落地 protocol 契约（OnCommandFn 替换为 protocol WSClientCommand 驱动 + 运行时校验）或 protocol 收敛为 server 内部类型（二选一，决策点，推荐前者） | server/src/ws/gateway.ts、daemon.ts、protocol |

**验收标准**：契约单一来源；WS 未知命令有日志（阶段 1 已做）+ 类型校验；protocol 未消费 API 显著下降

### 3.3 API 收敛与机制门禁
**改动**：
| # | 改动 | 文件 |
|---|---|---|
| S3-6 | 782 未消费 API 按包收敛（cli/config/memory/protocol 优先），价值门槛 >30% 需解释 | 多包 |
| S3-7 | 0 测试包补测试：desktop、design-tokens、server | 三包 |
| S3-8 | cyrene RAG 能力层收敛：file-ingest/worldbook/reranker 接真实场景（昔涟记忆注入）或内部化 | memory/src/cyrene/rag/ |
| S3-9 | layer-contract 扩展：src import 扫描（未声明隐式依赖）+ includeDev=true | packages/tools/src/layer-contract.ts + test |
| S3-10 | @layer 六层机制化：engine/src 全标注覆盖率门禁 + 跨层 import 校验 | engine/src + tools |
| S3-11 | 迁移完成态扫描器：`已迁至/已移至` 注释 + 原定义残留 = 报错 | tools/scripts |

**验收标准**：
1. 未消费 API 782 → 目标 <300（收敛过半），每包未消费率 <30% 或有解释归档
2. desktop/design-tokens/server 测试覆盖率 >50%
3. layer-contract 测试能检出：未声明隐式依赖、devDeps 分层违规
4. @layer 覆盖率 100%（engine/src 全部标注）+ 跨层 import 违规 = 门禁红
5. 迁移扫描器上线：假迁移（注释声明 + 定义残留）被检出
6. 门禁全绿

---

## 4. 测试流程归档规范（全程强制）

### 4.1 每阶段四步归档
```
docs/auditing/refactor-<阶段>-<日期>.md
├── 基线记录（门禁五段结果 + 零消费审计数字）
├── 改动清单（对照本 spec 勾选）
├── 新增测试清单（文件 × 断言 × 守护的改动项）
├── 验收标准逐条证据（命令输出 / 测试结果 / 运行时证据）
└── 遗留项（未闭合项 + 原因 + 后续计划）
```

### 4.2 兜底纪律
1. 测试红即停：任何重构导致既有测试失败，先修复或评估（评估需记录），不绕过
2. 每阶段提交独立 commit（pre-commit 门禁通过）
3. 零消费审计每阶段对比归档（v4 工具）
4. 新增测试必须带 @ci 标签（unit/contract/integration/verify），纳入门禁默认执行

### 4.3 归档位置
- 调研：docs/analysis/refactor-drift-survey-2026-06-20.md ✅
- 蓝图：docs/analysis/refactor-blueprint-2026-06-20.md ✅
- 本 spec：docs/analysis/refactor-spec-2026-06-20.md ✅
- 阶段验收：docs/auditing/refactor-阶段-N-<日期>.md

---

## 5. 风险与决策记录

| 风险 | 缓解 |
|---|---|
| SQLite 后端落地引入原生依赖构建问题 | better-sqlite3 已在 engine 依赖；memory 包加依赖时用动态 import + 降级（notification 已有先例）；CI 环境验证 |
| 阶段 2 激活链路破坏既有闭环 | 每条激活项先加 contract 测试再改代码（测试先行） |
| 782 收敛误删有用 API | 收敛按"无消费 ≥2 轮 + 无测试引用"双条件；删除前归档 |
| 治理层真实 LLM 验证成本 | 3 条用例聚焦最核心组件，验证环境复用 manual e2e 体系 |
| 重构战线过长半途而废 | 三阶段各自独立验收；每阶段完成即归档闭环；阶段间可暂停但不留半成品 |

**决策点（实施中需拍板）**：S1-3 design-tokens 收编 or 删除；S3-5 protocol 落地 or 收敛（推荐前者）。
