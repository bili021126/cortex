# Cortex 全量深入分析报告

> 生成时间: 2026-07-19
> 范围: 全项目 ~31 包, ~48K 行 TypeScript, ~3172 测试

---

## 〇、项目身份

**Cortex** 是一个**自治理 AI Agent 运行时**——跑在本地终端里的 monorepo。不是 SaaS，不是框架，是个人 AI 工程助手系统。

- **定位**: 终端优先 (CLI+TUI)，Agent 驱动，多模型路由，记忆持久化
- **堆栈**: TypeScript + Node.js，pnpm workspace monorepo (9.15.4)
- **模型层**: DeepSeek (主) / OpenAI (备)，通过 `@cortex/llm` 统一适配
- **宪法系统**: 昔涟宪法，12 章，治理整个项目的开发行为
- **代码规模**: ~31 包，~48K 行 TS，~3172 测试 (通过率 ~98%)
- **已知缺陷**: 五轮审查发现 ~260 项缺陷 (~30 Critical/~60 High)

---

## 一、四层架构总览

```
应用层    cli / tui / webui
集成层    engine / scheduler / platform
能力层    llm / memory-store / governance / consistency / fsm-compiler / prompt-kit / skill-kit / context-manager
基础层    shared / config / telemetry / notification / logging / resilience / parser / pattern-extractor
辅助层    tools / doctor / testing / plugin-runner
```

### 依赖方向（不可逆）

```
基础层 ← 能力层 ← 集成层 ← 应用层

shared/config (零外部依赖) → memory/llm → engine/scheduler → cli/tui
```

---

## 二、完整包清单

| 层 | 包名 | 职责 | 行数 |
|---|------|------|:---:|
| 基础 | `@cortex/shared` | 类型契约：Agent/Memory/Task/PipelineObserver 等 | ~3000 |
| 基础 | `@cortex/config` | 常量、默认值、环境变量、超时配置 | ~1500 |
| 基础 | `@cortex/telemetry` | 运行时遥测采集/采样/批处理 | ~800 |
| 基础 | `@cortex/notification` | 四通道通知管线 | ~700 |
| 基础 | `@cortex/logging` | 结构化日志 | ~500 |
| 基础 | `@cortex/resilience` | 韧性策略：重试/超时/断路器 | ~900 |
| 基础 | `@cortex/parser` | Markdown→HTML 转换器 | ~200 |
| 基础 | `@cortex/pattern-extractor` | 代码模式提取 | ~1200 |
| 能力 | `@cortex/llm` | LLM 适配器：重试/限流/缓存/超时/降级 | ~1200 |
| 能力 | `@cortex/memory` | 记忆存储层：接口/文件实现/事务 | ~2000 |
| 能力 | `@cortex/memory-store` | 记忆认知层：BM25+向量混合检索 | ~3000 |
| 能力 | `@cortex/governance` | 修宪管线：提案/评判/闭环/超时 | ~1500 |
| 能力 | `@cortex/consistency` | 六层记忆-现实一致性防御 (已迁入 governance) | ~800 |
| 能力 | `@cortex/prompt-kit` | 提示词模板引擎 | ~1500 |
| 能力 | `@cortex/skill-kit` | 技能模板引擎 | ~500 |
| 能力 | `@cortex/fsm-compiler` | 状态机编译器 + 运行时 | ~800 |
| 能力 | `@cortex/context-manager` | 上下文策略解析 | ~600 |
| 集成 | `@cortex/engine` | **运行时内核**：bootstrap/ReAct/Agent/记忆管线 | ~12000 |
| 集成 | `@cortex/scheduler` | **调度核心**：TaskBoard/AgentPool/dispatch-steps/重规划 | ~4000 |
| 集成 | `@cortex/platform` | 平台工具：19 个内置工具/Toolkit/MCP | ~3000 |
| 应用 | `@cortex/cli` | CLI 入口 + session/context 管理 | ~3000 |
| 应用 | `@cortex/tui` | TUI 渲染组件 (ANSI readline + Ink React) | ~2000 |
| 辅助 | `@cortex/tools` | monorepo 分析器 + 配置漂移检测 | ~600 |
| 辅助 | `@cortex/doctor` | 诊断工具 | ~500 |
| 辅助 | `@cortex/testing` | 测试数据生成 | ~300 |
| 辅助 | `@cortex/plugin-runner` | 插件基础设施 | ~500 |

---

## 三、运行时——完整执行流水线

### 3.1 七步执行链路

```
用户意图 → IntentFactWall → MetaAgent 规划 → TaskBoard 拓扑排序
→ AgentPool 认领 → ReAct 循环执行 → PipelineObserver 事件广播 → 记忆落盘
```

### 3.2 核心组件表

| 步骤 | 组件 | 位置 | 行数 |
|------|------|------|:---:|
| 意图清洗 | IntentFactWall | `engine/src/core/intent-fact-wall.ts` | ~300 |
| 粗粒度规划 | MetaAgent（甘雨） | `engine/src/core/meta-agent.ts` | 774 |
| 拓扑排序 | TopologicalSort | `scheduler/src/core/topological-sort.ts` | ~200 |
| Agent 池 | AgentPool | `scheduler/src/core/agent-pool.ts` | ~400 |
| ReAct 循环 | ReactLoop | `engine/src/components/react-loop.ts` | ~300 |
| 事件广播 | PipelineObserver | `scheduler/src/core/pipeline-observer.ts` | ~300 |
| 记忆写入 | MemoryPipeline | `engine/src/memory-bridge/pipeline.ts` | ~400 |

### 3.3 ReAct 循环四策略

`LoopStrategyRegistry` 管理四种执行策略：

| 策略 | 触发条件 | 说明 |
|------|---------|------|
| `direct` | 任务文本 < 200 字符 | 跳过 ReAct，直通执行 |
| `decompose` | 文本 > 500 字符 或 isRlmSubtask 或特定 tags | LLM 递归拆解执行 |
| `jury` | needsMultiPerspective=true | 多 Agent 并行裁决 |
| `react` | 默认回退 | 标准 ReAct 循环 |

---

## 四、Scheduler 调度核心

### 4.1 四抽象架构

`CompositeScheduler` 通过四种可替换抽象实现灵活调度：

| 抽象 | 接口 | 默认实现 | 职责 |
|------|------|---------|------|
| 调度策略 | `IScheduleStrategy` | `TagMatchingStrategy` | 决定任务由哪个 Agent 执行 |
| 循环驱动 | `ILoopDriver` | `TopologicalLayeredDriver` | 控制执行循环如何推进 |
| 执行范式 | `IExecutionModel` | `PipelineModel` | 控制单节点执行方式 |
| 模型路由 | `IModelRouter` | `FixedModelRouter` | 决定节点使用的 LLM 模型 |

### 4.2 Dispatch Pipeline 六步骤

```
ClaimStep → SpawnStep → ExecuteStep/RlmExecuteStep → BoundaryGuardStep → CleanupStep
```

| 步骤 | 前置条件 | 后置条件 | 失败场景 |
|------|---------|---------|---------|
| **ClaimStep** | node 存在，agents 已注册 | agentType/agent 已填充 | 无匹配 Agent / 认领失败 |
| **SpawnStep** | agentType/agent 已填充 | instanceId 已填充，Agent 已唤醒 | mHC 超时 / 池耗尽 |
| **ExecuteStep** | agent 可用 | result 已填充 | agent.execute() 异常 |
| **RlmExecuteStep** | llmChat 可选 | result 已填充 | 拆解失败回退直接执行 |
| **BoundaryGuardStep** | result.success=true | boundaryViolation 标记 | 扫描失败不阻塞 |
| **CleanupStep** | 始终执行 | mHC 释放 + Pool 销毁 + Board 落盘 | 不阻断流程 |

### 4.3 TaskBoard DAG 状态机

```
pending → claimed/running → done/failed
```

- **hard** 边：子节点等父节点完成（默认）
- **soft** 边：同层并行，收敛时等结果
- **trigger** 边：父成功才触发子
- **多视角节点**：needsMultiPerspective=true 时，多个 Agent 并行认领，全部完成才置 done

### 4.4 AgentPool 状态机

```
Created → Awake → Active ↔ Awake → Draining → Destroyed
```

- 每 Agent 类型有 `maxInstances` 配额
- RLM 子任务通过 `spawnSubtask()` 绕过配额

### 4.5 ManifoldGate 流控

深度求索 mHC 流形约束：同类 Agent 并发数 ≤ maxInstances
- FIFO 公平排队，无饥饿
- 可配置超时，默认 60s
- 支持热重载 `updateMax()`

### 4.6 ReplanManager 重规划

- 失败节点自动入队重规划
- 配额：每节点 ≤ 3 次，全局 ≤ 50 次
- 超限后进入降级模式（`_drainDegraded`）
- `resolveChains()`：若任意后代成功则修正原始节点为成功

### 4.7 ConfirmGate + TrustModel

**可逆性等级判定矩阵：**

| 等级 | 类型 | ConfirmGate | 并发 |
|------|------|:--:|:--:|
| L0 | 只读（read_file/search_code） | 不需要 | 并行 |
| L1 | 弱写（目前未分配） | 信任模型判定 | 串行 |
| L2 | 强写（write_file/edit） | 永远确认 | 串行 |
| L3 | 不可逆（delete_file/run_shell） | 永远确认 | 串行 |

**TrustModel 信任模型：**
- L1（冷启动）→ L2（连续 5 次接受）→ L3（连续 15 次接受）
- 任一拒绝 → 重置为 L1
- 7 天无活动 → 降一级

---

## 五、Engine 引擎胶水层

### 5.1 Bootstrap 启动管线

`bootstrap-engine.ts` 完成 14 步初始化：

1. Config 加载 → 2. PromptManager 设置 → 3. Registry 注入 → 4. Plugin 注册
5. Plugin 加载 → 6. 组件提取 → 7. 遥测初始化 → 8. Core-2 模块接线
9. 技能系统初始化 → 10. 特殊 Agent 创建 → 11. WorkerPool 设置
12. 生命周期注册 → 13. 昔涟记忆初始化 → 14. 装配返回

### 5.2 Agent 注册表（14 个 Agent）

| Agent | 类型 | 角色 | 模型 | 工具集 |
|-------|------|------|:----:|--------|
| 甘雨 | `meta` | 七星秘书 - 规划 | **pro** | 只读 |
| 阿贝多 | `code` | 首席炼金术士 - 实现 | flash | **全部** |
| 刻晴 | `review` | 玉衡星 - 审查 | flash | 基础 |
| 纳西妲 | `analysis` | 草神 - 分析 | flash | 基础 |
| 北斗 | `ops` | 南十字船长 - 运维 | flash | **全部** |
| 莫娜 | `loop` | 占星术士 - 模式提取 | flash | 基础 |
| 凝光 | `doc-govern` | 天权星 - 文档审计 | flash | 基础 |
| 希格雯 | `fix` | 护士长 - 修复 | flash | **全部** |
| 久岐忍 | `api` | 外务奉行 - API | flash | 基础 |
| 艾尔海森 | `data` | 大书记官 - 数据 | flash | 基础 |
| 安柏 | `inspector` | 侦察骑士 - 侦察 | flash | 基础 |
| 宵宫 | `browser` | 烟花店老板 - UI | flash | 基础 + browser_do |
| 昔涟 | `butler` | 记忆守望者 - 管家 | flash | 只读子集 |
| 钟离 | `strategist` | 往生堂客卿 - 战略 | **pro** | 只读(预留) |

### 5.3 Agent 自声明系统

每个 Agent 通过导出静态 `capability` 自声明：
```typescript
interface AgentCapability {
  id, type, role, emoji, tags, produces,
  toolPermissions, memoryQueryStrategy,
  maxInstances, modelKey, applicableScenarios,
  outputFormat, collaborationMode
}
```
系统启动时自动收集，MetaAgent 据此自组装团队。

### 5.4 插件系统（v3.0+）

10 个 Plugin 通过 `PluginLoader` 集中注册：
- pipeline-observer / task-board / agent-pool / confirm-gate / trust-model
- file-lock-manager / memory-store / meta-agent / consistency-layer / scheduler

生命周期：`init → postInit → start`，拓扑排序保证顺序。

---

## 六、记忆系统

### 6.1 双包架构

| 包 | 角色 | 功能 |
|---|------|------|
| `@cortex/memory` | 存储层 | IMemoryStore 接口 + FileBackend + 事务 + FSM |
| `@cortex/memory-store` | 认知层 | BM25 + 向量混合检索 + dedup + 权重老化 + RAG |

### 6.2 四态 FSM

```
Pending → Active → Archived → Obliterated
```

- `MEMORY_VALID_TRANSITIONS` 单源真相表控制
- CAS（Compare-And-Swap）原子操作
- Obliterated 为终态，条目从索引移除

### 6.3 MemoryEntry v3 四层结构

| 层 | 字段 | 说明 |
|----|------|------|
| 身份层 | id, source, domain, sessionId | 写后永不变 |
| 认知层 | kind, isFact, summary, semantic_gist, content_blob | 自迭代操作对象 |
| 生命周期层 | semantic_state, weight, accessCount, lastAccessedAt, createdAt | FSM 驱动态管理 |
| 工程层 | embedding, content_hash, expires_at | 不参与检索语义 |

### 6.4 MemoryKind 五类

| 类型 | 语义 | isFact | CSA 过滤 |
|------|------|:------:|:--------:|
| TaskLog | 任务执行记录 | true | 保留 |
| Insight | 洞察/分析结论 | true | 保留 |
| Skill | 技能提取/结晶 | true | 保留 |
| Governance | 治理决策 | true | 保留 |
| Intent | 意图/待办 | false | **排除** |

### 6.5 HCA vs CSA 读取模式

| 模式 | 用途 | 追踪热度 | 默认 Limit | 过滤 |
|------|------|:--------:|:--------:|------|
| HCA | MetaAgent 规划/全局扫描 | 不追踪 | 10 | 不过滤 |
| CSA | Agent 执行决策 | 追踪 | 3 | 排除 isFact=false |

### 6.6 混合检索管线

```
BM25 Top-2M + Vector Top-2M → 归一化融合 → Greedy 精排 → 边界回归
```

- BM25：Okapi BM25，多字段加权（summary:2, semantic_gist:1, payload:0.5）
- 向量：384d ONNX embedding（@xenova/transformers）
- 融合公式：`hybridScore = alpha * bm25Norm + beta * cosNorm`
- 自适应边界回归：EMA 阈值自校准

### 6.7 两阶段提交

1. `writePending()` → 存入 _pendingEntries（对 read() 不可见）
2. `commitMemory()` → Pending→Active，写入主索引
3. `rollback()` / `cancel()` → 回滚或自动判定

### 6.8 文件持久化 FileBasedMemoryStore

```
<basePath>/
  index.json     # 索引（version, updatedAt, entries）
  links.json     # 链接（version, updatedAt, links）
  entries/       # 单文件 <id>.json
```

原子写入：`writeFile(tmp) → rename(tmp, file)`，防部分写损坏。

---

## 七、治理层

### 7.1 三轴治理

```
事轴（命令流，自上而下）：用户意图 → MetaAgent → TaskBoard → Scheduler → Agent 执行
权轴（约束流，自下而上）：Agent 异常 → SafeErrorReporter → 重规划 → ConfirmGate → 用户裁决
横切（监督流，独立于事轴）：PipelineObserver 独立监听所有事件，DocGovernAgent 独立审计
```

### 7.2 16 个已落地治理组件

**横切——监督基础设施（5）**：
- PipelineObserver（事件管道，CRITICAL/HIGH/NORMAL 三级）
- SentinelSignalFilter（L1/L2/L3 信号分层，告警风暴检测）
- SafeErrorReporter（三档：fatal/degraded/silent）
- DocGovernAgent（plan_review / doc_audit / constitution_check）
- ConsistencyLayer（六层记忆-现实一致性防御）

**权轴——约束上报（4）**：
- ConfirmGate（L0-L3 可逆性等级拦截）
- ReplanManager（重规划配额，超限 escalateToUser）
- DecisionGateBridge（DECISION_REQUIRED → ConfirmGate 自动阻断）
- ResiliencePolicyFactory（LLM 重试 + 工具熔断）

**事轴——命令传导（5）**：
- MetaAgent 三轴感知
- TaskRouter 三层优先级策略路由
- EnvironmentAwareRouter 环境感知模型降级
- LoopStrategyRegistry 四策略注册表
- SkillScope 四级作用域解析

**治理内化（2）**：
- GovernanceLoop 修宪自动化管线
- NotificationRuntime PipelineObserver → NotificationPipe 桥接

### 7.3 六层防御

```
L1: IntentFactWall    —— 意图清洗（kind 自动推断 isFact）
L2: InitVerifier      —— 启动时记忆-现实一致性校验
L3: SchemaEnforcer    —— 记忆写入时的 Schema 校验
L4: SentinelSignalFilter —— 运行时信号分层过滤
L5: ConfirmGate       —— L2/L3 工具调用需用户确认
L6: GovernanceLoop    —— 修宪闭环写入
```

### 7.4 修宪管线

`draft → pending_judgment → approved/rejected → applied`

6 个默认检查：
1. **principle-immutability** (权重 2.0, 阻断) — 原则不可变
2. **version-continuity** (权重 1.0) — 版本号递增
3. **structural-consistency** (权重 1.5, 阻断) — before 段落匹配宪法
4. **cross-reference-integrity** (权重 1.5, 阻断) — 交叉引用存在
5. **impact-scope** (权重 1.0) — 声明影响范围
6. **format-consistency** (权重 1.0) — 格式检查

### 7.5 宪法自约束九子验证

宪法原则七要求每次修宪通过 9 个子约束检查：
① 显式引用 ② 完整记录 ③ 最小改动 ④ 架构保护
⑤ 独立审计 ⑥ 阶段限定 ⑦ 元规则保护 ⑧ 硬编码禁令 ⑨ 类型安全保障

---

## 八、工具系统

### 8.1 19 个内置工具

| 工具名 | 分类 | 可逆性 | 需锁 | 描述 |
|--------|------|:------:|:----:|------|
| `read_file` | Read | L0 | - | 读取文件 |
| `read_many_files` | Read | L0 | - | 批量并行读 (≤10) |
| `list_files` | Read | L0 | - | 列出目录 |
| `file_info` | Read | L0 | - | 文件元信息 |
| `diff_files` | Read | L0 | - | Unified diff (LCS) |
| `json_query` | Read | L0 | - | JSONPath 查询 |
| `resolve_import` | Read | L0 | - | 模块解析 |
| `parse_ast` | Read | L0 | - | TS AST 解析 |
| `search_code` | Search | L0 | - | ripgrep 全文搜索 |
| `search_symbol` | Search | L0 | - | TS 符号表 |
| `grep_files` | Search | L0 | - | 指定文件搜索 |
| `glob_find` | Search | L0 | - | Glob 匹配 |
| `web_search` | Search | L0 | - | 网络搜索 |
| `write_file` | Write | **L2** | **是** | 写文件 |
| `edit_file` | Write | **L2** | - | 精确替换 |
| `format_code` | Write | **L2** | - | 格式化代码 |
| `run_test` | Shell | **L2** | - | 运行测试 |
| `run_shell` | Shell | **L3** | - | 执行命令（沙箱） |
| `delete_file` | Write | **L3** | **是** | 删除文件 |

### 8.2 Toolkit.execute() 四阶段管线

```
invocation → ① 权限检查 → ② 工具查找 → ③ ConfirmGate → ④ 文件锁 → tool.execute()
```

### 8.3 安全加固

- **路径沙箱**：`_resolvePath()` 配合 `realpathSync.native` 防止符号链接逃逸
- **Shell 注入防护**：命令元字符过滤 + `execFile` 参数模式
- **输出截断**：Shell 输出上限 10000 字符
- **格式化器白名单**：仅允许 prettier/eslint/biome
- **Agent 权限模型**：静态表 + 运行时覆写，只读 Agent 不可升级到写权限

---

## 九、用户界面层（CLI/TUI）

### 9.1 CLI 架构

```
main.ts → bootstrapEngine() → EngineBridge → CommandRegistry(15 commands)
```

15 个命令：run / agent / task / memory / config / schedule / roundtable / confirm / skill / inspect / doctor / doc / setup / version / help

### 9.2 EngineBridge 核心入口

- `chat()` / `streamChat()` — 直接 LLM 调用
- `executeToolCall()` — 工具执行
- `submitTask()` / `executeAll()` / `executeWithStream()` — 任务执行
- `getMetaAgent()` — 甘雨规划

### 9.3 TUI 双后端

| 后端 | 依赖 | 适用场景 |
|------|------|---------|
| **ANSI readline** | `readline.Interface` | 默认轻量模式 |
| **Ink React** | `ink` + `react` | `--ink` 标志触发 |

### 9.4 TUI 五种模式

| 模式 | 标签 | 说明 |
|------|------|------|
| **chat** | 对话 | 默认模式，与单 Agent 对话 |
| **talk** | 闲聊 | 无工具的纯聊天 |
| **plan** | 计划执行 | 甘雨规划 → 多 Agent 协同 |
| **party** | 群聊 | 多 Agent 自主对话 |
| **command** | 命令 | 直接 CLI 命令，绕过 LLM |

---

## 十、基础设施层

### 10.1 `@cortex/llm` — LLM 适配器

- DeepSeek API 封装（标准 + 流式）
- 限流：滑动窗口 RPM + 日 Token 配额
- 缓存：LRU，精确/指纹双模式
- 断路器：连续失败最大 3 次，指数退避
- 降级：Flash→Pro（429/503 触发）
- WorkerPool：>10KB 响应走 worker 线程解析

### 10.2 `@cortex/fsm-compiler` — 状态机编译器

三层架构：DSL → Compiler → Runtime

已定义 FSM：

| 定义文件 | 建模对象 | 状态数 |
|---------|---------|:-----:|
| task-node.fsm.json | 任务节点 | 5 |
| agent-pool.fsm.json | Agent 池 | 3 |
| confirm-gate.fsm.json | 确认门禁 | 2 |
| manifold-gate.fsm.json | 流形门禁 | 3 |
| memory-entry.fsm.json | 记忆条目 | 3 |
| trust-model.fsm.json | 信任模型 | 3 |

### 10.3 `@cortex/prompt-kit` — 提示词引擎

6 层提示词框架：
```
身份位置 → 任务范围 → 当前情境 → 可用信息 → 输出规范 → 分寸拿捏
```

17 个角色提示词在 `prompts/<name>/` 下，每份含 system.md + roundtable.md。

### 10.4 `@cortex/skill-kit` — 技能系统

技能生命周期：`trial → active → deprecated`

技能从 Agent 执行输出中提取 → 莫娜模式扫描 → 技能结晶 → 固化到记忆库 → 其他 Agent 复用。

22 个预置技能定义在 `skills/` 目录。

### 10.5 `@cortex/telemetry` — 遥测

- Collectors：Console / File / Health
- Samplers：RateSampler / ThresholdSampler（策略模式）
- Batchers：SizeBatcher / TimeBatcher（策略模式）
- ConsoleBridge：拦截 console.log/warn/error → PipelineObserver
- PanoramaTracker：全执行链路追踪
- AlertEngine：可配置告警规则

### 10.6 `@cortex/resilience` — 韧性策略

| 策略 | 实现 | 说明 |
|------|------|------|
| 重试 | ExponentialBackoff / FixedRetry | 指数退避 + 抖动 |
| 断路器 | SimpleCircuitBreaker / StateMachineCircuitBreaker | 连续失败 / FSM 驱动 |
| 超时 | FixedTimeout / AdaptiveTimeout | 固定 / 历史自适应 |

---

## 十一、关键设计哲学

1. **暴露不可靠，治理内化**：不追求模型完美，追求系统在模型不可靠时仍然可控
2. **确认在落地之前**：L2/L3 工具永远需要人类确认
3. **模型辅助，人类终裁**：AI 出方案，人类做决策
4. **硬验证优先**：能走零 token 规则的就走规则，不依赖 LLM 判断
5. **单源真相**：配置只在一处定义，宪法只在一处生效
6. **接口契约化**：所有跨包交互通过 `@cortex/shared` 类型定义，依赖反转

---

## 十二、当前工程状态

| 指标 | 数值 |
|------|------|
| 测试文件 | 173 |
| 测试用例 | 3172（passed: 3122, failed: 50）|
| 通过率 | ~98% |
| ESLint errors | 550（预存，核心 31 包外）|
| ESLint warnings | 511 |
| TypeScript 非 TS5055 错误 | 0 |

### 已知技术债

| 项 | 原因 | 预计解锁 |
|---|------|---------|
| Config schema 验证 | 无外部输入触发 | MCP 工具接入后 |
| NotificationPipe 背压 | 无真实压测场景 | Committee session |
| CPU Worker 化 | 边际收益低 | Core-3 |
| 复合构建 tsup 迁移 | 工作量大 | Core-3 |
| Committee session | 需 Agent 间通信协议 | Core-3 |
| TrustModel | Agent 行为数据不足 | Core-2 后期 |

---

## 十三、架构图

```
┌─────────────────────────────────────────────────────────┐
│                     CLI / TUI                            │
│   packages/cli + packages/tui (ANSI/Ink)                 │
│   15 commands · 5 modes · EngineBridge                  │
├─────────────────────────────────────────────────────────┤
│                     Engine (胶水层)                      │
│   packages/engine (68 files, 11 子目录)                  │
│   Bootstrap · MetaAgent · ReAct · Lifecycle · Plugin    │
├─────────────────────────────────────────────────────────┤
│   Scheduler (调度核心)          │   Platform (工具层)    │
│   packages/scheduler            │   packages/platform    │
│   TaskBoard · AgentPool         │   Toolkit · 19 工具    │
│   Dispatch Pipeline 6-step      │   MCP Client           │
│   ManifoldGate · Replan         │   Path Sandbox         │
│   ConfirmGate · TrustModel      │   L0-L3 Permissions    │
├──────────────────┬──────────────────────────────────────┤
│  Governance      │  Memory                             │
│  packages/       │  packages/memory + memory-store     │
│  governance      │  IMemoryStore · FileBackend         │
│  GovernanceLoop  │  4-State FSM · Two-Phase Commit     │
│  修宪管线六检查 │  BM25 + Vector 混合检索              │
│  九子约束       │  HCA/CSA · DomainGate               │
│  六层防御       │  Statsig 权重老化 · RAG             │
├────────┬────────┼────────┬─────────────────────────────┤
│  LLM   │ FSM   │ Prompt │ Skill   │ Notification      │
│ 适配器 │ 编译器 │ 引擎   │ 系统    │ 四通道通知          │
│ Resili-│ Tele- │ Config │ Shared  │ Logging            │
│ ence   │ metry │ 配置源 │ 类型契约 │ 结构化日志          │
├────────┴───────┴────────┴────────┴─────────────────────┤
│           基础层：零外部依赖 TypeScript                   │
│   packages/shared + packages/config (全项目枢纽)          │
└─────────────────────────────────────────────────────────┘
```

---

*报告结束。如需进一步深入特定模块的源代码级分析，请说明。*
