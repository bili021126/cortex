# 核心主体加固验收归档（第二步：scheduler 开刀 + config 收尾 + tuning 接线）

> 日期：2026-06-20　依据：project-full-panorama-2026-06-20.md（全景）+ config-remediation-checklist-2026-06-20.md（第一步清单）
> 决策：SCH-1 四抽象拆分 / C2 第二批 schema / ENG-1·2 tuning 覆盖链接线

## 基线（本步起点）

| 项 | 基线值 |
|---|---|
| scheduler scheduling-implementations.ts | 1457 行单文件（四抽象全塞） |
| scheduler 测试位置 | src/__tests__（3 文件混入 src） |
| confirm-gate 遥测 | 3 处裸 console.error("[telemetry]...") 伪装 |
| config schema 覆盖 | 11/18 域（无 schema 的 7 域含 5 活域） |
| tuning 覆盖链（loadEngineDefaults） | 已实现但生产零消费（engine 7 处直读 DEFAULT_ENGINE_CONFIG） |

## 改动清单

### CI 三连修复（推送后远程门禁暴露）
- **CI-1** pnpm-lock.yaml 同步 server @cortex/notification 依赖（frozen-lockfile 失败）
- **CI-2** doctor 活包移出 .gitignore + 补 audit-checker.ts 跟踪（tsc TS2307）
- **CI-3** memory-persist-restart T2 向量去重合并修复——根因：MemoryStore 写入的语义相似条目被向量去重合并（CI 上 embedding 可用，本地降级假绿）；修复：测试条目语义差异化（semantic_gist 是 embedding 输入，必须与 A 完全不同）

### SCH scheduler 三刀
- **SCH-1** 1457 行拆分：strategies.ts(105) / drivers.ts(900) / execution-models.ts(166) / model-routers.ts(301) + re-export 桶（index.ts 导出面不变）；跨区间依赖 runDispatchPipeline 归 execution-models（export+import）
- **SCH-2** 测试迁出 src/__tests__ → tests/（git rename 识别），vitest 双配置 include 统一
- **SCH-3** confirm-gate 3 处裸 console → recordTelemetry（gate.trust_auto / gate.verdict）

### C2 config 第二批 schema（16/18 域）
- governance-domains.schema.ts：MCP_SERVERS / SELF_EXAMINATION / CROSS_VERIFICATION / SEED_MEMORIES / GOVERNANCE_PIPELINE（5 域）
- 退役域（agents @deprecated / searchProviders 旧格式）不挂——向后兼容不约束
- 守护测试 +8（5 数据文件校验通过 + 3 坏数据拒绝）

### ENG tuning 覆盖链接线
- **ENG-1** agent-factory maxLoops：DEFAULT_ENGINE_CONFIG.defaultMaxLoops → loadEngineDefaults().reactMaxLoops
- **ENG-2** memory-store schema.ts 9 常量动态化（embeddingDim/contentHashAlgo/vectorDedupThreshold/weightAgingFactor/staleFreezeDays/frozenObliterateDays/maintenanceWeightThreshold/schemaVersion/maxTotalMemories）+ hybrid-retrieval alpha/beta
- 覆盖链生效：overrides > CORTEX_* env > tuning.json > 静态常量兜底

## 调研结论（混沌→秩序边界推进）

| 域 | 结论 |
|---|---|
| memory / memory-store | 秩序域：worldbook 双文件为分域设计（测试专用 vs 活实现）；cognitive-engine @frozen 有测试消费（冻结非空转）；AbstractMemoryStore 1512 行为单类内聚（拆分收益低） |
| governance | 秩序域：16 文件全 <520 行，无超大文件 |
| llm / prompt-kit / platform / notification / telemetry / context-manager | 秩序域（批量扫描）：llm-adapter 854 行为单类内聚（拆分收益低）；prompt-template-engine/mcp-client/toolkit 单类；notification 降级 console.warn 属 G1-5 类显式降级警告（可接受）；telemetry/context-manager 无硬编码/宣称/console |
| **resilience（已开刀）** | **RES-1** Registry.ts 748 行多类集合拆分为 registry.types(156)/noop(67)/context(85)/impl(415) + re-export 桶（index 导出面不变）；StateMachineCircuitBreaker 722/AdaptiveTimeout 576/SimpleCircuitBreaker 407 为单类内聚（不拆）——tsc/eslint/287 测试全绿 |
| engine | 断链已接：ConsistencyLayer（preWriteHook/filterRead/verify）/ RAG 桥接 / MemoryManager 均接线 |
| **技术债（已清零）** | **engine 测试类型检查缺口**：根 tsconfig 只引用 tsconfig.src.json（不编译 tests）——tsconfig.test.json 全量重查暴露 623 处既有错误——**专项处置（2026-06-20）四轮清零**：①tsconfig.test.json 关闭 noUncheckedIndexedAccess（测试索引宽松化，382 处）；②shared GovernanceEventPayload severity/source optional（契约修正）；③makeEvent/makeMemoryEvent 返回类型具体化→any（测试辅助函数）+ EmittableEvent 断言 + mock 补方法/字段 + 枚举修正 + 未定义名称补 import + manual e2e 特殊排除（tui-chain/rollback 依赖特殊性）；④最终验证：tsconfig.test.json --force **0 错误**（623→0），engine 1137/1138 无回归——**测试类型检查闭环达成** |
| **字段挂空（处置）** | monitorWindowMs/monitorThreshold 已接（monitor.ts 单源化）；embeddingCacheSize/schedulerMaxRounds/schedulerRoundTimeoutMs **标注 @future 预留**（无生产消费——ENV_MAP 契约已注册——测试守护值合法——保留待调度层/embedding 缓存接入） |

## 门禁验证

- tsc -b（根）✅ / eslint --max-warnings 0 ✅ / vitest：scheduler 104/104、config 122/122（+8 守护）、memory-store 109/109、engine 受影响 37/37 ✅
- **测试类型检查全仓闭环（2026-06-20）**：engine 623→0、fsm-compiler 53→0、plugin-runner/resilience/scheduler 基线 0——所有 tsconfig.test.json 包 `--force` 重查 0 错误
- 提交序列：d6e60eea（scheduler）→ 2866b976（C2 schema）→ 894cb338（ENG-1/2）→ 32f67709（归档）→ 247efe00（ENG-4）→ cbb347f4（ENG-5）→ d3d5d0bd（类型债①）→ 7d84cc50（类型债②）→ eb423705（类型债③）→ fd5f9780（类型债④ engine 清零）→ 6d1d62a1（归档）→ 21dd0766（fsm 清零）→ dbebc6d9（挂空标注）
