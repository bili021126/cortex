# Cortex 重整化蓝图（2026-06-20）

> 前置调研：[重构前调研：行为契约漂移全景](refactor-drift-survey-2026-06-20.md)
> 本蓝图基于三轮全方面调研：漂移注释扫描（633 信号）+ 包依赖/分层（Agent A）+ 运行时主链路（Agent B）+ 事件/治理/观测接线矩阵（Agent C）
> **勘误（2026-06-20 用户指正）**：Agent B 报告“全仓无 sqlite 引用”有误——better-sqlite3 依赖声明于 engine/package.json:42，memory/DESIGN.md 完整规划 SqliteStorageBackend，通知包 persistence.ts 已用动态 import 模式。修正见 L5。
> 原则：**先还原真相，再决定每条链路是“激活”还是“修正宣称”，最后建防再漂移机制**

## 〇、全景结论：五大空转层 + 三类漂移

**宣称架构与活架构系统性分裂**。不是个别 bug，而是五层系统性空转：

| 层 | 宣称 | 实际（证据） | 定性 |
|---|---|---|---|
| **CLI 层** | CLI/TUI 是主入口 | `cli/main.ts:328-340` 默认 `process.exit(0)`——CLI/TUI 已废弃；活路径是 daemon（server 内嵌 engine）或 `CORTEX_ENABLE_CLI=1` | 已废弃未文档化 |
| **治理层** | 修宪/合规/审计/圆桌事件运行 | GovernanceEventEmitter 零生产者；GovernancePlugin 注册但不在插件清单；runPipeline 无生产调用——连带 HardVerificationGate/ZeroTokenValidator/DecisionGateBridge **全部空转** | 声明先行空转层 |
| **观测层** | 遥测上报/告警/审计 | `setTelemetry` 零调用 → 永远 ConsoleCollector；telemetry.json 无人读；AlertEngine 规则无数据源（恒查空）；AuditTrail 4 类 record* 死方法 | 数据只进不出 |
| **通知层** | 四通道推送 | NotificationPipe 生产端接了，**消费端零订阅**（on/onAll/ack 仅测试命中）；persistence 未注入 → Urgent/Important 持久化失效 | 只入不出 |
| **记忆层** | SQLite 持久化/语义检索（better-sqlite3 依赖已声明、DESIGN.md 规划 SqliteStorageBackend、插件注释宣称 SQLite 建表） | `init(dbPath)` 委托 InMemoryMemoryStore 的 **NOOP 后端（dbPath 静默忽略）**；SqliteStorageBackend 未落地；仅 FileBasedMemoryStore（JSON 文件）为真实持久化实现 | 宣称 SQLite 底层，实现未落地 |

**三类漂移**（沿用前调研）：假迁移双源（shared/toolkit.ts 三 enum）、新旧双入口（meta-agent re-export + fallback 活路径）、包建了价值悬空（cyrene RAG 7 能力文件、protocol 双契约、design-tokens 孤儿包、desktop/design-tokens 零测试）。

**好消息**：包级依赖图干净（DAG 无环、无 src 越界 import、无未声明隐式依赖）——物理隔离守住；5 条链路已闭环（ErrorReported 哨兵链、AgentBoundaryViolation 重规划链、NodeComplete 技能链、SchedulerLoopCrashed 告警链、DegradationBoundary 审计链）。

## 一、活架构真相（修正后的分层图）

```
[已废弃] CLI/TUI ──(CORTEX_ENABLE_CLI=1)──┐
                                          ▼
[活] desktop ──client──▶ server(daemon, 3210) ──engine──▶ Scheduler(engine 内建)
                              ▲ 契约：自有 OnCommandFn（protocol 仅 1 个 type import）
                              │ 健康端点：硬编码零（router.ts:144-161）
                              ▼
                scheduler 包（仅剩抽象+步骤，PipelineModel/ExecuteStep 死代码）
                meta-agent（场景路由；ContextManager 注入失败 → 旧版 tag 路由 fallback）
                ReActLoopStep → react-loop → Toolkit（decompose/jury 策略选中但恒走 react）
                memory-bridge → MemoryManager → [RAG 入口已接 | 降级空实现]
                MemoryStore(适配器) → InMemoryMemoryStore（空操作）
                telemetry：ConsoleCollector（无出口）
                notification：四通道只入不出
                governance：emit×4 零调用（整层空转）
```

## 二、每层决策：激活 or 修正宣称

### L1 入口层——CLI 作交互层基底（用户决策）
- **用户决策**：CLI 是交互层基底，desktop/tui/webui 是高层——CLI 不是废弃或复活二选一，而是**交互能力底座**，各 UI 端建在其上
- **重构方向**：① query-loop 直连 LlmAdapter 改为经 engine 链路（streamChat 等正式入口）；② 工具执行接 ConfirmGate/BoundaryGuard（消除旁路）；③ CLI run 命令接 MetaAgent 规划（消除绕过）；④ 交互原语（流式对话/工具调用/规划）下沉 CLI，desktop/tui/webui 消费同一底座

### L2 治理层——暂不激活，真实 LLM 验证先行（用户决策）
- **用户决策**：先不激活——治理组件（硬验证门/零 token 校验/合规）的测试需要跑**真实 LLM 调用**才知道是否有效
- **重构方向**：① 不投入激活工程；② 先建治理组件真实 LLM 验证环境（manual e2e 体系已存在，补治理组件验证用例）；③ 验证结论出来后再决定激活方式；④ 期间治理事件/组件保持现状，但文档标注“待真实 LLM 验证后激活”（防止“看似运行”误判）

### L3 观测层——激活
- `setTelemetry` 接线 → FileCollector（落盘）+ 读取端（doctor/scripts 查询）
- AlertEngine 数据源：agent_pool.idle_rate 改走 console.log 拦截路径或直接记录指标点；context.inflate/llm.request_body_size 接真实生产者或从预置规则移除（诚实收敛）
- AuditTrail：record* 四方法接真实调用点（config override/违规/域过滤）；queryBySpan 接读取端（doctor/审计脚本）
- HealthCollector：daemon 健康端点改真实 snapshot（router.ts:144-161 硬编码删除）

### L4 通知层——激活
- bootstrap 注入 NotificationPersistence（磁盘持久化）
- 消费端接线：desktop/webui/CLI 订阅四通道（或至少 Urgent/Important 落地可查）
- ack 回路：重要通知需确认的，接 WS 客户端应答

### L5 记忆层——落地 SQLite 后端（用户决策）
- **用户决策**：底层是 SQLite。已核实：better-sqlite3 依赖声明于 engine/package.json:42；memory/DESIGN.md 已规划 `SqliteStorageBackend`（IStorageBackend 后端抽象 + SqliteMigrations）；memory-store.plugin.ts 注释宣称 SQLite 建表；notification/persistence.ts 已示范动态 import 模式
- **重构方向**：① 按 memory/DESIGN.md 规划落地 `SqliteStorageBackend`（WAL、FTS5、防抖刷写），挂到 `MemoryStoreBackend` 接口；② bootstrap 选 SQLite 后端（默认 `.cortex/memory.db`）；③ RAG 降级路径：失败时显式错误返回（不返回假 id），降级状态入 telemetry；④ cyrene RAG 能力层：file-ingest/worldbook/reranker 要么接真实使用场景（昔涟记忆注入管线），要么从公共 API 收敛为内部实现

### L6 协议层——单契约
- server 落地 protocol 契约（OnCommandFn 替换为 protocol WSClientCommand 驱动）或 protocol 包收敛为 server 内部类型——二选一，消灭双源

### L7 双源与死代码——清零
- shared/toolkit.ts 三 enum 删除 → config 单源（4 个消费方改 import）
- 死依赖 4 处（doctor→tools、memory→config、server→memory-store、server→tools）删除声明
- design-tokens 孤儿包：收编（接入 desktop 主题）或删除
- @cortex/factory 幽灵注释清除
- 40 死代码 + 782 未消费 API 按包收敛（价值门槛）

### L8 分层机制化——防再漂移
- layer-contract.test.ts 扩展：src import 扫描（未声明隐式依赖检测）+ includeDev=true
- @layer 六层：标注覆盖率门禁（engine/src 全标注）+ 跨层 import 校验（把注释变机制）
- 迁移完成态扫描器：`已迁至/已移至` 注释 + 原定义残留 = 报错
- PACKAGE_POSITIONING.md 三处依赖列漂移修正（desktop/memory-store/llm）+ 文档-代码自动核对脚本

## 三、实施节奏（三阶段，每阶段独立可验证）

### 阶段 1：真相复位（低风险，1-2 轮）✅ 已完成（2026-06-20）
1. ✅ shared 双源清零（41 消费方改 import + 守护测试）
2. ✅ 死依赖 + 孤儿包 + 幽灵注释清理（doctor/memory/server 死依赖删除、design-tokens 收编、@cortex/factory 幽灵注释清除）
3. ✅ daemon 健康端点接真实 HealthCollector（+ WS 未知命令日志）
4. ✅ 文档同步：PACKAGE_POSITIONING 三处依赖列修正、五流六层 @layer 覆盖率如实标注（74 文件仅 24 标注）
5. ✅ 验证：门禁五段 + v4 零消费审计对比（见 docs/auditing/refactor-phase1-2026-06-20.md）

### 阶段 2：激活空转层（中风险，2-3 轮）
6. 记忆持久化：FileBasedMemoryStore 接线 + RAG 降级显式化
7. 观测层：setTelemetry → FileCollector + AlertEngine 数据源修正 + AuditTrail record* 接线
8. 通知层：persistence 注入 + 消费端（先 Urgent/Important 落地可查）
9. 治理层：触发源决策后激活（含 DecisionGateBridge payload 修复）
10. 验证：每条链路新增 contract/integration 测试 + 运行时证据（真实触发一次）

### 阶段 3：协议与入口统一（需阶段 1-2 稳定）
11. protocol 单契约（决策后执行）
12. CLI/TUI 去留执行（用户决策后）
13. cyrene RAG 能力层收敛（接真实场景或内部化）
14. 782 未消费 API 按包收敛 + 0 测试包补测试（desktop/design-tokens/server）
15. 分层机制化门禁上线（@layer 校验 + 迁移扫描器）

## 四、用户决策记录（2026-06-20 已拍板）

1. **CLI/TUI**：CLI 作交互层基底，desktop/tui/webui 作高层（非废弃/复活二选一）
2. **治理层**：暂不激活，治理组件测试需跑真实 LLM 调用验证有效性后再定
3. **记忆后端**：底层是 SQLite（设计意图确认）；实现未落地，需按 DESIGN.md 落地 SqliteStorageBackend
