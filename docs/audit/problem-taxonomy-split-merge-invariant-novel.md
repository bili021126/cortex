# 问题分类：裂·合·不变·新概念

> 基于 `full-codebase-audit.md` 的 59 项问题，按四个维度重新归类。
> 此文档是概念讨论的脚手架——每一项归类都附带判据。

---

## 裂（该裂开的东西）

**判据**：一个模块/文件/常量承担了两种以上语义，或者类型+数据+逻辑混居一处。

### A. 包层裂

| 裂项 | 来源 | 裂法 | 去向 |
|------|------|------|------|
| shared 包类型/运行时混居 | §1.1×4 | 运行时类迁出，shared 回归纯类型 | file-lock-manager→engine, kv-store→engine, lifecycle→engine |
| shared 包类型/数据混居 | §2.1×2 | 数据（PRESET_CONTEXT_POLICIES, AGENT_DEFS, FULL_TOOLSET）迁出 | → @cortex/config |
| engine-telemetry 双副本 | §1.4 | engine 副本删除 | 统一走 @cortex/telemetry |

### B. 模块内裂

| 裂项 | 来源 | 裂法 | 去向 |
|------|------|------|------|
| CognitionEngine 算法/参数混居 | §2.1×2 + §8.1~8.4 | 21 个权重 + 6 组阈值裂出 | → cognition.json + hybrid-retrieval.json |
| LoopStrategy 算法/规则混居 | §3.2 | canHandle 阈值 + TOOL_DEPENDENCY_TAGS 裂出 | → strategy-rules.json |
| NotificationPipe 逻辑/通道配置混居 | §4.4×3 | DEFAULT_CHANNEL_CONFIGS + MERGE_TIMEOUT 裂出 | → channels.json |
| SchedulingDriver 逻辑/波浪定义混居 | §3.1 | DEFAULT_WAVE_DEFINITIONS 裂出 | → wave-defs.json |
| MetaAgent 逻辑/策略路由混居 | §3.3 | _resolveContextPolicy() tag→策略映射 裂出 | → context-policy-rules.json |
| GovernancePipeline 逻辑/阶段序列混居 | §4.2 | DEFAULT_STAGES 裂出 | → pipeline-stages.json |
| AmendmentJudge 逻辑/检查项注册混居 | §4.3 | blocking/weight 注册裂出 | → amendment-checks.json |
| TeamCollab 逻辑/协作配置混居 | §5.1×2 | DEFAULT_TEAM_COLLAB_CONFIG + AGENT_MEMORY_SCOPES 裂出 | → team-collab.json |
| NotificationRuntime 引擎/路由规则混居 | §2.1×1 | defaultSemantics 裂出 | → governance-routing.json |

**裂的本质**：把"是什么"和"怎么配"分开。算法、逻辑、语义留在包里；参数、阈值、映射表迁到 config。

---

## 合（该整合的东西）

**判据**：同一件东西在多处重复定义，或者同一类操作散落在不同位置。

### A. 重复值合并

| 合项 | 来源 | 合法 | 单源 |
|------|------|------|------|
| retrievalAlpha/Beta 双定义 | §2.3 | engine-defaults.ts 和 hybrid-retrieval.ts 统一 | hybrid-retrieval.json |
| DEFAULT_LOCK_TIMEOUT_MS 双定义 | §2.3 | file-lock-manager.ts 和 engine-defaults.ts 统一 | engine-defaults.ts |
| DEFAULT_ACQUIRE_TIMEOUT_MS 双定义 | §2.3 | manifold-gate.ts 和 engine-defaults.ts 统一 | engine-defaults.ts |
| _VALID_TIERS 双定义 | §3.4 | meta-agent.ts 和 scheduling 统一 | @cortex/shared 常量 |

### B. 模式合并

| 合项 | 来源 | 合法 |
|------|------|------|
| 空 catch 20+ 处 | §6.1 + §7.2 | 统一为 DegradationBoundary 模式（见"新概念"） |
| env override 仅 engine-defaults 有 | §2.4 | 推广到 ConfigRegistry 全局 |
| memory-store 内联常量 7 个 | §2.2 | 收归 @cortex/config |
| 13 张 config JSON | §9.2 + §9.3 | 全部注册进 ConfigRegistry |
| hardcoded timeout 多重兜底 | §3.4 + §7.3~7.5 | 统一引用 engine-defaults.ts |

### C. 包收敛

| 合项 | 来源 | 合法 |
|------|------|------|
| toolchain 幽灵包 | §1.3 | 删除 |
| pm 外来包 | §1.3 | 移到 projects/ |
| @deprecated barrel 6 条 | §1.5 | 收口——要么删文件，要么移导出 |
| base-agent.ts 废弃 | §7.1 | 与其他废弃代码统一清理 |

---

## 不变（不能变的东西）

**判据**：这些是 Core-1 沉淀下来的不变式，是架构的骨头。外部化参数不等于改变语义。

| 不变项 | 来源 | 什么不变 | 什么可以变 |
|--------|------|---------|-----------|
| 三轴模型 | 治理层 §4 | 事轴/权轴/横切的语义 | 轴的实现参数可 config |
| MemoryStore 纯存取定位 | 记忆层 §8 | 不往里加调度/策略/domain 过滤 | 上游加调度层 |
| CognitionEngine 打分语义 | §8.2~8.4 | 六维打分算法 | 权重来源从 DEFAULT→config |
| ContextPolicy 语义 | 配置层 §2.1 | fallback 机制 | Policy 内容可 config |
| NotificationPipe 四通道 | §4.4 | Urgent/Important/Routine/Info 语义 | 队列大小/TTL 可 config |
| Scheduler wave 语义 | §3.1 | design→code→review→verify 顺序 | tag→wave 映射可 config |
| 人格记忆层文件注入 | §9.4 | persona-talk.txt 等四文件体系 | 可新增域 |
| Engine bootstrap 顺序 | §7 | 启动流程 | 早期插 ConfigRegistry 注册 |
| pnpm workspace 拓扑 | 整体 | 包依赖方向 | 裂/合在包内 |

**不变量总原则**：架构的"形"不动，只动"参"。

---

## 新概念（需要借助的新概念）

**判据**：当前代码中没有对应物，或者现有的做法只是打补丁，需要引入新的抽象层才能根本解决。

### 1. Config as Runtime（配置即运行时）

**解决的问题**：
- §2.4 env override 不统一
- §2.3 重复默认值
- §9.1 config-management-deepening 未实施
- 30 处硬编码的去向

**概念定义**：配置不再只是静态 JSON 文件——它是运行时可注册、可校验（Zod schema）、可覆盖（env > user > project > defaults）、可热加载（fs.watch）、可漂移检测（CI 比对）的一等公民。

**核心零件**：ConfigRegistry（注册）+ ConfigResolver（覆盖链）+ ConfigWatcher（热加载）+ ConfigSchema（校验）+ drift-detector（CI）

**与不变量的关系**：不改变任何现有包的接口——ConfigRegistry 是基础设施，各包从 `import json` 迁移到 `registry.get()`。

---

### 2. Scene-Aware Retrieval（场景感知检索）

**解决的问题**：
- 检索策略散落在 ContextPolicy、CognitionEngine、ContextBuilder 三处
- 无 scene + persona + task 三元组概念
- 域隔离（工程记忆 vs 亲密记忆）无法表达

**概念定义**：在 MemoryStore 上游插入一个调度层，接收 `{ scene, persona, task }` 三元组，组装复合检索策略（domain 过滤 + weighting override + activeOnly），然后委托 MemoryStore.query()。

**核心零件**：RetrievalScheduler 类 + retrieval-presets.json

**与不变量的关系**：MemoryStore 不改。CognitionEngine 不改。ContextPolicy 作为 fallback 不变。调度层在外面包。

---

### 3. Memory Domain（记忆域）

**解决的问题**：
- 工程记忆和亲密记忆混查
- 纳西妲知识库无法隔离
- 当前 MemoryEntry 无 domain 字段

**概念定义**：每条 MemoryEntry 带一个 `domain` 标签（`engineering` / `intimate` / `knowledge` / ...），检索调度层按 scene + persona 决定 allow/block 规则。写入时自动标注 domain。

**核心零件**：domain 字段（MemoryEntry 类型扩展）+ domain 过滤（retrieval-presets.json）

**与不变量的关系**：MemoryStore 存 domain 但不理解其语义——语义在调度层。类似 HTTP header，传输层不解析。

---

### 4. Signal Routing（信号路由）

**解决的问题**：
- §4.4 notification-runtime.ts 的事件→语义映射是线性的
- 实际治理信号是图状的——一个事件 → 多通道、一个通道 ← 多事件
- governance-routing.json 不只是映射表，应该是路由矩阵

**概念定义**：事件→通道→通知 的三段路由。不是一张静态映射表，而是一个可配置的路由矩阵：同一个事件可以根据 severity 路由到不同通道，同一个通道可以被不同事件以不同优先级触发。

**核心零件**：governance-routing.json（事件路由）+ channels.json（通道参数）+ NotificationPipe（不改）

**与不变量的关系**：NotificationPipe 四通道语义不变。只是把"哪个事件走哪个通道"从硬编码变成可声明。

---

### 5. Degradation Boundary（降级边界）

**解决的问题**：
- §6.1 20+ 处空 catch
- §7.2 3 处空 catch
- 根因不是"忘记加日志"，是"不知道该不该报、不知道怎么报"

**概念定义**：系统级的降级策略声明——定义三个级别：
1. **silent**：非关键路径，异常可丢弃（如 UI 动画、次要传感器）
2. **trace**：记录下来（memory pipeline 清理失败、doc-registry 索引损坏）
3. **escalate**：上报到 notification 通道（会话存储写入失败、关键路径异常）

每个 catch 点声明自己的降级级别，而不是裸 `catch {}`。

**核心零件**：DegradationBoundary 工具函数 + degradation-rules.json（或整合到 governance-routing.json）

**与不变量的关系**：不改变现有 catch 的语义——只给它一个统一的表达方式。

---

### 6. Config Drift Detection（配置漂移检测）

**解决的问题**：
- §2.3 三处重复默认值，根源是"没人知道已有默认值"
- 未来裂出的 config JSON 越多，漂移风险越大

**概念定义**：CI 门禁——比对源码中的默认值（如 engine-defaults.ts）和 config JSON 中的默认值，不一致时报错（或 WARN）。

**核心零件**：scripts/check-config-drift.ts

**与不变量的关系**：不改变任何代码——只是加了一道检查。

---

## 五、归类总览

```
裂 ×13          合 ×6（类）       不变 ×9          新概念 ×6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

包内裂:         重复值合并:       三轴模型          Config as Runtime
  shared 3项     retrievalAlpha    纯存取定位        Scene-Aware Retrieval
  engine 1项     锁定超时          打分语义          Memory Domain
  cognitive 1项  获取超时          ContextPolicy     Signal Routing
  strategy 1项   _VALID_TIERS      四通道语义        Degradation Boundary
  notification   ──────            Wave语义          Config Drift
  scheduling    模式合并:          人格文件体系     
  metaagent      空catch→边界      Bootstrap顺序    
  governance     环境变量推广      Workspace拓扑    
  amendment      schema常量                      
  team-collab    13张表注册                      
  notif-runtime  超时统一                         
                ──────                            
                包收敛:                            
                 幽灵包2                          
                 barrel 6                        
                 base-agent
```

## 六、先做什么

裂 → 合 → 新概念，按依赖顺序：

1. **先裂**：把混居的东西分开。裂不产生新概念，只做物理分离。这是最安全的——不改语义，只换文件位置。
2. **再合**：裂完之后重复的东西自然暴露，整合才有意义。重复值是裂的产物——两处都有同一份数据，裂完发现可以合。
3. **新概念最后**：裂和合完成后的架构才是干净的底板，新概念才有稳定的底座。

但有一个例外：新概念 1（Config as Runtime）必须先做，因为它是裂（参数→config）和合（config→Registry）的基础设施。没有 ConfigRegistry，裂出来的 JSON 无处安放。
