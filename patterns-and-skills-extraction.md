# 包创建全过程模式与技能提取报告

> 提取日期：2025-07-12
> 分析范围：整个 Cortex Monorepo（packages/*, src/, skills/, prompts/）
> 提取依据：源码分析（CLI → Factory → Engine → Memory → SkillRegistry 全链路）

---

## 目录

1. [架构模式（Architecture Patterns）](#1-架构模式)
2. [创建流程模式（Creation Process Patterns）](#2-创建流程模式)
3. [Agent 模式（Agent Patterns）](#3-agent-模式)
4. [技能系统模式（Skill System Patterns）](#4-技能系统模式)
5. [持久化模式（Persistence Patterns）](#5-持久化模式)
6. [可复用技能（Reusable Skills）](#6-可复用技能)
7. [设计决策模式（Design Decision Patterns）](#7-设计决策模式)

---

## 1. 架构模式

### P1 — 微核心 + 可插拔插件架构（Micro-Kernel + Plugin Architecture）

| 属性 | 描述 |
|------|------|
| **Trigger** | 需要构建可扩展的系统，核心功能稳定但外围功能需动态加载 |
| **Tags** | `architecture`, `design`, `plugin`, `core` |
| **Steps** | ① 定义最小核心接口（BootstrapResult/Agent/Scheduler）→ ② 核心只做编排不做实现 → ③ 外围功能以 Plugin 形式注册 → ④ PluginLoader 按拓扑序加载 → ⑤ 每个 Plugin 有 init → postInit → start → shutdown 生命周期 |
| **Expected Output** | 核心包体积小、单一职责；可通过新增 plugin 文件扩展功能，不改核心代码 |

**代码证据：**
- `packages/engine/src/bootstrap/bootstrap-engine.ts` — §3-§5：`PluginLoader.load()` 按清单动态加载
- `packages/engine/src/plugin/plugin-loader.ts` — 插件拓扑排序加载
- 每个插件定义 `init()` / `postInit()` / `start()` / `shutdown()` 生命周期

### P2 — 四阶段引导流水线（Four-Phase Bootstrap Pipeline）

| 属性 | 描述 |
|------|------|
| **Trigger** | 系统启动时需要从配置文件加载、校验、组装、启动 |
| **Tags** | `architecture`, `bootstrap`, `startup` |
| **Steps** | ① **loadAll** — 并行加载 agents/cognition/docs 三份 JSON 配置 → ② **validateAll** — 跨字段三合一校验 → ③ **assembleAll** — 组装配置为运行时对象（调用但不依赖返回值）→ ④ **start** — 调用方启动 |
| **Expected Output** | 全或无：任一阶段失败则报错退出，不留半启动状态 |

**代码证据：**
- `packages/factory/src/bootstrap.ts` — 四阶段流水线实现
- `packages/engine/src/bootstrap/bootstrap-engine.ts` — 引擎级细化 bootstrap

### P3 — 组合式工厂替代类继承（Composition Factory Over Class Inheritance）

| 属性 | 描述 |
|------|------|
| **Trigger** | 多个 Agent 类型共享相同行为模式，但需要各自定制 |
| **Tags** | `architecture`, `design-pattern`, `composition` |
| **Steps** | ① 定义纯数据 Config 接口（AgentFactoryConfig）→ ② 工厂函数接收 Config + 依赖注入（llm/toolkit/memory）→ ③ 返回符合 Agent 接口的对象字面量 → ④ 内部用闭包管理私有状态（PoolAwareState） |
| **Expected Output** | 无继承链、无 `super()` 调用、无 `this` 隐式耦合；每个字段显式声明 |

**代码证据：**
- `packages/engine/src/components/agent-factory.ts` — `createAgent()` 工厂
- 配置 `AgentFactoryConfig` 是纯数据，无抽象方法
- 替代了原有的 `abstract class BaseAgent` 继承模式

### P4 — 桶导出模式（Barrel Export Pattern）

| 属性 | 描述 |
|------|------|
| **Trigger** | Monorepo 多包项目中，每个包的公开 API 需要统一管理和版本承诺 |
| **Tags** | `architecture`, `api-design`, `module` |
| **Steps** | ① 每个包的 `src/index.ts` 是唯一对外入口 → ② 所有公开符号必须在 barrel 文件追加 export → ③ 测试文件禁止 `../src/` 相对导入，必须使用包名 → ④ 标记 @deprecated/@experimental 的导出有版本承诺 |
| **Expected Output** | 外部调用方只需 `import { X } from "@cortex/engine"`，不感知内部文件结构 |

**代码证据：**
- `packages/engine/src/index.ts` — 268 行统一的桶导出，按 domain 分组
- `@module-convention` 注释块明确约定规则

---

## 2. 创建流程模式

### P5 — CLI 三层命令路由（CLI Three-Layer Command Routing）

| 属性 | 描述 |
|------|------|
| **Trigger** | 需要构建支持子命令、别名、全局选项的 CLI |
| **Tags** | `cli`, `command`, `routing` |
| **Steps** | ① `CommandRegistry` 维护 name → definition 映射 + 别名解析 → ② `dispatch()` 方法解析顶级命令 → ③ 子命令在 CommandDefinition.subcommands 中注册 → ④ 统一选项解析器 `_parseOptions()` 处理 `--key=value` / `--key value` / `-k v` |
| **Expected Output** | `cortex agent list --status awake` 格式准确路由到 handler |

**代码证据：**
- `packages/cli/src/commands/index.ts` — CommandRegistry 实现
- `packages/cli/src/commands/command-list.ts` — 16 个命令统一注册

### P6 — 延迟工厂创建 Handler（Lazy Factory Handler Creation）

| 属性 | 描述 |
|------|------|
| **Trigger** | Handler 创建时依赖 engineBridge/docRegistry 等，但 CLI 启动时这些依赖尚未完全就绪 |
| **Tags** | `cli`, `design-pattern`, `lazy-initialization` |
| **Steps** | ① 定义 `createXxxHandler()` 工厂函数 → ② 工厂接收依赖作为参数（而非从全局获取）→ ③ 在 `registerCommands()` 中一次性调用所有工厂 → ④ handler 内部再按需调用 `bridge.ensureBootstrapped()` |
| **Expected Output** | 循环依赖可解、依赖注入显式、handler 创建时机灵活 |

**代码证据：**
- `packages/cli/src/commands/agent.ts` — `createAgentHandler(bridge)`
- `packages/cli/src/commands/command-list.ts` — 所有 factory 调用聚集

### P7 — 懒加载单例（Lazy Singleton Pattern）

| 属性 | 描述 |
|------|------|
| **Trigger** | 全局唯一的服务（如 SkillRegistry）需要在第一次访问时才初始化，且只初始化一次 |
| **Tags** | `design-pattern`, `singleton`, `performance` |
| **Steps** | ① 模块级声明 `_registryCache` 变量 → ② `getRegistry()` 方法检查缓存 → ③ 为空时 new 实例并缓存 → ④ 返回缓存实例 |
| **Expected Output** | 零初始化开销，仅第一次调用时创建实例 |

**代码证据：**
- `packages/cli/src/commands/skill.ts` — `let _registryCache: SkillRegistry | null = null` + `getRegistry()`

### P8 — 跨进程状态持久化（Cross-Process State Persistence）

| 属性 | 描述 |
|------|------|
| **Trigger** | CLI 的 spawn/list 等操作需要跨进程共享 Agent 实例状态 |
| **Tags** | `cli`, `state-management`, `persistence`, `cross-process` |
| **Steps** | ① 定义 JSON 文件路径（`.cortex/agent-instances.json`）→ ② `readPersistedInstances()` / `writePersistedInstances()` 读写 → ③ spawn 时写入（递增），destroy 时写入（递减）→ ④ list 时合并内存 + 持久化计数（取最大值） |
| **Expected Output** | 多个 `cortex agent list` 进程看到一致的实例计数 |

**代码证据：**
- `packages/cli/src/commands/agent.ts` — `INSTANCES_FILE`, `readPersistedInstances()`, `writePersistedInstances()`

---

## 3. Agent 模式

### P9 — ReAct 循环统一实现（ReAct Loop Unified Implementation）

| 属性 | 描述 |
|------|------|
| **Trigger** | 所有执行型 Agent 都需要 ReAct（推理-行动-观察）循环 |
| **Tags** | `agent`, `react`, `llm`, `execution` |
| **Steps** | ① 定义 `ReActContext`（依赖注入：llm/toolkit/memory/systemPrompt）→ ② `runReActLoop()` 是共享函数，所有 Agent 共用 → ③ 循环内：组装消息 → LLM.chat() → 检查工具调用 → 执行工具 → 收集结果 → ④ 循环上限检查 + 墙钟超时检查 + 临近结束提示注入 |
| **Expected Output** | 单一实现，9+ 种 Agent 共享，无重复代码 |

**代码证据：**
- `packages/engine/src/components/react-loop.ts` — `runReActLoop()`
- TOOL_DISCIPLINE 注入 — Agent 收到工具使用硬约束

### P10 — Agent 标签匹配与路由（Agent Tag Matching & Routing）

| 属性 | 描述 |
|------|------|
| **Trigger** | 任务需要根据标签自动分配到最合适的 Agent |
| **Tags** | `agent`, `scheduling`, `matching`, `routing` |
| **Steps** | ① 每个 Agent 类型预定义 `tags`（如 code 标签：code/implementation/refactor）→ ② `findMatchingAgent()` 按 `node.type` 精确匹配优先 → ③ 回退按 tag 交集打分 → ④ 平局时用匹配密度（`score/tagCount`）打破 |
| **Expected Output** | 新任务自动分配到最专精的 Agent，无需人工指定 |

**代码证据：**
- `packages/engine/src/core/agent-matcher.ts` — `findMatchingAgent()`, `findAllMatchingAgents()`
- `cortex-agents.json` — 每个 agent 的 tags 定义

### P11 — PoolAwareState 状态管理（Pool-Aware State Management）

| 属性 | 描述 |
|------|------|
| **Trigger** | Agent 实例需要安全的状态转换，且与 AgentPool 配额联动 |
| **Tags** | `agent`, `state-machine`, `pool`, `concurrency` |
| **Steps** | ① Agent 有四个状态：Awake → Active → Draining → Destroyed → ② `transition()` 方法校验合法性（如 Active 状态必须池有配额）→ ③ execute 时先 `state.transition(Active)`，失败则拒绝执行 → ④ finally 块中 `state.transition(Awake)` 归还 |
| **Expected Output** | 池配额耗尽时 Agent 自动拒绝新任务，不会绕过限制 |

**代码证据：**
- `packages/engine/src/components/pool-aware.ts` — `PoolAwareState`
- `packages/engine/src/components/agent-factory.ts` — execute 中的状态转换

### P12 — 工具级别安全沙箱（Tool-Level Security Sandbox）

| 属性 | 描述 |
|------|------|
| **Trigger** | 不同 Agent 需要不同的工具权限，防止权限越界 |
| **Tags** | `security`, `agent`, `tool`, `permission` |
| **Steps** | ① `cortex-agents.json` 中每个 agent 定义 `toolPermissions` → ② `Toolkit.listDefinitions(agentType)` 按 Agent 类型过滤 → ③ toolkit.execute() 内部校验工具权限 → ④ 工具按危险级别分为 L0（读）/ L2（写）/ L3（执行） |
| **Expected Output** | 莫娜（Loop Agent）没有 `run_shell` 权限，阿贝多（Code Agent）有完整权限 |

**代码证据：**
- `cortex-agents.json` — 每个 agent 的 `toolPermissions` 列表
- `packages/shared/src/agent-permissions.ts` — `getAgentToolPermissions()`

---

## 4. 技能系统模式

### P13 — 技能即记忆（Skill-as-Memory Paradigm）

| 属性 | 描述 |
|------|------|
| **Trigger** | 技能不是可执行函数，而是 Agent 产出的结构化认知经验 |
| **Tags** | `skill`, `memory`, `knowledge`, `cognition` |
| **Steps** | ① `SkillTemplate` 包含 id/kind/name/triggerTags/trigger/steps/expectedOutput → ② 技能存入 `MemoryStore` 的 `MemoryType.Skill` → ③ 其他 Agent 通过 `SkillRegistry.queryByTags()` 主动拉取参考 → ④ 使用后带回 `FeedbackEntry` 评价，驱动进化 |
| **Expected Output** | 技能池是记忆系统的一部分，Agent 自主拉取而非强制注入 |

**代码证据：**
- `packages/shared/src/agent-skill-types.ts` — `SkillTemplate` 接口定义
- `packages/engine/src/registry/skill-registry.ts` — `SkillRegistry` 查询/反馈机制
- 设计宪法注释：**"技能是'被参照'而非'被执行'"**

### P14 — 技能双路径入池（Dual-Path Skill Ingestion）

| 属性 | 描述 |
|------|------|
| **Trigger** | 技能有两种来源：Agent 运行时产出（内生）和 JSON 文件注册（外源） |
| **Tags** | `skill`, `pipeline`, `ingestion` |
| **Steps** | ① **内生路径**：LoopAgent 执行 → Pipeline 事件 → `extractSkillsFromOutput()` → register(trial, weight=0) → ② **外源路径**：`skills/*.json` → `validateExternalSkillJson()` → `externalJsonToSkillTemplate()` → register(trial, weight=0) → ③ 外源 status="active" 强制降级为 trial（安全约束） |
| **Expected Output** | 双路径统一注册表，status 安全约束防止外部声明不可信 |

**代码证据：**
- `packages/engine/src/components/skill-extractor.ts` — 内生提取
- `packages/engine/src/components/skill-json-validator.ts` — 外源校验+转化

### P15 — 技能状态纯函数推导（Derived Status via Pure Function）

| 属性 | 描述 |
|------|------|
| **Trigger** | 技能状态（trial/active/deprecated）不应是硬编码状态机，而是可推导衍生标签 |
| **Tags** | `skill`, `state`, `pure-function` |
| **Steps** | ① `deriveStatus(weight, feedbackHistory)` 是纯函数 → ② weight>=1 + 至少1条正向评价 = active → ③ 连续3条 rating=-1 = deprecated → ④ 其他 = trial |
| **Expected Output** | status 不是存储字段，而是运行时计算值，永远与 weight+feedback 一致 |

**代码证据：**
- `packages/engine/src/registry/skill-registry.ts` — `deriveStatus()` 纯函数

### P16 — 技能结晶为知识（Skill Crystallization to Knowledge）

| 属性 | 描述 |
|------|------|
| **Trigger** | 技能从 trial 升级到 active 时，需要事实认证并沉淀为持久知识 |
| **Tags** | `skill`, `knowledge`, `crystallization`, `verification` |
| **Steps** | ① trial→active 触发 `onSkillStatusChange` 回调 → ② `verifySkillKnowledge()` 检索关联情景记忆（至少1条）→ ③ 可选 `searchExternalEvidence()` 联网检索 → ④ `crystallizeSkillToKnowledge()` 写入 MemoryType.Insight → ⑤ 幂等更新（version 递增）+ 证据链合并 |
| **Expected Output** | active 技能 = 已认证知识（weight=5），trial 技能 = 未认证知识（weight=3） |

**代码证据：**
- `packages/engine/src/components/skill-persister.ts` — `crystallizeSkillToKnowledge()`, `verifySkillKnowledge()`
- `packages/engine/src/bootstrap/init-skills.ts` — 状态变更回调

### P17 — 外源技能 JSON 可插拔校验组件（Pluggable Skill JSON Validation）

| 属性 | 描述 |
|------|------|
| **Trigger** | 外源技能 JSON 需多项校验规则，且规则应可插拔扩展 |
| **Tags** | `skill`, `validation`, `pluggable` |
| **Steps** | ① 定义 `SkillJsonValidator` 接口（name + validate 方法）→ ② 每个校验规则是一个独立组件：`requiredFieldsValidator` / `agentTypeValidator` / `statusValidator` / `stepsValidator` / `triggerTagsValidator` / `createdAtValidator` → ③ 全部注册到 `VALIDATOR_REGISTRY` 数组 → ④ `validateExternalSkillJson()` 遍历执行，不短路（收集完整诊断） |
| **Expected Output** | 新增校验规则 = 新增一个 validator 组件 + 注册，不改主函数 |

**代码证据：**
- `packages/engine/src/components/skill-json-validator.ts` — 7 个 validator 组件 + 注册表

### P18 — 文件回溯技能提取（File Scan Skill Extraction）

| 属性 | 描述 |
|------|------|
| **Trigger** | 项目中的 pattern*.md / design*.md / review*.md / audit*.md 等文件可能蕴含技能，需自动扫描提取 |
| **Tags** | `skill`, `extraction`, `file-scan`, `reverse-engineering` |
| **Steps** | ① 定义 `SCAN_PATTERNS`（glob + kind 映射）→ ② `findFiles()` 递归遍历工作目录（深度≤5）→ ③ `extractSkillsFromMarkdown()` 多策略提取：JSON块 → P0-P9段落 → 模式N段落 → 文件标题兜底 → ④ 去重（seenIds Set） |
| **Expected Output** | 无需人工标注，项目文档自动转化为技能模板 |

**代码证据：**
- `packages/engine/src/components/skill-persister.ts` — `scanOutputFilesForSkills()`, `extractPNSections()`, `extractPatternSections()`

---

## 5. 持久化模式

### P19 — MemoryStore 三层记忆架构（Three-Tier Memory Store）

| 属性 | 描述 |
|------|------|
| **Trigger** | Agent 需要区分临时任务日志、持久概念知识、技能经验等不同记忆类型 |
| **Tags** | `memory`, `persistence`, `architecture` |
| **Steps** | ① 三类 MemoryType：`TaskLog`（情景/执行记录）、`Skill`（技能模板）、`Insight`（结晶知识）→ ② 每个 MemoryEntry 有 semantic_state（Active/Archived）→ ③ 查询支持 kind 过滤 + semantic_state 过滤 + metadataFilter → ④ 两种读模式：HCA（高语义相关）+ CSA（内容结构分析） |
| **Expected Output** | 记忆检索时能区分"执行记录"和"沉淀知识"，Agent 按需查询 |

**代码证据：**
- `packages/engine/src/memory/` — MemoryStore 实现
- `packages/engine/src/components/skill-persister.ts` — MemoryType 区分写入

### P20 — 技能持久化桥接模式（Skill Persistence Bridge）

| 属性 | 描述 |
|------|------|
| **Trigger** | SkillRegistry（内存）和 MemoryStore（持久化）需要双向同步 |
| **Tags** | `skill`, `persistence`, `bridge`, `sync` |
| **Steps** | ① `persistSkillsToMemory()` — Registry → MemoryStore（批量写入 MemoryType.Skill）→ ② `loadSkillsFromMemory()` — MemoryStore → Registry（反序列化恢复）→ ③ `crystallizeSkillToKnowledge()` — 技能→知识升级写入 MemoryType.Insight |
| **Expected Output** | 进程重启后，技能从 MemoryStore 恢复；JSON 文件是迁移兜底（已被废弃） |

**代码证据：**
- `packages/engine/src/components/skill-persister.ts` — 三个核心桥函数
- `packages/engine/src/bootstrap/init-skills.ts` — 初始化时从 MemoryStore 恢复

---

## 6. 可复用技能

以下技能直接从代码库的 skills/*.json 和源码模式中提取，可直接用于新项目：

### S1 — P10: CI 门禁全流程
**id**: `skill-p10-ci-gate-full-cycle`
**kind**: `workflow`
**trigger**: 需要执行 CI 门禁检查时（build → typecheck → test → lint 全流程）
**steps**:
1. 执行 `pnpm install` 确认依赖已安装
2. 按依赖拓扑顺序执行 `pnpm -r build`
3. 逐包执行 `pnpm -r typecheck`
4. 按包粒度执行 `pnpm -r test`（llm 包用 `--passWithNoTests`）
5. 执行 `pnpm lint`
6. 汇总 build/typecheck/test/lint 四项结果
7. 若有失败项，输出详情并中止后续步骤

### S2 — P11: 技能结晶循环
**id**: `skill-p11-skill-crystallization-loop`
**kind**: `workflow`
**trigger**: Agent 执行完成后需要将产出的模式沉淀为可复用技能
**steps**:
1. 从 Agent 输出提取 SkillTemplate JSON
2. 校验模板字段完整性（必需 id/name/kind/triggerTags/steps）
3. 注册到 SkillRegistry（status=trial, weight=0）
4. 下次相似任务触发时，MetaAgent 按标签匹配建议
5. 执行 Agent 拉取参考，使用后带回评价
6. weight 累加，status 纯函数推导
7. trial→active 时触发事实认证→结晶为知识

### S3 — P12: 分层缺陷报告
**id**: `skill-p12-code-review-tiered-defect-report`
**kind**: `workflow`
**trigger**: 代码审查后发现多个缺陷需要分层组织报告
**steps**:
1. 按严重程度将缺陷分为 P0（阻塞）/ P1（严重）/ P2（一般）/ P3（建议）
2. 为每个缺陷标注文件位置 + 行号范围
3. 每个缺陷附带修复建议
4. 统计各层级缺陷数量
5. 提供总体代码健康度评估

### S4 — P13: 文件侦察清单
**id**: `skill-p13-file-reconnaissance-inventory`
**kind**: `workflow`
**trigger**: 需要快速了解项目目录结构和文件分布
**steps**:
1. 遍历项目根目录，识别目录结构树
2. 按文件类型分类统计（.ts / .json / .md / config 等）
3. 标注关键配置文件位置
4. 标注入口文件位置
5. 生成文件清单报告

### S5 — P14: 包迁移至 Monorepo
**id**: `skill-p14-package-migration-to-monorepo`
**kind**: `workflow`
**trigger**: 需要将独立包迁移到 pnpm workspace monorepo 中
**steps**:
1. 在 packages/ 下创建同名子目录
2. 从独立包复制 src/ + tests/ + package.json + tsconfig.json
3. 更新 package.json 的 name 为 @scope/package-name
4. 更新跨包 imports 从相对路径改为包名
5. 更新根 pnpm-workspace.yaml 添加新包
6. 执行 `pnpm install` 验证 workspace 链接
7. 执行 `pnpm -r build --filter <new-pkg>` 验证构建

### S6 — P17: 分层测试组织
**id**: `skill-p17-vitest-hierarchical-test-org`
**kind**: `thought`
**trigger**: 需要组织 vitest 测试配置文件以实现不同的测试运行场景
**steps**:
1. 创建 vitest.config.ts（默认配置）
2. 创建 vitest.ci.config.ts（CI 专用配置，含 junit reporter）
3. 创建 vitest.ci-slow.config.ts（耗时测试配置）
4. package.json 中配置 test/typecheck/lint 脚本
5. CI 中通过 --config 指定不同配置
6. 使用 `--passWithNoTests` 跳过无测试文件的包

### S7 — P25: 事件负载映射一致性审计
**id**: `skill-p25-event-payload-map-consistency-audit`
**kind**: `thought`
**trigger**: 需要确保事件路由表、Agent produces 声明、handler 处理之间的一致性
**steps**:
1. 提取 cortex-agents.json 中所有 agent 的 produces 列表
2. 提取 eventRouting.routeTable 中的 keys
3. 跨比对：每个 produce 事件是否在 routeTable 中有对应条目
4. 检查 routeTable 中的事件类型命名规范
5. 输出不一致项报告

### S8 — P29: Agent 标签重叠检测
**id**: `skill-p29-agent-tags-overlap-detection`
**kind**: `thought`
**trigger**: 需要检测不同 Agent 之间的标签重叠度，判断 Agent 职责边界是否清晰
**steps**:
1. 提取 cortex-agents.json 中所有 agent 的 tags
2. 对每对 agent 计算 Jaccard 相似度 = |A∩B| / |A∪B|
3. 标记重叠度 > 0.5 的 agent 对
4. 建议职责细分或合并

### S9 — P30: any 类型泄露扫描
**id**: `skill-p30-any-type-leak-scanner`
**kind**: `action`
**trigger**: 代码库中出现 `: any` 类型，需要追踪并消除
**steps**:
1. 搜索全局 `: any` 和 `as any` 出现位置
2. 分类：函数返回类型 / 参数类型 / 变量声明 / 类型断言
3. 对每个位置评估是否可以替换为具体类型或 `unknown`
4. 生成 `any` 泄露清单

### S10 — P31: console → observer 迁移审计
**id**: `skill-p31-console-to-observer-migration-audit`
**kind**: `action`
**trigger**: 代码中使用 `console.log/warn/error` 需要迁移到 PipelineObserver 事件系统
**steps**:
1. 搜索 `console.log` / `console.warn` / `console.error`
2. 排除测试文件和 CLI 输出（需要 console 的场景）
3. 对业务代码中的 console 调用标记
4. 替换为 `observer.emit({ type, priority, payload })`
5. 未迁移的 console 保留为 eslint 警告

### S11 — P35: 双重初始化守卫模式
**id**: `skill-p35-double-init-guard-pattern`
**kind**: `action`
**trigger**: 服务/组件有初始化/未初始化状态，防止重复初始化或未初始化就使用
**steps**:
1. 声明 `_initialized` 布尔标志位
2. 所有公开方法入口检查 `if (!this._initialized) throw`
3. init() 方法先检查 `if (this._initialized) return`
4. 所有状态修改走标志位守卫

### S12 — P36: 告警节流守卫模式
**id**: `skill-p36-alert-throttle-guard-pattern`
**kind**: `action`
**trigger**: 同一告警在高频重复触发时需要有节流机制
**steps**:
1. 定义节流窗口（如 30 秒）
2. 每个告警类型记录上次触发时间戳
3. 触发前检查：若在窗口内则静默跳过
4. 窗口外则触发并更新时间戳

### S13 — P37: 全链路最终验收
**id**: `skill-p37-full-chain-final-acceptance`
**kind**: `workflow`
**trigger**: 功能开发完成后需要全链路验证
**steps**:
1. 验证配置文件（cortex-agents.json 等）完整性
2. 验证 build 通过（pnpm -r build）
3. 验证 typecheck 通过
4. 验证 test 通过
5. 验证 lint 通过
6. 冒烟测试入口 cli
7. 输出验收报告

### S14 — P38: Prompt Kit 开发模式
**id**: `skill-p38-prompt-kit-development-pattern`
**kind**: `workflow`
**trigger**: 需要为 Agent 开发系统提示词时
**steps**:
1. 在 prompts/<agent>/ 目录下创建 system.md
2. 定义 Agent 角色、职责、产出物类型
3. 定义工具使用约束
4. 定义记忆检索策略
5. 定义输出格式要求
6. 引用已有的技能池模板
7. 与 roundtable.md 协同定义协作方式

---

## 7. 设计决策模式

### D1 — "Fail Fast, No Half-Init" 原则

**决策**：引导流水线任一阶段失败则抛错退出，不留半启动状态。
**代码**：`packages/factory/src/bootstrap.ts` — 每个 load 都有 try-catch + throw，无 fallback。
**适用**：初始化逻辑应全或无，避免调用方拿到部分初始化对象。

### D2 — "State Is Derived, Not Stored" 原则

**决策**：技能 status 是 `deriveStatus(weight, feedbackHistory)` 的纯函数计算结果，而非存储字段。
**代码**：`packages/engine/src/registry/skill-registry.ts` — `deriveStatus()`, `recordFeedback()` 后重新计算。
**适用**：任何可通过现有数据计算出的状态都不应持久化存储，避免不一致。

### D3 — "Pluggable Over Hardcoded" 原则

**决策**：校验规则（SkillJsonValidator）、插件（PluginLoader）、调度策略（IScheduleStrategy）全部设计为可插拔组件。
**代码**：`packages/engine/src/components/skill-json-validator.ts` — VALIDATOR_REGISTRY 数组，新增规则=新增组件+注册。
**适用**：预见到会有扩展点的逻辑，一开始就用注册表模式，避免后续 hardcode 扩散。

### D4 — "External Input Is Never Trusted" 原则

**决策**：外源 JSON 的 status="active" 强制降级为 trial；外部声明的 weight/adoptionCount 需要交叉验证。
**代码**：`packages/engine/src/components/skill-json-validator.ts` — `resolveStatus()` 安全约束；`normalizeStatus()` 降级逻辑。
**适用**：所有外部输入都应在边界处做安全降级处理。

### D5 — "Composition Over Inheritance" 原则

**决策**：`createAgent()` 工厂函数替代 `abstract class BaseAgent`，纯数据配置替代抽象方法覆写。
**代码**：`packages/engine/src/components/agent-factory.ts` — AgentFactoryConfig 接口 + createAgent 工厂。
**适用**：有多个变体但共享行为模式时，用组合工厂+依赖注入替代类继承。

### D6 — "Memory Is The Single Source Of Truth" 原则

**决策**：v2.6 后 MemoryStore 是技能持久化的唯一真相源，JSON 文件兜底仅用于旧版迁移（已废弃）。
**代码**：`packages/engine/src/bootstrap/init-skills.ts` — 先从 MemoryStore 恢复，JSON 文件是 `totalCount===0` 时兜底。
**适用**：持久化方案有且只有一个主源，其他方案只做迁移兼容，不做日常读写。

---

## 技能应用矩阵

| 模式/技能 | 应用于 | 产出物类型 | 复用价值 |
|-----------|--------|-----------|---------|
| P1 微核心+插件 | 系统架构 | 架构决策 | ⭐⭐⭐⭐⭐ |
| P2 四阶段引导 | 启动流程 | 启动模板 | ⭐⭐⭐⭐⭐ |
| P3 组合工厂 | Agent 创建 | 代码模式 | ⭐⭐⭐⭐ |
| P5 CLI 三层路由 | 命令行工具 | 代码模式 | ⭐⭐⭐⭐ |
| P9 ReAct 循环 | LLM Agent 执行 | 执行引擎 | ⭐⭐⭐⭐⭐ |
| P13 技能即记忆 | 知识沉淀 | 设计理念 | ⭐⭐⭐⭐⭐ |
| P14 双路径入池 | 技能采集 | 架构模式 | ⭐⭐⭐⭐ |
| P17 可插拔校验 | 数据验证 | 代码模式 | ⭐⭐⭐⭐ |
| P19 三层记忆架构 | 持久化 | 架构决策 | ⭐⭐⭐⭐⭐ |
| S1 CI 门禁 | 构建/测试 | 可执行技能 | ⭐⭐⭐⭐⭐ |
| S14 Prompt Kit | Agent 开发 | 开发流程 | ⭐⭐⭐⭐⭐ |

---

## 总结

本报告从 Cortex Monorepo 的全链路源码中提取了 **19 个架构/设计模式**（P1-P19）、
**14 个可复用技能**（S1-S14）和 **6 个设计决策原则**（D1-D6）。

核心设计哲学可概括为：
1. **微核心 + 插件化** — 核心只做编排，功能通过插件扩展
2. **技能即记忆** — 经验沉淀是被参照的结构化认知，非可执行函数
3. **状态即推导** — 状态从数据纯函数计算，不持久化存储
4. **组合优于继承** — 工厂函数+依赖注入替代类继承
5. **记忆即真相源** — MemoryStore 是唯一持久化主源
