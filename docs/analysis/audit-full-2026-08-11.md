# Cortex 全量深度审计报告（2026-08-11）

> 审计方式：30 包全包扫描 + CLI/TUI/桌面端三端深度源码调研（并行子代理）+ 第二轮广泛调研（engine 内核/支撑包群/测试治理/资产配置）+ 既有审计基线对比
> 基线：docs/analysis/audit-full-2026-08-05.md（0C / 3H / 4M / 3L）
> 范围：类型安全 / 资源治理 / 可观测性 / 接线完整性 / 错误处理 / 测试体系 / 文档漂移 / 三端工程现状 / 资产配置一致性

---

## 总览

```
承接 08-05 基线：Critical 0 · High 3 · Medium 4 · Low 3
第一轮新增（三端）：High 2 · Medium 5 · Low 4（D1-D11）
第二轮新增（广泛调研）：High 3 · Medium 5 · Low 6（E1-E16）
第三轮新增（外部生态）：行动项 8 项（见外部生态报告）
第四轮新增（宪法/文档/运行态/UI）：High 2 · Medium 5 · Low 6（F1-F14）
含 1 项实跑验证 Critical 级门禁事故（E1）
```

**总体判断**：工程层健康度维持**高**——依赖分层干净（L0-L4 单向 DAG，23 支撑包反向依赖扫描全部为 0）、engine 治理纪律优秀（as any 清零、空 catch 全有降级语义、大写 TODO/FIXME 为零）、13 包覆盖率全部高于阈值、git 工作区干净（近 1.5 月 189 次提交）。但四轮调研累计暴露**治理层系统性失效**：CI 门禁必红（E1 实跑验证）、宪法量化自述大面积失实（F1）、依赖漏洞无自动化扫描（F2）、README/注册表/文档三轨漂移（E2/F5）、桌面包游离于 CI（F3）。

---

## 一、08-05 基线复核

| 项 | 状态 | 复核结论 |
|---|---|---|
| H1 裸 console（memory 包 103 处） | 🔶 未修 | memory-compressor 诊断仍走 console.log；engine 499 处 console 中 console.log 类未收敛 |
| H2 测试污染根因（bootstrap 共享 WORKSPACE_ROOT） | 🔶 未修 | 本地并行 forks 仍会红；CI maxForks=1 规避 |
| H3 行为层评测未落地（eval-gate） | ✅ 修正 | **已落地**：`packages/engine/tests/eval/` 存在（eval-gate/eval-runner/stress/profile + golden 3 用例），`.cortex/eval-report.json` 已有 2026-08-09 产出——但 report 模式 exit 恒 0、无 golden 断言消费（见 E7）——闭环缺口仍在 |
| M1 auditMemoryStore 零调用 | 🔶 未修 | 无 `cortex mem audit` 接线 |
| M2 server timer 缺 exit 兜底 | 🔶 未修 | stop() 路径仍为唯一清理点 |
| M3 文档漂移检查未建 | ✅ 本轮补充 | 见 D11（漂移项已盘点） |
| M4 engine console 部分未收敛 | 🔶 未修 | 部分 console.error 未走 diagnostic/observer |

**结论**：08-05 的 10 项遗留全部未动——本轮不作为新发现重复上报，但修复优先级排序中保留。

---

## 二、本轮新增发现（三端深度审计）

### High

#### D1. TUI 双渲染体系并存（ANSI 直写 vs Ink）——结构性死代码源

**证据**：`packages/cli/src/tui/renderer/`（ansi.ts、diff-viewer.ts、permission-dialog.ts、token-monitor.ts、tool-log.ts、sigint-handler.ts、sanitize.ts）与 `tui/ink/`（Ink 组件体系）并存。权限确认存在**两条路径**：`renderer/permission-dialog.ts` 的 `renderInlinePermission`（ANSI 直写）vs `ink/PermissionPrompt.tsx`——`ink-entry.tsx` 未使用旧体系，旧文件成为死代码与漂移源。

**影响**：维护者无法判断哪条路径生效；权限这类安全关键路径出现双实现，未来修复可能只改一侧造成行为分叉。

**修复方向**：以 `tui/ink/` 引用关系为准，清点 `renderer/` 下未被引用的文件，删除或标注 legacy；权限路径收敛为 Ink 单一实现。

#### D2. REST 契约面裂口（client 28 方法 vs daemon 15 路由）

**证据**：`@cortex/client` 暴露 28 个类型化 REST 方法（http-client.ts 实测：含 getEvents/getModels/getKeys/getTuning/config 域），但 `@cortex/server` 实际仅实现 15 条路由（router.ts 实测）——`/api/v1/events`、`/api/v1/models`、`/api/v1/keys`、`/api/v1/tuning`、`/api/v1/config/*` 不存在。capabilities 虽诚实声明 `events:false/config:false`（router.ts:329-330），但 client 侧方法对 daemon 直接 404。**延伸证据**：capabilities.wsChannels 仅声明 7 个通道（router.ts:332），而 `@cortex/protocol` 定义 11 个（state/pipeline/tui/system/config/chat/gate/agent/memory/session/notification）——agent/memory/session/tui 四通道未声明。

**影响**：三端（cli/desktop/未来 webui）用 client SDK 时会撞 404；capabilities 声明与 client 方法集无自动对齐机制，裂口只会随时间扩大。

**修复方向**：以 capabilities 为唯一真相源——要么补齐 daemon 路由，要么收敛 client 方法集；加契约测试断言"client 方法 ⊆ daemon 路由 ∩ capabilities 声明"。

### Medium

#### D3. CLI 冻结声明的审计排除未落实

**证据**：全仓库 grep "R14" 仅命中 `packages/cli/package.json` 描述一处；CI 脚本（scripts/ci-gate.ts）与扫描器配置中**无实际排除项**。冻结声明（2026-08-06）后仍合入安全修复（engine-bridge.ts R12-D7 shutdown 修复），说明代码仍在被维护，但审计/门禁并不知情。

**影响**：冻结边界模糊——"仅安全修复"无执行载体，任何改动都可能悄悄滑入冻结包。

**修复方向**：在 ci-gate.ts 或独立审计脚本中登记 cli 冻结包清单，对 src 变更做 diff 级别的"安全修复白名单"门禁。

#### D4. 配置双轨 + 端口双源（CLI）

**证据**：`ConfigManager`（自实现 deepMerge + _searchUp，config-manager.ts:23-33/203-212）与 `@cortex/config` 的 ConfigStore/loadConfigDomain 体系并行；`CORTEX_DAEMON_PORT`（main.ts:161）与 status.ts:28 硬编码 3210 双源。

**影响**：配置真相源原则（唯一真相源）在 cli 包内被破坏；端口改配置时 status 命令会失联。

**修复方向**：config-manager 下沉合并入 @cortex/config；端口统一走 config 包解析。

#### D5. 桌面端双份手维护常量/类型

**证据**：IPC_CHANNELS 在 ipc-handlers.ts 与 preload/index.ts 双份手抄；PresenceEvent（main 侧 presence-bridge）与 PresenceEventPayload（renderer 侧）两份手工对齐类型，未引用 `WSServerEventByChannel` 类型锚点；截图定时器 main 5s + renderer 5s 两套并存。

**影响**：通道名/事件类型漂移是静默故障源——改一侧不漏编译错误，运行期才暴露。

**修复方向**：IPC 通道从 preload 单一导出（renderer 侧 import 而非手抄）；Presence 类型由 `@cortex/protocol` 的 `WSServerEventByChannel` 派生；截图合并为按需触发。

#### D6. TUI 模式切换无清理（SET_MODE）

**证据**：`session-reducer.ts:294-295` 的 SET_MODE 仅改 `mode` 字段，不清 planState/toolCard/overlay——v2 设计文档 F4/F6（模式切换清理）未在 reducer 层落实。

**影响**：plan→chat→plan 往返后旧规划状态残留，视觉与上下文污染。

**修复方向**：SET_MODE 附带 plan/tool/permission 状态复位（对齐设计文档）。

#### D7. 桌面端通知/确认门闭环断裂

**证据**：通知链单向——desktop 只收 `notification:event` 不答 ack（client 有 `ackNotification` 但 desktop 未使用），S2-12 闭环断；确认门无 UI——gate.request 只驱动 Live2D 问号表情，ChatView 无 resolveGate 调用面。

**影响**：daemon 侧通知无法确认（重发/堆积风险）；L2 写操作确认在桌面端无操作入口，实际不可用。

**修复方向**：desktop 接入 ackNotification；ChatView 补确认门 UI（列表 + resolve/reject）。

### Low

#### D8. CLI 死代码清单（已核验）

platform.ts 整文件（PlatformBridge 单例无引用）；`rebootstrapIfNeeded`（engine-bridge.ts:122）；talk 三件套（ensureTalkMemory/readTalkMemory/writeTalkMemory——仅 shared 接口与 tests mock 消费）；remote 侧 `fetchToolDefs`/`setCurrentAgent`；bootstrap/config.ts 的 `injectAgentManifestsToRegistry`/`getConfigStores`；`_currentRollbackTaskId` 从未赋值（rollback taskId 恒为 "executeToolCall"）；roundtable join stub；inspect report 空壳；CommandRegistry 子命令查表死分支（commands/index.ts:71-81）。

**本轮新增核验**：`tui/web/` 整套 WebUI 后端（api-router.ts / gateway.ts / state-aggregator.ts / config-api-handler.ts / index.ts，约 300+ 行，含第二个手写 RFC6455 WS 网关）仅在 tui/index.ts:104-109 导出、**全仓库无任何调用点**（startWebUI 无消费方）——历史上从未接线。且其 gateway 与 `@cortex/server` 的 ws/gateway.ts（同为手写 RFC6455）构成**双实现**——直接命中 Core-3 目标 1（消除重复实现）。PACKAGE_POSITIONING 称 "RESTful API 由 @cortex/cli 承载" 实为对这套死代码的描述，而非纯粹文档幻觉。

#### D9. TUI 零组件测试

全仓库仅 session-reducer.test.ts import 了 ink 目录——App/ChatView/StatusBar/InputBar/TaskTree/PermissionPrompt/GroupView/SplashScreen/CommandPaletteView 均无直接测试；use-input-handler（核心分发链 257 行）零覆盖；FocusManager/CommandPaletteController/intent-router pipeline 无测试。

#### D10. 桌面端死代码与未接线

boot-sequence.ts 从未实例化（renderer/main.ts 只装配 PresenceEngine）；global.d.ts 声明 live2dSpeech/live2dAction/openerBridge/window.settings 四组接口但 preload 从未暴露；preload streamChat 每次注册 ipcRenderer.on、done 时移除——历史遗留泄漏模式需复核；WS 令牌双通道（DaemonWsClient 只读 env，daemon 随机生成写 ~/.cortex/ws-token 时无法连接，代码注释承认静默降级）。

#### D11. 文档漂移盘点

| 文档 | 漂移内容 | 证据 |
|---|---|---|
| README.md | 称"26 个包"（实际 30）；称 `packages/tui/` 独立包（实际 TUI 在 cli 包内 `src/tui/`）；列 `@cortex/consistency` 包（不存在）；"pnpm cli 启动 TUI"（CLI 已冻结，需 CORTEX_ENABLE_CLI=1） | packages/ 实测 30 个 package.json |
| PACKAGE_POSITIONING.md | 称 RESTful API 由 @cortex/cli 承载（实际宿主为 @cortex/server）——实为 cli 包内从未接线的 tui/web/ 死代码描述（见 D8）；cli 定位未提冻结状态 | server/src/http/router.ts、cli/src/tui/web/ |
| cli/PACKAGE_POSITIONING.md | 全文无冻结内容，与 package.json 描述不一致 | 文件对比 |
| commands/help.ts | 宣传 `cortex repl` / `cortex daemon start`——两命令均不存在 | command-list.ts 17 命令核对 |
| docs/core/full-flow-map.md | 引用 `packages/tui/tests/`——包不存在 | 目录实测 |
| cortex-docs.json | docRegistry 为空（文档治理注册表未填充） | JSON 实测 |

---

## 二·五、第二轮广泛调研新增发现（engine 内核 / 支撑包群 / 测试治理 / 资产配置）

> 本轮对 08-05 未深潜的四大面补全：engine 内核（75 文件 10157 行）、23 个支撑包、测试与治理体系（297 测试文件 67788 行）、资产与配置（prompts/skills/agents/宪法）。

### Critical

#### E1. CI 门禁当前必红——cli 12 个测试文件无 @ci 标签（实跑验证）

**证据**：`npx tsx scripts/ci-gate.ts --dry-run` 实测退出码 1，输出明确列出 12 个文件：eval-command.test.ts、status-command.test.ts、tui-context-compactor/event-bus/group-chat/hooks/intent-router/query-loop/remote-query-loop/session-store/snapshot-e2e/streaming-tool-executor.test.ts——均无 `// @ci:` 标签。ci-gate.ts L305-315 无标签审计对缺失文件 exit(1)。

**影响**：`pnpm ci` 当前必然失败——CI 门禁作为"修宪前置条件/合并前提"的治理承诺已失效；TUI 测试为新增文件（08-05 审计后合入），说明新增测试未过门禁即合入，门禁的增量防线形同虚设。

**修复方向**：P0 立即——给 12 个文件补 `// @ci: unit`（tui-snapshot-e2e 按实际性质标 unit 或 integration）；同时审查 CI 工作流（.github/workflows/ci.yml）为何未拦截本次合入。

**✅ 已修复（2026-08-11）**：12 个文件全部补 `// @ci: unit`；`ci-gate --dry-run` 退出码 0（修复前 1）；cli 包全量测试 36 files / 608 tests 全通过（含新进 CI 的 12 个文件）。遗留：CI 工作流未拦截本次合入的根因（新增测试直接 push 未跑门禁）需在 CI 侧确认——门禁本身已恢复拦截能力。

### High

#### E2. README 与真相源脱节（三方数字漂移 + 根文件失踪）

**证据**：README 声称 17 角色/14 Agent/22 技能/26 包，实测：prompts/ 16 角色、config 包 agents.json 16 Agent（@deprecated）、skills/ 26 个 skill-* JSON、30 包。根目录 `cortex-agents.json` 与 `cortex-cognition.json` 均不存在（README L112-113 目录树声明其存在）——已迁入 packages/config/src/data/。

**影响**：新读者按 README 找配置真相源直接落空；"14 Agent"与宪法 v3.7 自述"16 Agent/15 类型"也冲突。

**修复方向**：README 全面对齐 config 包真相源（16 角色/16 Agent/26 技能/30 包）；目录树删除根文件声明。

#### E3. Agent 配置双源冲突（agents.json @deprecated vs agent-manifests.json）

**证据**：packages/config/src/data/ 下 agents.json（779 行，头注 @deprecated 2026-07）与 agent-manifests.json（516 行，新权威源）并存且**模型分配实质冲突**：nahida 在 agents.json 为 flash/CHAT，在 manifests 中为 pro/REASONER；cognition.json 中 strategist active:false 与 agents.json 中 zhongli/shuangning status:"awake" 矛盾；confirm-gate 类型不在激活矩阵中。

**影响**：Agent 实际模型/激活状态取决于消费方读哪个源——调度行为不可预期；宪法 §11.6 虽声明 agents 域保留兼容，但"唯一真相源"原则被破坏。

**修复方向**：裁定 agents.json 退役时点（建议 Core-3），消费方统一走 agent-manifests + cognition；补一致性校验（manifests vs cognition 交叉断言）。

### Medium

#### E4. parser 包定位完全错误

**证据**：PACKAGE_POSITIONING 称 parser 为"AST 解析——代码结构分析（tree-sitter）"；parser.ts 头部实测为"Markdown → HTML 转换解析器"（原属 projects/solo-flight，迁入时未改定位）。

**影响**：文档指引与代码现实南辕北辙；若未来需要真 AST 解析（tree-sitter 已在 patches/ 有补丁但未被 parser 使用），当前包名被占。

**修复方向**：二选一——定位文档改为"Markdown→HTML 转换"，或将 parser 重构为真 AST 解析器（tree-sitter 补丁已备）。

#### E5. context-manager 核心 @frozen（冻结包仍被 engine 依赖）

**证据**：context-engine.ts 头注 "@frozen 2026-07——仅 import type 引用，setContextManager() 从未在生产代码中被调用"；但 engine 仍依赖 @cortex/context-manager（package.json 16 包之一），bootstrap 中 PromptManager/ContextBuilder 链存在间接引用。

**影响**：冻结声明与依赖面并存——同 CLI 冻结（D3）一致的模式：声明无执行载体，包处于"半死"状态。

**修复方向**：将冻结声明实体化（依赖面裁剪或明确退役时点），纳入 Core-3 目标 1（消除重复实现）清单。

#### E6. notification 文档-代码漂移（物理四通道 vs 文档三档）

**证据**：PACKAGE_POSITIONING 写"四通道物理分层（FYI/WARNING/DECISION_REQUIRED）"；代码实测物理层为 `NotificationChannel` 枚举 Urgent/Important/Routine/Info 四通道（types.ts:13-22），FYI/WARNING/DECISION_REQUIRED 是语义层三档（semantic-layer.ts:19）映射到物理层。

**影响**：文档把语义层名字写进物理层描述、漏了 Info 通道——两层概念混淆，消费方按文档找通道会落空。

**修复方向**：定位文档补两层结构描述；语义↔物理映射表入文档。

#### E7. eval-gate 落地但不阻断（闭环缺口）

**证据**：tests/eval/ 存在（修正 H3），但 eval-gate report 模式 exit 恒 0，结果不比对 golden 断言（断言在 expect 内逐条检查但失败不影响退出码）；golden 仅 3 条 liveness 用例（timeout-fires/heartbeat-by-design/scheduler-alive）；CI 无 eval 消费点。

**影响**：行为回归仍无自动拦截——人格一致性/记忆域等行为验证依赖人肉。

**修复方向**：eval-gate 增加 fail 模式（断言失败 exit 1）并接入 CI 门禁 4.5 段；golden 从 3 条扩到 16 条（08-05 方案已定）。

#### E8. CompositeScheduler 已迁出 scheduler 包（文档过时）

**证据**：scheduler/src/core/ 实测无 composite-scheduler.ts（拆分为 drivers.ts/execution-models.ts/model-routers.ts/strategies.ts 四文件）；组合实现已迁至 engine/src/core/scheduler.ts（头注 "CompositeScheduler（原调度组合）已从 @cortex/scheduler 移出"）；但 scheduler/src/index.ts:9 仍写 "CompositeScheduler — 组合调度入口"。DESIGN.md（v1.0 草案）整体基于旧结构。

**影响**：文档/barrel 表述与文件现实不符——按文档找组合入口会误导。

**修复方向**：scheduler index.ts 表述更新；DESIGN.md 标注过时或重写。

### Low

#### E9. 非法 @ci 标签静默降级 unit

prompt-kit/tests/unit/placeholder.test.ts 首行 `// @ci: skip`（skip 不在合法值内）→ 占位测试进 CI 跑；engine/tests/path-safety.test.ts 首行无冒号 `@ci 路径越界防护` → 同样降级。

#### E10. 覆盖率门禁默认不跑 + 测试代码无 lint

ci-gate 覆盖率门禁需 `--coverage` 参数，而 .github/workflows/ci.yml 只跑 `tsx scripts/ci-gate.ts`（无 --coverage）——阈值是纸面约束；eslint.config.mjs ignores 全部 tests/** 与 *.test.ts——测试代码无 no-explicit-any 等约束。

#### E11. 技能资产未闭环

26 个 skill-* JSON 全部 status=trial、adoptionCount=0（结晶闭环从未消费）；编号断裂（p01-09/p18-24 缺失）；p17 双文件重复编号；README 称 22 与实测 26 不符。

#### E12. 宪法内部 CI 口径漂移 + 文档注册表失联

宪法 §十八仍列"五段执行"（tsc→eslint→critical-fixes→vitest→coverage），AM-2026-0801-001 after 声称"三段"；cortex-docs.json constitutionPath 指向 docs/constitution/constitution.md（不存在），运行时权威源为 config 包 docs.json——双注册表并存且根文件过时。

#### E13. 裸 console 具体分布确认（08-05 H1 细化）

memory 包 32 处（12 文件：memory-scheduler 5/rag-vectorstore 5/FileBasedMemoryStore 4/memory-manager 4 等）；llm 包 12 处（eslint-disable no-console 下残留）；scheduler drivers.ts 1 处；engine 57 处（21 文件，集中在 REACT_DEBUG 门控与 bootstrap 启动期，agent-factory 6 处无门控 TRACE 值得关注）。

#### E14. engine 待验证项（非缺陷，标注跟踪）

① bootstrap/create-core.ts 与 register-agents.ts 为 v2.x 遗留，与 v3.0 插件路径是否存在双轨漂移；② Core-2 AgentRegistry 与 JSON 声明面（agents.json/manifests）运行时同步状态；③ agent-factory 无门控 TRACE 是否应纳入 ConsoleBridge 白名单。

### 强项确认（扫描验证）

| 维度 | 结果 | 判定 |
|---|---|---|
| 分层反向依赖 | 23 支撑包 import @cortex/engine 全部为 0（shared 3 处为注释） | 🟢 零违规 |
| engine 类型纪律 | as any 实际 0 处（3 处为注释；全用 as unknown as/as never） | 🟢 优秀 |
| engine 空 catch | 16 处全部有降级语义注释（配合 DegradationBoundary） | 🟢 达标 |
| engine TODO/FIXME | 大写标记 0 处 | 🟢 达标 |
| 覆盖率 | 13 包全部高于阈值（notification 91.4 最高 / scheduler 34.7 最低均达标） | 🟢 达标 |
| scheduler 四抽象 | IScheduleStrategy × ILoopDriver × IExecutionModel × IModelRouter 与定位文档一致，36 种组合 | 🟢 达标 |
| llm capabilities 链 | config/models.json → shared/ModelCapabilities → LlmAdapter._shouldEnableThinking → IModelRouter 完整 | 🟢 达标 |
| 测试资产 | 297 文件 / 67788 行，engine 91 文件覆盖最重 | 🟢 雄厚 |

---

## 二·六、第四轮广泛调研新增发现（宪法全文 / 设计文档体系 / 工程运行态 / 桌面端 UI 内容级）

> 本轮覆盖前几轮未触达的四块：宪法 v3.7 全文审计（674 行）、docs 设计文档体系（229 文件 4.5MB）、工程运行态（git/依赖/构建/CI/打包）、桌面端最大 UI 文件内容级（ChatView.tsx 1355 行）。

### High

#### F1. 宪法量化自述大面积失实 + AM-2026-0801-001 口径错误（已裁决）

**证据**（宪法 v3.7 全文 vs 代码实测）：配置域 §11.6 称 17 域，代码实测 18 域（loader.ts 漏 enginePlugins）；技能模板 §十二称 41，skills/ 实测 27 个；行数锚点 6/6 不符（meta-agent 737 vs 声称 665、confirm-gate 433 vs 254、scheduling-implementations 12 vs 1107——已拆四文件）；测试基线 §十九 engine 902 vs 实跑 1036 passed；agent-manifests §5.1 称 15 条无霜凝，实测 18 条含 shuangning（pro 模型 vs 宪法 flash）。**CI 口径裁决**：实跑 = 5 主段 + eval 4.5 段；宪法正文"五段"正确但漏 eval 段；**AM-2026-0801-001 声称"三段"为修订错误**（三段从未在 ci-gate 存在）。

**影响**：宪法是"修宪前置条件"与治理闭环的根基——量化自述失真使宪法作为事实锚点的功能失效；AM 错误口径若被引用会误导后续修订。

**修复方向**：宪法 v3.8 事实对齐修订（配置域 18、技能口径界定、行数锚点去绝对值化为活引用、测试基线全仓重跑、补 eval 段）；AM 以勘误形式订正；修正案档案缺失 4 项（AM-2026-0622/0706/0716/0720-001）补齐或标注。

#### F2. 依赖漏洞无自动化扫描（安全盲区）

**证据**：`pnpm audit --prod` 实测失败——registry 为 npmmirror，无 audit 端点实现；lockfile 675 个顶层包条目无漏洞扫描机制。

**影响**：供应链漏洞（如 Ink/Electron/依赖链）无法被自动发现——在外部生态报告确认 Ink/Electron 均需跟进版本的安全语境下，此盲区放大风险。

**修复方向**：切换 registry 到官方源跑 audit 或接 npm audit 直连；漏洞扫描纳入 CI（至少低频 cron）。

### Medium

#### F3. 桌面包完全游离于 CI

**证据**：ci.yml 构建步骤显式 `--filter '!@cortex/desktop'`；CI 仅 ubuntu-latest 单平台（桌面主打 Windows NSIS 但无 Windows 打包验证）；electron-builder.yml 无图标配置；desktop 测试仅 1 个文件（message-state-machine.test.ts）。

**影响**：桌面端代码不受任何门禁约束——ChatView 1355 行零测试、打包链路零验证。

**修复方向**：CI 增加 desktop typecheck/build（Linux 侧可跑）；Windows 打包验证至少手动脚本化；图标补齐。

#### F4. 远程默认分支漂移 + 子模块空声明

**证据**：`origin/HEAD` 指向 `feature/chaos-bond`，本地/远程 main 并存——远程默认分支与本地主分支漂移；.gitmodules 声明 tools/filesystem-mcp-server 但 `git submodule status` 为空、目录不存在——声明未实装。

**影响**：clone 默认分支与开发基线不一致风险；子模块声明误导后续维护者。

**修复方向**：明确默认分支治理（origin/HEAD 改回 main 或正式切换）；删除或实装子模块。

#### F5. 文档注册表根文件死亡 + docs/README 断链

**证据**：根 cortex-docs.json 全库 0 个 .ts 引用（死文件）、constitutionPath 指向不存在文件、与 config 包 docs.json 零交集；docs/README 4 处断链（概念设计整合/治理层设计/Agent 标签词汇表路径失实、analysis 计数 15 vs 46）。

**影响**：文档治理双轨中根轨已死——新读者按索引找文档落空。

**修复方向**：删除根文件或改为指向 config 包单一真相源；docs/README 刷新 + 断链检查入 CI（doc-drift-check 已有先例）。

#### F6. 宪法版本链与修正案档案缺口

**证据**：版本链 v1.1→v3.7 仅 v3.0 与 v2.7.1（经 v2.5.35）有档案，其余 8 个版本无独立档案；§十七 修正记录表 8 行中 4 行（AM-2026-0622/0706/0716/0720-001）在 git 全历史不存在；§十七 v3.5 日期"2026-06-20" vs 版本头"2026-07-20"矛盾；§11.2-bis 写"最新 AM-0722-003" vs 版本头"AM-0801-001"自指矛盾。

**修复方向**：档案补齐或标注"无独立档案"；下版修正案统一引用链。

#### F7. 桌面端双色板并行（--rb-* vs CYRENE_PALETTE）

**证据**：chat.css 用本地 tokens.css 的 `--rb-*`（Tailwind 玫粉系，#ec4899 等）；@cortex/design-tokens 的 CYRENE_PALETTE（薰衣草紫 #b57edc/薄荷青/暖象牙）已在 desktop 依赖中且 presence/design-spec.ts 已消费——**同一应用两套色板，chat 目录完全未用 design-tokens**。

**影响**：视觉语言分裂；设计令牌治理原则（设计常量单源）被破坏。

**修复方向**：chat.css 变量迁移至 CYRENE_PALETTE（或 tokens.css 桥接 re-export）；P0 视觉收敛项。

### Low

#### F8. world-model-simulation-design 纯纸面设计

SimulationShell/simulation-layer 全库 0 命中——设计文档无任何代码支撑，需决策落地或归档。意图响应体系设计.md 同样：canonical 标记但 engine 无实现。

#### F9. 废弃包残留（parser/tools 标 DELETE 仍被跟踪）

.gitignore 标 `packages/parser/`、`packages/tools/` 为 DELETE，但 git 仍跟踪 8/15 文件、仍在 tsconfig references 中、且有 dist 产物——废弃标记与仓库状态脱节。

#### F10. ChatView 半成品清单（内容级）

任务"取消/重试"与"合并/压缩会话"按钮仅弹 toast（776-777/916-917）；模式五态"UI 先装功能后接"（327-330）；Monaco 主题固定亮色 "vs" 与暗色 UI 冲突（1009）；chat.css 2792 行含大量未引用历史样式（.weather-card/.choice-card/.approval-card/.loader/.chat__particles）；硬编码版本快照陈旧（宪法 v2.5/Node 24/gitHead 21863f02）；MemoryPanel/DesignPreview 10 个唯一 #hex inline 硬编码。

#### F11. USAGE.md 与 docs/README 的桌面端盲区

USAGE.md 通篇未提桌面端（Electron 聊天 UI/桌宠零文档覆盖）；docs/README 无任何 UI/渲染层条目；USAGE 称 14 Agent vs 宪法 16 vs ChatView AGENT_MODE_MAP 8 种——三处口径不一致。

### 修正与强项（本轮复核）

| 项 | 状态 | 结论 |
|---|---|---|
| 桌面端设置面板"静态假数据"（早前判断） | ✅ 修正 | **已接真**：settingsData 覆盖静态值（ChatView 348-349），saveSetting 写回 settings.set（353-362）——静态值仅作 fallback；但静态 key 与真实 config schema 对齐未验证 |
| 宪法结构性承诺 | ✅ 全部成立 | 29 包/16 Agent/10 插件/16 治理组件/L0-L3 确认门/记忆四态 CAS+obliterate 落盘均实测通过 |
| git 健康 | ✅ 优秀 | 工作区干净、近 1.5 月 189 次提交（日均 4）、提交粒度小（avg 3.94 文件）、信息规范 |
| TS 严格度 | ✅ 良好 | strict + noUncheckedIndexedAccess + composite/incremental；缺 noImplicitOverride 等进阶项（可选） |
| 设计文档落地度 | 🔶 55% 完全落地 | 抽查 11 份：✅6 / 🔶3 / ❌1（world-model-simulation）/ 🕰️1（tui-v2） |
| electron 版本 | ✅ 低风险 | lockfile 43.1.0 vs 最新 43.3.0——同一 major 滞后 2 patch |
| 文档:代码比值 | ℹ️ 1:2.8 | 229 文档 65255 行 vs 代码 180998 行——极高文档密度（角色叙事占 docs 体积约 40%） |

---

## 三、三端工程现状速评（详细调研见三端论证文档）

| 端 | 形态 | 健康度 | 最大债务 | 方向 |
|---|---|---|---|---|
| CLI | 17 命令 + 双宿主桥 | 🔶 冻结中 | 内嵌 engine 路径 622 行冻结代码 + 死代码 10+ 处 | 降格为薄 daemon 客户端 |
| TUI | Ink 5 组件体系 + ANSI 直写残留 | 🔶 结构性债务 | 双渲染体系并存 + 零组件测试 | 保持 Ink，收敛清理 |
| 桌面端 | Electron 双窗 + Live2D + Presence | 🟢 骨架完整 | 画布式 UI 未落地 + 协议裂口 | 协议对齐 → client 原语 → 画布落地 |

---

## 三·五、修复执行记录（2026-08-11 当轮）

| 项 | 修复内容 | 验证证据 |
|---|---|---|
| E1（Critical）✅ | cli 12 个测试文件补 `// @ci: unit` | ci-gate --dry-run exit 0（前 1）；cli 589 tests 通过 |
| D1（High）✅ | TUI 双体系收敛：删 sanitize/token-monitor/tool-log/diff-viewer 4 死文件；ansi.ts 383→195 行（Box/StatusLine/write/writeln 移除）；permission-dialog.ts 仅保留 reversibilityLevel（183→54 行）；barrel 清理；SigintHandler 确认活跃保留；测试裁剪 | cli typecheck exit 0；589 tests 通过；权限路径收敛为 ink/permission-prompt.tsx 单一实现 |
| D2（High）✅ | client capabilities 驱动降级：NotSupportedError + _assertSupported 守卫（13 孤儿方法）+ getCapabilities self-cache；新增契约守护测试（contract-gap，29 用例：client 方法 ⊆ server 路由 ∪ 守卫）与守卫行为测试（guard-behavior，9 用例） | client 68 tests 通过；typecheck exit 0 |
| F1（High）✅ 草案 | 宪法 v3.8 事实勘误修正案草案产出：AM-2026-0811-001.json（8 组事实对齐 + CI 口径勘误 + 行数去绝对值化）+ 起草说明——待圆桌共识裁定后落笔 | AM schema 与 0801 一致；before 值全部实测 |
| F2（High）✅ | scripts/audit-deps.ts（官方 registry 审计 + 退出码门禁化）+ package.json audit:deps + ci.yml 接入；overrides 修复 16→0 漏洞（dompurify ^3.4.13 / protobufjs ^7.5.5 / sharp ^0.35.0） | audit exit 0（No known vulnerabilities）；engine 1036 tests 通过（protobufjs 7 兼容验证）；memory-persist-restart 4/4 |
| F3（Medium）✅ | 桌面包纳入 CI：ci.yml 移除 `--filter '!@cortex/desktop'` + desktop typecheck 步骤；顺带修复桌面端 4 类真实类型错误（saveShot 声明缺失/setToast 未定义/settings.set 参数错误/res.data 闭包窄化） | desktop typecheck exit 0 |
| 环境修复（T2 超时根因） | pnpm peer 双实例导致 transformers 模型缓存分离——engine 实例预下载 all-MiniLM-L6-v2（80MB，hf-mirror） | memory-persist-restart 4/4（原 30s 超时） |

**附注**：F1 修正案与宪法修订属于修宪流程（AM + 圆桌共识），草案已就绪待裁定；E2/E3/D3/D4/D5/D6/D7 等未执行项仍按优先级排队。

### 后续轮次补记（2026-08-24）

历史提交已落地：E2（README/USAGE 对齐 29 包/16 角色/26 技能 + pnpm ci/cli 命令修复）、E3（agents.json 退役，agent-manifests 唯一真相源）、E4（parser 定位纠偏）、F9（parser/tools 误标 DELETE 清理）、CLI 重整化第一波（净删约 2200 行：platform 单例/tui/web 第二 WS 网关/talk 三件套等）、npmrc 损坏文件清理、lint 豁免修复、宪法草案存档。

| 项 | 修复内容 | 验证证据 |
|---|---|---|
| R14 补全 ✅ | CLI 降格 daemon 动作路由消费端：client 新增 getSchedulerSnapshot/submitNode/executeScheduler 三方法 + SchedulerSnapshot/NodeSubmitRequest DTO（服务端三条路由由前序提交就绪） | client 71 tests + server 52 tests；契约测试自动覆盖新路径 |
| E7 ✅ | eval-gate --fail 模式（golden 断言失败 exit 1，默认 report 模式不变）+ ci.yml 行为活性层步骤接入 | eval-gate --fail 8/8 通过 exit 0 |
| F5 ✅ | 根 cortex-docs.json constitutionPath 死链修复（指向 v3.7 实际文件）+ 注册 08-11 两份报告（该文件由 scripts/verify-docs-registry 与 cortex-cli docs 命令消费——修正早前"死文件"误判） | verify-docs-registry 通过 |
| E6 ✅ | PACKAGE_POSITIONING notification 描述改为双层结构（物理四通道 Urgent/Important/Routine/Info × 语义三档映射） | 文档已改 |
| E8 ✅ | scheduler/src/index.ts barrel 头部表述修正（CompositeScheduler 已迁 engine，不再宣称"组合调度入口"） | 文档已改 |
| D5 ✅ | 桌面端 IPC_CHANNELS 单源化：新建 src/shared/ipc-channels.ts，main/ipc-handlers 与 preload/index 与 main/index 三处统一 import（历史双份已实证漂移：SCREENSHOT/PRESENCE_EVENT 各缺其一）；tsconfig main/renderer 双项目 include 同步 | desktop typecheck exit 0 + vite build 成功 |
| CI 失效诊断 ℹ️ | 本地模拟 CI 全流程全绿（tsc -b / pnpm -r build / desktop typecheck / ci-gate / audit:deps / dep:cycle / eval-gate --fail）；**本地领先远程 156 提交未推送——远程 CI 从未运行新代码**；推送后若仍红需看 Actions 日志 | 全部本地门禁 exit 0 |

### 优化迭代轮补记（2026-08-24 二轮）

| 项 | 修复内容 | 验证证据 |
|---|---|---|
| E9 ✅ | prompt-kit placeholder 非法标签 `@ci: skip` 合法化为 unit；engine path-safety 无冒号标签补正 | ci-gate 标签扫描全绿（293 文件） |
| D6 ✅ | TUI SET_MODE 增加模式切换清理（planNodes/planState/streamingContent/pendingPermission 复位——对齐 v2 设计 F4/F6） | cli typecheck + 测试待全量 |
| H2 ✅ 验证 | bootstrap 测试污染根因已修复（bootstrap-integration 等均用 mkdtemp 独立临时工作区） | 源码核验 |
| M1 ✅ | memory-audit 零调用死代码接线：scripts/mem-audit.ts（JSON 导出格式审计 + 退出码暴露问题信号） | 脚本可执行（错误路径验证） |
| M2 ✅ 验证 | server 三处 timer（daemon/state-handler/session-manager）exit 兜底均已存在（历史提交） | 源码核验 |
| D7a ✅ | 桌面端通知 ack 闭环：DaemonWsClient 新增 send + 收到 ackRequired 通知自动回执（S2-12 断链修复） | desktop typecheck exit 0 |
| F7 ✅ | 双色板单源化：design-tokens 新增 CHAT_PALETTE（62 令牌权威值）+ barrel 导出；desktop 守护测试 chattokens-consistency（键集合 + 值归一化一致性，防双份漂移）；补 desktop vitest.config（此前无配置——状态机测试全靠默认收集） | desktop 37 tests 全绿；design-tokens typecheck + build 通过 |
| E10 部分 ⏸️ | 测试 lint 纳入与覆盖率默认开启留 Core-3（改动面大：eslint ignores 放开 + 全量 coverage 耗时） | 标注跟踪 |
| D7b ⏸️ | 确认门 UI（gate.request → ChatView 确认列表 + resolve）留后续（涉及 renderer 大改） | 标注跟踪 |

---

## 四、修复优先级建议

```
P0（立即）：E1（CI 门禁必红——12 文件补 @ci 标签，实跑验证）+ F1（宪法 v3.8 事实对齐 + AM 勘误）+ D1（TUI 双体系收敛）+ D2（契约裂口）
P1：F2（依赖漏洞扫描接入）+ F3（桌面包入 CI）+ E2（README 对齐真相源）+ E3（Agent 双源裁定）+ E7（eval-gate fail 模式）
P2：D4/D5 + F5（注册表单源化）+ F7（双色板收敛）+ E4/E5/E6/E8（定位文档与冻结实体化）+ D7（通知/确认门闭环）
P3：D6/D8/D9/D10/D11/E9-E14/F4/F6/F8/F9/F10/F11（清理、档案、测试与跟踪类——随迭代）
```

---

## 五、趋势判断

R12（8 处接线断裂）→ R13（降级守卫/归一化/WS 鉴权）→ 08-05（0C/3H）→ 四轮调研（D1-D11/E1-E16/F1-F14）：**遗留问题从"机制断裂"完全转入"机制收敛与落地"，且收敛压力正在向治理载体堆积**。四轮累计的 40+ 项发现中，代码缺陷占比持续下降，治理载体失准占比持续上升：门禁（E1 必红/E9 静默降级/E10 不实跑）、宪法（F1 量化失实/F6 档案缺口）、文档（E2/F5 三轨漂移）、安全（F2 审计盲区）、CI 覆盖面（F3 桌面包游离）。

**一句话**：代码层健康（分层/纪律/覆盖率/git 全部达标），治理层失准（门禁/宪法/文档/安全四载体各自漂移）——下一阶段修复重心应从代码迁移到**治理载体四件套（门禁、宪法、文档注册表、依赖安全）的自身对齐与双向校验**，这与 Core-3"接口稳固、消除重复实现"同向，但需先让治理载体成为可信事实源。

---

*审计完成（四轮）——三端深度调研见 three-front-engineering-argumentation-2026-08-11.md；外部生态见 three-front-external-ecosystem-2026-08-11.md；engine/支撑包/测试治理/资产配置/宪法/文档体系/运行态/UI 子调研证据已并入 D/E/F 组。*
