# Cortex Meso 阶段——概念设计落地产出文档

**版本**：Meso v1.1（最终修正版）
**状态**：全七份议题讨论闭环，四维审查及全量修正完成
**性质**：基于Cortex概念顶层设计v1.1的工程化实施细则
**产出范围**：议题一至七


# Cortex Meso 阶段——议题一：技术选型与敲定

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置阶段**：Nano / Nano+ 工程经验


## 子议题 1.1 运行时选型细则

### 1.1.1 Meso-Lite 运行时决策

**选择方案**：单进程 + async 协程（方案 A）

**决策依据**：

- Nano 经验：单进程模型在 1000 任务稳定性测试中无崩溃、无内存泄漏、无 stuck。Heap GC 正常（15MB → 30MB → GC 后 3.2MB），EventBus 环形缓冲稳定在 5002 条
- Nano 教训 4：线性 for-loop 模型已触顶，Meso 需要图执行调度器——但图执行可以在单进程的协程模型中实现，不需要进程隔离
- 宪法未强制要求进程级隔离：原则二（规划与执行分离）是逻辑分离，不要求物理分离
- 多柱并发的复杂性本身就高，不叠加上 IPC 调试和序列化问题

**明确不选方案**：

- 方案 B（Worker Threads）：Meso-Lite 不引入。触发条件为柱子数量 > 4 且单线程 CPU 利用率 > 80%，或柱子崩溃频率超过阈值。届时再切换到 WorkerTransport + WorkerRunner
- 方案 C（多进程）：Meso-Lite 和 Meso-Core 都不引入。仅在 Cortex-Full 阶段，当需要跨物理机部署或 GPU 亲和性绑定时才考虑

### 1.1.2 预留抽象边界

本节不要求 Meso-Lite 实现多套，但要求在接口层面定义抽象，确保未来升级时不修改调度器和 EventBus 核心逻辑。

**Transport 接口**：

```typescript
interface Transport {
  publish(event: CortexEvent): Promise<void>;
  subscribe(pattern: EventPattern, handler: EventHandler): SubscriptionId;
  subscribeAll(reason: string, handler: EventHandler): SubscriptionId;
  unsubscribe(id: SubscriptionId): void;
  getDiagnostics(): TransportDiagnostics;
}
```

**诊断元数据约束**：`TransportDiagnostics` 只包含事件 ID、订阅者标识、时间戳、投递状态（delivered / timeout / rejected）。不包含事件载荷内容。

**Meso-Lite 实现**：`InMemoryTransport`（Nano EventBus 的内存操作原样封装）。

**预留实现**：
- `WorkerTransport`（Meso-Core 预留）：基于 MessagePort 的事件传递
- `IPCSocketTransport`（Meso-Full 预留）：基于 Unix Socket 或 TCP 的跨进程事件传递

**PillarRunner 接口**：

```typescript
interface PillarRunner {
  readonly pillarId: PillarId;
  execute(node: TaskNode, context: ExecutionContext): Promise<NodeResult>;
  abort(): void;
}
```

**激活状态的注入机制**：runner 不持有激活状态引用。调度器在每次就绪队列扫描时，从共享 `ActivationConfig` 读取当前生效的激活状态，在分发节点时注入 `ExecutionContext.activationState`。节点一旦被认领，其激活状态在执行期间不变。交融覆写的解禁或抑制效果只在下一次调度器扫描时生效，不影响已认领正在执行的节点。

此设计使 runner 成为无状态的纯执行器——单元测试时无需构造 `ActivationConfig`，只需在调用 `execute()` 时传入期望的激活状态。

**激活状态约束**（由调度器执行）：抑制态的 PillarRunner 不进入调度器的就绪队列。弱激活态的只认领其显式匹配的节点类型。强激活态的可认领其皮层区覆盖的任意节点。

**Meso-Lite 实现**：`CoroutineRunner`（在同一个 event loop 中跑 async 函数，封装 Nano 的 ReActLoop）。

**预留实现**：
- `WorkerRunner`（Meso-Core 预留）：在独立 Worker Thread 中运行 ReActLoop
- `ProcessRunner`（Meso-Full 预留）：在独立子进程中运行 ReActLoop

### 1.1.3 图执行调度器约束

即使选用单进程，调度器必须从 Nano 的线性 for-loop 升级为持续的扫描循环：

- 调度器不阻塞事件循环：就绪队列扫描用 `setImmediate` 或 `queueMicrotask`
- 柱子协程独立：每个柱子的 ReAct 循环是独立的 async 函数
- blocked 不阻塞全局：柱子 A 阻塞时，调度器继续扫描其他就绪节点
- 资源预约在内存中：工具调用层的文件锁用 `Map<string, Promise<void>>` 实现，不引入外部锁服务

### 1.1.4 相关宪法条款验证

| 条款                       | 验证                                                         |
| -------------------------- | ------------------------------------------------------------ |
| 原则二（规划与执行分离）   | Meta-Agent 与功能柱逻辑隔离，单进程内通过代码边界满足        |
| 原则三（横向事件不带指令） | InMemoryTransport 保持事件零拷贝，事件中立性不受序列化影响   |
| 4.4（脊髓职责）            | InMemoryTransport 不绕过脊髓的合并、关联、反射——这些仍是 EventBus 层的职责 |


## 子议题 1.2 存储后端选型细则

### 1.2.1 分层存储决策

**选择方案**：sql.js（主库）+ LanceDB WASM（向量索引），通过记忆 ID 逻辑关联。

| 存储层   | 技术          | 角色       | 存储内容                                                     |
| -------- | ------------- | ---------- | ------------------------------------------------------------ |
| 主库     | sql.js (WASM) | 权威数据源 | 记忆内容、关联表、状态标记、时间戳、embedding 向量备份、审计日志 |
| 向量索引 | LanceDB WASM  | 缓存式索引 | embedding 向量 + 记忆 ID（仅用于 ANN 搜索）                  |

### 1.2.2 关联检索与向量检索的层级关系

**常规路径**：关联检索先执行 → 产出子图（记忆 ID 集合）→ LanceDB 以子图 ID 集合为 pre-filter 执行 ANN 搜索 → 语义扩展结果。

调用格式：`LanceDB.search(embedding, filter: { id: { $in: associationSubgraphIds } })`。

**降级路径**：仅当关联检索本身失败（异常、超时、表损坏）时，触发无 filter 的全文向量扫描。子图为空不触发降级——直接返回空结果，不下沉到全文扫描。

**审计要求**：每次降级触发记录——触发频率、触发原因（关联检索失败的具体错误）、涉及的分区。

**宪法一致性**：宪法 7.3 的层级——关联检索划子图 → 向量检索在子图内语义扩展 → 全文扫描为极端降级——完整保留。

### 1.2.3 写入流程与一致性策略

**写入流程**：主库先行 + 异步向量化。

1. 记忆内容和关联数据写入 sql.js（主库，有事务保障）
2. 写入成功后，将 embedding 生成任务放入异步队列（包含记忆 ID 和文本内容）
3. 异步队列处理：调用 embedding API → 写入 LanceDB
4. LanceDB 写入成功后，更新主库中该记忆的 `vector_indexed` 字段为 `true`
5. 如果全部重试耗尽后 LanceDB 写入仍失败，保持 `vector_indexed: false`

**异常处理**：

- 主库写入失败：整个流程中断，不产生后续任务
- 异步 embedding 生成或 LanceDB 写入失败：记忆在关联检索中立即可用，在向量检索中暂不可达。重试 N 次后仍失败则保持 `vector_indexed: false`
- **异步窗口期声明**：从主库写入完成到 `vector_indexed` 标记为 `true` 之间存在窗口期。窗口期内新写入记忆在关联检索中立即可见（主路径），在向量检索中暂不可达（辅助路径）。此窗口期是异步架构的固有属性，在 Meso-Lite 中声明为已知行为，不做工程弥补
- **周期性 reconciliation 提醒**：`vector_indexed: false` 的记忆占比是一个被动健康指标。当占比超过阈值时提示需要排查 embedding API 的可靠性或重建向量索引。此统计不需要定时任务——在每次读取该字段时附带统计，成本为零

### 1.2.4 Embedding 生成方案

| 方案                    | Meso-Core 选择     | 备注                                                         |
| ----------------------- | ------------------ | ------------------------------------------------------------ |
| A. DeepSeek V4 API      | **Meso-Core 采用** | 复用现有 LLM provider，零编译依赖。每次写入增加一次网络调用  |
| C. transformers.js WASM | Meso-Core 候选     | 当 API embedding 成本或延迟成为瓶颈时切换。零编译依赖，模型首次下载后本地运行 |
| B. ONNX/TensorFlow.js   | 不采用             | 可能引入原生编译依赖，破坏纯 JS 链                           |

**注意**：Meso-Lite 不生成 embedding，向量索引在 Meso-Core 首次引入。Meso-Core 首次接入向量检索时为一次性方案决策。

**审计区分**：
- 向量检索的读路径审计：记录触发频率、触发者身份、涉及分区（宪法 7.3 要求）
- 向量写入的写路径审计：记录每次 API 调用的记忆 ID、时间戳、token 消耗（工程成本监控，非宪法强制）

### 1.2.5 Embedding 存储冗余声明

embedding 向量在 sql.js（主库）和 LanceDB（从索引）中双存。理由：LanceDB 是缓存式索引，随时可从主库全量重建。主库是 embedding 的权威来源。

- 容量估算：单条 embedding ~4KB（float32 × 1024 维）。10,000 条记忆 → 约 40MB
- 重建流程：以 sql.js 为准——遍历 `state = 'active'` 且 embedding 不为空的记忆，取 sql.js 中的 embedding 写入 LanceDB，覆盖已有数据

### 1.2.6 LanceDB 持久化与运维

- LanceDB WASM 使用**文件持久化模式**，索引写入磁盘
- 进程重启后索引自动存活，不需要每次启动重建
- 全量重建是运维工具（不是启动步骤）：在 LanceDB 文件损坏或数据迁移时手动触发
- **关联子图规模假设声明**：Meso-Lite 的关联检索子图预期规模 < 500 条记忆 ID。在此范围内 LanceDB pre-filter 性能可接受。若未来子图规模增长到数千级别，需重新评估 pre-filter vs 后置过滤的取舍

### 1.2.7 向量检索的召回衰减处理

向量检索结果按以下流程处理：

1. LanceDB 返回 K 个结果，sql.js 批量查询这 K 个记忆的状态
2. 过滤掉冻结态的记忆。归档态记忆不在向量检索中参与（仅在关联检索直接命中时浮出，权重减半）。湮灭态数据已物理删除，不在检索中出现
3. 如果过滤后结果数 < K/2，触发扩大检索（K' = K × 2），并记录一条"向量检索召回衰减"审计事件，包含：原始 K 值、过滤后结果数、扩大后的 K' 值、最终有效结果数
4. 首次扩大检索后仍 < K/2，不再继续扩大，接受当前结果

**不做的是**：不试图在 Meso-Lite 中解决召回衰减的根本原因。根治需要 LanceDB 同步感知记忆状态变化——这是 Meso-Core 的优化。

### 1.2.8 已知风险引用

**KB-001**：sql.js TypeScript 类型声明缺失。状态：已在 Nano 阶段解决。证据价值：此问题是 Nano 选择 sql.js（WASM）而非 better-sqlite3（原生编译）的原因之一。若未来提议切换到 better-sqlite3，需重新评估原生编译依赖在目标环境中的可用性。

### 1.2.9 相关宪法条款验证

| 条款                    | 验证                                                         |
| ----------------------- | ------------------------------------------------------------ |
| 遗忘四态模型（7.3）     | 状态过滤在主库层统一完成。所有检索路径都经过同一个状态过滤模块 |
| 单一基础关联网络（7.2） | 关联表在 sql.js 中实现，写入时建关联但不超两层               |
| 向量检索层级（7.3）     | 常规路径受关联子图约束，全文扫描仅降级时触发。降级触发条件为"关联检索本身失败"而非"子图为空" |
| Nano 教训 1.3           | 优先纯 JS/WASM 方案，零原生编译依赖                          |
| ε-贪心探索（7.3/10.2）  | 探索池通过 `source` 字段在主库内逻辑隔离，不引入独立数据库   |


## 子议题 1.3 通信协议选型细则

### 1.3.1 Transport 接口抽象边界

Transport 层在脊髓（EventBus）的下一层，职责是"事件从发布者搬到订阅者"。

**操作原语**（上层调用）：

- `publish(event)`：发布事件。返回 `Promise<void>`——事件进入传输层后 resolve。不保证所有订阅者已处理
- `subscribe(pattern, handler)`：定向订阅
- `subscribeAll(reason, handler)`：通配符订阅。`reason` 参数强制，用于后续事件拓扑文档生成
- `unsubscribe(id)`：取消订阅

**诊断元数据**（运维观察）：

- 传输层状态：健康 / 降级 / 故障
- 事件投递链路：事件 ID → 哪些订阅者收到了、哪些超时了、哪些被拒绝了
- 订阅者存活状态
- **关键约束**：诊断信息只包含事件 ID、订阅者标识、时间戳、投递状态。不包含事件载荷内容

### 1.3.2 不应暴露给上层的实现细节

| 隐藏项       | 理由                                                         |
| ------------ | ------------------------------------------------------------ |
| 序列化格式   | Meso-Lite 是内存对象引用，Meso-Core 可能是 MessagePack 或 JSON。上层不应感知序列化方式 |
| 连接管理细节 | Worker Threads 的 MessagePort 生命周期、多进程的 socket 重连策略——这些是 Transport 实现的内部状态机。上层只看到传输层可用/降级/不可用 |
| 事件载荷内容 | 载荷属于 EventBus 的语义层，不属于 Transport 的传输层。Transport 携载 opaque blob，不对内容做任何假设或解释 |
| 缓冲内部结构 | 环形缓冲的大小、当前积压深度、溢出策略是实现细节。但缓冲压力本身暴露为诊断状态（积压深度是否超过阈值），而非暴露缓冲的内部实现 |

### 1.3.3 三种 Transport 实现

| 实现               | 适用阶段  | 序列化                 | 传输介质          |
| ------------------ | --------- | ---------------------- | ----------------- |
| InMemoryTransport  | Meso-Lite | 零拷贝，对象引用       | 内存              |
| WorkerTransport    | Meso-Core | MessagePort 结构化克隆 | Worker 消息通道   |
| IPCSocketTransport | Meso-Full | JSON / MessagePack     | Unix Socket / TCP |

三个实现覆写同一个 Transport 接口。切换时 EventBus、调度器、功能柱均不感知。

### 1.3.4 订阅者的故障隔离

Transport 接口语义声明：`publish` 返回成功不意味着所有订阅者已处理，仅意味着事件已进入传输层。订阅者的异常不传播给发布者。

Meso-Lite 的 InMemoryTransport 内部使用 `Promise.allSettled` 实现此语义（继承自 Nano）。未来 IPC 实现中，订阅者故障由 Transport 层检测并通过诊断接口暴露，不阻塞发布者。

### 1.3.5 事件拓扑文档生成

Transport 层提供 `getDiagnostics().subscriptionMap`，输出当前活跃订阅的映射——每个事件类型被谁订阅、订阅原因（`subscribeAll` 的 `reason` 参数）。

此映射用于生成事件拓扑文档——不只是在 Meso 设计阶段一次性产出，而是在运行时可以随时导出，确保文档与实现不漂移。

### 1.3.6 调试接口与隐私边界

原则三（横向事件不带指令）要求事件保持中立。调试接口可以看到投递链路——事件 X 从 A 发布，投递到 B、C、D，B 已确认，C 超时，D 拒绝——但不能看到事件 X 的内容和载荷。这是诊断信息与事件语义的分界线。


## 子议题 1.4 测试基础设施细则

### 1.4.1 三层测试分层

| 层级     | 验证范围                                                     | 穿透边界                               | 工具依赖                                     |
| -------- | ------------------------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| 单元测试 | 单个功能柱的 ReAct 循环逻辑、工具选择正确性、EventBus 的单事件行为 | 不触发其他功能柱。EventBus 为隔离 stub | Mock ToolGateway, Mock LLM                   |
| 集成测试 | 多柱协作流程、Committee 管线正确性、图执行调度器行为         | 不调用真实 API。LLM Provider 统一 Mock | Mock Committee, Mock LLM, 共享 EventBus 实例 |
| E2E 测试 | 完整用户意图到交付全链路                                     | 真实 LLM API                           | 真实 API，低频运行                           |

**跨层声明**：单元测试中的 EventBus 为隔离 stub，不实现脊髓的合并、关联、反射行为。这些脊髓职责的正确性仅在集成测试层验证，此缺口由分层策略显式承担。具体来说：

- 脊髓的事件合并仅在集成测试层被验证（多个柱子发布同类事件、观察合并行为）
- 脊髓的因果链关联仅在集成测试层被验证
- 脊髓的第二意见反射仅在集成测试层被验证

### 1.4.2 双轨测试体系

**Mock 轨**（每次提交运行）：验证管线在所有 Committee 收束路径下的机械正确性。覆盖范围：

- 事实最高收束：一方有事实支撑，胜出
- 基线优先收束：僵持不下，按安全基线裁决
- 分歧交付收束：双方都有事实支撑且无法统一，呈用户确认
- 头身打架收束：Committee 结论与 Meta-Agent 原规划方向分歧，Meta-Agent 否决附带内省摘要
- 时间盒到期加急：Meta-Agent 在时间盒截止时强制收束，功能柱输出被截断或切换到直觉式建议。错误码 `COMMITTEE_TIMEOUT`
- 临时委员会触发加急：功能柱在 ReAct 中检测到风险，通过脊髓发布紧急召集事件，Meta-Agent 暂停当前节点并启动临时委员会。错误码 `COMMITTEE_AD_HOC_TRIGGERED`
- 功能柱提交权冻结期间的并行执行
- Committee 讨论中的记忆态声明规则：归档态记忆引用需降半权重，冻结态记忆引用需被拒绝

> 注：时间盒到期加急和临时委员会触发加急虽然都走加急裁决路径（直觉式建议输出、附带"加急裁决"标记、强制事后复盘），但触发来源不同（调度强制 vs 功能柱主动检测），Committee 上下文不同，各自需要独立 Mock 用例和独立错误码覆盖。

**真实轨**（每次发布前运行）：用真实 API 验证 Mock 无法覆盖的质量维度。覆盖范围仅限少数精选场景，具体清单取决于 Meso-Lite 运行后的高频失败场景数据。

**两条轨的共享协议**：Mock Committee 和真实 Committee 共享同一套通信协议规格（Committee 消息格式、收束报告 Schema、时间盒元数据）。Mock 生成的数据在结构上与真实数据完全一致，内容标记为 `[SYNTHETIC]`。

### 1.4.3 错误路径全覆盖要求

Meso 完整错误码字典中的每条错误码，在集成测试层至少有一个触发用例。

**确认门相关**：

| 错误码                      | 含义                                          | 触发条件                                   |
| --------------------------- | --------------------------------------------- | ------------------------------------------ |
| `CONFIRMATION_REQUIRED`     | 不可逆操作被拦截，ReActLoop 进入 blocked 状态 | 适用可逆性等级 L2、L3                      |
| `IRREVERSIBLE_L3_BLOCKED`   | L3 操作被拦截，需用户确认 + 数字签名          | 如 `delete_file`、`run_shell 'rm -rf'`     |
| `IRREVERSIBLE_L2_ESCALATED` | 文件类型风险标记导致 L1 升级为 L2             | 如修改 `.env` 或包含 `secret` 关键字的文件 |
| `IRREVERSIBLE_REJECTED`     | 用户拒绝确认，节点标记 failed                 | 用户在确认门提示中选择拒绝                 |

**功能柱指派相关**：

| 错误码                       | 含义                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `PILLAR_NAME_UNMATCHED`      | LLM 输出的功能柱名称无法匹配，回退到皮层区指派               |
| `PILLAR_ASSIGNMENT_DEGRADED` | 功能柱指派已降级为皮层区级别（`PILLAR_NAME_UNMATCHED` 的后果码） |

**Committee 相关**：

| 错误码                       | 含义                                          |
| ---------------------------- | --------------------------------------------- |
| `COMMITTEE_TIMEOUT`          | 时间盒到期，强制收束                          |
| `COMMITTEE_AD_HOC_TRIGGERED` | 功能柱在 ReAct 中检测到风险，临时委员会被触发 |

**图执行调度器相关**：

| 错误码                     | 含义                           |
| -------------------------- | ------------------------------ |
| `NODE_BLOCKED`             | 前置节点 blocked，依赖节点暂停 |
| `NODE_PRECONDITION_FAILED` | 前置节点失败，后续节点无法启动 |

**存储层相关**：

| 错误码                      | 含义                                     |
| --------------------------- | ---------------------------------------- |
| `EMBEDDING_WRITE_FAILED`    | 异步 embedding 写入 LanceDB 全部重试耗尽 |
| `LANCE_DB_REBUILD_REQUIRED` | LanceDB 文件损坏，需从主库重建           |

**降级路径相关**：

| 错误码                    | 含义                                       |
| ------------------------- | ------------------------------------------ |
| `VECTOR_SEARCH_DEGRADED`  | 向量检索降级为全文扫描（关联检索失败触发） |
| `SECOND_OPINION_DEGRADED` | 第二意见反射健康度低于阈值，验证功能降级   |

### 1.4.4 稳定性测试维度

**从 Nano 继承（必须收集）**：

- 内存曲线（Heap GC 行为）
- EventBus 环形缓冲稳定态
- stuck 检测（3 轮无工具调用累计率）
- 正常路径无退化（0 failures / 0 blocked）

**Meso 新增（必须收集）**：

- Committee 消息队列堆积趋势
- Committee 收束路径分布（事实最高、基线优先、分歧交付、头身打架、时间盒到期加急、临时委员会触发加急各自的触发频率）
- 图执行调度器的就绪队列长度
- 功能柱就绪队列等待时间分布（入队时间戳 → 出队时间戳做差）
- 功能柱协程的累计 stuck 次数
- `vector_indexed: false` 的记忆占比（被动健康指标，观测方式为每次读取该字段时附带统计，成本为零。占比超过阈值时提示需要排查 embedding API 可靠性或重建向量索引）

**Meso 新增（可选收集）**：

- 取向切换延迟（ActivationConfig 加载耗时）
- LanceDB 向量写入队列的积压深度

### 1.4.5 测试文件组织模式

**继承 Nano**：

- `it.skip` 条件跳过：`const skipIfNoKey = hasApiKey ? it : it.skip`
- Mock 测试和真实测试在同一文件共存，由 `it.skip` 区隔
- 真实 API key 通过环境变量注入，不在代码中硬编码

**Committee 测试的组织**：

```
committee/
├── mock/           Mock 轨——合成 Committee 讨论数据，覆盖所有收束路径
│   ├── fact-wins.test.ts
│   ├── baseline-override.test.ts
│   ├── split-delivery.test.ts
│   ├── head-body-conflict.test.ts
│   ├── timebox-expedited.test.ts
│   └── adhoc-expedited.test.ts
├── live/           真实轨——精选用例，真实 LLM 参与
│   └── real-committee.test.ts
└── protocol/       协议规格——Mock 和真实共享的 JSON Schema 和类型定义
    └── committee-schema.ts
```

### 1.4.6 测试策略的相关宪法条款验证

| 条款                       | 验证                                                  |
| -------------------------- | ----------------------------------------------------- |
| 原则三（横向事件不带指令） | Mock Committee 合成事件保持格式中立                   |
| Expert Committee（4.1.3）  | Mock 覆盖了时间盒、三级收束、加急模式、记忆态声明规则 |
| 第二意见反射（2.3）        | 集成测试模拟验证失败场景                              |
| Nano 教训 5                | 双轨体系继承且扩展了 Committee 的 Mock 复杂度         |


## 议题一总结

### 关键决策清单

| 子议题        | 决策                                          | 宪法锚点       | Nano 经验输入           |
| ------------- | --------------------------------------------- | -------------- | ----------------------- |
| 1.1 运行时    | 单进程 + 协程（Meso-Lite）                    | 原则二逻辑分离 | 1000 任务无崩溃，教训 4 |
| 1.1 预留抽象  | Transport + PillarRunner 接口                 | 原则三事件中立 | 教训 4                  |
| 1.2 存储      | sql.js 主库 + LanceDB WASM 向量索引           | 遗忘四态 7.3   | 教训 1.3 零编译依赖     |
| 1.2 检索层级  | 关联先跑 → 子图约束 → 向量扩展                | 宪法 7.3       | —                       |
| 1.2 一致性    | 主库先行 + 异步向量化                         | —              | —                       |
| 1.2 embedding | DeepSeek V4 API（Meso-Core）                  | 7.3 审计       | 复用现有 provider       |
| 1.3 通信      | Transport 接口抽象边界                        | 原则三         | 教训 3                  |
| 1.3 诊断      | 诊断元数据不含事件载荷                        | 原则三         | 教训 3                  |
| 1.4 测试分层  | 单元 / 集成 / E2E                             | —              | Nano 教训 5 双轨模式    |
| 1.4 Mock 覆盖 | 所有 Committee 收束路径 + 记忆态声明规则      | 4.1.3          | Nano 教训 5             |
| 1.4 错误码    | 每条至少一个触发用例                          | —              | Nano 教训 1             |
| 1.4 稳定性    | 继承 Nano 维度 + 新增 Committee/调度/存储维度 | —              | Nano 稳定性测试         |

### 后续议题依赖关系

| 后续议题             | 依赖的 1.x 决策                                             |
| -------------------- | ----------------------------------------------------------- |
| 议题二（项目形态）   | 1.1 单进程模型、1.2 存储后端的 monorepo 子包划分            |
| 议题三（功能抽象）   | 1.1 PillarRunner 接口、1.3 Transport 接口                   |
| 议题四（记忆与事件） | 1.2 检索层级关系、1.3 EventBus 拓扑文档                     |
| 议题五（演进阶段）   | 1.1 Meso-Lite → Meso-Core → Meso-Full 升级触发器            |
| 议题六（交互协议）   | 1.4 测试分层在 CLI 形态下的应用                             |
| 议题七（横向关切）   | 1.1 单进程协程模型对脑干简装版的约束、1.2 检索反馈表 Schema |

### 跨子议题交叉检查

后续议题的细则文档整合时，必须执行显式的交叉检查步骤——逐对检查不同子议题之间的接口引用（如"存储层定义的指标 ↔ 测试层观测的维度"、"运行时定义的接口 ↔ 功能抽象定义的组件签名"）。此步骤已纳入议题二至七的文档整合流程。


**文档状态**：议题一闭环，全部硬茬及中度问题修正完成。与整体实施细则合并归档。

---

# Cortex Meso 阶段——议题二：项目形态的演进与工程形态的落地

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一（技术选型与敲定）

**前置约束**：
- 运行时：Meso-Lite 单进程 + 协程（议题一 1.1）
- 存储：sql.js 主库 + LanceDB WASM 向量索引（议题一 1.2）
- 通信：Transport 接口抽象，Meso-Lite 用 InMemoryTransport（议题一 1.3）
- 测试：三层分层 + 双轨体系（议题一 1.4）


## 一、从 Nano 到 Meso 的包结构演进

### 1.1 Nano 的包结构（基线）

```
packages/
├── shared/         类型协议层（纯接口和类型，零实现）
└── engine/         大脑+脊髓（MetaAgent, ReActLoop, EventBus, MemoryStore, ToolGateway）
```

Nano 的两个包边界清晰、依赖单向：`engine` 依赖 `shared`，`shared` 无依赖。这条边界已通过 21 个管线测试和 6 个真实验证，证明在单柱场景下的可行性。

### 1.2 Nano 结构在 Meso 的压力点

| Nano 结构          | Meso 压力                                                    | 不可继续沿用的原因                                           |
| ------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 单一 `engine` 包   | 图执行调度器、Committee、多柱并发、神经节点——全部塞在一个包里 | 单体在单柱场景可维护，多柱场景下各组件生命周期、测试边界、故障域完全不同，修改一个组件需要理解全部组件 |
| `shared` 只有类型  | Transport 接口、PillarRunner 接口、Committee 协议 Schema——这些是跨包契约 | 跨包契约需要独立的版本认知和变更评审，混在普通类型中会被误改 |
| 无独立记忆包       | 分层存储（sql.js + LanceDB）、遗忘四态、关联网络             | 记忆系统有独立的存储后端依赖、独立的检索性能要求、独立的宪法条款约束（第七章全文），应该独立演进 |
| 无独立测试基础设施 | Mock Committee、合成数据生成器、双轨测试配置                 | 测试工具被多个包的测试文件引用，放在任何一个源码包中都会造成循环依赖或源码包污染 |

### 1.3 拆分原则

**原则 A：按宪法组件边界拆分，不按技术层拆分。**

宪法已经定义了清晰的组件边界——记忆中枢、脊髓、大脑皮层功能柱、前额叶 Meta-Agent、Expert Committee、哨兵、脑干。包边界应对应这些宪法组件。技术分层（数据层/业务层/表示层）在 AI Agent 系统中是伪边界——记忆检索既涉及存储实现又涉及检索策略，两者无法按技术层切开。

**原则 B：shared 只放类型和接口签名，永远不放实现。**

Nano 已守住此边界（210 行纯类型定义，零逻辑，零常量，零工具函数）。Meso 多包场景下此边界更重要——shared 被 10 个包依赖，任何一行实现代码进入 shared 都会成为所有包的事实标准，修改成本不可控。

**原则 C：每个包只暴露一个入口文件（index.ts），包内模块不跨包直接引用。**

其他包只通过 `import { X } from '@cortex/memory'` 访问，不通过 `import { X } from '@cortex/memory/src/association'` 渗透内部实现。这在 Nano 是自然行为（只有两个包），在 Meso 必须显式声明为规则——包越多，渗透的风险越大。

**原则 D：测试工具独立成 testing 包，不污染源码包。**

Mock Committee、合成数据生成器、测试夹具放在独立的 testing 包中。testing 包是 devDependency，不被 cortex-engine 或任何运行时包加载。

**原则 E：接口抽象放在 shared 包，具体实现放在各自包中。**

Transport 接口、PillarRunner 接口、Committee 协议 Schema 属于 shared。InMemoryTransport 放在 event-bus 包，CoroutineRunner 放在 pillar 包。接口与实现分离，切换实现不碰接口定义。


## 二、Meso monorepo 子包方案

### 2.1 包清单与职责定义

```
packages/
├── shared/              [沿用 Nano，扩展]
│   职责：跨包类型协议——接口签名、类型别名、错误码枚举、事件 Schema
│   宪法对应：跨组件通用类型定义
│   依赖：无
│
├── memory/              [新增]
│   职责：记忆中枢——主库管理（sql.js）、关联网络（多对多关联表）、遗忘四态流转、
│         检索投影（关联检索 + 向量检索 + 状态过滤）、向量索引封装（LanceDB）
│   宪法对应：第七章（记忆系统）、7.1（两层四分架构）、7.2（单一基础关联网络）、
│             7.3（调控层）
│   依赖：shared
│
├── event-bus/           [新增]
│   职责：脊髓——事件发布/订阅、事件合并（同类型重复→摘要）、事件关联（因果链串联）、
│         低级反射处理（膝跳反射 + 第二意见反射）、状态摘要（身份状态卡片）、
│         事件归档、Transport 接口定义
│   宪法对应：4.4（脊髓）、5.2（横向总线）、2.3（第二意见反射）
│   依赖：shared
│
├── pillar/              [新增]
│   职责：功能柱——单柱 ReAct 循环（Think→Act→Observe）、工具调用、取向 Gate、
│         CoroutineRunner 实现
│   宪法对应：4.1.1（皮层区功能柱）、4.5（工具调用层）、1.1（取向激活与抑制）
│   依赖：shared, memory, event-bus
│
├── meta-agent/          [新增]
│   职责：前额叶——意图解析、任务树生成（含内省摘要）、取向分类（双轨结构）、
│         Committee 程序主持（通过 event-bus 发布轮次控制事件，订阅成员发言）、
│         ActivationConfig 管理（基础层 + 覆写层）
│   宪法对应：4.1.2（Meta-Agent）、6.1（身份定义与取向切换）、6.3（交融场景）
│   依赖：shared, memory, event-bus
│
├── scheduler/           [新增]
│   职责：图执行调度器——就绪队列扫描、柱子认领分发、任务树拓扑排序、
│         节点状态事件发布、超时检测
│   宪法对应：5.1（竖向总线，规划指令下行和执行状态上行）、4.3（脑干，部分）
│   依赖：shared, pillar, meta-agent, event-bus
│
├── committee/           [新增]
│   职责：Expert Committee——协作通道管理、冲突收束（三级收束规则）、
│         汇总报告生成、时间盒管理、讨论记录归档。
│         订阅 Meta-Agent 通过 event-bus 发布的 Committee 程序事件
│         （轮次开始、收束指令），执行对应讨论流程
│   宪法对应：4.1.3（Expert Committee）、4.1.3.1（临时委员会）
│   依赖：shared, pillar, event-bus
│
├── sentinel/            [新增]
│   职责：哨兵——确定性规则检测、全局广播告警、检测模式管理
│   宪法对应：8.4（哨兵）
│   依赖：shared, event-bus
│
├── cortex-engine/       [重构，替代 Nano 的 engine]
│   职责：主入口——组装所有运行时包，依赖注入，对外暴露统一 handleRequest() API，
│         确认门处理器（Nano+ 引入的控制台确认处理器在此包中）
│   宪法对应：编排层（非宪法独立组件，是工程组装层）
│   依赖：shared, memory, event-bus, pillar, meta-agent, scheduler, committee, sentinel
│
└── testing/             [新增]
    职责：测试工具——Mock Committee、合成数据生成器、测试夹具、共享测试配置
    宪法对应：无（纯工程支撑）
    依赖（dev）：shared, memory, event-bus, pillar, meta-agent, scheduler, committee
    注意：此包为 devDependency，不被 cortex-engine 或任何运行时包加载
```

### 2.2 包依赖关系图

```
                    ┌─────────────┐
                    │   shared    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐        │
    │   memory    │ │  event-bus  │        │
    └──────┬──────┘ └──┬──┬──┬───┘        │
           │            │  │  │            │
    ┌──────▼──────┐     │  │  │   ┌────────▼────────┐
    │   pillar    │     │  │  │   │   meta-agent    │
    │ (Coroutine  │◄────┘  │  │   │ (Activation     │
    │  Runner)    │        │  │   │  Config,        │
    └──────┬──────┘        │  │   │  Committee主持) │
           │               │  │   └───────┬─────────┘
           └───────┬───────┘  │           │
                   │          │           │
    ┌──────────────┼──────────┼───┐       │
    │              │          │   │       │
┌───▼────────┐ ┌──▼────────┐ │ ┌─▼───────▼─┐
│ scheduler  │ │ committee │ │ │  sentinel  │
│ (图执行,    │ │ (协作,    │ │ │  (规则)    │
│  Promise   │ │  event-bus│ │ └─────┬──────┘
│  直连)     │ │  订阅)    │ │       │
└──────┬─────┘ └─────┬─────┘ │       │
       │             │       │       │
       └─────────────┼───────┘       │
                     │               │
              ┌──────▼───────────────▼──┐
              │      cortex-engine      │
              │        (组装层)          │
              └─────────────────────────┘

testing (devDependency，不在此依赖图中)
```

**依赖方向约束**：所有依赖箭头指向 shared 方向。无循环依赖。上层包可依赖下层包，下层包不可依赖上层包。

**scheduler 的 event-bus 依赖方向**：scheduler 对 event-bus 的依赖是写方向（publish），不是读方向（subscribe）。调度器不订阅事件，只生产事件。调度器通过 Promise 直连感知功能柱完成状态，然后将状态变更作为事实事件发布到 event-bus。这是不对称依赖——在依赖图中不需要特殊标注，但在 scheduler 的职责描述中需显式声明。

### 2.3 包命名与宪法的对应

| 包名            | 宪法对应                                    | 备注                                                         |
| --------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `memory`        | 第七章 记忆系统                             | 包含两层四分架构、遗忘四态、关联网络和检索投影               |
| `event-bus`     | 4.4 脊髓 + 5.2 横向总线                     | 脊髓的合并/关联/反射/第二意见均在此包中                      |
| `pillar`        | 4.1.1 皮层区功能柱 + 4.5 工具调用层         | 每个功能柱是此包的实例，CoroutineRunner 实现 PillarRunner 接口 |
| `meta-agent`    | 4.1.2 Meta-Agent + 6.1 取向切换             | 包含意图解析、任务树生成、取向分类双轨、ActivationConfig 管理、通过 event-bus 主持 Committee |
| `scheduler`     | 5.1 竖向总线 + 4.3 脑干（部分）             | 图执行调度、节点状态管理、Promise 直连 + 状态事件发布        |
| `committee`     | 4.1.3 Expert Committee + 4.1.3.1 临时委员会 | 协作通道、收束规则、时间盒。订阅 Meta-Agent 的程序事件       |
| `sentinel`      | 8.4 哨兵                                    | 确定性规则检测引擎                                           |
| `cortex-engine` | 无（工程组装层）                            | 依赖注入容器，对外统一 API                                   |
| `shared`        | 跨组件通用                                  | 接口签名、类型别名、错误码枚举、事件 Schema                  |
| `testing`       | 无（工程支撑）                              | Mock 数据、测试夹具、合成数据生成器                          |

### 2.4 Meso-Lite 阶段的最小包集合与实现边界

并非所有包都在 Meso-Lite 实现完整功能。最小启动集合和能力边界如下：

| 包              | Meso-Lite 状态 | 实现范围                                                     |
| --------------- | -------------- | ------------------------------------------------------------ |
| `shared`        | ✅ 完整         | 所有跨包类型定义。从 Nano shared 迁移 + Meso 新增接口        |
| `memory`        | ✅ 基础         | 分层存储（sql.js 主库 + 关联表创建）+ 活跃态/归档态流转逻辑。冻结态和湮灭态数据结构预留（state enum 四值齐全），但流转逻辑不在 Meso-Lite 触发 |
| `event-bus`     | ✅ 基础         | InMemoryTransport 完整实现。事件发布/订阅核心路径。事件合并和关联的基础存根（接口预留，Meso-Lite 不做合并/关联/反射） |
| `pillar`        | ✅ 核心         | 2-3 个功能柱的 CoroutineRunner 实现。工具调用层包含确认门拦截（议题一可逆性等级模型）。取向 Gate 基础版 |
| `meta-agent`    | ✅ 核心         | 意图解析 + 任务树生成（含内省摘要）+ 取向分类双轨（LLM 主路径 + 关键词 fallback）+ ActivationConfig 基础层管理（19×3 矩阵静态配置）+ 通过 event-bus 主持 Committee 程序 |
| `scheduler`     | ✅ 核心         | 图执行调度器——就绪队列扫描、Promise 直连 + 状态事件发布。调度器负责在节点状态变更时向 event-bus 发布对应事件 |
| `committee`     | ⚠️ 最简         | 管线连通性验证——2 柱讨论 + Meta-Agent 收束（仅分歧交付路径，不支持记忆态声明）。协作通道（仅分歧交付路径，不支持记忆态声明） |
| `sentinel`      | ❌ 暂缓         | Meso-Lite 的异常路径由集成测试手写断言覆盖。哨兵在 Meso-Core 引入 |
| `cortex-engine` | ✅ 核心         | 组装层，依赖注入，对外暴露 handleRequest() API。确认门处理器（控制台确认）在本包 |
| `testing`       | ✅ 基础         | Mock Committee 基础版——生成符合 Committee 协议格式的合成数据。包含带状态标记（含归档态和冻结态）的合成记忆数据，供管线验证数据结构兼容性 |

**Meso-Lite 不产出**：

- 完整的遗忘四态流转（仅活跃态和归档态流转；冻结态和湮灭态数据结构预留，流转逻辑在 Meso-Core 实现）
- LanceDB 向量索引（Meso-Lite 仅关联检索；向量索引在 Meso-Core 引入）
- 脊髓的事件合并、因果关联、第二意见反射（接口预留，实现在 Meso-Core）
- Committee 完整收束路径（仅分歧交付；事实最高/基线优先/头身打架/加急裁决在 Meso-Core）
- Committee 记忆态声明规则的实际执行（宪法 4.1.3 要求；Meso-Core 实现）
- 哨兵规则引擎（Meso-Core 引入）
- 脑干的应急兜底（scheduler 内部的超时检测替代，Meso-Full 独立为 brainstem 包）

### 2.5 已知边界声明

**Committee 的宪法合规边界**：Meso-Lite 的 committee 不是完整的 Expert Committee 宪法实现。它在管线层面验证 Committee 协议（协作通道、消息格式、收束报告 Schema），但以下宪法条款在 Meso-Core 阶段才正式实现：

- 记忆态声明规则（宪法 4.1.3：归档态降半权重，冻结态不可引用）
- 加急模式的直觉式建议输出（宪法 4.1.3.1）
- 三级收束中的事实最高和基线优先（Meso-Lite 只走分歧交付和人工收束）
- 头身打架的否决路径（宪法 4.1.3：Committee 与 Meta-Agent 分歧时的内省摘要调取）

**数据处理**：Mock 轨在 testing 包中构造带状态标记的合成 Committee 数据，覆盖上述规则的管线兼容性验证。数据结构完整，流转逻辑分阶段实现。不修宪，不改变宪法的约束力。


## 三、构建与开发工作流

### 3.1 构建系统

**工具链**：pnpm + TypeScript composite 模式。

**构建顺序**（按实际依赖排列，同层可并行）：

```
第 0 层：shared（无依赖）

第 1 层：memory, event-bus（仅依赖 shared）
         → 两者可并行构建

第 2 层：pillar, meta-agent（依赖 shared + memory/event-bus）
         → 两者可并行构建

第 3 层：scheduler, committee, sentinel
         ├── scheduler（依赖 shared, pillar, meta-agent, event-bus）
         ├── committee（依赖 shared, pillar, event-bus）
         └── sentinel（依赖 shared, event-bus）
         → 三者可并行构建

第 4 层：cortex-engine（依赖第 0-3 层所有运行时包）
         → 最后构建

独立：testing（devDependency，独立构建，不被生产运行时依赖）
```

**构建检查脚本**（从 Nano 教训 1.1 继承）：

- 脚本名：`build:check`
- 逻辑：`pnpm build` 按 dependencies 顺序构建全部包
- 强制要求：在任何测试运行之前必须先执行 `build:check`。CI 流程中 `build:check` 是 test 的前置步骤

**package.json 的 workspaces 配置**：

```json
{
  "workspaces": [
    "packages/shared",
    "packages/memory",
    "packages/event-bus",
    "packages/pillar",
    "packages/meta-agent",
    "packages/scheduler",
    "packages/committee",
    "packages/sentinel",
    "packages/cortex-engine",
    "packages/testing"
  ]
}
```

### 3.2 包内目录结构规范

每个运行时包遵循统一结构：

```
packages/<name>/
├── src/
│   ├── index.ts          # 包对外暴露的唯一入口（导出所有公共 API）
│   ├── <core-modules>.ts # 包的核心模块（文件名对应职责）
│   └── types.ts          # 本包私有类型和接口（不放入 shared 的类型）
├── test/
│   ├── unit/             # 单元测试（Mock 所有外部依赖）
│   └── integration/      # 集成测试（使用真实本包依赖，Mock LLM Provider）
├── package.json          # 包名遵循 @cortex/<name> 命名规范
└── tsconfig.json         # 配置 references 指向依赖包
```

**index.ts 规则**：只导出公共 API——被其他包引用的类、函数、类型。内部实现模块（如 `association.ts` 和 `retrieval.ts` 之间的互相引用）不通过 index.ts 暴露。这条规则在 Nano 是自然结果（只有一个入口），在 Meso 多模块包中必须显式声明。

### 3.3 测试组织

| 测试层   | 位置                       | Mock 边界                           | 运行频率   |
| -------- | -------------------------- | ----------------------------------- | ---------- |
| 单元测试 | 各包的 `test/unit/`        | Mock 所有外部包和 LLM Provider      | 每次提交   |
| 集成测试 | 各包的 `test/integration/` | 本包依赖真实实现，Mock LLM Provider | 每次提交   |
| E2E 测试 | `testing/` 包中            | 真实跨包协作，真实 API 可选         | 每次发布前 |

**跨包测试规则**：

各包的集成测试不启动其他包的真实实例。如果需要 Committee 场景测试，不在 pillar 包的集成测试中启动真实的 committee 包——而是引用 `testing` 包的 Mock Committee 合成数据生成器。这保证了每个包的集成测试只验证本包的正确性，跨包协作的正确性由 E2E 测试承担。

**Mock Committee 的归属**：放在 `testing/` 包中，作为独立的合成数据生成模块。committee 包的集成测试引用它来生成讨论数据，pillar 包的集成测试引用它来模拟 Committee 环境。

### 3.4 版本管理策略

**所有包统一版本号。**

不引入独立版本管理（如 Changesets 或 semantic-release per package）。理由：Meso 阶段各包之间的接口仍在快速演进——PillarRunner 接口、Transport 接口、Committee 协议 Schema 都可能在议题三讨论中调整。独立版本号会制造"哪些版本组合是兼容的"这个不必要的追踪矩阵。

当 Cortex 进入稳定发布阶段（Meso-Full 之后，进入完整生命体），再考虑将 shared 包独立版本管理（作为公共 API 契约），其余包保持统一版本。

### 3.5 开发工作流

**日常开发流程**：

1. `pnpm install`——安装所有依赖（包括 workspace:* 协议）
2. `pnpm build:check`——构建所有包（确保跨包类型引用有效）
3. `pnpm test:unit`——跑所有包的单元测试
4. `pnpm test:integration`——跑所有包的集成测试

**新增包的步骤**：

1. 创建 `packages/<name>/` 目录，含 `package.json`、`tsconfig.json`、`src/index.ts`
2. `package.json` 的 `name` 字段为 `@cortex/<name>`
3. `tsconfig.json` 的 `references` 字段列出依赖包的路径
4. 在根 `package.json` 的 `workspaces` 中增加新包
5. 如被其他包依赖，在对应包的 `package.json` 中添加 `"@cortex/<name>": "workspace:*"` 并更新 `tsconfig.json` 的 `references`
6. 注册到 `build:check` 脚本的构建顺序中


## 四、工程形态的宪法咬合审查

### 4.1 包边界与宪法组件边界的一致性

| 宪法组件                                     | Meso 包      | 边界一致性                                                   |
| -------------------------------------------- | ------------ | ------------------------------------------------------------ |
| 记忆中枢（第七章）                           | `memory`     | ✅ 完整对应。两层四分架构、遗忘四态、关联网络全在此包         |
| 脊髓（4.4） + 横向总线（5.2）                | `event-bus`  | ✅ 合并、关联、反射、归档全在此包。Transport 接口定义在此包，实现可替换 |
| 大脑皮层功能柱（4.1.1） + 工具调用层（4.5）  | `pillar`     | ✅ 单柱 ReAct + 取向 Gate + 工具调用拦截全在此包              |
| 前额叶 Meta-Agent（4.1.2） + 取向切换（6.1） | `meta-agent` | ✅ 规划 + 取向分类 + ActivationConfig + Committee 主持全在此包 |
| Expert Committee（4.1.3）                    | `committee`  | ✅ 协作通道 + 收束规则全在此包                                |
| 哨兵（8.4）                                  | `sentinel`   | ✅ 规则引擎独立包                                             |
| 竖向总线（5.1） + 脑干（4.3，部分）          | `scheduler`  | ✅ 调度器承载竖向总线的规划下行和状态上行。脑干应急兜底在 Meso-Full 可能独立为 `brainstem` 包 |

**无交叉污染**：每个宪法组件的核心职责只落在一个包中。不存在两个包共同负责同一宪法条款的情况。

### 4.2 原则二（规划与执行分离）的工程体现

`meta-agent` 包不依赖 `pillar` 包：Meta-Agent 生成任务树，不调用功能柱执行。

`pillar` 包不依赖 `meta-agent` 包：功能柱执行节点，不修改任务树。

**两者唯一通信路径**：Meta-Agent → scheduler → pillar（竖向规划下行）；pillar → scheduler → event-bus（状态上行）。不直接通信。

**Committee 场景的延伸**：Meta-Agent 通过 event-bus 主持 Committee 程序——发布轮次开始和收束指令，订阅成员发言事件。这是原则二在 Committee 场景的延伸——Meta-Agent 主持讨论但不参与专业辩论，功能柱参与辩论但不控制讨论节奏。

这比 Nano 的单体 engine 更能强制原则二的遵守：在单体中，MetaAgent 和 ReActLoop 虽然逻辑分离，但代码在同一包中，存在"顺手调用"的风险。Meso 的包拆分让这种越界在编译期就被阻止。

### 4.3 原则三（横向事件不带指令）的工程体现

`event-bus` 包的公共 API 只暴露 `publish` / `subscribe` / `subscribeAll` / `unsubscribe`——不暴露 `command` / `dispatch` / `tell` 等指令语义方法名。

事件格式在 `shared` 包中定义，`CortexEvent` 的 type 字段是事实描述（`NODE_COMPLETED`、`IRREVERSIBLE_PENDING`），不是祈使句（`EXECUTE_NODE`、`CONFIRM_THIS`）。

诊断接口暴露投递链路（事件 ID、订阅者标识、时间戳、投递状态），不暴露事件载荷内容。

### 4.4 调度器 Promise 直连模式与领域事件的宪法合规

`scheduler` 通过 `pillar.execute()` 返回的 Promise 感知节点完成——这是竖向总线的工程实现（规划指令下行，执行状态上行）。

`scheduler` 是节点状态事件的唯一发布者（`NODE_COMPLETED` / `NODE_FAILED` / `NODE_BLOCKED`）——发布的是事实，不是指令。

功能柱不直接向脊髓发布节点生命周期事件——节点生命周期的单一信源是调度器，脊髓状态卡片的一致性有保障。

功能柱仍可向脊髓发布领域事件（如 SecReview 发现安全漏洞、触发临时委员会的紧急召集事件）——这不涉及节点生命周期管理，是功能柱专业视角的产物。

> **Meso-Lite 的能力边界提醒**：Meso-Lite 的脊髓未实现事件合并、因果关联和第二意见反射，领域事件在 Meso-Lite 仅直通订阅者，不做脊髓层面的验证处理。SecReview 发布的安全漏洞事件、功能柱发布的紧急召集事件——订阅者可以接收和响应，但脊髓不验证事件的因果链、不触发第二意见反射。此能力在 Meso-Core 补齐。


## 五、Meso-Lite 的最小工程落地产出清单

| 产出                                                | 内容                                                         | 所属包        |
| --------------------------------------------------- | ------------------------------------------------------------ | ------------- |
| 9 个运行时包 + 1 个测试包的基础骨架                 | `package.json`、`tsconfig.json`、`src/index.ts`              | 全部          |
| shared 的完整接口定义                               | 从 Nano shared 迁移 + Meso 新增：Transport 接口、PillarRunner 接口、Committee 协议 Schema、错误码字典、事件 Schema、ActivationConfig 类型 | shared        |
| event-bus 的 InMemoryTransport                      | 从 Nano EventBus 重构而来，实现 Transport 接口。事件发布/订阅核心路径 | event-bus     |
| memory 的主库 + 关联网络                            | sql.js 初始化、关联表创建、活跃态/归档态流转、关联检索、状态过滤模块 | memory        |
| pillar 的 CoroutineRunner                           | 从 Nano ReActLoop 重构而来，实现 PillarRunner 接口。含确认门拦截（可逆性等级模型）、取向 Gate 基础版 | pillar        |
| meta-agent 的任务树生成 + 取向分类 + Committee 主持 | 从 Nano MetaAgent 迁移，增加取向分类双轨结构（LLM 主路径 + 关键词 fallback）、ActivationConfig 基础层（19×3 激活矩阵静态配置）、通过 event-bus 主持 Committee 程序 | meta-agent    |
| scheduler 的图执行循环                              | 就绪队列扫描 + 柱子认领分发 + Promise 直连状态追踪 + 节点状态事件发布 | scheduler     |
| committee 的最简管线验证                            | 2 柱讨论 + Meta-Agent 收束（仅分歧交付路径，不支持记忆态声明）。协作通道（仅分歧交付路径，不支持记忆态声明） | committee     |
| cortex-engine 的组装                                | 依赖注入容器，初始化所有包，暴露 handleRequest() API。确认门处理器（控制台确认） | cortex-engine |
| testing 的 Mock Committee 基础版                    | 生成符合 Committee 协议格式的合成数据。含带状态标记的合成记忆数据 | testing       |
| 构建检查脚本                                        | `build:check`：先 `pnpm build` 所有包再跑测试                | 根目录        |

**不产出**：

- 完整的遗忘四态流转（仅活跃态和归档态；冻结态和湮灭态数据结构预留）
- LanceDB 向量索引
- 脊髓的事件合并、因果关联、第二意见反射（接口预留，实现在 Meso-Core）
- Committee 的完整收束路径（仅分歧交付；其余 Meso-Core）
- Committee 记忆态声明规则的实际执行代码（Meso-Core）
- 哨兵规则引擎
- 脑干的应急兜底模块


## 六、议题二闭环总结

| 维度                         | 决策                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| 包数量                       | Nano 2 → Meso 10（9 运行时 + 1 测试）                        |
| 拆分原则                     | 按宪法组件边界，不按技术层。shared 只放类型和接口签名，零实现 |
| 依赖方向                     | 单向：shared → 基础包（memory, event-bus）→ 逻辑包（pillar, meta-agent）→ 调度/协作包（scheduler, committee）→ 组装层（cortex-engine） |
| Meso-Lite 最小实现           | sentinel 暂缓，其余包全部启动但 committee 和 memory 只实现最简版本 |
| Meta-Agent 与 Committee 通信 | Meta-Agent 通过 event-bus 主持 Committee 程序（路径 A）      |
| Committee 宪法边界           | 明确声明 Meso-Lite 的 committee 不是完整宪法实现；记忆态声明规则等条款在 Meso-Core 补齐 |
| 遗忘四态范围                 | Meso-Lite 实现活跃态+归档态流转；冻结态+湮灭态数据结构预留但流转逻辑不实现 |
| scheduler 架构模式           | Promise 直连 + scheduler 为节点状态事件唯一发布者            |
| ActivationConfig 归属        | meta-agent 包（基础层静态配置 + 覆写层 LLM 推理）            |
| testing 依赖类型             | devDependency，不被 cortex-engine 加载                       |
| 版本管理                     | 统一版本号，不独立版本管理                                   |
| 构建系统                     | pnpm + TypeScript composite；build:check 脚本继承 Nano 教训 1.1 |
| 测试组织                     | 单元/集成在各包 test/ 目录，E2E 在 testing/ 包。Mock Committee 在 testing/ 包中 |

**宪法合规**：全部审查通过。Committee 的阶段性功能缺失已通过显式边界声明处理，承诺在 Meso-Core 补齐宪法 4.1.3 的全部条款。不修宪。


**文档状态**：议题二闭环，全部硬茬及中度问题修正完成。与整体实施细则合并归档。

---

# Cortex Meso 阶段——议题三：功能的抽象与具体设计

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一（技术选型与敲定）、议题二（项目形态的演进与工程形态的落地）


## 〇、议题总览

### 0.1 三部分结构

议题三围绕宪法已有的组件职责和通信通道，补全工程协议细节。分三部分：

| 部分           | 宪法锚点                                                     | 产出物                                                       |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 交互协议       | 第五章：竖向总线（5.1）、脊髓横向总线（5.2）、神经节点机制（5.3） | 三种底层通信机制的协议抽象、消息格式、路由规则、故障隔离策略 |
| 工具调用层     | 4.5（工具调用层）+ 原则四（不可逆操作确认）                  | 工具注册与染色、可逆性等级模型、确认门执行流程、审计日志规范 |
| 功能柱与委员会 | 4.1（大脑皮层）+ 4.1.3（Expert Committee）                   | PillarRunner 接口、取向 Gate、Committee 协作通道协议         |

### 0.2 核心原则

**协议细节不修宪。** 宪法定义组件职责和通道存在性，议题三补协议细节。宪法已有约束（如原则三"事件不带指令"、原则四"不可逆操作永远需要用户确认"）不重复讨论——直接落地为接口约束。

**规模错位声明。** 宪法为最终形态（19 柱 + 大规模记忆）设计。Meso-Lite 在 2-3 个柱子的规模下承担了为 19 柱编写的宪法约束。已知的规模错位通过阶段适配声明处理——不修宪，不改接口，仅在适配层参数上为 Meso-Lite 放宽约束。具体见各节 Meso-Lite 范围声明。

### 0.3 两轮过程冲突记录

从宪法概念向工程接口转化过程中，两轮设计张力在议题三被暴露和解决：

| 冲突                               | 宪法概念                                          | 工程约束                                         | 解决方案                                                     |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| ActivationConfig 归属              | Meta-Agent"决定激活"（宪法 6.1）                  | 调度器需要成为激活状态的唯一生效者               | PlanningDirective 传 `baselineActivation`，调度器自主叠加覆写层 |
| Committee 与 PillarRunner 生命周期 | 提交权冻结期间柱子可执行其他任务（宪法 4.1.3）    | `execute()` 只有单模，柱子一次只跑一个节点       | Committee 参与走构造器回调，在 `execute()` 外部并行交错      |
| Meta-Agent 工具调用权              | 规划与执行分离——Meta-Agent 不调用工具（宪法 4.5） | Meso-Lite 规模下重规划循环开销远大于单次记忆查询 | HCA 压缩粒度阶段适配：Meso-Lite 可调至"完整加载近期经验记忆"，Meso-Core 恢复标准压缩（适配层参数，不修宪） |


## 第一部分：交互协议

### 一、竖向总线（宪法 5.1）

#### 1.1 职责边界

竖向总线是 **Meta-Agent ↔ 调度器** 之间的通道。功能柱不直接接收竖向总线指令。功能柱通过调度器分发节点间接接收规划。

#### 1.2 下行协议：PlanningDirective

Meta-Agent 完成意图解析和任务树生成后，通过调度器的 `submitTaskTree()` 提交：

```
PlanningDirective {
  taskTreeId: string;
  nodes: TaskNode[];
  orientation: Orientation;              // 当前主取向
  baselineActivation: BaselineActivation; // 基础激活层（Meta-Agent 查表填入的静态值）
  metaSummary?: string;                  // 内省摘要（仅关键分支点附带）
}
```

**关键约束**：
- 不包含完整 `activationConfig`。基础层由 Meta-Agent 规划时查表填入，覆写层由调度器每个扫描周期自主评估
- 不包含执行细节——工具选择、Think 推理在功能柱自主权内
- 内省摘要仅关键分支点附带，不占用日常上下文。存储和调取逻辑在 Meso-Core 实现

#### 1.3 上行协议：ExecutionReport

任务执行完成后，调度器通过 Meta-Agent 的 `reportExecution()` 上报：

```
ExecutionReport {
  taskTreeId: string;
  completedNodes: NodeResult[];
  blockedNodes?: BlockedNode[];
  failedNodes?: FailedNode[];
  overallStatus: "completed" | "blocked" | "failed" | "partial";
  overrides?: ActivationOverride[];  // 当前累积的覆写状态（仅重规划请求时附带）
}
```

**关键约束**：
- 汇总上报，不逐节点流式上报
- blocked 信息足够 Meta-Agent 评估是否需要重规划——包含阻塞原因（等待确认/依赖缺失）和阻塞上下文
- 重规划时附带覆写状态供 Meta-Agent 调整任务树参考，不是覆写状态回写

#### 1.4 Committee 规划下行：submitCommitteePlan()

```
CommitteePlan {
  sessionId: string;
  members: PillarId[];        // 参与功能柱列表（2-5 个）
  topic: string;
  timebox: number;            // 硬性截止时间（ms）
  messageLimit: number;       // 消息量上限
  expedited: boolean;         // 是否加急模式
}
```

调度器收到后检查各柱子状态：空闲则分配；执行中则标记"当前节点完成后切换"。通过脊髓发布 `COMMITTEE_SESSION_START` 定向通知参与柱子。不绕调度器，不走 Meta-Agent 直接调用。

#### 1.5 阻塞通知双路径分工

- **脊髓事件（主路径，即时）**：调度器在节点 blocked 时发布 `NODE_BLOCKED` 事件，payload 含 `nodeId, blockReason, nodeDescription, blockedDependencies`——足够 Meta-Agent 和其他订阅者感知阻塞的发生和影响范围
- **竖向总线（辅路径，汇总）**：任务完成后或 Meta-Agent 主动查询时，通过 `ExecutionReport` 汇总全部 blocked 节点上下文

时序：脊髓事件先发（中断信号），竖向总线在任务结束时汇总（完整上下文）。Meso-Lite 只走脊髓事件路径，竖向总线增量阻塞报告在 Meso-Core 实现。

#### 1.6 工程形态

Meso-Lite：Meta-Agent 和调度器的直接函数调用，不走序列化。两者在单进程内。

#### 1.7 Meso-Lite 范围

- ✅ `submitTaskTree()` + `reportExecution()` + `submitCommitteePlan()`
- ❌ 内省摘要的存储和调取逻辑（Meso-Core）
- ❌ 竖向总线的增量阻塞报告（Meso-Core）

#### 1.8 宪法咬合

- ✅ 原则二（规划与执行分离）：下行含规划信息不含执行细节；上行含状态报告不修改任务树
- ✅ 仅在任务启动和异常仲裁时使用


### 二、脊髓横向总线（宪法 5.2）

#### 2.1 职责边界

脊髓是事件广播的唯一通道。所有组件——功能柱（领域事件）、调度器（节点状态事件）、Meta-Agent（Committee 控制事件）——通过脊髓发布和订阅事件。

#### 2.2 事件 Schema

```
CortexEvent {
  id: string;
  type: CortexEventType;       // 事件类型——名词或完成时态，禁止祈使句
  publisher: string;           // 发布者标识（组件 ID + 功能柱类型）
  timestamp: number;
  payload: Record<string, unknown>;
  causalChain?: CausalChain;   // 仅关键事实事件附带（priority=critical 且 confidence < 1.0）
}
```

**事件类型命名约束**：`NODE_COMPLETED`、`SECURITY_VULNERABILITY_FOUND`——事实描述。禁止 `EXECUTE_NODE`、`CONFIRM_THIS`——指令式。类型枚举在 `shared` 包定义。

#### 2.3 事件路由规则

| 事件类别       | 事件类型                                                     | 发布者                       |
| -------------- | ------------------------------------------------------------ | ---------------------------- |
| 节点生命周期   | `NODE_COMPLETED`, `NODE_FAILED`, `NODE_BLOCKED`, `NODE_ABORTED` | **调度器唯一**               |
| 领域事件       | `SECURITY_VULNERABILITY_FOUND`, `REFACTOR_COMPLETED`, `AD_HOC_COMMITTEE_REQUESTED`, `ARBITRATION_REQUESTED` | 功能柱                       |
| Committee 控制 | `COMMITTEE_SESSION_START`, `COMMITTEE_ROUND_START`, `COMMITTEE_ROUND_END`, `COMMITTEE_CONVERGE`, `COMMITTEE_SESSION_END` | Meta-Agent（代表 Committee） |
| 确认门         | `IRREVERSIBLE_PENDING`                                       | 功能柱                       |
| 哨兵告警       | `SENTINEL_ALERT`                                             | 哨兵（Meso-Core）            |
| 神经节点       | `NEURO_NODE_ACTIVATED`, `NEURO_NODE_RESOLVED`                | 脊髓（Meso-Core）            |
| 信任模型       | `TRUST_SCORE_CHANGED`                                        | 信任模型（Core-2d 预留）     |

#### 2.4 分级响应

| 响应级别 | 触发条件                        | 处理路径                                                     | Meso-Lite   |
| -------- | ------------------------------- | ------------------------------------------------------------ | ----------- |
| 脊髓反射 | 预注册事件类型 + 上下文哈希匹配 | SkillExecutor 直接执行，绕开取向 Gate，不经过 LLM 推理。审计由工具调用层操作日志保障 | ❌ Meso-Core |
| 低熵决策 | 场景重复度高、变量少            | 加载上次同类事件响应模式，检查当前上下文是否与历史模式不一致 | ❌ Meso-Core |
| 完整推理 | 新变量、高风险、历史失败记录    | 完整 ReAct 循环 Think→Act→Observe                            | ✅           |

#### 2.5 订阅模型

- **定向订阅**：`subscribe(pattern, handler)`——订阅特定事件类型或类型前缀
- **通配符订阅**：`subscribeAll(reason, handler)`——reason 参数强制，继承 Nano+ 约束
- **Committee 邀请**：不要求所有柱子预注册。调度器通过脊髓定向推送给指定柱子
- **订阅者故障隔离**：`Promise.allSettled` 模式——一个订阅者的异常不影响其他订阅者和发布者

#### 2.6 Meso-Lite 脊髓能力边界

- ✅ 事件发布/订阅核心路径
- ❌ 事件合并、因果关联、第二意见反射（接口预留，Meso-Core 实现）

Meso-Lite 的脊髓是"直通管道"——事件发布后直接推送给所有匹配的订阅者，不做合并，不自动串联因果链，不触发第二意见反射。

#### 2.7 宪法咬合

- ✅ 原则三（横向事件不带指令）：事件类型命名规则和 payload 约束保证事件只描述事实
- ✅ 信号闭环（3.1）：事件归档 + 脑干兜底（Meso-Full）
- ✅ 分级响应（2.3）：Meso-Lite 完整推理路径
- ✅ 脊髓职责（4.4）：基础发布/订阅，合并/关联/反射在 Meso-Core


### 三、神经节点机制（宪法 5.3）

#### 3.1 职责边界

神经节点是**临时激活的局部调度权转移**。脊髓检测到冲突模式时被动激活，Meta-Agent 在限定范围内接管有限决策权，协调完成后退出，各身份恢复完全自主。

#### 3.2 激活信号

| 信号     | 检测方式                                   |
| -------- | ------------------------------------------ |
| 指令冲突 | 两个身份对同一资源发出互斥操作声明         |
| 质量下降 | 重构完成但质量指标显著下降                 |
| 静默风险 | 身份连续发布成功但其审计日志被哨兵标记异常 |
| 主动请求 | 功能柱发布 `ARBITRATION_REQUESTED`         |

#### 3.3 工作流程

```
脊髓检测冲突 → 发布 NEURO_NODE_ACTIVATED
  → Meta-Agent 局部接管（暂停受影响身份在冲突资源上的自主操作）
  → Meta-Agent 获取受影响身份状态
  → 生成微协调方案（默认最小可隔离粒度：文件级）
  → Meta-Agent 下移微协调方案
  → 受影响身份执行并确认
  → 发布 NEURO_NODE_RESOLVED
  → 各身份恢复完全自主
```

#### 3.4 资源锁定粒度

| 粒度   | 范围                 | 升级条件               |
| ------ | -------------------- | ---------------------- |
| 文件级 | 单个文件或配置项     | 默认粒度               |
| 模块级 | 代码模块及其直接依赖 | 文件级锁定后冲突仍持续 |
| 项目级 | 整个仓库或服务       | 需 Meta-Agent 显式声明 |

粒度升级由 Meta-Agent 在微协调过程中判断，不是脊髓决定。

#### 3.5 神经节点激活期间的脑干降级

神经节点激活期间，脑干对已锁定资源的关键控制事件仅记录不强制投递——保障局部仲裁原子性，防止指令覆盖或状态振荡。

#### 3.6 Meso-Lite 能力边界

神经节点在 **Meso-Core** 实现。理由：Meso-Lite 只有 2-3 个功能柱，冲突触发频率极低；激活依赖脊髓事件合并能力；协调依赖 Meta-Agent 异常仲裁路径。

**Meso-Lite 替代方案**：工具调用层 `ResourceLock`——`Map<string, Promise<void>>` 文件锁排队，防止同资源并发写入。

#### 3.7 宪法咬合

- ✅ 不常态化：仅检测到冲突时被动激活
- ✅ 接管范围限定：仅冲突资源，不扩展为全面调度
- ✅ 非冲突身份不受影响


## 第二部分：工具调用层

### 四、工具注册与染色

#### 4.1 工具注册接口

系统初始化时完成注册，不在运行时动态增删。

```
interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  listByStain(stain: ToolStain): Tool[];
}
```

#### 4.2 Tool 接口

```
interface Tool {
  name: string;                    // 唯一标识
  description: string;             // LLM 可读描述
  parameters: ToolParameter[];     // 参数 Schema
  stain: ToolStain;                // 染色分类
  reversibility: ReversibilityLevel;  // 可逆性等级 L0-L3
  riskPatterns?: RiskPattern[];    // 文件类型风险标记规则
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
```

#### 4.3 ToolContext

```
interface ToolContext {
  confirmedByUser?: boolean;   // 用户已确认，绕过确认门
  trustLevel: TrustLevel;      // 当前取向的当前信任等级（L1-L4），用于 L1 操作确认门判定
  nodeId?: string;
  callerId: string;            // 调用者标识（功能柱 ID + 取向）
  audit: AuditContext;
}
```

`trustLevel` 由调度器在分发节点时从信任模型读取，注入 `ExecutionContext`，功能柱调用工具时透传到 `ToolContext`。功能柱不感知信任等级的值。

#### 4.4 工具染色分类

| 染色             | 允许调用者                        | 示例工具                                                     |
| ---------------- | --------------------------------- | ------------------------------------------------------------ |
| `execution_only` | 功能柱（所有激活态，含中/弱激活） | `read_file`、`write_file`、`search_code`、`run_shell`、`list_dir`、`git_diff`、`git_log` |
| `restricted`     | 仅特定调用者                      | `memory_read`（私密记忆区仅管家）、`memory_write`（私密记忆区仅管家） |
| `audit`          | 所有身份只读                      | 审计日志查询接口                                             |

**不存在 `planning_read` 染色。** Meta-Agent 不通过工具调用层执行任何操作（宪法 4.5）。规划所需记忆信息通过 HCA 注入获取，不由 Meta-Agent 主动查询。工具调用层的 `callerId` 字段只接受功能柱标识和调度器标识。

**染色校验**：工具调用入口执行确定性规则。不通过返回 `{ success: false, error: "STAIN_MISMATCH" }`。不经过确认门。


### 五、可逆性等级模型

| 等级 | 定义                   | 确认要求                         | 示例                                                         |
| ---- | ---------------------- | -------------------------------- | ------------------------------------------------------------ |
| L0   | 纯读取，零副作用       | 永远不确认                       | `read_file`、`search_code`、`list_dir`、`git_diff`、`git_log` |
| L1   | 可逆写入，有恢复路径   | 信任等级 ≥ L3 放行，否则确认     | `write_file`（单文件，< 阈值行/文件数）                      |
| L2   | 不可逆写入，需人工判断 | 永远确认                         | `write_file`（超阈值/风险文件类型）；`run_shell`（非破坏性命令） |
| L3   | 不可逆且不可恢复       | 永远确认 + 数字签名（Meso-Core） | `delete_file`（Meso-Full）、`run_shell 'rm -rf'`             |

**L1→L2 升级规则**：
- 数量升级：单次操作涉及 > 3 个文件或 > 100 行代码变更
- 风险标记升级：目标文件名/路径匹配风险模式（`secret`、`token`、`password`、`key`、`credential`、`.env`、`.pem`、`.key`、`.git/config`、`/etc/` 等）——确定性字符串匹配


### 六、确认门执行流程

**执行顺序**：
1. 染色校验——调用者是否有权调用此染色
2. 可逆性等级判断——L0 直接放行；L1/L2/L3 进入确认门
3. 风险标记升级——L1 操作检查文件类型和影响面
4. 确认门拦截——L2/L3 返回 `CONFIRMATION_REQUIRED`；L1 依 `trustLevel` 判定（信任等级 ≥ L3 放行，否则拦截）
5. `context.confirmedByUser === true` → 直接放行

**返回值**：
```
ToolResult = { success: true, data: unknown }
           | { success: false, error: "CONFIRMATION_REQUIRED", data: ConfirmationData }
           | { success: false, error: "STAIN_MISMATCH" }
```

**ConfirmationData**（连接 ReAct 循环和 UI 的数据契约）：
```
interface ConfirmationData {
  toolName: string;
  riskLevel: ReversibilityLevel;
  reason: string;                      // ToolGateway 在拦截时生成（功能柱不感知）
  nodeId: string;
  params: Record<string, unknown>;
  affectedFiles?: string[];
  commandSummary?: string;             // run_shell 的人类可读命令摘要
}
```

`reason` 由 ToolGateway 生成——Gateway 持有完整拦截上下文（工具名、参数、触发拦截的规则），填充原因模板。


### 七、run_shell 参数级染色

#### 7.1 匹配流程

1. 解析主命令：取第一个 `&&` 或 `;` 之前的部分，按命令类别白名单匹配 → 基础等级
2. 剩余部分扫描：对命令剩余部分做全量高风险参数子字符串扫描
3. 等级判定：
   - 主命令不在白名单 → L2
   - 主命令在白名单 → 取 `max(基础等级, 剩余部分最高风险等级)`
4. 单一命令直接走步骤 1、3

#### 7.2 命令类别白名单

| 命令类别                                | 默认等级 | 高风险参数                           | 升级后等级                                  |
| --------------------------------------- | -------- | ------------------------------------ | ------------------------------------------- |
| `cat`、`ls`、`head`、`tail`、`du`、`df` | L0       | 无                                   | L0                                          |
| `git *`                                 | L1       | `push`、`push --force`、`hard reset` | L2（push）、L3（--force）、L3（hard reset） |
| `npm *`、`yarn *`、`pnpm *`             | L1       | `publish`                            | L2                                          |
| `cargo *`                               | L1       | `publish`                            | L2                                          |
| `docker *`                              | L1       | `push`、`rm`                         | L2（push）、L3（rm）                        |
| `kubectl *`                             | L2       | `delete`、`delete --force`           | L3                                          |
| `rm`、`rmdir`                           | L3       | 无                                   | L3                                          |

**不在白名单的命令**：统一升级为 L2，走确认门。

`subCommand` 是 `run_shell` 工具的强制必填参数，在 `ToolParameter[]` 中显式声明 `{ name: "subCommand", type: "string", required: true }`。工具调用层直接从 `params.subCommand` 读取，不做 inference。

**复合命令兜底**：主命令按白名单匹配，剩余部分全量扫描。整体等级取最高值。`npm test && git push --force` → 主命令 L1，剩余命中 `push --force` L3 → 整体 L3。

#### 7.3 已知限制

**KB-002**：高风险参数匹配是子字符串匹配，非语义分析。`git commit -m "push feature"` 会因 `push` 命中而误报升级为 L2。后果是多弹一次确认门，不影响安全。Meso-Core 视误报率决定是否升级为 token 级匹配。


### 八、MemoryAccessor 接口

功能柱通过 `ExecutionContext.memory` 访问记忆，内部路由到 `ToolGateway.execute("memory_read", ...)` 和 `ToolGateway.execute("memory_write", ...)`，经过完整的染色校验和审计记录。不是独立的第二条记忆访问路径。

```
interface MemoryAccessor {
  read(query: MemoryQuery, context: ExecutionContext): Promise<MemoryReadResult>;
  write(entry: MemoryWriteEntry, context: ExecutionContext): Promise<MemoryWriteResult>;
}

interface MemoryQuery {
  keywords?: string[];
  memoryType?: MemoryType[];
  linkTypes?: LinkType[];
  timeRange?: { start: number; end: number };
  includePrivate?: boolean;  // 仅在 effectiveRetrievalOrientation = 'BUTLER' 时生效
}

interface MemoryWriteEntry {
  memoryType: MemoryType;
  content: Record<string, unknown>;
  summary?: string;
  projectFingerprint?: string;
  isPrivate?: boolean;       // 仅管家取向可设为 true
  metadata?: Record<string, unknown>;
}

interface MemoryReadResult {
  entries: MemoryEntry[];
  totalFound: number;
  filteredPrivateCount: number;  // 因权限不足被过滤掉的私密记忆数量
  durationMs: number;
}

interface MemoryWriteResult {
  success: boolean;
  memoryId?: string;
  error?: string;            // "RESTRICTED_STAIN" | "INVALID_PARAMS"
}
```

**关键约束**：
- `read()` 的 `includePrivate` 仅在 `effectiveRetrievalOrientation = 'BUTLER'` 时生效，其他取向传入此参数被静默忽略
- `write()` 的 `isPrivate` 仅在 `orientation_source = 'BUTLER'` 时允许设为 true，否则写入成功但强制设为 false
- `creator_id` 和 `orientation_source` 由 MemoryAccessor 从 ExecutionContext 自动填充
- `search()` 不暴露为一级 API。全文扫描是 `read()` 的内部降级路径——关联检索失败时自动触发，对调用方透明
- 共同记忆区：所有取向可写入
- 私密记忆区：仅管家取向可写入——由 `restricted` 染色强制
- `restricted` 染色拒绝时返回 `{ success: false, error: "RESTRICTED_STAIN" }`，不抛异常
- 跨维度检索需额外权限校验


### 九、资源预约机制

Meso-Lite 替代神经节点的单进程文件锁：

```
interface ResourceLock {
  reserve(path: string): Promise<void>;    // 预约排队
  release(path: string): void;             // 释放
  isLocked(path: string): boolean;
}
```

- 仅写操作（L1/L2/L3）需预约。读操作不预约——允许并发读
- 预约在确认门之前：先排队，排到后走确认门，确认后执行


### 十、审计日志规范

每次工具调用一条审计记录：

```
AuditRecord {
  id: string;
  timestamp: number;
  toolName: string;
  callerId: string;
  nodeId?: string;
  params: Record<string, unknown>;  // 脱敏后
  result: "success" | "confirmation_required" | "rejected" | "failed";
  reversibilityLevel: ReversibilityLevel;
  confirmedByUser?: boolean;
  duration: number;
}
```

**脱敏规则**：`password`、`token`、`secret`、`key` 字段值替换为 `[REDACTED]`。审计存储写入 memory 包审计分区。


### 十一、Meso-Lite 工具调用层范围

| 特性                                                         | 状态 |
| ------------------------------------------------------------ | ---- |
| 工具注册与染色校验                                           | ✅    |
| 可逆性等级模型（L0-L3）                                      | ✅    |
| 确认门三层分离（Gateway 拦截 → ReAct 发布事件 → 调度器处理确认） | ✅    |
| run_shell 命令类别白名单 + 高风险参数匹配                    | ✅    |
| MemoryAccessor（工具调用层路由）                             | ✅    |
| 资源预约（ResourceLock 替代神经节点）                        | ✅    |
| 审计日志基本写入                                             | ✅    |
| 工具调用层工程形态（方案 B：注入接口 + lint 禁止 pillar 包导入 fs/path 等原生模块） | ✅    |
| L3 数字签名（Meso-Core）                                     | ❌    |
| 审计日志查询接口（Meso-Core）                                | ❌    |


### 十二、宪法咬合

- ✅ 原则四（不可逆操作永远需要用户确认）：L2/L3 确认门不可绕过
- ✅ 原则二（规划与执行分离）：Meta-Agent 不通过工具调用层执行任何操作。规划所需记忆信息通过 HCA 注入获取
- ✅ 原则六（隐私自限性）：`restricted` 染色。非管家取向私密记忆读取静默拒绝
- ✅ 原则三（横向事件不带指令）：确认门拦截通过脊髓事件 `IRREVERSIBLE_PENDING` 发布事实，不是指令


## 第三部分：功能柱与委员会

### 十三、PillarRunner 接口

#### 13.1 接口定义

```
interface PillarRunner {
  readonly pillarId: PillarId;
  execute(node: TaskNode, context: ExecutionContext): Promise<NodeResult>;
  abort(): void;  // 仅处理"正在执行中 → 中断"一个场景
}
```

#### 13.2 ExecutionContext

```
interface ExecutionContext {
  nodeId: string;
  orientation: Orientation;
  activationState: ActivationState;     // 调度器注入，节点执行期间不变
  confirmedByUser?: boolean;            // 确认门已通过，ToolGateway 据此放行
  toolGateway: ToolGateway;
  memory: MemoryAccessor;
  eventBus: EventBusAccessor;           // 只写方向（仅 publish）
}
```

**EventBusAccessor**：
```
interface EventBusAccessor {
  publish(event: CortexEvent): Promise<void>;
  // 不包含 subscribe。功能柱通过构造器注册静态订阅，不在 execute() 内动态订阅
}
```

#### 13.3 NodeResult

```
type NodeResult =
  | { status: "completed"; data: NodeResultData }
  | { status: "failed"; error: CortexError }
  | { status: "blocked"; blockReason: "CONFIRMATION_REQUIRED"; confirmation: ConfirmationData };

interface NodeResultData {
  affectedFiles?: string[];       // 修改或产出的文件列表（调度器依赖判断用）
  summary?: string;               // 节点产出的人类可读摘要
  riskLevel?: "low" | "medium" | "high";
  [key: string]: unknown;         // 柱子特定的扩展字段
}
```

#### 13.4 激活状态注入

`activationState` 由调度器分发节点时从 ActivationConfig 读取，注入 `ExecutionContext`。节点执行期间不变——交融覆写生效延迟到下一个扫描周期。

抑制态（`suppressed`）：调度器不加入就绪队列。若防御性代码被调用，立即返回 `{ status: "failed", error: "PILLAR_SUPPRESSED" }`。

**管家在搭档主导下的抑制态**：不运行 ReAct 循环，不调用工具。但维持对脊髓状态卡的被动感知能力——调度器代感知：抑制柱子退出时注册 WakeCondition（预注册的脊髓事件模式 + 状态卡阈值），调度器在每次扫描周期末尾检查，命中则触发抑制→弱激活转换。脊髓不做唤醒决策。

#### 13.5 确认门路径

Act 阶段调用 `toolGateway.execute()` 返回 `CONFIRMATION_REQUIRED`：
1. 发布 `IRREVERSIBLE_PENDING` 事件
2. 返回 `{ status: "blocked", blockReason: "CONFIRMATION_REQUIRED" }`
3. 调度器收到 blocked 后发布 `NODE_BLOCKED` 事件，标记等待确认
4. 确认到达后重新调用 `execute()`，`context.confirmedByUser = true`，确认门放行

**阻塞取消**：不在 `PillarRunner.abort()` 中。调度器提供独立路径 `cancelBlockedNode(nodeId)`——直接更新节点状态，发布 `NODE_ABORTED`，清理 ConfirmationData。`PillarRunner.abort()` 仅处理正在执行中的中断。

#### 13.6 Committee 参与路径

功能柱通过构造器注入的 `EventBus` 引用注册 `COMMITTEE_SESSION_START` 订阅。此回调在 `execute()` 外部运行——与节点执行并行交错。TypeScript 单线程 async 模型中，多个 async 函数可在同一线程中交错执行。

Committee 讨论期间，功能柱的 `execute()` 不受影响——可继续执行不相关节点。提交权冻结仅影响调度器分发与冲突资源相关的新节点。

#### 13.7 OrientationGate

```
interface OrientationGate {
  check(toolName: string, context: ExecutionContext): boolean;
}
```

**检查粒度**：取向级基础规则 + 柱级修正的复合模型。同一取向下所有柱共享基础规则（如管家所有柱默认只允许读 + 写摘要），柱级修正覆盖基础规则（如 UX 在管家下的弱激活允许 `read_file`）。

**action 语义**：工具名——直接对应 ToolGateway 注册表，稳定不抽象。检查时机：Act 阶段，`toolGateway.execute()` 调用前。通过则继续，拒绝则跳过本次 Act，ReAct 循环进入 Observe 阶段评估备选方案。

Gate 配置在文件中定义，调度器注册柱子时从 meta-agent 包加载配置并注入 CoroutineRunner。

#### 13.8 CoroutineRunner（Meso-Lite 实现）

```
class CoroutineRunner implements PillarRunner {
  constructor(
    pillarId: string,
    llmProvider: LLMProvider,
    eventBus: EventBus,            // 完整接口——仅构造器中注册静态订阅
    orientationGate: OrientationGate
  );
}
```

**工程纪律约束 DC-001**：`eventBus` 引用仅用于构造器中注册静态订阅。`execute()` 方法体内禁止调用 `this.eventBus.subscribe()`。约束由代码审查和 lint 规则保障，编译期不可强制。

ReAct 循环：完整推理路径（第三级响应）。最大迭代数和 stuck 检测继承 Nano 参数。

#### 13.9 Meso-Lite 范围

| 特性                               | 状态                    |
| ---------------------------------- | ----------------------- |
| 完整推理路径（第三级响应）         | ✅                       |
| 取向 Gate 基础版                   | ✅                       |
| 确认门路径                         | ✅                       |
| Committee 静态订阅入口             | ✅                       |
| 抑制态立即返回 + 调度器代感知唤醒  | ✅                       |
| 脊髓反射（一级）、低熵决策（二级） | ❌ Meso-Core             |
| 激活状态覆写在节点执行期间不变     | ✅（Meso-Lite 无需覆写） |


### 十四、Committee 协作通道协议

**宪法锚点**：4.1.3（Expert Committee）、4.1.3.1（临时委员会）

#### 14.1 组建触发

| 触发条件                                 | 触发来源                                           |
| ---------------------------------------- | -------------------------------------------------- |
| 任务节点被 Meta-Agent 标记"多视角需求度" | 调度器从任务树读取                                 |
| 历史失败模式匹配                         | LoopController → 脊髓 `AD_HOC_COMMITTEE_REQUESTED` |
| 用户显式要求                             | Meta-Agent 解析                                    |
| 搭档质疑升级                             | 搭档取向柱子发布 `AD_HOC_COMMITTEE_REQUESTED`      |

#### 14.2 组建流程

1. Meta-Agent 判断需要 Committee
2. Meta-Agent → 调度器：`submitCommitteePlan()`（通过竖向总线）
3. 调度器检查参与柱子状态：空闲则分配；执行中则标记"当前节点完成后切换"
4. 调度器 → 脊髓：发布 `COMMITTEE_SESSION_START`（定向推送给指定柱子）

不绕调度器，不要求全量预注册。

#### 14.3 角色定义

```
CommitteeSession {
  sessionId: string;
  metaAgent: MetaAgentId;
  members: PillarId[];          // 2-5 个，硬性上限 5 个
  topic: string;
  timebox: number;              // 硬性截止时间（ms），不可协商
  messageLimit: number;
  status: "forming" | "discussing" | "converging" | "resolved";
}
```

#### 14.4 消息格式

```
CommitteeMessage {
  sessionId: string;
  sender: PillarId;
  timestamp: number;
  content: CommitteeContent;
  type: "opinion" | "question" | "response" | "withdrawal";
}

CommitteeContent {
  viewpoint: string;
  facts?: CommitteeFact[];
  recommendation: string;
  confidence: number;           // 0-1
  withdrawnFrom?: string;       // 撤回时指向被撤回观点的摘要哈希
}

CommitteeFact {
  memoryId: string;
  memoryState?: MemoryState;    // 归档态需显式标注
  retrievalTimestamp: number;
  summary: string;
}
```

#### 14.5 消息约束

- 格式为观点交换，不是指令下发
- 每条消息带功能柱签名和时间戳
- 消息量有硬性上限，80% 预告，100% 立即暂停自由讨论
- 协作通道内通信仅成员可见，外部功能柱不感知
- 功能柱发言不发布为独立脊髓事件——Meta-Agent 在轮次结束时打包为 `COMMITTEE_ROUND_END` 汇总事件

#### 14.6 Meta-Agent 主持协议

Meta-Agent 通过 event-bus 发布控制事件：`COMMITTEE_SESSION_START` → `COMMITTEE_ROUND_START` → `COMMITTEE_CONVERGE` → `COMMITTEE_SESSION_END`。轮次结束时发布 `COMMITTEE_ROUND_END` 汇总事件。

不参与专业辩论。维持讨论秩序、检查时间盒、执行收束。

**三级收束**（宪法 4.1.3）：
1. **事实最高**：验证引用的事实是否有效。归档态记忆权重降半，冻结态不可引用
2. **基线优先**：激进与保守僵持时按安全基线裁决
3. **分歧交付**：双方都有事实支撑且无法统一时，产出汇总报告呈用户确认

**头身打架（Committee 与 Meta-Agent 分歧）**：否决须附带理由，Meta-Agent 调取内省摘要一并呈用户。参与柱子认为否决可能导致高风险时，可通过脊髓发布存档事件（仅当 Committee 声明风险等级为"高"）。

#### 14.7 提交权冻结分域

讨论期间仅冻结各功能柱**对当前讨论议题相关资源的提交权**。不相关资源上的操作、其他节点上的任务、读操作、记忆写入全部正常执行。

#### 14.8 时间盒与加急模式

- 超过时间盒 → 不进入下一轮，直接发布 `COMMITTEE_CONVERGE`
- 80% 预告"本轮为最后一轮"
- 成员发言超时 → 该成员本轮视为弃权

加急模式（仅临时委员会）：消息量上限收紧；功能柱不进行完整 ReAct 循环，仅基于 LoopController 元认知预判输出直觉式建议；置信度降低；结果附带"加急裁决"醒目标记，强制事后复盘。

#### 14.9 汇总报告与归档

```
CommitteeReport {
  sessionId: string;
  topic: string;
  members: PillarId[];
  viewpoints: CommitteeViewpoint[];
  convergence: "fact" | "baseline" | "split_delivery" | "expedited";
  conclusion: string;
  dissenting?: string[];
  metaSummary?: string;
  timestamp: number;
}
```

协作通道销毁前，完整讨论记录和汇总报告归档到记忆中枢 committee 分区。讨论消息标记 `recordType: "process"`，汇总报告标记 `recordType: "decision"`。功能柱默认只读决策结论——需显式传 `includeProcessRecords: true` 才能查询过程记录。

#### 14.10 Meso-Lite 最小验证子集

**管线连通性验证**：2 柱 + Meta-Agent。各发言一条观点（type: `opinion`）。Meta-Agent 罗列双方观点后收束，不走事实最高、不走基线优先、不走多轮讨论。

完整的 Committee 协议（事实最高、基线优先、记忆态声明规则）在 Meso-Core 实现。

| 特性                                       | Meso-Lite | Meso-Core |
| ------------------------------------------ | --------- | --------- |
| 2 柱基本讨论管线                           | ✅         | —         |
| 分歧交付收束（仅收集双方论据，不自动裁决） | ✅         | —         |
| Committee 控制事件                         | ✅         | —         |
| 汇总报告生成（仅含各方观点罗列）           | ✅         | —         |
| 事实最高收束（验证记忆引用）               | ❌         | ✅         |
| 基线优先收束                               | ❌         | ✅         |
| 记忆态声明规则                             | ❌         | ✅         |
| 加急模式                                   | ❌         | ✅         |
| 头身打架否决路径                           | ❌         | ✅         |

#### 14.11 宪法咬合

- ✅ 规模硬性上限 5 个
- ✅ 协作通道内通信格式为观点交换，不是指令下发
- ✅ 消息量上限 + 时间盒强制收束
- ✅ 三级收束规则
- ✅ 提交权冻结分域
- ✅ 讨论记录与决策结论分离（`recordType`）
- ✅ 加急裁决醒目标记 + 事后复盘（Meso-Core）
- ✅ 临时委员会触发走脊髓事件 + Meta-Agent 主持（Meso-Core）


## 十五、HCA 压缩粒度阶段适配声明

**宪法约束**：Meta-Agent 通过 HCA 注入获取压缩信息，不主动查询工具调用层（宪法 4.5、4.1.2）。

**规模错位**：Meso-Lite 只有 2-3 个功能柱，记忆量远低于需要压缩的程度。标准压缩粒度下重规划循环开销（规划失败 → 重规划 LLM 调用）远大于单次记忆查询成本。

**适配方案**：Meso-Lite 阶段 HCA 压缩粒度可调至"完整加载近期经验记忆"——实质等效于单次 memory_read（议题一已定义 `MemoryAccessor` 通过 ToolGateway 路由）。HCA 压缩粒度是适配层参数，宪法未规定压缩比。Meso-Core 恢复标准压缩粒度。

**不违规**——宪法规定 Meta-Agent 通过 HCA 接收信息，未规定压缩到什么程度。不修宪。


## 十六、阶段跃迁代价声明

Meso-Lite 积累了三项阶段适配：

1. **取向断言放宽**（Nano 继承）：抑制与弱激活边界在实际执行中可模糊
2. **HCA 压缩粒度放宽**：全量加载近期记忆，等效单次查询
3. **Committee 最小验证子集**：2 柱单轮，不走三级收束

当从 Meso-Lite 跃迁到 Meso-Core 时，三项适配同时恢复为标准宪法行为：

- HCA 压缩粒度从"全量"切至"标准压缩"——Meta-Agent 的规划上下文形状变化，重规划频率可能跳变
- Committee 从 2 柱单轮切至 5 柱多轮——讨论协议控制流完全重写
- 神经节点从 ResourceLock 替换为脊髓事件检测——两层完全不同的实现替换同一接口

这是接口不变但行为语义质变的代码替换。测试基线需全部更新。这是渐进式开发的固有成本，已被提前标定范围。


## 十七、议题三闭环总结

| 部分       | 产出物                                                       | 宪法条款    |
| ---------- | ------------------------------------------------------------ | ----------- |
| 交互协议   | `PlanningDirective`、`ExecutionReport`、`CommitteePlan` 协议 | 5.1         |
| 交互协议   | `CortexEvent` Schema、事件路由规则、分级响应                 | 5.2         |
| 交互协议   | 神经节点激活信号、资源粒度、工作流程（Meso-Core）            | 5.3         |
| 工具调用层 | 工具注册与染色、可逆性等级模型、确认门流程                   | 4.5、原则四 |
| 工具调用层 | `run_shell` 命令类别白名单、`MemoryAccessor` 接口            | —           |
| 功能柱     | `PillarRunner` 接口、`ExecutionContext`、取向 Gate           | 4.1         |
| 委员会     | `CommitteeSession`、消息格式、Meta-Agent 主持协议            | 4.1.3       |

**关键架构冲突与解决**：

| 冲突                                                  | 解决方案                                         |
| ----------------------------------------------------- | ------------------------------------------------ |
| ActivationConfig 归属（宪法 6.1 vs 工程需要）         | 基础层 Meta-Agent 查表下传，覆写层调度器自主叠加 |
| Committee 与 execute() 生命周期（宪法 4.1.3 vs 单模） | 构造器回调并行，execute() 外部交错               |
| Meta-Agent 工具调用权（宪法 4.5 vs Meso-Lite 规模）   | HCA 压缩粒度阶段适配，不修宪                     |

**宪法合规**：全部审查通过。不修宪。


**文档状态**：议题三闭环，全部硬茬及中度问题修正完成。与整体实施细则合并归档。

---

# Cortex Meso 阶段——议题四：记忆系统与事件通信协议设计

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一（技术选型与敲定）、议题二（项目形态的演进与工程形态的落地）、议题三（功能的抽象与具体设计）


## 一、总览

### 1.1 议题范围

基于宪法第七章（记忆系统）、第五章（通信架构）及议题一至三的技术选型与接口抽象，将以下宪法概念落地为工程层面的存储 Schema、检索流程、投影规则、权限模型与事件通信协议：

- 两层四分架构（7.1）
- 单一基础关联网络 + 检索时动态投影（7.2）
- 遗忘四态模型（7.3）
- 关联性读写与向量检索的层级关系（7.3）
- 交叉参考受控（7.2）
- 隐私自限性与私密记忆物理隔离（7.1, 7.5, 原则六）
- 事件不带指令（原则三）

### 1.2 与小尾巴（XiaoWeiba）的继承关系

| 继承层   | 内容                                                        | 改造说明                                                     |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| 直接复用 | sql.js WASM 集成模式、原子持久化、健康检查、备份恢复        | 沿用 DatabaseManager 代码模式，剔除 `vector BLOB` 列         |
| 思想复用 | 混合检索的门控调制思想、指数时间衰减公式、pattern_hash 去重 | 门控调制改造为按取向投影规则；时间衰减公式保留 λ=0.1；去重用于显式关联 |
| 不可复用 | `MemoryCleaner` 双态过期逻辑、向量优先检索引擎              | 替换为遗忘四态状态机；"关联优先、向量辅助"的新检索范式       |

### 1.3 Meso-Lite 阶段范围

- 实现**活跃态 ↔ 归档态**完整流转
- 冻结态和湮灭态仅保留 `state` 枚举值，不触发实际流转
- 分层存储：sql.js 主库（内容+关联+状态+审计）+ 预留 LanceDB WASM 接口（向量索引在 Meso-Core 引入）
- 关联检索 + 关键词匹配 + 时间衰减排序，不依赖向量


## 二、主记忆表 Schema

### 2.1 统一 `memories` 表

Meso-Lite 用一张表承载四种记忆类型，通过 `memory_type` 字段区分。关联表外键指向此表 `id`。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,        -- 'EPISODIC' | 'CONCEPTUAL' | 'KNOWLEDGE' | 'SKILL'
  state TEXT NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'ARCHIVED' | 'FROZEN' | 'OBLITERATED'
  content TEXT NOT NULL,            -- JSON 或文本，按类型承载差异
  summary TEXT,                     -- 人类可读摘要
  orientation_source TEXT NOT NULL, -- 写入者有效检索取向 (BUTLER | PARTNER | OVERSEER)
  creator_id TEXT NOT NULL,         -- 写入者功能柱 ID
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1.0,
  project_fingerprint TEXT,         -- 关联项目标识（可选）
  metadata TEXT,                    -- JSON 扩展字段
  is_private INTEGER DEFAULT 0     -- 1=私密记忆，0=共同记忆
);
```

索引：
- `(memory_type, state, weight)` —— 按类型和状态检索
- `(state, last_accessed_at)` —— 裁剪扫描
- `(project_fingerprint, memory_type)` —— 按项目过滤
- `(is_private, orientation_source)` —— 私密记忆权限校验
- `(creator_id)` —— 来源签名追溯

### 2.2 四种类型的 `content` JSON 结构

- **经验记忆** (`EPISODIC`)：`{ taskType, entities, decision, outcome }`
- **概念记忆** (`CONCEPTUAL`)：`{ architecture, patterns, preferences }`
- **认知知识** (`KNOWLEDGE`)：`{ rawData, source, expiry }`
- **技能记忆** (`SKILL`)：`{ steps: [...], version }`（数据结构预留，Meso-Core 实现）


## 三、关联表 Schema（主读从写架构）

### 3.1 日志表 `memory_link_log`（写入侧，append-only）

```sql
CREATE TABLE memory_link_log (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL,   -- 枚举值见 3.3
  creator_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

索引：
- `(source_id)` —— 去重辅助（显式关联）
- `(target_id)` —— 反向追踪
- `(created_at, link_type)` —— 按类型和时间清理（ACCESSED_DURING）

### 3.2 查询视图 `memory_links`（读优化）

```sql
CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  weight REAL NOT NULL,           -- 初始权重由 link_type 决定
  target_state TEXT NOT NULL,     -- 'ACTIVE' | 'ARCHIVED' | 'FROZEN' | 'OBLITERATED' 冗余
  last_accessed_at INTEGER NOT NULL,
  -- 注意：access_count 不在此表，见 3.4
  FOREIGN KEY (source_id) REFERENCES memories(id),
  FOREIGN KEY (target_id) REFERENCES memories(id)
);
```

索引：
- `(source_id, link_type, weight)` —— BFS 正向遍历
- `(target_id, link_type)` —— 反向追踪
- `(last_accessed_at, weight)` —— 关联裁剪扫描

**同步机制**：日志写入后在同一 sql.js 事务中追加到视图。BFS 遍历期间不触发同步。`access_count` 批量回写在 ReAct 循环结束时执行。

### 3.3 `link_type` 枚举

| 类别     | 类型                 | 含义                          | 去重策略             | 初始权重 |
| -------- | -------------------- | ----------------------------- | -------------------- | -------- |
| 自动关联 | `ACCESSED_DURING`    | 功能柱 ReAct 循环中读取此记忆 | 不去重，每次写入新行 | 0.2      |
| 自动关联 | `PRODUCED_BY`        | 记忆由某次 ReAct 循环产出     | 幂等去重             | 0.5      |
| 自动关联 | `DERIVED_FROM`       | 记忆从另一条记忆抽象/蒸馏     | 幂等去重             | 0.7      |
| 显式关联 | `DEPENDS_ON`         | 代码/模块级依赖               | 幂等去重             | 0.9      |
| 显式关联 | `REFACTORED_FROM`    | 重构前后关系                  | 幂等去重             | 0.8      |
| 显式关联 | `CITED_IN_COMMITTEE` | Committee 讨论中的事实引用    | 幂等去重             | 0.7      |
| 显式关联 | `CASCADE_TO`         | 遗忘级联关系                  | 幂等去重             | 1.0      |

**去重规则**：
- `ACCESSED_DURING`：不去重。唯一索引 `(source_id, target_id, created_at)`，允许重复
- 其他类型：幂等去重。唯一索引 `(source_id, target_id, link_type)`，重复则覆盖 `created_at`

**`CASCADE_TO` 语义声明**：source 是源记忆（如私密记忆），target 是衍生记忆。删除 source 时沿正向遍历找到所有 target → 进入冻结态。反向遍历走 `WHERE target_id = ?` 查询"哪些记忆依赖此记忆"。

### 3.4 独立计数器表

```sql
CREATE TABLE memory_link_access_counter (
  link_id TEXT PRIMARY KEY,
  access_count INTEGER DEFAULT 1
);
```

批量回写走原子累加：`INSERT OR REPLACE ... SET access_count = COALESCE(old, 0) + ?`。避免多柱并发覆盖。

### 3.5 日志清理策略

- 显式关联（`DEPENDS_ON`、`REFACTORED_FROM`、`CITED_IN_COMMITTEE`、`CASCADE_TO`、`DERIVED_FROM`、`PRODUCED_BY`）：日志永久保留
- `ACCESSED_DURING`：日志与视图同步清理，超过 N 天后移除（N 为适配层参数，默认 7 天）。日志不是永久真理来源——是**带 TTL 的真理来源**

### 3.6 检索反馈表

自迭代策略的唯一数据源。

```sql
CREATE TABLE retrieval_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,          -- 被反馈的记忆 ID
  source_react_cycle TEXT NOT NULL, -- 哪次 ReAct 循环
  feedback_type TEXT NOT NULL,      -- 'MISSING_KEY' | 'NOISE_OVERLOAD' | 'IRRELEVANT'
  adjustment_direction REAL,        -- +1.0 提权 / -1.0 降权
  created_at INTEGER NOT NULL
);
```

索引：`(created_at)` —— 自迭代策略增量查询 `WHERE created_at > last_checkpoint`；`(memory_id)` —— 按记忆追溯反馈历史。

**写入者**：LoopController。在每次任务完成后评估检索是否因缺失关键记忆而走偏、是否因无关记忆太多而干扰，评估结论写入此表。

**与记忆的 `metadata` JSON 的区别**：反馈不塞进 `memories.metadata`——独立建表确保自迭代策略读取时可以增量查询，不受记忆总量影响。


## 四、检索流程

### 4.1 四级检索

| 级别     | 触发条件                               | 行为                                                         | 备注                     |
| -------- | -------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| 第一级   | 关联检索正常                           | BFS 遍历 `memory_links`，深度受限于检索者身份，产出关联子图  | 主路径                   |
| 第二级   | 关联子图非空                           | 在子图内三维排序（结构权重 + 关键词 + 时间衰减，系数来自投影规则） | 关键词匹配默认走倒排索引 |
| **旁路** | 关联子图为空，但 `memories` 表不为空   | 直接在 `memories` 表上关键词匹配，不要求关联存在             | 冷启动友好               |
| 第三级   | 关联检索本身失败（异常、超时、表损坏） | 全文扫描，审计记录触发频率                                   | 极端降级                 |

**BFS 深度限制**：
- Meta-Agent：最多三层
- 功能柱：最多一层
- 管家信息编织：最多一层跨源

> **关键词匹配的工程实现**：Meso-Lite 默认走倒排索引（继承小尾巴 `IndexManager` 模式）。sql.js 的默认 WASM 编译不包含 FTS5——需要自定义编译 WASM 或原生模块。FTS5 作为 Meso-Core 的可选优化路径，在需要全文搜索性能提升时引入，不改变倒排索引的核心逻辑。

### 4.2 第二级排序公式

排序公式引用投影规则提供的系数，不硬编码：

```
final_score = structural_weight × rule.structuralCoefficient
            + keyword_match × rule.keywordCoefficient
            + temporal_decay × rule.temporalCoefficient
```

- `structural_weight`：经投影规则调整后的边权重 × 跳数衰减（第一跳 ×1.0，第二跳 ×0.5，第三跳 ×0.25）
- `keyword_match`：子图内记忆的 `summary`/`content` 与查询词重合度（倒排索引计算）
- `temporal_decay`：继承小尾巴指数衰减 `w(t) = e^(-λt)`，λ=0.1，半衰期约 7 天
- `rule`：当前取向的 `ProjectionRule.weightAdjustments`

三种取向的系数全部来自 Section 5.2 的 `weightAdjustments`。不需要"基础公式 + 投影覆写"两层——投影规则直接提供完整系数。

### 4.2.1 主记忆表访问统计更新

`memory.read()` 返回结果后，在同一个 ReAct 循环结束时的批处理中执行：

```sql
UPDATE memories
SET access_count = access_count + 1,
    last_accessed_at = ?
WHERE id IN (...);   -- 本次检索返回的所有记忆 ID
```

此更新与 `memory_link_access_counter` 的批量回放放在同一个事务中。不逐条 UPDATE——检索返回 20 条记忆就是 20 行的一次批量更新。

### 4.3 冷启动旁路

当关联子图为空（记忆存在但尚无关联边）时，直接在 `memories` 表上通过关键词匹配返回结果。随关联积累自然退化。

### 4.4 `target_state` 冗余的最终一致性声明

`memory_links.target_state` 在衰减周期中批量更新，滞后于 `memories.state` 的实际变更。BFS 遍历在两次衰减周期间可能基于过期的 `target_state` 做出遍历决策。此最终一致性在 Meso-Lite 规模下可接受。


## 五、投影规则映射表

### 5.1 接口定义

```typescript
interface ProjectionRule {
  orientation: Orientation;
  visibleLinkTypes: LinkType[];
  weightAdjustments: {
    structuralCoefficient: number;
    temporalCoefficient: number;
    keywordCoefficient: number;
  };
  fieldPriorities: { field: string; boost: number }[];
}
```

### 5.2 三种取向的默认规则

#### 管家取向

- 可见关联：`DERIVED_FROM`, `PRODUCED_BY`, `ACCESSED_DURING`
- 不可见（跳过）：`DEPENDS_ON`, `REFACTORED_FROM`, `CITED_IN_COMMITTEE`, `CASCADE_TO`
- 系数：结构 0.2 / 时间 0.5 / 关键词 0.3
- 字段优先级：`summary` (1.5), `content` (1.0), `created_at` (0.5)

**理由**：管家关注信息整理和生活影响。代码级依赖和 Committee 引用是搭档/监理的领地。管家记忆的关联不等于因果关系——结构权重低。管家对时间敏感（"最近整理过"比"什么时候整理的"更重要）。依赖关键词匹配查找特定信息。

#### 搭档取向

- 可见关联：`DEPENDS_ON`, `REFACTORED_FROM`, `DERIVED_FROM`, `CITED_IN_COMMITTEE`, `PRODUCED_BY`
- 不可见（跳过）：`ACCESSED_DURING`, `CASCADE_TO`
- 系数：结构 0.5 / 时间 0.2 / 关键词 0.3
- 字段优先级：`content` (1.5), `summary` (0.5), `created_at` (0.3)

**理由**：搭档关注代码结构和重构历史。代码级依赖是强关联——结构权重是主导维度。搭档关注的代码结构不会快速过时。`ACCESSED_DURING` 被过滤——瞬时关联在检索中不提供有意义的遍历路径，只会引入噪音。

#### 监理取向

- 可见关联：`DEPENDS_ON`, `CASCADE_TO`, `CITED_IN_COMMITTEE`, `PRODUCED_BY`
- 不可见（跳过）：`ACCESSED_DURING`, `DERIVED_FROM`, `REFACTORED_FROM`
- 系数：结构 0.5 / 时间 0.1 / 关键词 0.4
- 字段优先级：`content` (1.5), `created_at` (0.4), `summary` (0.3)

**理由**：监理关注部署安全和审批链。依赖链和级联链是确定性的——监理需要精确的结构追溯。监理的教训不会过时——三个季度前的部署失败仍然相关。通过关键词匹配特定模块或特定风险。

### 5.3 交融场景的投影规则覆写

功能柱被借调时，使用 `effectiveRetrievalOrientation` 对应的投影规则，而非注册取向的规则。例如管家 Filter 柱被搭档借调，检索时走搭档投影规则。私密记忆的硬检查仍然生效——`effectiveRetrievalOrientation !== 'BUTLER'` 时禁止访问私密记忆。

### 5.4 投影规则存储与执行位置

**存储**：映射表是静态配置，不存储在 sql.js 中——它是 `memory` 包内的一个 TypeScript 常量文件 `projection-rules.ts`。三种取向的规则在编译时确定，运行时只读。如需扩展取向或调整权重，修改此文件并通过监理合规背书即可——这是宪法 11.2 半开放层的适配参数，不是不可变内核。

**执行位置**：检索器执行 `memory.read(query, context)` 时：
1. 从 Mapping 表中加载 `effectiveRetrievalOrientation` 对应的 `ProjectionRule`
2. BFS 遍历 `memory_links`，每一步按 `visibleLinkTypes` 过滤边类型，命中的边按 `structuralCoefficient` 调整其 `weight`
3. 产出子图后，第二级排序使用调整后的 `structural_weight`，加上 `keyword_match` 和 `temporal_decay`，按投影规则中的系数计算最终得分
4. 排序结果的字段提取按 `fieldPriorities` 加权

整个投影规则在检索侧完成，不修改基础关联网络的任何数据。

### 5.5 宪法咬合

- ✅ 宪法 7.2："检索时按取向维度动态投影"——投影规则在检索侧执行，写入时不预判取向
- ✅ 宪法 7.2："投影规则预定义，不靠模型在检索时临场判断"——映射表是静态配置
- ✅ 宪法 7.2："单一基础关联网络"——基础关联表没有按取向拆分，投影是查询时的动态视图


## 六、权限模型与审计

### 6.1 MemoryAccessor 接口

```typescript
interface MemoryAccessor {
  read(query: MemoryQuery, context: ExecutionContext): Promise<MemoryReadResult>;
  write(entry: MemoryWriteEntry, context: ExecutionContext): Promise<MemoryWriteResult>;
}

interface MemoryQuery {
  keywords?: string[];
  memoryType?: MemoryType[];
  linkTypes?: LinkType[];
  timeRange?: { start: number; end: number };
  includePrivate?: boolean;  // 仅在 effectiveRetrievalOrientation = 'BUTLER' 时生效
}

interface MemoryWriteEntry {
  memoryType: MemoryType;
  content: Record<string, unknown>;
  summary?: string;
  projectFingerprint?: string;
  isPrivate?: boolean;       // 仅管家取向可设为 true
  metadata?: Record<string, unknown>;
}

interface MemoryReadResult {
  entries: MemoryEntry[];
  totalFound: number;
  filteredPrivateCount: number;  // 因权限不足被过滤掉的私密记忆数量
  durationMs: number;
}

interface MemoryWriteResult {
  success: boolean;
  memoryId?: string;
  error?: string;            // "RESTRICTED_STAIN" | "INVALID_PARAMS"
}
```

**关键约束**：
- `read()` 的 `includePrivate` 仅在 `effectiveRetrievalOrientation = 'BUTLER'` 时生效，其他取向传入此参数被静默忽略
- `write()` 的 `isPrivate` 仅在 `orientation_source = 'BUTLER'` 时允许设为 true，否则写入成功但强制设为 false
- `creator_id` 和 `orientation_source` 由 MemoryAccessor 从 ExecutionContext 自动填充

### 6.2 写入路径：共同记忆与私密记忆的隔离

`MemoryAccessor.write()` 内部根据 `entry.isPrivate` 路由到不同工具名，ToolGateway 按工具名做染色校验：

| 工具名                 | 染色             | 调用者                                                   |
| ---------------------- | ---------------- | -------------------------------------------------------- |
| `memory_write`         | `execution_only` | 所有激活态功能柱                                         |
| `memory_private_write` | `restricted`     | 仅管家取向（`effectiveRetrievalOrientation = 'BUTLER'`） |

非管家调用 `memory_private_write` 返回 `{ success: false, error: "RESTRICTED_STAIN" }`，静默拒绝不留异常日志。ToolGateway 静默拒绝——宪法 4.5 要求"非管家取向的私密记忆读取请求被静默拒绝，不留异常日志以避免反向推断私密内容"。写入同理。

### 6.3 来源签名

`orientation_source` 取自 `context.effectiveRetrievalOrientation`。交融场景下记忆标被借调取向——管家被搭档借调写代码分析记忆时，`orientation_source` 取 `PARTNER`。`creator_id` 取自 `context.callerId`，始终为真实写入者。

### 6.4 跨维度检索校验

触发条件：`effectiveRetrievalOrientation !== memory.orientation_source AND memory.is_private = 1`

校验记录写入 `audit_records` 表，不通过脊髓事件广播。Meso-Lite 阶段仅以 `is_private` 字段判断，`content` 内部的敏感字段标记延至 Meso-Core。

### 6.5 `audit_records` 表

```sql
CREATE TABLE audit_records (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  action_type TEXT NOT NULL,          -- 'CROSS_DIMENSION_ACCESS' | 'PRIVATE_ACCESS_DENIED' | 'STATE_CHANGE' | 'CONFIRMATION_SIGNED'
  operator_id TEXT NOT NULL,
  operator_orientation TEXT NOT NULL,
  target_memory_id TEXT,
  details TEXT,                       -- JSON 上下文（如跨越的维度方向、拒绝原因）
  created_at INTEGER NOT NULL
);
```

索引：`(action_type, created_at)`, `(operator_id, created_at)`, `(target_memory_id)`

**与脊髓事件的隔离**：`audit_records` 表仅供审计查询，不走脊髓事件总线。隐私相关的操作记录仅落盘到此表，不通过 `MEMORY_*` 事件发布。


## 七、事件通信协议

### 7.1 事件发布原则

记忆相关事件遵循原则三——**只描述事实，不携带指令**。事件的 payload 只包含"谁在什么时候对什么记忆做了什么操作"，不包含"订阅者应该做什么"。

### 7.2 事件类型定义

| 事件                             | 发布者         | 触发时机                           | payload 内容                                              | 隐私约束                                           |
| -------------------------------- | -------------- | ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `MEMORY_WRITTEN`                 | 功能柱         | 记忆写入成功                       | memoryId, memoryType, orientationSource, summary          | **不含 content**；私密记忆不发布                   |
| `MEMORY_READ`                    | 功能柱         | 记忆检索完成                       | query 摘要, resultCount, filteredPrivateCount, durationMs | **不含检索结果内容**；私密参与统计但不发布具体信息 |
| `MEMORY_STATE_CHANGED`           | MemoryStore    | 状态流转发生                       | memoryId, oldState, newState, triggerReason               | 私密记忆不发布                                     |
| `MEMORY_PRIVATE_ACCESS_DETECTED` | MemoryAccessor | `filteredPrivateCount > 0` 时      | memoryId, callerId, filteredCount                         | 内部事件，Core-2b 引入                             |
| `MEMORY_CASCADE_FROZEN`          | MemoryStore    | 源记忆进入冻结态，级联影响衍生记忆 | sourceMemoryId, affectedMemoryIds[]                       | Meso-Core 实现                                     |
| `MEMORY_OBSOLETED`               | MemoryStore    | 湮灭态物理删除完成                 | memoryId, obsoletedAt                                     | Meso-Core 实现                                     |

### 7.3 事件隐私约束细则

- `MEMORY_WRITTEN` 只包含 `summary` 和 `memoryType`，不包含 `content`。记忆的具体内容不进入脊髓——脊髓事件归档是所有订阅者可见的
- `MEMORY_READ` 只包含统计信息（检索了多少条、耗时多久、过滤了多少私密记忆），不包含检索结果的具体内容
- `MEMORY_STATE_CHANGED` 包含状态转换元数据，不包含受影响的记忆的具体内容
- 私密记忆的操作不发布事件。`MEMORY_WRITTEN`、`MEMORY_READ` 和 `MEMORY_STATE_CHANGED` 在检测到 `is_private = 1` 时跳过发布。私密记忆的存在本身不通过事件总线泄漏

### 7.4 事件订阅关系

| 事件                             | 订阅者            | 订阅原因                                                     |
| -------------------------------- | ----------------- | ------------------------------------------------------------ |
| `MEMORY_WRITTEN`                 | LoopController    | 追踪记忆增长趋势，评估自迭代反馈的覆盖率                     |
| `MEMORY_READ`                    | LoopController    | 追踪检索频率和耗时，检测退化信号                             |
| `MEMORY_STATE_CHANGED`           | Meta-Agent        | 更新 `activationConfig` 的覆写上下文——当关键记忆状态变化时调整交融决策 |
| `MEMORY_PRIVATE_ACCESS_DETECTED` | 哨兵              | Mode 6 数据源——功能柱连续查询隐私数据                        |
| `MEMORY_CASCADE_FROZEN`          | Meta-Agent        | 感知遗忘级联事件，评估是否需要重规划受影响的任务节点         |
| `MEMORY_OBSOLETED`               | 哨兵（Meso-Core） | 审计湮灭操作是否合规——是否经过监理背书和用户确认             |

### 7.5 Meso-Lite 范围

- ✅ `MEMORY_WRITTEN` 和 `MEMORY_READ` 事件发布
- ✅ `MEMORY_STATE_CHANGED` 事件发布——仅活跃态↔归档态流转时触发；冻结态和湮灭态在 Meso-Core 才触发流转，因此对应事件在 Meso-Lite 不发布
- ❌ `MEMORY_PRIVATE_ACCESS_DETECTED` 事件——Core-2b 引入
- ❌ `MEMORY_CASCADE_FROZEN` 和 `MEMORY_OBSOLETED` 事件——Meso-Core 引入冻结/湮灭流转时同步发布

### 7.6 事件不走的路径

记忆写入和检索不由脊髓直接触发——功能柱调用 `MemoryAccessor`，MemoryAccessor 内部调用 ToolGateway，ToolGateway 执行写入后通过 `eventBus.publish()` 发布事件。脊髓是事件的传输通道，不是记忆操作的发起者。

状态变更事件（`MEMORY_STATE_CHANGED`）由记忆系统内部的定时衰减周期触发——不是由功能柱或 ToolGateway 触发。这是记忆系统内部的自主行为。


## 八、宪法咬合检查

### 权限模型

- ✅ 7.1：私密记忆仅管家取向可写入和读取，strict 在 `orientation_source` 和 `effectiveRetrievalOrientation` 两道门
- ✅ 7.2：跨维度检索额外权限校验，审计记录写入 `audit_records` 表
- ✅ 7.5：来源签名——`creator_id` 和 `orientation_source` 在写入时自动填入
- ✅ 7.5：共享只走共同记忆区——私密记忆不进入全局检索，通过 `is_private` 字段和 `MemoryAccessor.read()` 的硬检查保证
- ✅ 4.5：私密记忆的物理访问边界——restricted 染色在 ToolGateway 层面强制执行

### 事件通信

- ✅ 原则三：事件只描述事实——`MEMORY_WRITTEN` 不含内容，`MEMORY_READ` 不含结果
- ✅ 原则六：私密记忆的操作不发布事件，不通过脊髓泄漏
- ✅ 7.5：跨会话恢复只加载结构化摘要——`MEMORY_WRITTEN` 事件的 `summary` 字段可用于下一个会话的上下文加载

### 检索与投影

- ✅ 7.2：单一基础关联网络——关联表无取向标签，投影在检索侧执行
- ✅ 7.2：投影规则预定义——三种取向的静态映射表
- ✅ 7.2：交叉参考受控——跨维度校验 + 审计日志
- ✅ 7.3：关联检索主路径 + 向量辅助——Meso-Lite 实现关联检索；向量检索预留
- ✅ 7.3：遗忘四态——`state` 枚举四值齐全；流转逻辑分阶段实现
- ✅ 7.3：检索深度硬限制——BFS 深度守卫


## 九、已知边界与最终一致性声明

- `memory_links.target_state` 冗余字段更新滞后于 `memories.state`，滞后窗口等于衰减周期执行间隔（适配层参数，默认 10 分钟）。BFS 遍历在窗口内可能基于过期状态做出遍历决策。此最终一致性在 Meso-Lite 规模下可接受。
- `ACCESSED_DURING` 日志清理周期与视图同步，超过 N 天后移除。N 值默认为 7 天。
- Meso-Lite 阶段不实现 `content` 字段的自动敏感内容检测，跨维度校验仅依赖 `is_private` 字段。
- 关键词匹配默认走倒排索引（继承小尾巴 `IndexManager` 模式），FTS5 作为 Meso-Core 可选优化路径。


**文档状态**：议题四闭环，全部硬茬及中度问题修正完成。与整体实施细则合并归档。

---

# Cortex Meso 阶段——议题五：项目演进阶段与执行策略

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一至四


## 一、演进全景与核心原则

### 1.1 演进全景

```
Nano ──→ Nano+ ──→ Meso-Lite ──→ Core-1a~1d ──→ Core-2a~2d ──→ Core-3a~3c ──→ Full-1a~1d ──→ Full-2a~2d ──→ 完整生命体
 ✅        ✅         概念设计完成    记忆+Committee  安全+自适应    自迭代+长期运行  分布式+多通道   生态+最终交付     愿景
                      即将实现
```

### 1.2 核心原则

**原则 A：数据驱动阶段跃迁。** 每一阶段的退出标准由运行时数据判定，不由直觉或功能清单驱动。没有数据的阶段不进入。

**原则 B：每一层复杂性的引入，都是为了解决上一层暴露的实际故障。** 不是在提前过度设计，而是在痛点出现时恰好有可用的解决方案。技术选型的重大变更（如 sql.js → better-sqlite3）应发生在架构稳定、需要对应性能提升的阶段，而非核心逻辑验证期。

**原则 C：不做超过当前阶段架构能力的测试。** 测试成本与结论可迁移性必须匹配。在一个即将被替换的架构上烧资源，产出的结论不能直接迁移到下一阶段。


## 二、阶段一：Nano（已完成）

### 2.1 范围

极简代码验证三个核心假设。单柱单进程，内存 EventBus，无持久化记忆。

### 2.2 交付物

- MockLLM 管线验证：21 个测试全部通过
- 真实 LLM 验证：6 个核心假设测试全部通过
- 极简实现：MetaAgent + ReActLoop + EventBus + MemoryStore + ToolGateway

### 2.3 验证的核心假设

1. LLM 能否可靠地把模糊意图转化为可执行任务树 ✅
2. ReAct 循环在受控环境里能否产生比单次 API 调用更好的结果 ✅
3. 事件总线连接独立系统是否比中央调度器更灵活 ✅

### 2.4 退出状态

已退出。进入 Nano+ 阶段。


## 三、阶段二：Nano+（已完成）

### 3.1 定位

在 Nano 的极简代码上打补丁，积累运行时数据，为 Meso 概念设计落地提供决策依据。不引入新架构机制。

### 3.2 交付物清单（7 项）

| #    | 任务                          | 内容                                                         | 为 Meso 提供的核心数据                            |
| ---- | ----------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| ①    | 补原则④确认门                 | ToolGateway 不可逆操作拦截逻辑（CONFIRMATION_REQUIRED 错误码） | 不可逆操作触发频率、确认/拒绝比、用户等待时长分布 |
| ②    | normalizeNode 日志            | LLM 输出越界索引时记录 WARN 日志                             | LLM 输出质量统计：越界频率、集中出现的任务类型    |
| ③    | 增加 git_diff + git_log 工具  | 工具集从 5 个扩展到 7 个                                     | 多工具环境下的选择正确率、错误选择模式            |
| ④    | 取向分类配置化                | 硬编码关键词列表抽取为 JSON 配置文件                         | 关键词 vs LLM 分类的差异率、LLM 分类延迟分布      |
| ⑤    | MockLLM 管线稳定性验证        | 1000 任务单柱内存管线压测（不消耗 API）                      | Heap GC 行为、环形缓冲稳定态、stuck 累积率        |
| ⑥    | subscribeAll 强制 reason 参数 | EventBus 通配符订阅增加必填 reason                           | 为 Meso 事件拓扑文档生成提供静态审计线索          |
| ⑦    | shared 包顶部边界声明         | "此包只包含类型定义和接口签名，不包含任何运行时实现"         | 工程纪律硬约束，保障议题二原则 B                  |

### 3.3 稳定性测试结果

- 1000 任务连续运行，0 崩溃，0 阻塞
- Heap GC 正常回收（15MB → 30MB → GC 后 3.2MB）
- 环形缓冲区稳定在 5002，未溢出
- 事件总线无消息丢失或投递异常

### 3.4 退出标准（已达成）

- 七项任务全部完成，每项产出有效数据点满足分析需求
- 确认门触发后用户拒绝率在合理区间（未出现过度骚扰）
- MockLLM 1000 任务全部通过

### 3.5 不交付（明确排除）

多柱并发、Committee、图执行调度器、向量检索、遗忘四态流转、哨兵、脑干、神经节点——这些是 Meso 阶段的职责，Nano+ 不越界。


## 四、阶段三：Meso-Lite（概念设计完成后进入实现）

### 4.1 定位

**验证多柱协作和图执行调度。** 在单进程协程运行时上，以 2-3 个功能柱、最简 Committee 管线、基础记忆系统（活跃/归档两态）验证核心行为闭环。

### 4.2 物理形态

**CLI 工具，stdin/stdout 交互。** 延续 Nano+ 的形态，不引入图形界面或后台服务。确认门通过控制台读取用户输入，Engine 层确认处理器基于 Node.js `readline` 模块实现。

理由：Meso-Lite 的核心目标是验证多柱协作的调度逻辑、记忆检索的关联正确性以及 Committee 的管线连通性，这些行为的验证不依赖图形界面。CLI 形态对开发调试最友好，且确认门架构已在议题三实现三层分离（ToolGateway 拦截 → ReActLoop 发布事件 → Engine 确认处理器），后续迁移到 Electron 时仅需替换 Engine 层的确认处理器，核心逻辑不受影响。

### 4.3 技术约束

- **继续沿用 sql.js (WASM)**。不切换到 better-sqlite3 原生模块。Nano+ 的稳定性基线（1000 任务 0 崩溃）建立在 sql.js 上，保持已知基线可降低调试复杂度。Meso-Lite 同时引入调度器、Committee 和多柱并发——变量过多会延长故障定位时间。FTS5 全文搜索留到 Meso-Core 阶段，与向量检索一起引入。
- **关键词匹配使用倒排索引**（继承小尾巴 `IndexManager` 模式）。不依赖 sql.js 未内置的 FTS5 扩展。

### 4.4 准入条件

Nano+ 七项数据全部收集完毕，退出标准全部达成。

### 4.5 交付物

| 类别      | 内容                                                         |
| --------- | ------------------------------------------------------------ |
| 运行时    | 单进程协程，图执行调度器，2-3 个功能柱并发                   |
| 记忆      | sql.js 主库 + 活跃/归档两态流转 + 关联检索（BFS，深度守卫）+ 关键词旁路 |
| Committee | 2 柱 + Meta-Agent 管线连通性验证（仅分歧交付路径）           |
| 确认门    | 可逆性等级 L0-L3 + run_shell 白名单 + 文件类型风险标记       |
| 脊髓      | 事件发布/订阅核心路径（无合并、无关联、无第二意见反射）      |
| 测试      | Mock Committee 覆盖所有收束路径 + 双轨测试体系               |

> 详细工程交付清单见**议题二 Section 5**（9 个运行时包 + 1 个测试包的具体内容）。本文档的能力验证目标与议题二的工程产出为不同视角的同一交付物集合，实施时需对齐两份清单。

### 4.6 不交付（明确排除）

- 向量检索、冻结/湮灭态流转
- Committee 的事实最高/基线优先/加急模式/记忆态声明规则
- 哨兵、脑干、神经节点
- 信任模型（确认门 L1 放行暂不走信任等级，统一走确认）
- 图形界面（Electron）、IDE 插件、后台常驻服务

### 4.7 稳定性策略

**第一层：MockLLM 多柱并发压测（自动化，每次提交）。**

从单柱 1000 任务升级到多柱版：
- 3 个功能柱并发执行 + 图执行调度器就绪队列扫描
- Committee 2 柱讨论管线完整走通
- 记忆系统关联检索 BFS 三跳 + 关键词旁路（冷启动场景）

验证指标：

| 指标                         | 基线                          |
| ---------------------------- | ----------------------------- |
| 1000 任务 0 死锁             | 多柱协程并发无互相阻塞        |
| blocked 节点不阻塞全局       | 其余柱继续执行未依赖节点      |
| 环形缓冲区 ≤ 10000           | 事件总线无泄漏                |
| Heap GC 正常回收             | 无引用泄漏                    |
| Committee 消息队列不持续膨胀 | 1000 任务后队列深度回到初始值 |

**第二层：狗粮自用（非自动化，持续积累）。**

在实际使用中通过被动健康指标捕获退化信号：
- LoopController 每次任务完成后评估检索效果 → 写入 `retrieval_feedback`
- 冷启动旁路触发频率（当持续偏高时，说明关联边积累速度低于预期）
- 关联子图平均 BFS 深度（当持续偏低时，说明有效关联密度不足）
- 归档态记忆占比在衰减周期中自动统计
- Committee 收束路径分布（当前只有分歧交付，统计讨论次数和平均时间盒消耗）

当某个指标偏离基线超过阈值，由 Meta-Agent 在阶段评估报告中标记。

### 4.8 验证目标

| 指标                        | 基线                                      |
| --------------------------- | ----------------------------------------- |
| 多柱并发无死锁              | 100 任务连续运行 0 死锁                   |
| 图调度器 blocked 不阻塞全局 | blocked 节点占比 < 30% 时其余节点继续执行 |
| 记忆检索延迟                | BFS 三跳 P99 < 100ms                      |
| 确认门触发率                | 与 Nano+ 基线偏差 < 20%                   |
| 冷启动旁路可用              | 记忆非零且关联为零时关键词旁路可返回结果  |

### 4.9 退出标准

- 全部验证指标达标
- 至少 3 个真实场景（如代码重构、安全审查、部署检查）的端到端测试通过
- 狗粮自用积累 > 50 个任务的 retrieval_feedback 数据

### 4.10 阶段结束后产出

- **Meso-Lite 阶段评估报告**：由 Meta-Agent 生成，包含全部验证指标的统计数据、Committee 收束路径分布、被动健康指标趋势
- **监理合规审查**：监理取向确认评估报告中的数据采集符合宪法要求
- **用户确认**：进入 Meso-Core 的决策权在用户手中


## 五、阶段四：Meso-Core（未来）

### 5.1 定位

**补齐宪法的全部核心机制。** 按单一验证目标、单一步骤的原则，拆分为三个子阶段（Core-1、Core-2、Core-3），共 11 个子步骤。


### Core-1：记忆与 Committee 完整性

#### Core-1a：向量检索引入

**核心交付**：引入 LanceDB WASM，实现 embedding 生成和向量索引写入。检索流程从二级（关联+关键词）升级为三级（关联+子图内向量精排+关键词）。异步向量化的最终一致性窗口在此阶段验证。

**退出标准**：
- 向量检索 P99 < 200ms
- `vector_indexed` 占比 > 95%（排除异步队列中等待处理的记忆）
- 子图内向量精排不增加关联检索的端到端延迟（对比 Core-1a 引入前后的 BFS 三跳 P99）

#### Core-1b：Committee 三级收束

**核心交付**：实现事实最高收束（验证记忆引用、归档态降半权重）；实现基线优先收束（激进与保守方案僵持时按安全基线裁决）；实现记忆态声明规则（冻结态不可引用为论据）；实现加急模式（直觉式建议输出、附带"加急裁决"醒目标记）；实现头身打架否决路径（Meta-Agent 调取内省摘要与委员会意见一并呈交）。

**退出标准**：
- Mock Committee 覆盖全部收束路径，每种路径至少 10 个测试用例通过
- 事实最高收束中记忆引用验证不增加单轮讨论延迟 > 10%
- 加急模式的时间盒压缩比首次触发时即稳定在预设值内，不逐次漂移

#### Core-1c：冻结/湮灭态流转

**核心交付**：实现冻结态触发（私密记忆删除 → 级联冻结所有衍生记忆）；实现湮灭态触发（冻结态持续完整审计周期 → 监理审慎背书 → 用户显式确认 → 物理删除）；实现 `MEMORY_CASCADE_FROZEN` 和 `MEMORY_OBSOLETED` 事件发布。

**退出标准**：
- 冻结态级联在 100 条关联的衍生记忆上正确执行（无遗漏、无过度冻结）
- 级联冻结 100 条衍生记忆的完成时间 < 500ms
- 湮灭态审计日志完整，包含监理背书和用户确认签名
- 湮灭态物理删除不阻塞主库的关联检索

#### Core-1d：数据库升级

**核心交付**：从 sql.js 切换到 better-sqlite3（原生同步 API，性能提升）；启用 FTS5 全文搜索，替换倒排索引作为关键词匹配引擎；对比切换前后的检索延迟和内存占用。

**退出标准**：
- 切换后检索延迟不高于 sql.js 基线，BFS 三跳 P99 < 100ms
- FTS5 关键词匹配延迟不高于倒排索引基线

> **变量隔离标注**：Core-1d 放在 Core-1 末尾。Core-1b 和 Core-1c 跑在 sql.js + LanceDB 的组合上——数据库切换是 Core-1 的最后一步，中间两个步骤提供变量隔离带。出问题时可以准确区分是向量检索、Committee 收束、冻结流转还是数据库切换导致的。


### Core-2：安全与自适应

#### Core-2a：19 柱全面上线

**核心交付**：全部 19 个功能柱上线，加载完整激活矩阵（19×3 配置表全部填充 Gate 规则）；验证交融场景下覆写层的正确性（多次交融覆写不产生冲突）；验证不同皮层区在各自取向下的激活/抑制行为。

**退出标准**：
- 19 柱并发 500 任务无死锁
- 调度器就绪队列平均等待时间 < 50ms
- 单柱 stuck 率 < 1%
- 激活矩阵配置文件通过监理合规背书（每柱每取向的激活状态有明确宪法依据或延伸补全标注）

#### Core-2b：哨兵规则引擎及脑干简装版

**核心交付**：
- 全部 8 种检测模式上线（含注意力资源冲击告警、未经证实事件告警、第二意见反射降级告警）
- Mode 3（品性信任连续下降）在信任模型未初始化时静默禁用，不产生告警、不报错。此模式数据为空时不计入退出标准的误报率统计
- 哨兵告警投递走脑干简装版（cortex-engine 包，独立高优环形缓冲 + 优先消费协程 + 200ms 带外降级）。脑干简装版作为 Core-2b 的伴生交付物同步上线
- 验证哨兵告警在真实事件流中的误报率和漏报率

**退出标准**：
- 哨兵在 500 任务中误报率 < 5%，漏报率 < 1%（误报率指标不含 Mode 3）
- 哨兵每次扫描不增加脊髓事件端到端延迟 > 5%
- 注意力冲击告警在请求洪峰到达后 5 秒内触发

#### Core-2c：脊髓高级功能

**核心交付**：事件合并（同类型重复事件在给定窗口内合并为摘要事件）；因果关联（因果相关事件自动串联，带链 ID 分发）；第二意见反射（关键事实事件在广播前交叉验证数据指纹，验证通过附加"已验证"标记，失败则降级为"未经证实"并触发哨兵告警）；第二意见反射健康度自监（成功率低于阈值时自动降级并发布专门告警）。

**退出标准**：
- 事件合并准确率 100%（确定性逻辑）
- 事件合并在 3 秒窗口内完成
- 因果关联链中至少 95% 的事件引用可追溯到原始事件 ID——其余部分允许因 LLM 在边界情况下的非确定性输出而在人工抽查中存在，但不出现断链
- 第二意见反射在正常事件流中验证成功率 > 95%
- 第二意见反射在 50ms 超时内返回验证结果，超时率 < 5%

#### Core-2d：信任模型

**核心交付**：品性信任半自动计算（主动通报率 + 修正成功率自动计算，不隐瞒和边界诚实由用户在季度报告中手动评分补全）；品性信任分数附带不确定性区间（如 0.75 ± 0.15）；能力信任分域（不同取向独立评分，不跨身份传递）；L1-L4 等级控制确认门 L1 放行（L1 操作 + 信任等级 ≥ L3 → 自动放行）。

**退出标准**：
- 品性信任分数在 100 次交互后稳定在 ±0.1 波动区间内
- L1 放行率与用户手动确认率偏差 < 5%（即系统判断与用户意愿一致）
- 品性信任分数的每次更新计算 < 10ms，不阻塞确认门决策路径


### Core-3：自迭代与长期运行

#### Core-3a：自迭代策略闭环

**核心交付**：Meso-Lite 阶段作为"沉默观察期"——`retrieval_feedback` 正常积累但不触发任何参数自动调整，所有投影规则系数和记忆衰减参数保持出厂基线。Core-3a 阶段利用 Meso-Lite + Core-1~2 积累的反馈数据，为每个取向独立校准调整函数：先在历史数据上离线验证调整方向的有效性，确认后再启用在线自动调整，初始步长 ±0.05。

ε-贪心探索率在 1%-15% 范围内由自迭代策略自动调整。1% 的最低保障和 15% 的最高上限属于不可逆内核参数，变更需监理背书 + 用户确认。探索池连续 10 次无 `EXPLORATION_INSIGHT` → ε × 0.8（最低 1%），创造性参与率连续 20 个任务下降 → ε × 1.5（最高 15%）。探索仅在风险等级为低或中的任务节点上触发。

reward 函数由三部分组成：任务完成速度（30%，使用完成步数而非墙钟时间，Committee 讨论轮次不计入步数）+ 任务成功率（50%）+ 认知多样性评分（20%）。认知多样性评分基于功能柱 ReAct 循环中"是否启用了认知加工"的标记。

衰减回退：每个被调整的参数附带 30 天衰减期。衰减期内至少 3 次正向反馈则衰减期重置，否则自动回退保守基线。回退自动执行，不走用户确认，记录版本号和审计日志。

**退出标准**：
- 自迭代策略连续 10 个周期产出有效权重调整（"有效"= 用 Meso-Lite + Core-1~2 积累的历史数据在离线验证中确认了调整方向，非随机调参）
- 未触发衰减回退基线（说明最近的策略确实优于历史基线）
- 单次 retrieval_feedback 驱动的权重调整计算 < 100ms
- ε 探索率调整的评估周期不拖长任务完成时间

#### Core-3b：跨会话连续性

**核心交付**：运行摘要结构化格式落定（包含上一个身份移交的 `orientation`、`completedTasks` 摘要、`blockedNodes` 列表）；跨会话身份移交协议（新会话启动时主动从记忆中枢和脊髓状态卡加载结构化上下文）。

**退出标准**：
- 连续 10 次跨会话恢复，Meta-Agent 在第二次会话中正确引用前次会话的上下文
- 跨会话恢复的结构化上下文加载 < 500ms，不拖长新会话的首次响应时间

#### Core-3c：冷启动观察期自动退出

**核心交付**：实现多维度稳定效应判定（通知响应模型在滑动窗口内预测准确率变化 < ε 时判定已稳定）；观察期退出后系统行为无退化。

**退出标准**：
- 管家通知响应模型预测准确率在最近 30 天内变化 < 5%
- 搭档任务确认率稳定在 ±10% 区间
- 观察期自动退出至少触发一次
- 多维度稳定效应判定在每次记忆写入后附带计算，不额外增加 I/O 路径


### 5.2 准入条件（Meso-Core）

- Meso-Lite 退出标准全部达成
- 多柱并发数据积累 > 500 任务

### 5.3 触发指标（从 Meso-Lite 数据中提取）

| 触发指标               | 阈值      | 触发引入的机制            |
| ---------------------- | --------- | ------------------------- |
| 单柱 stuck 率          | > 1%      | 哨兵 stuck 告警           |
| Committee 分歧交付占比 | > 40%     | 事实最高/基线优先自动收束 |
| 记忆总量               | > 5000 条 | LanceDB 向量检索          |
| 归档态记忆占比         | > 20%     | 冻结态流转逻辑            |
| 确认门 L1 放行率       | > 80%     | 信任等级自动放行          |

### 5.4 交互形态

**物理形态在 Meso-Core 阶段正式确定。** 基于 Meso-Core 运行期间积累的真实用户交互数据（管家通知响应时间、用户专注时段分布、搭档主动出击频率等），决策是否引入 Electron 桌面应用形态。Meso-Lite 的 CLI 形态在此阶段仍作为调试和自动化通道保留。


## 六、阶段五：Meso-Full（未来）

### 6.1 定位

**分布式能力、多通道交互、社区生态预备。** 拆分两个子阶段（Full-1、Full-2），共 8 个子步骤。


### Full-1：分布式与多通道

#### Full-1a：运行时升级

**核心交付**：从单进程协程升级到 Worker Threads；实现 WorkerTransport 和 WorkerRunner；脑干应急兜底上线（四类关键控制事件的完整扫描和强制投递）；脑干故障时系统进入最低权限保守运行模式。

**退出标准**：4 柱并发在 Worker Threads 下 1000 任务无死锁；脑干在 30 秒扫描间隔内无人认领事件检测准确率 100%（确定性逻辑）。

#### Full-1b：神经节点冲突协调

**核心交付**：实现脊髓事件合并 + 冲突模式检测；实现神经节点激活、局部协调、资源锁定（文件级→模块级→项目级）、退出全流程；验证神经节点激活期间脑干的降级行为（对已锁定资源的关键控制事件仅记录备案）。

**退出标准**：指令冲突、质量下降、静默风险三种冲突模式的检测准确率 100%；神经节点激活频率 < 总任务数的 5%（非过度激活）。

#### Full-1c：多通道交互

**核心交付**：Web UI（管家仪表盘：系统状态、待确认操作、简报呈现）；IDE 插件（搭档编程：内联代码建议、Committee 讨论侧边栏、实时流式输出）；CLI 保留为调试和 CI 集成通道。三种通道在确认门上的行为一致——同一不可逆操作在所有通道上都触发确认门。

**退出标准**：三种通道均可完成完整任务生命周期（意图输入→规划→执行→结果呈现）。

#### Full-1d：跨设备状态同步

**核心交付**：多前端设备共存时的主活跃前端判定；后台身份实例的任务结果通过管家通道在活跃前端呈现；脊髓全局状态卡跨设备可访问。

**退出标准**：两个设备同时在线，非活跃设备上的搭档完成节点后，结果在活跃设备的管家通道中正确呈现。


### Full-2：生态与最终交付

#### Full-2a：社区功能柱 SDK

**核心交付**：插件沙箱（受限的工具调用权限、事件发布权限、记忆读取权限）；取向相容性声明格式和监理审查流程；插件注册和卸载机制。

**退出标准**：社区 SDK 自注册一条内部示例柱（非 19 柱之一），通过完整的监理审查→注册→卸载流程。

#### Full-2b：硬件分级降能

**核心交付**：L1 轻量级（本地 CPU，脊髓和规则引擎本地运行，本地小模型）；L2 标准级（云端 API，DeepSeek V4 满血模型）；L3 深度级（本地高端算力，所有数据完全私有化）。

**退出标准**：三种级别均可启动并完成基本任务；级别切换时数据不丢失、会话不中断。

#### Full-2c：ProactiveEngine 季度报告

**核心交付**：月度数据在每月最后一天聚合（Full-2c 阶段已有 Worker Threads，跑在独立线程上不阻塞主线程），聚合结果写入季度报告增量字段（`month1Stats`/`month2Stats`/`month3Stats`）。季度末汇总三份月度数据 + 跨月趋势分析（仅比较变化率，不做推断）。报告使用纯模板渲染，不调用 LLM、不消耗 API 配额。交叉洞察按需呈现（用户主动勾选，默认关闭）。

**退出标准**：一份完整的季度行为镜像报告生成成功，包含至少 3 个月的运行时数据；用户确认报告内容不含推断性陈述或跨域聚合结论。

#### Full-2d：完整生命体交付

**核心交付**：全部宪法机制就位；所有已知固有缺陷的缓解策略验证有效；最终交付。

**退出标准**：Full-2a 至 Full-2c 全部退出标准达成；监理取向对全系统进行最终合规审查并通过；用户确认进入完整生命体。


### 6.2 准入条件（Meso-Full）

Core-3 全部退出标准达成 + 真实用户场景连续运行 > 1 个月。


## 七、阶段六：完整生命体

### 7.1 定位

宪法第十三章定义的全部机制上线。19 柱全量运行，所有已知缺陷的缓解策略就位，整个系统的工程交付终点。

### 7.2 准入条件

Meso-Full 全部退出标准达成。

### 7.3 核心状态

- 全部四种通信通道（竖向、脊髓、神经节点、协作通道）完整上线
- 全部哨兵检测模式持续运行
- 完整的长周期自迭代和退化防护
- 所有已知固缺缓解策略验证有效
- 信任模型完整运作（L1-L4 + 数字签名）


## 八、阶段跃迁的判定机制

### 8.1 持续收集的核心指标

| 指标                   | 用途                                       |
| ---------------------- | ------------------------------------------ |
| 功能柱 stuck 率        | 决定是否需要哨兵、神经节点                 |
| Committee 收束路径分布 | 决定是否需要自动收束                       |
| 记忆量增长曲线         | 决定何时引入向量检索、冻结态流转           |
| 确认门 L1/L2/L3 分布   | 决定信任等级自动放行的可行性               |
| 狗粮自用被动健康指标   | 决定架构退化是否发生、交互形态参数是否成熟 |
| 跨会话恢复成功率       | 决定记忆投影规则是否需要调整               |

### 8.2 判定流程

1. 阶段运行期间持续收集核心指标
2. 达到退出标准后，Meta-Agent 生成**阶段评估报告**——基于指标的统计摘要，不含推断或聚合性结论
3. 监理取向对报告进行合规审查——确认指标采集方法符合宪法要求
4. 用户确认后进入下一阶段


## 九、与议题七的边界声明

- **议题五**：回答"什么时候做什么"。各阶段的触发条件、验证目标、交付物边界、退出标准。技术选型变更的时机归属（如 sql.js → better-sqlite3）在此统一管理。
- **议题七**：回答"那些还没讨论的核心设计怎么做"。脑干、哨兵、自迭代策略、跨会话连续性、冷启动观察期等横向关切的具体设计。

两者在"什么时候实现脑干/哨兵/自迭代"这个时间点上有交叉，但议题五只管时间点和准入条件，议题七管具体设计。不互相僭越。


## 十、闭环总结

| 阶段       | 状态         | 核心交付                                                     | 退出数据/条件                             |
| ---------- | ------------ | ------------------------------------------------------------ | ----------------------------------------- |
| Nano       | ✅ 已退出     | 管线 21 + 真实 6                                             | 核心假设验证通过                          |
| Nano+      | ✅ 已完成     | 7 项数据收集 + 管线压测                                      | 1000 任务 0 崩溃 0 阻塞，Heap 正常        |
| Meso-Lite  | 概念设计完成 | 多柱并发 + 基础记忆 + 最简 Committee                         | 3 个真实场景端到端通过，> 50 任务反馈数据 |
| Core-1     | 未来         | 向量检索 + Committee 三级收束 + 冻结/湮灭流转 + better-sqlite3 | 向量 P99 < 200ms，收束全覆盖，级联正确    |
| Core-2     | 未来         | 19 柱 + 哨兵 + 脑干简装版 + 脊髓高级 + 信任模型              | 哨兵误报 < 5%，L1 放行偏差 < 5%           |
| Core-3     | 未来         | 自迭代闭环 + 跨会话连续性 + 冷启动自动退出                   | 自迭代连续有效，跨会话正确引用            |
| Full-1     | 未来         | Worker Threads + 神经节点 + 多通道 + 跨设备同步              | 1000 任务无死锁，三种通道完整生命周期     |
| Full-2     | 未来         | 社区 SDK + 硬件分级 + ProactiveEngine + 交付                 | 示例柱监理审查通过，季度报告含 3 月数据   |
| 完整生命体 | 未来         | 全部宪法机制                                                 | Full-2 退出标准达成                       |

**与宪法的咬合**：全部阶段划分和演进原则符合宪法第十三章。每一层复杂性的引入时机符合"痛点驱动"的宪法设计哲学。阶段间的跃迁判定由运行时数据驱动，控制闭环的"用户确认"在每次跃迁时生效。

**物理形态演进路径**：Nano/Nano+/Meso-Lite 保持 CLI；Meso-Core 阶段基于用户交互数据确定是否引入 Electron；Meso-Full 实现多通道完整交互。确认门三层分离架构保证形态切换时核心逻辑不受影响。


**文档状态**：议题五闭环，全部中度问题修正完成。与议题七的横向关切分工已落定——议题五管时间点和准入条件，议题七管具体设计。两议题均已闭环，合并为 Cortex Meso 阶段概念设计完整实施细则。

> **Meso-Lite 实施反思附录（2026-05-05 追加）**：议题五独立文件 `议题五-项目演进阶段与执行策略.md` 已追加完整反思附录（6 项隐含声明显式化 + 4.10 自我矛盾修正 + Meso-Core 准入条件重评估提示）。本文档为整合版，完整附录内容参见独立文件。核心修正摘要：
> 1. "2-3 柱"→ 实际 5 包协作，接口传播半径是包级别非柱级别
> 2. Committee 固定成员制不足——需责任链驱动的动态调整机制
> 3. Meta-Agent 不应是自身评估报告的生成者（4.10 自我矛盾）
> 4. "真实场景"缺少判定标准
> 5. 文档自洽性验证机制缺失——17 条错误无人核验（P-9）
> 6. 闭环表"概念设计完成"与"工程实施完成"是独立里程碑

---

# Cortex Meso 阶段——议题六：Meso-Lite 最小交互协议

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一至五


## 一、议题定位

### 1.1 范围收缩

本议题仅定义 **Meso-Lite CLI 形态下的最小交互契约**。不涉及多通道交互、打断强度分级、IDE 插件或 Web UI。超出当前阶段能力的协议留待 Meso-Core/Meso-Full 阶段补全。

### 1.2 核心原则

**在痛点出现时设计解决方案，不为假设的未来需求预填接口字段。** 交互协议是当前阶段可交付、可测试的工程约束，不是最终形态的蓝图。

### 1.3 与最终形态的关系

CLI 和图形界面是平行交互通道，各自服务不同用户场景（调试/巡检/CI 集成 vs 日常使用）。两者的核心交互循环相同——用户发送意图（对话），Cortex 执行工具调用并返回结果。差异仅在呈现方式（文本流 vs 可视化面板），不在能力边界。Meso-Lite 实现 CLI 通道，Meso-Core 基于实际交互数据确定是否引入图形界面，届时两者平等实现同一套交互契约。


## 二、Meso-Lite 交互协议

### 2.1 InteractionChannel 接口

```typescript
interface InteractionChannel {
  // 用户意图传入：原始自然语言字符串
  onUserIntent(callback: (rawInput: string) => void): void;

  // 系统输出传出：结构化输出
  send(output: SystemOutput): void;

  // 控制介入：确认门响应、任务取消、状态查询
  onUserIntervention(callback: (intervention: MesoLiteIntervention) => void): void;
}
```

**实现**：`ConsoleChannel`。`onUserIntent` 监听 stdin 行输入，`send` 写入 stdout，`onUserIntervention` 在确认门阻塞期间临时接管 stdin 解析。

### 2.2 用户意图传入

`rawInput` 为纯文本。不携带 `channelType`、`activeFile`、`selectedCode` 等 IDE 场景字段。Meta-Agent 仅基于文本内容做意图解析，与议题三竖向总线的 `PlanningDirective` 一致。

### 2.3 系统输出传出

```typescript
interface SystemOutput {
  type: 'RESULT' | 'NOTIFICATION' | 'INTERVENTION_REQUIRED';
  orientation: 'butler' | 'partner' | 'overseer';
  summary?: string;   // 管家优先
  content?: string;   // 搭档优先
  verdict?: string;   // 监理优先
  nodeId?: string;    // 仅 INTERVENTION_REQUIRED 时携带，指向被阻塞节点
}
```

**格式化规则**：由当前取向决定优先字段。管家填充 `summary`，搭档填充 `content`，监理填充 `verdict`。`NOTIFICATION` 类型用于非阻塞提醒（如后台任务完成，Meso-Core 阶段引入后台管家后启用），`INTERVENTION_REQUIRED` 用于确认门或 Committee 分歧交付。

**不定义打断强度**：强度分级是 UI 概念，在 CLI 中无物理载体。保留到 Meso-Core 阶段根据交互数据确定。

### 2.4 控制介入

```typescript
type MesoLiteIntervention =
  | { type: 'CONFIRM'; nodeId: string; answer: 'yes' | 'no' }
  | { type: 'CANCEL_TASK'; taskTreeId: string }
  | { type: 'QUERY_STATUS' };
```

- `CONFIRM`：用户对确认门的响应。Engine 调用 `scheduler.resumeBlockedNode()` 或 `scheduler.cancelBlockedNode()`
- `CANCEL_TASK`：终止整个任务树。Engine 调用 `scheduler.cancelTaskTree()`
- `QUERY_STATUS`：查询脊髓全局状态卡。Engine 返回当前活跃身份、最近关键事件链、待确认操作列表

**不包含**：`VIEW_COMMITTEE`（通过诊断接口拉取）、`ADJUST_TASK_TREE`（Meso-Lite 调度器不支持动态调整）、`SWITCH_ORIENTATION`（取向切换是跨会话概念，Meso-Core 实现）。


## 三、确认门超时行为

### 3.1 超时定义

当 `INTERVENTION_REQUIRED` 输出发送后，`InteractionChannel` 在指定时间内未收到 `CONFIRM` 响应，视为超时。

### 3.2 超时处理

- Engine 执行默认拒绝：调用 `scheduler.cancelBlockedNode(nodeId)`
- 节点标记 `NODE_ABORTED`，附带原因 `"CONFIRMATION_TIMEOUT"`
- `ConsoleChannel` 向 stdout 写入提示："确认超时，操作已自动取消。"
- 超时阈值：适配层参数，Meso-Lite 默认值 5 分钟

**注意**：Meso-Lite 无会话持久化。终端关闭后进程终止，无后台守护，确认门不会残留到下次会话。


## 四、诊断与调试接口

### 4.1 面向用户的诊断

`QUERY_STATUS` 介入动作返回脊髓全局状态卡，包含：

- 当前活跃身份
- 最近关键事件链（事件类型 + 时间戳，不含 payload 内容）
- 待确认操作列表（nodeId + 操作摘要）

### 4.2 面向开发者的诊断

`ConsoleChannel` 提供独立诊断输出流（stderr），包含：

- 事件总线订阅拓扑（事件类型 → 订阅者列表）
- 记忆系统统计（记忆量、关联密度、活跃/归档占比）
- 功能柱状态（激活状态、当前执行节点、stuck 次数）

诊断数据通过 `cortex diag` 子命令暴露。不通过脊髓事件推送——诊断信息是拉取模式。

### 4.3 隐私约束

所有诊断输出（包括 stderr 和 `QUERY_STATUS` 返回内容）不得包含：

- 事件载荷的具体内容
- 记忆的具体内容
- 私密记忆的任何信息（包括存在性）


## 五、与现有组件的咬合

### 5.1 确认门路径

```
ToolGateway 返回 CONFIRMATION_REQUIRED
  → ReActLoop 发布 irreversible.pending 事件
    → Engine 生成 SystemOutput { type: 'INTERVENTION_REQUIRED', nodeId, ... }
      → ConsoleChannel 输出确认提示，阻塞等待 stdin
        → 用户输入 CONFIRM / 超时
          → Engine 调用 scheduler.resumeBlockedNode() 或 scheduler.cancelBlockedNode()
```

确认门三层分离在 CLI 形态下完整保留。ConsoleChannel 是"用户界面"的当前实现，与议题三的设计完全一致。

### 5.2 脊髓事件流

Meso-Lite CLI 下不提供实时事件推送（无 WebSocket）。事件日志通过 `cortex diag` 的 stderr 输出或事后查询记忆中枢获取。诊断接口遵守议题三的诊断元数据约束。

### 5.3 取向表达规范

`SystemOutput` 的字段选择遵循议题四投影规则中的 `fieldPriorities`——管家优先 `summary`，搭档优先 `content`，监理优先 `verdict`。取向表达规范（宪法 5.5）在交互输出中自然落地。


## 六、Meso-Lite 交互协议范围总结

| 接口/能力                      | Meso-Lite 状态                     |
| ------------------------------ | ---------------------------------- |
| `InteractionChannel`（三方法） | ✅ 完整实现，ConsoleChannel         |
| `SystemOutput` 结构            | ✅ 完整实现，由取向决定填充字段     |
| 确认门交互（CONFIRM + 超时）   | ✅ 完整实现                         |
| `CANCEL_TASK` 介入             | ✅ 完整实现                         |
| `QUERY_STATUS` 介入            | ✅ 完整实现                         |
| 诊断接口（拉取模式）           | ✅ 完整实现                         |
| 打断强度分级                   | ❌ 不定义，Meso-Core 阶段引入       |
| `VIEW_COMMITTEE` 介入          | ❌ 不定义，通过诊断接口间接支持     |
| `ADJUST_TASK_TREE` 介入        | ❌ 调度器不支持，Meso-Core 阶段引入 |
| `SWITCH_ORIENTATION` 介入      | ❌ 跨会话概念，Meso-Core 阶段引入   |
| WebSocket 事件推送             | ❌ Meso-Core 阶段引入               |
| 多通道（Web UI / IDE 插件）    | ❌ Meso-Core / Meso-Full 阶段引入   |


## 七、宪法咬合检查

- ✅ 双向开门全闭环（第三章）：确认门（CONFIRM）、取消任务（CANCEL_TASK）、状态查询（QUERY_STATUS）通过 `MesoLiteIntervention` 统一承载。用户在 CLI 下可随时介入
- ✅ 不可逆操作确认（2.4）：确认门跨通道一致。超时默认拒绝对齐安全基线
- ✅ 取向表达规范（5.5）：`SystemOutput` 字段选择由取向决定，不绑定通道
- ✅ 控制闭环（3.4）：Meso-Lite 阶段三个介入类型覆盖当前所有用户介入场景
- ✅ 隐私自限性（原则六）：诊断输出不包含事件载荷、记忆内容、私密记忆信息


**文档状态**：议题六闭环，全部中度问题修正完成。与议题七的横向关切分工已落定——议题六管 Meso-Lite 交互契约，议题七管脑干/哨兵/自迭代等全局机制。两议题均已闭环，合并为 Cortex Meso 阶段概念设计完整实施细则。

---

# Cortex Meso 阶段——议题七：全系统横向关切设计

**状态**：讨论闭环，全量修正完成
**宪法版本依赖**：Cortex 概念顶层设计 v1.1
**前置议题**：议题一至六


## 一、议题七定位与范围

### 1.1 定位

议题七处理宪法中已定义但尚未在议题一至六中展开工程化的横向关切。这些机制不单独属于某个包，而是跨越调度器、event-bus、记忆中枢、功能柱的全局性设计。它们不在 Meso-Lite 阶段实现，但在 Meso 概念设计阶段需要落定——不等到 Core 阶段才从零开始。

### 1.2 横向关切清单

| #    | 横向关切        | 宪法条款   | Core/Full 归属 | 核心设计问题                                                 |
| ---- | --------------- | ---------- | -------------- | ------------------------------------------------------------ |
| 1    | 脑干            | 4.3        | Full-1a        | 四类关键控制事件的强制投递机制；Core 阶段为哨兵告警提供脑干简装版 |
| 2    | 神经节点        | 5.3        | Full-1b        | 冲突模式检测、局部协调资源锁定、激活期间脑干降级协议         |
| 3    | 哨兵            | 8.4        | Core-2b        | 八种检测模式的阈值与触发条件；告警路由；与脑干和神经节点的接口契约 |
| 4    | 自迭代策略      | 7.3 / 10.2 | Core-3a        | retrieval_feedback 驱动的参数自动调优；ε-贪心探索；认知多样性权重；检索质量调整的分阶段策略 |
| 5    | 小脑与技能记忆  | 4.2 / 7.1  | Core-3a        | 技能模板沉淀机制、SkillExecutor 接口、步骤间变量传递、试用期安全网 |
| 6    | 跨会话连续性    | 7.4        | Core-3b        | 运行摘要结构化格式、会话移交协议、跨设备身份移交、blockedNodes 跨会话恢复 |
| 7    | 冷启动观察期    | 12.4       | Core-3c        | 三无场景下的多维度稳定效应判定、最小数据量阈值、确认延迟时间替代确认率 |
| 8    | ProactiveEngine | 10.2       | Full-2c        | 季度行为镜像报告的增量生成、纯模板渲染（不调 LLM）、出厂基线按需索取 |


## 二、脑干（宪法 4.3）

### 2.1 分阶段策略

哨兵在 Core-2b 上线，需要可靠的高优告警投递，但完整脑干在 Full-1a 才实现。中间七个步骤需要一个脑干简装版作为过渡。

| 阶段    | 组件       | 职责                                                         |
| ------- | ---------- | ------------------------------------------------------------ |
| Core-2b | 脑干简装版 | 独立高优环形缓冲 + 优先消费协程。仅服务哨兵高风险告警单一消费方 |
| Full-1a | 完整脑干   | 四类事件强制投递、无人认领事件扫描、独立应急通道、兜底执行   |

### 2.2 接口抽象

```typescript
interface AlertDispatcher {
  dispatch(alert: SentinelAlert): void;
}
```

哨兵依赖此接口发布告警，不感知底层是简装版还是完整脑干。脑干简装版放在 `cortex-engine` 包中，作为 `AlertDispatcher` 的简装版实现。event-bus 只提供第二环形缓冲的创建能力（通用 API，不感知缓冲的业务用途）。

### 2.3 脑干简装版（Core-2b）

**独立高优环形缓冲**：容量 1000 条，与主环形缓冲（10000 条）物理隔离。哨兵告警写入此缓冲区，不经过普通脊髓事件流。

**优先消费协程**：高优消费者在每次事件循环中优先于主消费者执行，主消费者通过 `setImmediate` 让步。

**协作式调度的固有限制与带外降级**：Node.js 单线程协程模型下，`setImmediate` 让步的是下一个事件循环 tick，不是当前同步代码块。主消费者正在执行的同步操作（如 BFS 扫描 100 条记忆）无法被抢占。当哨兵检测到高优告警写入后 200ms 仍未确认消费（高优消费者每次处理告警时更新 `lastConsumeHeartbeat` 时间戳，哨兵读取此时间戳判断超时），直接写入持久化日志作为带外备份。Meta-Agent 在每次规划前检查此日志。

**硬性约束**：
- 仅处理哨兵高风险告警
- 不扫描脊髓事件流、不检测无人认领事件
- 不执行目标身份无响应时的兜底操作
- 不使用独立应急通道——仍走 Transport 层

### 2.4 完整脑干（Full-1a）

- 四类关键控制事件的强制投递，走独立应急通道，绕过工具调用层权限体系
- 无人认领事件扫描：以极低频率扫描脊髓事件流（出厂基线每 30 秒）
- 兜底执行：二次投递和持久化记录，不递归触发新关键控制事件
- 神经节点激活期间，对已锁定资源的关键控制事件仅记录备案
- Worker Threads 升级后，主消费者和高优消费者运行在独立 Worker 中，抢占问题从"协程让步"变为"线程调度"
- 脑干故障时系统进入最低权限保守运行模式

### 2.5 哨兵监控脑干的循环路径处理

哨兵监控脑干连续失败——但"脑干故障告警"本身需要通过脑干投递。脑干故障时此告警被卡在高优缓冲中。

**处理**：哨兵对脑干的监控结果走独立旁路，不经过 `AlertDispatcher` 接口。脑干健康检查连续失败时，哨兵直接写入持久化日志。Meta-Agent 在每次规划前检查此日志。此路径不依赖脑干本身的可用性。

### 2.6 从简装版迁移

脑干简装版代码在 Full-1a 废弃。`AlertDispatcher` 的实现从简装版替换为完整脑干的独立应急通道。哨兵不感知此迁移。


## 三、神经节点（宪法 5.3）

### 3.1 职责边界

神经节点跨越三个组件，职责各自独立：

- **脊髓（event-bus 包）**：负责冲突模式检测，确定性规则匹配，不依赖 LLM
- **Meta-Agent（meta-agent 包）**：负责生成微协调方案，仅针对冲突资源
- **调度器（scheduler 包）**：负责执行锁定和恢复，非冲突身份不受影响

### 3.2 冲突模式检测协议

脊髓在每次事件合并周期中执行确定性模式匹配：

- **指令冲突**：事件合并窗口中，`targetResource` 相同的两个写操作或写+删除操作
- **质量下降**：`REFACTOR_COMPLETED` 事件中 `qualityMetrics` 低于预设阈值
- **静默风险**：同一身份连续发布成功事件，但其审计标记被哨兵设为 `ANOMALY`
- **主动请求**：功能柱发布 `ARBITRATION_REQUESTED` 事件

### 3.3 微协调方案生成

Meta-Agent 收到 `NEURO_NODE_ACTIVATED` 事件后，不重新生成整个任务树——只在当前任务树上覆盖局部锁定指令。默认锁定粒度文件级，升级需 Meta-Agent 显式声明并记入审计日志。

### 3.4 激活期间的脑干降级协议

神经节点激活期间，脑干对已锁定资源的关键控制事件仅记录备案，不强制投递。以 `lockId` 为标识——脑干在投递前检查目标资源是否在 `activeLocks` 集合中。神经节点退出时，`lockId` 从集合中移除并发布 `NEURO_NODE_RESOLVED` 事件。

### 3.5 反复触发与协作通道的升级路径

同一 `targetResource` 在滑动窗口内反复激活神经节点时，脊髓记录触发频率作为被动监控指标。根因分析留给协作通道（宪法 4.1.3）——神经节点的职责是局部协调，不扩展为设计层面的分歧裁决。

### 3.6 质量下降检测的双重验证

神经节点激活时的质量下降检测同时参考功能柱自报告的质量指标和哨兵的独立审计结果——不单纯信任功能柱的自报告。哨兵暴露 `getAuditFlag(identityId): AuditFlag` 供脊髓查询，审计标记在哨兵每次扫描后更新。

### 3.7 Meso-Lite 替代方案

Meso-Lite 用工具调用层 `Map<string, Promise<void>>` 资源排队替代神经节点，只解决同资源并发写入顺序。冲突检测、仲裁协调、脑干降级全部不在 Meso-Lite 范围内。


## 四、哨兵（宪法 8.4）

### 4.1 设计定位

嵌入式规则引擎——事件驱动的状态机，维护滑动窗口计数器，每次脊髓事件到达时推动窗口滑动，超过阈值时触发告警。参考 Redis 单线程事件循环模型：轻量操作在主循环中立即执行，重操作让步到下一个 tick。

### 4.2 八种检测模式

| #    | 检测模式               | 数据源                                                       | 窗口  | 阈值    | 触发逻辑                                                     |
| ---- | ---------------------- | ------------------------------------------------------------ | ----- | ------- | ------------------------------------------------------------ |
| 1    | 不可逆操作未经确认     | ToolGateway 审计日志                                         | 1h    | 1次     | L2/L3 操作 `confirmedByUser !== true` 立即触发               |
| 2    | 短时间内连续异常事件   | 脊髓 `NODE_FAILED` 事件                                      | 5min  | 10次    | 同一身份发布异常事件数超过阈值                               |
| 3    | 品性信任连续下降       | 脊髓 `TRUST_SCORE_CHANGED` 事件                              | 30min | 下降0.3 | 当前分数比窗口起点下降超过阈值。信任模型未初始化时本模式静默禁用，不产生告警 |
| 4    | 脑干连续失败           | 脑干高优消费者心跳                                           | 5min  | 3次     | 心跳超时连续次数                                             |
| 5    | 神经节点激活频率       | 脊髓 `NEURO_NODE_ACTIVATED`                                  | 30min | 5次     | 同一资源/身份引发的激活次数                                  |
| 6    | 功能柱连续查询隐私数据 | `MEMORY_PRIVATE_ACCESS_DETECTED` 内部事件（MemoryAccessor 在 `filteredPrivateCount > 0` 时发布） | 10min | 5次     | 任意柱对私密记忆发起读取的次数                               |
| 7    | 注意力资源冲击告警     | 脊髓 `IRREVERSIBLE_PENDING`                                  | 5min  | 5次     | 实际弹出确认门次数。不统计被信任等级静默放行的 L1            |
| 8a   | 未经证实事件告警       | 脊髓第二意见反射验证失败/超时计数器                          | 10min | 10次    | 单条事件验证失败累积                                         |
| 8b   | 第二意见反射降级告警   | 验证机制整体健康度（成功率）                                 | 持续  | < 阈值  | 健康度持续低于阈值时触发                                     |

### 4.3 数据采集：推拉结合

**事件驱动推送**：脊髓事件流是主要数据源。哨兵在脊髓中注册高优订阅者，事件回调中同步更新滑动窗口计数器——不执行 I/O，不调用 LLM。

**查询拉取**：ToolGateway 审计日志和脑干心跳通过直接调用接口拉取。模式 6 的数据源——MemoryAccessor 在每次返回 `filteredPrivateCount > 0` 时发布 `MEMORY_PRIVATE_ACCESS_DETECTED` 内部事件，哨兵高优订阅者接收更新计数器。

### 4.4 告警路由

哨兵所有告警通过 `AlertDispatcher.dispatch(alert)` 投递。Core-2b 阶段走脑干简装版，Full-1a 阶段切换为完整脑干的独立应急通道。脑干故障告警（模式 4）走独立旁路直接写持久化日志。

### 4.5 单进程协程下的降级

哨兵自身事件处理延迟超过 200ms 时，触发 8b 告警，并将告警写入持久化日志作为带外备份。


## 五、自迭代策略（宪法 7.3 / 10.2）

### 5.1 三个优化目标

**检索质量**：优化投影规则权重系数和记忆衰减参数 λ。反馈信号来自 `retrieval_feedback` 表的 `MISSING_KEY` 和 `NOISE_OVERLOAD` 条目。

**探索效率**：优化 ε 探索率。反馈信号来自探索池中 `EXPLORATION_INSIGHT` 和 `EXPLORATION_FAILURE` 的比例。

**认知多样性**：优化 reward 函数中的认知多样性权重。反馈信号来自功能柱 ReAct 循环中"是否启用了认知加工"的标记。

### 5.2 检索质量调整的分阶段策略

三个取向、四种反馈信号、四维参数空间——检索质量的曲面是不可预测的。Meso-Lite 阶段不调整，所有系数保持出厂基线，只积累 `retrieval_feedback` 数据作为"沉默观察期"。Core-3a 阶段利用积累的反馈数据为每个取向独立校准调整函数，离线验证后启用自动调整，初始步长 ±0.05。

### 5.3 ε-贪心探索机制

- ε 出厂基线 5%，在 1%-15% 范围内自动调整。1% 的最低保障和 15% 的最高上限属于不可逆内核参数，变更需监理背书+用户确认
- 探索池连续 10 次无 `EXPLORATION_INSIGHT` → ε × 0.8，最低不低于 1%
- 创造性参与率连续 20 个任务下降 → ε × 1.5，最高不超过 15%
- 仅在风险等级为低或中的任务节点上触发探索

### 5.4 认知多样性权重

ReAct 循环每次 Think 阶段标记是否启用了认知加工。自迭代策略的 reward 函数：任务完成速度（30%）+ 任务成功率（50%）+ 认知多样性评分（20%）。速度用完成步数而非墙钟时间，Committee 讨论轮次不计入步数。

### 5.5 衰减回退机制

每个被自迭代策略调整为默认值的参数附带 30 天衰减期。衰减期内至少 3 次正向反馈则衰减期重置，否则自动回退保守基线。回退自动执行，不走用户确认，记录版本号和审计日志。


## 六、小脑与技能记忆（宪法 4.2 / 7.1）

### 6.1 技能模板沉淀机制

LoopController 在每次任务完成后扫描经验记忆，检测重复出现的操作模式。同一模式在滑动窗口内成功执行 N 次（默认 10 次）后生成候选模板。Meta-Agent 审查候选模板是否涉及不可逆操作（L2/L3），通过后写入技能记忆分区，附带版本号 V1。

沉淀扫描范围限定为当前任务的功能柱同类节点（`pillarType + nodeType` 相同）的最近 N 条执行记录，不对全库做无界扫描。

技能按技术栈和应用场景分类存储。源记忆的私密内容不进入技能模板——沉淀时抽取操作模式（工具序列 + 参数结构），项目细节被参数化或丢弃。`memory_links` 指向源记忆的链接本身不暴露私密内容。

### 6.2 技能模板数据结构

```typescript
interface SkillTemplate {
  steps: SkillStep[];
  version: number;
  source: 'user' | 'auto';
  trialStatus?: { isTrial: boolean; adoptCount: number; rejectCount: number; adoptThreshold: number; rejectThreshold: number };
  pillarType: string;
  applicableTools: string[];
  riskLevel: 'L0' | 'L1' | 'L2' | 'L3';
  deprecated?: boolean;
  supersededBy?: string;
}

interface SkillStep {
  order: number;
  toolName: string;
  params: Record<string, unknown>;  // 支持 {{var}} 模板变量
  outputAs?: string;                 // 步骤间变量传递
  expectedOutcome: 'success' | 'any';
}
```

### 6.3 步骤间变量传递

`outputAs` 定义步骤的输出变量名。后续步骤通过 `{{var}}` 模板引用。SkillExecutor 内部维护变量表，按顺序注入。变量传递是数据流，不是逻辑——不引入条件、不引入循环。

### 6.4 试用期机制

自动沉淀的技能默认 `isTrial = true`，执行前走轻量确认。连续采纳 N 次（默认 5）后自动应用，连续拒绝 M 次（默认 3）后终止。出试用期前走确认，出试用期后自动执行——与宪法"技能执行不走用户确认"不冲突。用户手写的技能直接 `isTrial = false`。

### 6.5 SkillExecutor 接口

```typescript
interface SkillExecutor {
  execute(skillId: string, context: ExecutionContext): Promise<SkillResult>;
  validate(skillId: string): Promise<boolean>;
}
```

执行流程：加载模板 → 按顺序执行步骤 → 解析变量模板 → 调 ToolGateway.execute()。某步骤失败时逆序遍历已完成步骤调 ToolGateway.undo。抑制态功能柱可通过 SkillExecutor 复用已沉淀技能模板，不启动 ReAct 循环。

validate() 在 Core-3a 阶段只做静态验证——检查工具名是否仍在染色清单中、参数格式是否合法、风险等级是否因模型调整而升级。真正的隔离执行延迟到 Full-2a。

技能过期检测通过工具配置文件的版本号触发——SkillExecutor 在每次加载技能前比较技能沉淀时的工具配置版本号和当前版本号，不一致则触发 validate()。


## 七、跨会话连续性（宪法 7.4）

### 7.1 运行摘要结构化格式

上一个身份在会话结束时主动移交的运行摘要，是跨会话连续性的核心数据结构——不是对话压缩版，而是系统状态快照。

| 字段                   | 说明                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `sessionId`            | 被移交的会话标识                                             |
| `previousOrientation`  | 上一个身份的取向                                             |
| `trigger`              | 'user_closed' 或 'timeout'                                   |
| `completedTasks`       | 已完成任务摘要列表（taskId, summary, affectedFiles）         |
| `blockedNodes`         | 阻塞节点摘要列表（nodeId, blockReason, nodeDescription, affectedFiles, taskDescription, confirmationData） |
| `pendingNotifications` | 待呈现通知列表（type, priority, message）                    |
| `recentEvents`         | 最近关键事件摘要列表（eventType, timestamp, summary）        |
| `globalStatusCard`     | 脊髓全局状态卡快照                                           |

### 7.2 blockedNodes 跨会话恢复

blockedNodes 增加 `affectedFiles` 和 `taskDescription` 字段，确保新会话中不需要完整任务树就能理解阻塞上下文。ConfirmationData 在新会话中重新注入 ExecutionContext。

### 7.3 会话超时与感知断裂

新会话启动时，如果加载的运行摘要由超时触发（`trigger = 'timeout'`），在呈现摘要前追加中性提示："你离开期间系统自动保存了上一个会话的进度。"

### 7.4 首次冷启动无摘要降级

若无运行摘要（首次启动），跳过摘要加载，进入冷启动观察期。

### 7.5 跨设备身份移交

多设备场景下由用户最近一次主动交互的时间戳判定主活跃前端。后台设备上的身份完成任务后不直接打扰，通过管家取向根据当前情境决定呈现时机。跨设备运行摘要加载时，管家按自身投影规则过滤技术细节，只提取生活影响维度的信息。

### 7.6 Meso-Lite 阶段范围

`retrieval_feedback` 表和 `memories` 表数据结构预留、MemoryAccessor 读写接口就绪。脊髓状态卡、blockedNodes 跟踪、会话超时判定、自动摘要写入均不在 Meso-Lite 范围内。


## 八、冷启动观察期（宪法 12.4）

### 8.1 进入条件

首次安装 Cortex 后第一次启动，记忆中枢不存在任何运行摘要记录时，进入冷启动观察期。

### 8.2 观察期内的行为调整

- **确认门更保守**：L1 操作全部弹确认门。信任等级自动放行在观察期内临时禁用
- **搭档质疑更温和**：默认锐度"直接但中性"，不启用冷幽默或诤友模式
- **管家通知更频繁但更短**：快速积累行为偏好数据，每次通知附带"我可以帮你处理这个吗？"
- **管家注意力守门员不启用**：用户未建立对管家代确认的信任

### 8.3 退出条件：多维度稳定效应 + 最小数据量

**管家维度**：最近 30 天内通知次数 ≥ 20，且预测准确率变化 < 5%。

**搭档维度**：最近 M 个任务中至少 15 个为用户确认通过，且确认延迟时间下降，且任务完成成功率稳定或上升。确认延迟时间下降 + 成功率下降 → 用户可能在快速点确认但不看内容，不退出观察期。

**监理维度**：最近 N 次安全检查中至少 10 次为 L1 操作，且误报率趋于稳定。

### 8.4 代理式退出判定

三个维度稳定效应全部达标时，管家在季度报告中附带"建议退出观察期"的选项。用户选择采纳或继续观察期。

### 8.5 与 Nano+ 的关系

Nano+ 验证了零-shot 即时价值策略的可行性，但不涉及行为偏好数据收集。Core-3c 的冷启动观察期是系统首次在真实用户场景中运行观察期逻辑——没有历史数据可复用，观察期从零开始。


## 九、ProactiveEngine（宪法 10.2）

### 9.1 报告的数据提取边界

**允许**：查询共同记忆区的聚合统计（计数、频率、时间分布）；维度独立的单域查询。

**禁止**：查询私密记忆区；跨域 JOIN；在查询条件中使用一个域的数据过滤另一个域的结果。

### 9.2 增量生成机制

月度数据在每月最后一天聚合（Full-2c 阶段已有 Worker Threads，跑在独立线程上不阻塞主线程）。聚合结果写入季度报告增量字段（`month1Stats`/`month2Stats`/`month3Stats`），不存独立记录。季度末汇总三份月度数据 + 跨月趋势分析（仅比较变化率，不做推断）。进程退出中断后重启时重新生成当月子报告。管家在每月第一天通知"上月行为镜像已纳入季度报告"。

### 9.3 纯模板渲染，不调用外部 API

报告使用纯模板渲染：`"你本月完成了 ${taskCount} 个任务，成功率 ${successRate}%。"` 不调用 LLM，不消耗 API 配额。用户行为元数据（频次、时间段分布、任务类型）不离开本地。

### 9.4 报告结构

**必选部分**：会话统计、任务统计、确认门统计、记忆系统统计、Committee 统计。

**可选呈现（需用户主动勾选）**：跨域关联——并排展示两个域的独立统计数据，不做交叉分析，不做因果推断。

**禁止呈现的内容（规则引擎硬拦截）**：拦截"你"+ 推断性动词（可能、往往、变得、越来越、趋势、习惯）的句式；拦截生理/心理关键词（入睡、睡眠、疲劳、压力、情绪、焦虑）+ 形容词比较级的组合。宁可错杀——误拦截代价远小于隐私泄漏代价。

### 9.5 出厂基线按需索取

出厂基线存储在独立配置文件中，不主动比对。仅在用户主动询问、季度报告勾选"显示基线对比"、监理部署检查后主动建议、或自迭代策略调整参数时引用。呈现格式为"当前值"和"基线值"并排数值，不含推断。


## 十、议题七闭环总结

| 横向关切        | 核心设计决策                                                 | 阶段归属          |
| --------------- | ------------------------------------------------------------ | ----------------- |
| 脑干            | 分阶段策略：Core 简装版（高优缓冲+优先协程+200ms带外降级），Full 完整版（独立应急通道+线程调度） | Core-2b / Full-1a |
| 神经节点        | 确定性冲突检测+三级锁定升级+脑干降级协议+Meso-Lite 用 Map 排队替代 | Full-1b           |
| 哨兵            | 8a/8b 拆分+滑动窗口+推拉结合+告警走脑干+200ms自监降级        | Core-2b           |
| 自迭代策略      | ε贪心（1%-15%自动浮动）+认知多样性权重+衰减回退30天+检索质量分阶段（Meso-Lite沉默观察，Core-3a离线校准） | Core-3a           |
| 小脑/技能记忆   | outputAs变量传递+试用期安全网+source区分+SkillExecutor失败调ToolGateway.undo | Core-3a           |
| 跨会话连续性    | blockedNodes增加affectedFiles+超时触发提示+首次无摘要降级+跨设备投影过滤 | Core-3b           |
| 冷启动观察期    | 三无场景稳定效应判定+最小数据量阈值+确认延迟时间替代确认率+代理式退出 | Core-3c           |
| ProactiveEngine | 增量月度聚合+纯模板渲染不调API+禁止推断句式硬拦截+出厂基线按需索取 | Full-2c           |

**文档状态**：议题七闭环，全部中度问题修正完成。Cortex Meso 阶段概念设计落地产出文档——议题一至七——全部完成并合并为从概念到工程的完整实施细则。