# config 重整清单（核心主体稳定 · 第一步）

> 日期：2026-06-20 ｜ 依据：project-full-panorama-2026-06-20.md（全景调研）+ chaos-audit-report.md
> 原则：先真相源归一 → 再消灭双源 → 补公差 → 处置空转 → 立读取门面 → 最后清理。端侧（cli/desktop/webui/tui）不在范围。

## 阶段 A：真相源归一（最尖锐，先做）

### A1. engine.json 数值冲突归一（负债 3）
| 语义 | constants | defaults.ts | engine.json | 处置 |
|---|---|---|---|---|
| maxTotalReplans | 10 | 10 | **3** | 定 10（defaults 与 constants 一致），engine.json 改 10 |
| executeAllTimeoutMs | 300_000 | **600_000** | 600_000 | 定 600_000（defaults 与 engine.json 一致），constants 改 600_000 |
| defaultMaxLoops | — | 32 | **64** | 死配置——engine.json 无消费方，删除该键（defaults 32 为准） |

- 涉及：packages/config/src/data/engine.json、constants/scheduler-params.ts、defaults.ts
- 验收：三处数值一致；grep 确认 defaultMaxLoops 无消费后删除
- 守护测试：config/tests 新增"engine.json 与 constants/defaults 数值一致性"断言

### A2. 超时值冲突修复（行为影响，优先）
- `scheduling-implementations.ts:560` 兜底 300s vs defaults.ts:26 生产 600s——config 未注入时全局超时减半
- 处置：兜底引用 config 常量（直读 `EXECUTE_ALL_TIMEOUT_MS`），消灭本地兜底
- 验收：兜底路径与生产路径同值

## 阶段 B：消灭双源

### B1. engine 平行类型体系收敛（负债 1）
- `engine/src/bootstrap/factory/types.ts` 15+ 接口（AgentManifest/EventRoutingConfig/CommitteeRule/SelfExaminationConfig/CrossVerificationConfig/SeedMemoriesConfig/GovernancePipelineConfig/CortexCognitionConfig/CortexDocsConfig 等）与 `@cortex/config/interfaces` 语义平行
- 处置：逐接口对照——config 已有时删除 engine 副本改 import；config 缺时补进 config 后 engine 改 import
- 涉及：engine/src/bootstrap/factory/types.ts、factory/loaders/{agents,cognition,docs}.loader.ts、config/src/interfaces/
- 验收：engine/src 无自建平行类型（grep 实证）；loader 消费 config interfaces

### B2. agents 旧域 vs agentManifests 新域双轨（负债 2）
- agents.json 标 @deprecated 但 engine 主路径仍消费；agent-manifests.json 仅 server 消费
- 处置（决策点）：engine 主路径切 agentManifests 域（agent-manifests.json 有 schema，更完整）→ 旧 agents 域退役；或明确旧域为唯一真相源、新域收敛
- 涉及：engine/src/bootstrap/factory/loaders/agents.loader.ts、config/src/loader.ts、store.ts
- 验收：单一 agent 域被 engine 与 server 共同消费

### B3. isTestEnv 三份重复实现
- config/src/constants/index.ts:211（宣称单源）vs engine/src/test-env.ts（死代码，零导入）vs scheduler/src/utils/internal.ts:17
- 处置：删 engine/src/test-env.ts 与 scheduler/utils/internal.ts 的本地实现，统一 import config
- 验收：全仓仅 config 一份定义

### B4. 信任分公式双实现
- scheduler/src/core/confirm-gate.ts:16-24 与 engine/src/agents/confirm-gate-agent.ts:29-38 逐字相同，注释自认"镜像"
- 处置（决策点）：公式上移 config（constants/confirm-gate.ts 单源）或下移 engine（scheduler 改 import）——按分层：confirm-gate 属治理语义，建议 config 或 engine 单源，scheduler 消费
- 验收：一份定义，两处 import

### B5. ConfigDomain 同名双定义
- loader.ts:82（name/fileName/required/dataKey/schema/description）vs registry.ts:17（key/schema/defaults/envPrefix）
- 处置：统一为一个 ConfigDomain（保留两套字段语义并集或拆名），loader 与 registry 共用
- 验收：单一 ConfigDomain 类型

## 阶段 C：公差补齐（负债 5）

### C1. engine 消费的 12 域补 JSON Schema
- 现状：agents/engine/engine-plugins/roundtable/search-providers/mcp-servers/self-examination/cross-verification/seed-memories/governance-pipeline/cognition/docs 无 schema
- 处置：按 schemas/ 既有 6 域模式（L1-L4 标注 + 字段类型 + validators.ts 对标 Zod parse）分批补齐；先补 engine 主路径 5 域（agents/engine/cognition/docs/event-routing 已有）
- 验收：18 域全有 schema；loader 加载时校验生效

### C2. 统一校验体系
- engine 各 loader 自建 `_validateStructure` 与 config `validateDomainWithSchema` 互不调用
- 处置：engine loader 改调 config 校验（validateDomainWithSchema），删除自建
- 验收：单一校验入口

## 阶段 D：空转处置（负债 4）

### D1. 4 个空转配置域
- crossVerification/governancePipeline/seedMemories/selfExamination——加载后 engine 运行时 0 读取
- 处置（决策点）：接真实消费方（若属治理/记忆管线后续项）或从 loader 默认加载移除（按需加载）
- 验收：无"加载即空转"的域（要么被读、要么不加载）

### D2. ConfigRegistry 激活
- registry 仅 1 域（context-policies）1 生产方；约 40 处直读
- 处置：registry 注册全部 18 域（defaults 挂上）；registry.get 成为读取门面（阶段 E 配合）
- 验收：registry.list() = 18 域

## 阶段 E：读取门面（40 处直读 → 统一入口）

### E1. 直读分批收敛
- engine 24 文件 + scheduler 14 文件 + 其余——分批改 import 为 registry/resolveConfig 读取
- 处置：先高价值 5 处（DEFAULT_ENGINE_CONFIG 直读 ×7、TRUST_*、GOVERNANCE_EVENT_ROUTING、PRESET_ALERT_RULES），再批量
- 验收：config 读取统一走门面；门禁（scripts/audit-unconsumed.ts 扩展）检出新增直读

## 阶段 F：清理

### F1. 注释宣称修正（4 处）
- memory/index.ts:12（宣称依赖 config，实际无）、llm/index.ts:6-7（宣称仅 shared，实际 resilience/telemetry）、memory-store/memory-store.ts:2（归属残留）、isTestEnv 单源宣称
- 处置：注释与事实对齐（或依赖补齐）

### F2. server 隐式依赖
- server/engine-host.ts:41、notification-bridge.ts:9 import @cortex/notification 未在 package.json 声明
- 处置：server/package.json 补 @cortex/notification

### F3. 死代码/空转清理
- engine/test-env.ts（B3 已含）、loadEngineDefaults 零消费（接线 or 收敛）、cognitive-engine @frozen 仍导出（memory-store index 移除 or 标注）、engine-plugins.json 绕过 loader 直读（改走 loader）

### F4. ObservabilityInfo 兑现
- protocol/rest/health.ts:20-35 类型已定义，server handleDaemonHealth 不返回 observability
- 处置：router.ts 补 observability 字段（telemetryFile/telemetryEntries/auditEntries/memoryPersisted）
- 验收：daemon/health 返回 observability；S2-9 数据源补齐闭环

## 执行顺序与验收总纲

A1 → A2 → B1 → B2（决策点）→ B3 → B4（决策点）→ B5 → C1 → C2 → D1（决策点）→ D2 → E1 → F1-F4

- 每条激活项先加守护测试（@ci 标签）再改代码
- 每阶段结束跑相关包 vitest + tsc；全部完成后门禁五段全量回归
- 归档：docs/auditing/config-remediation-2026-06-20.md

## 决策点（2026-06-20 已拍板）

1. **B2 agents 域**：✅ engine 主路径切 agentManifests（有 schema），旧 agents.json 退役
2. **B4 信任分公式**：✅ 上移 config（constants/confirm-gate.ts 单源），engine 与 scheduler 共同 import
3. **D1 空转域**：✅ 4 域（crossVerification/governancePipeline/seedMemories/selfExamination）改按需加载（默认不加载，接消费方时再加）
