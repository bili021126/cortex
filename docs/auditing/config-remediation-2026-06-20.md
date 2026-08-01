# config 重整验收归档（核心主体稳定 · 第一步）

> 日期：2026-06-20 ｜ 依据：config-remediation-checklist-2026-06-20.md（清单）+ project-full-panorama-2026-06-20.md（全景）
> 决策：B2 切 agentManifests（先补数据）/ B4 信任分上移 config / D1 空转域按需加载

## 基线（重整前）

| 项 | 基线值 |
|---|---|
| engine.json 数值 | maxTotalReplans 3 vs 10、executeAllTimeoutMs 300k vs 600k、defaultMaxLoops 死配置 64 |
| engine 平行类型 | factory/types.ts 18 接口与 config interfaces 平行（289 行） |
| agents 双轨 | agents.json（@deprecated）engine 主路径 vs agent-manifests.json（仅 server） |
| isTestEnv | 三份重复实现（config/engine/scheduler） |
| 信任分公式 | engine 与 scheduler 逐字双实现（+ shouldAutoApprove 也双实现） |
| ConfigDomain | loader.ts 与 registry.ts 同名双定义 |
| registry | 仅 1 域（context-policies）1 生产方 |
| engine-plugins 读取 | bootstrap 直读文件绕过 loader |
| daemon/health | ObservabilityInfo 类型已定义端点未返回 |

## 改动清单（A-F 六阶段全落地）

### A 真相源归一
- **A1** engine.json 数值归一：maxTotalReplans 3→10、executeAllTimeoutMs 统一 600s（constants 300k→600k）、删除死配置 defaultMaxLoops；defaults.ts 的 executeAllTimeoutMs 改从 constants import（消除本地硬编码）
- **A2** 超时兜底冲突随 A1 消解（scheduling-implementations:560 的 `?? EXECUTE_ALL_TIMEOUT_MS` 与 defaults 同值 600s）
- 守护测试：config/tests/data-consistency.test.ts（4 断言：三处同值 + 死配置删除）

### B 消灭双源
- **B1** engine 平行类型收敛：types.ts 289→~150 行，13 个一致接口改 config re-export；AgentManifest/ActivationEntry/EventRoutingConfig 用 engine 侧类型收窄（config 零依赖保持）；AgentRoundtable config 补齐（personaPrompt/personaPromptFile/roundtableTitle）；暴露并解决 RouteTableMap/mergeRules 契约（config string vs notification 枚举——engine 收窄）
- **B2** agents 双轨→agentManifests：
  - B2a 数据补全：kuki/alhaitham/shuangning 按新域格式补入（15→18 agent；字段映射 display→emoji/role、systemPromptFile→systemPrompt、roundtable 字段对齐）
  - B2b profile 展开器：agents.loader.ts 加载 agentManifests 域 + _profiles 合并
  - B2c 切换：旧 agents.json 退役（全仓零消费仅注释示例）；校验放宽（systemPrompt 可选——轻量 agent 合法）；config 新增 AgentManifestDecl 类型（数据有 profile 类型没有的图纸补齐）
  - engine 全量 1137/1138 零回归
- **B3** isTestEnv 三份合一：engine/test-env.ts 删除（死代码）、scheduler/internal.ts 改 re-export config
- **B4** 信任分上移 config：TrustRecord/computeTrustScore/shouldAutoApprove 单源在 constants/confirm-gate.ts（含 TRUST_L0_L1_PENALTY 常量）；engine/scheduler 双实现删除改 import（engine re-export 保持公共 API）
- **B5** ConfigDomain 双定义统一：loader.ts 为基础 + defaults/envPrefix 字段；registry.ts 删本地定义改 import；register 用 name（key 即 name）；测试批量更新

### C 公差补齐
- **C1** 首批 5 域 schema（engine/enginePlugins/roundtable/cognition/docs）→ schemas/engine-domains.schema.ts + CONFIG_DOMAINS 挂载；**schema 校验真实生效**（E1a 期间拦截了错误 schema 形状——校验体系工作的实证）；dataKey 域 schema 校验提取后的值（数组）
- **C2** 校验职责分明：config 管结构（schema，loadConfigDomain 加载时校验）、engine 管语义（_validateStructure 跨字段）

### D 空转处置
- **D1** 4 空转域（selfExamination/crossVerification/seedMemories/governancePipeline）改按需加载：engine 不再默认加载（-63 行），接消费方时调用侧 loadConfigDomain
- **D2** ConfigRegistry 激活：registerAllDomains 注册 CONFIG_DOMAINS 全部 18 域 + context-policies（registry.list()=19）；registerDefaultDomains 保留兼容别名

### E 读取门面
- **E1** engine-plugins 直读改 loadConfigDomain（bootstrap-engine.ts 直读文件→loader 门面 + schema 校验）；DEFAULT_ENGINE_CONFIG 直读 ×7 评估为"默认值读取语义正确"（resolveConfig 无 partial 时等价），记录不强行改

### F 清理
- **F1** 注释宣称修正 3 处（memory 依赖 config / llm 仅 shared / memory-store 归属残留）
- **F2** server/package.json 补 @cortex/notification（隐式依赖显式化）
- **F3** loadEngineDefaults（tuning 链）生产接线待接——记录遗留（用户 77c5fd65 亲手做的链，engine bootstrap 未调用）
- **F4** ObservabilityInfo 兑现：daemon/health 返回 observability（telemetryFile/telemetryEntries/auditEntries/memoryPersisted），router 构造补 projectRoot

## 验证

| 项 | 结果 |
|---|---|
| 全量 tsc -b | EXIT=0 |
| config 测试 | 122/122（含 data-consistency 4 新断言） |
| engine 测试 | 1137/1138（B2 后全量）；B4/B5 回归修复（registry key→name 测试适配） |
| scheduler 测试 | 104/104 |
| server 测试 | 44/44 |
| 门禁五段 | ✅ CI_GATE_EXIT=0：tsc/eslint/critical-fixes 全过；vitest 3888/3893（25 skipped）；coverage 14 包全达标（config 78.63%↑ / engine 70.28%） |

## 遗留项（记录不阻塞）

| # | 项 | 说明 |
|---|---|---|
| 1 | loadEngineDefaults（tuning 链）生产接线 | 用户 77c5fd65 的覆盖链 engine bootstrap 未调用——接线需字段映射设计（EngineDefaults→EngineConfig） |
| 2 | 其余 7 域 schema（searchProviders/mcpServers/selfExamination/crossVerification/seedMemories/governancePipeline/agents 旧域） | C1 第二批；agents 旧域随退役可不补 |
| 3 | DEFAULT_ENGINE_CONFIG 直读 ×7 | 语义正确（默认值读取），统一门面待读取门面机制成熟 |
| 4 | registry.get 返回 defaults（空）——真正解析门面 | 阶段 E 的 resolveConfig 门面化（读取走 loader + 覆盖链）后续推进 |
| 5 | engine 单包 tsc 的 tests 噪音（TS2532 等） | 全量 tsc 干净；单包构建的既有增量问题 |

## 混沌 → 秩序 边界变化

重整前 5 处结构性负债 → 重整后：
- 负债 3（数值冲突）✅ 消除（一致性守护测试固化）
- 负债 1（平行类型）✅ 消除（engine 停止自建，config 单源 + 收窄）
- 负债 2（agents 双轨）✅ 消除（数据补全 + 切换 + 旧域退役）
- 负债 4（空转域）✅ 消除（按需加载）
- 负债 5（公差不足）◐ 首批 5 域补齐（18 域 6→11 有 schema）
- 新增消除：isTestEnv ×3、信任分 ×2、ConfigDomain ×2、engine-plugins 直读、注释宣称 ×3、隐式依赖 ×1、ObservabilityInfo 断链
