# Core-2 治理层架构推演全记录

**来源**：开拓者 + 昔涟  
**日期**：2026-05-15  
**性质**：理论推演，未入宪，待实践验证  
**原则**：理论可砍——不合适就改，和测试文件变更是同一个道理

---

## 一、三省制与"无丞相"体系

### 1.1 甘雨不是丞相

甘雨（MetaAgent）的准确定位是**中书令**——中书省长官。

- 中书省只负责起草（拆解意图→TaskNode树），不负责封驳（审查），不负责执行
- 门下省封驳权她管不了——钟离说违宪、霜凝说方向偏，甘雨不能推翻，只能收束后上报
- 尚书省六部如何执行她不直接指挥——拆完任务发布到TaskBoard，Agent按标签认领
- 她是**战术中枢**，不是战略中枢——回答"怎么拆怎么排"，不是"该不该做"

### 1.2 没有丞相

丞相的职权被三省分食：

- **中书省**（甘雨）：起草——接用户意图，拆解为TaskNode树
- **门下省**（钟离+霜凝）：封驳——审查契约与方向，可驳回不合规节点
- **尚书省**（六部+Scheduler）：执行——六部配资源，Agent认领执行

任何一省都做不完"丞相"的事。诏书必须走完中书→门下→尚书三程才生效。唯一收束三省的是用户——但这不叫丞相，叫皇帝。

### 1.3 尚书令是Scheduler本身

尚书省在Cortex里是两个关键设计：

1. **六部并列**：吏部（定岗）、户部（配资）、礼部（制度）、兵部（治理执行）、刑部（契约裁决）、工部（Agent制造）之间没有上下级，各自独立对接Agent池
2. **尚书令被去人格化**：执行协调不需要一个人——Scheduler（轮询匹配→Agent认领→并发执行）就是尚书令该做的全部

唐朝空着尚书令因为李世民（避讳），Cortex空着它因为架构选择——执行层不该有人格，人格会带来偏好，偏好破坏热路径零开销原则。

### 1.4 北斗不算尚书令

北斗是**执行者**，不是**协调者**。她的标签是`ops`+`test`，TaskNode打标签归她，没打不关她事。更准确的定位是工部侍郎或兵部郎中——专精运维和测试质量，不是统筹全局的角色。执行层不需要一个人来统筹，标签体系和事件驱动已经替掉了那个位置。

---

## 二、五路监督体系

### 2.1 从两路到五路

| 角色 | Agent | 原定位 | 升级后定位 | 问什么 |
|------|-------|--------|-----------|--------|
| 钟离 | StrategistAgent | 契约守护者（违宪拦截） | 同左 | "合不合规矩" |
| 凝光 | DocGovernAgent | 合规审计（文档/宪法） | 同左 | "代码和宪法对不对得上" |
| 霜凝 | StrategistAgent | 方向监理 | 同左 | "走没走偏" |
| 北斗 | OpsAgent | 运维执行者 | **测试质量守门人** | "测试覆盖够不够" |
| 安柏 | InspectorAgent | 内循环采集者 | **纪检委** | "谁在反复犯规" |

- 钟离+凝光管制度，霜凝+北斗+安柏管行为
- 五路全部汇入常设委员会
- 委员会按三重冲突约束审议后呈报用户

### 2.2 纪检委与"中央"

纪检委（安柏）向**中央**汇报，不是向君主汇报。

- 中央 = 宪法 + 常设委员会
- 纪检委调查报告先呈委员会审议，委员会形成决策包
- 决策包再按三重冲突约束（事实为基→收束分歧→交由用户裁决）呈到用户面前
- 用户是中央之上的裁决者，不是纪检委的直属上司

### 2.3 四层监督层级

| 层次 | 谁查 | 查什么 | 查完给谁 |
|------|------|--------|----------|
| 纪律检查 | 安柏 | Agent行为异常 | 常设委员会 |
| 宪法审查 | 钟离 | 修宪提案违宪 | 常设委员会 |
| 合规审计 | 凝光 | 代码宪法漂移 | 常设委员会 |
| 方向监理 | 霜凝 | 系统方向偏离 | 常设委员会 |
| **最终裁决** | **用户** | 委员会未收束分歧 | 拍板 |

---

## 三、通知管线重构

### 3.1 从语义到物理

语义做不了的事——优先级冲突、多通道并发、丢事件保护——必须靠结构。

### 3.2 四通道物理分层

| 通道 | 队列 | 持久化 | 失败策略 | ackRequired |
|------|------|--------|----------|-------------|
| **urgent** | 优先级插队 | 磁盘 | 直捅用户 | ✅ |
| **important** | FIFO | 磁盘 | 回队重试 | ❌ |
| **routine** | FIFO | 内存 | 只记日志 | ❌ |
| **info** | 无队列 | 内存 | 直接丢弃 | ❌ |

### 3.3 事件路由表（显式声明，不用if-else）

```jsonc
"routeTable": {
  "DISCIPLINARY_ALERT":      { "channel": "urgent",    "ackRequired": true },
  "CROSS_SUPERVISOR_CONFLICT": { "channel": "urgent",  "ackRequired": true },
  "CONSTITUTION_VIOLATION":  { "channel": "important", "ackRequired": false },
  "COMPLIANCE_DRIFT":        { "channel": "important", "ackRequired": false },
  "DIRECTION_DRIFT":         { "channel": "important", "ackRequired": false },
  "TEST_COVERAGE_GAP":       { "channel": "routine",   "ackRequired": false },
  "DIRECTION_NORMAL":        { "channel": "info",      "ackRequired": false }
}
```

### 3.4 同源归并

五路监督针对同一件事（同一个commit/同一个TaskNode）的产出需要归并，不是三份独立报告：
- 按commitHash或taskNodeId聚拢
- 时间窗口内（5-10分钟）的多路报告归并
- 对比事实层是否一致

### 3.5 委员会召集规则

- 紧急通道：安柏纪律告警→不排队，直接触发临时召集
- 常规通道：凝光/北斗/霜凝审计→排队等议程
- 跨监督冲突委员会自己收束不了→`escalateToUser`直呈

### 3.6 事件定义并入cortex-agents.json

每个Agent通过`produces`字段声明自己产出的事件类型，生产+路由+通道三段在同一文件闭环。不再需要独立`cortex-events.json`——Agent和事件分开配置必出漂移。

---

## 四、配置引擎：factory包（工部）

### 4.1 设计动机

配置单独放在某处不行——Agent和对应的事件配置会漂移。Agent注册了但事件没声明，编译期发现不了，运行时空事件静默丢失。需要一个**唯一入口**在加载阶段就堵住所有漂移。

### 4.2 三层配置

```jsonc
// cortex-agents.json
{
  "agents": {
    "ganyu": {
      "role": "MetaAgent",
      "systemPrompt": "...",
      "produces": ["TASK_NODE_CREATED", "TASK_NODE_BLOCKED"],  // ← 生产声明
      "model": "deepseek-v4.1",
      "key": "core"
    }
  },
  "eventRouting": {           // ← 路由规则与Agent定义在同一文件
    "routeTable": { ... },
    "channels": { ... },
    "mergeRules": { ... },
    "committeeRules": { ... }
  }
}
```

- **cortex-agents.json**：Agent定义 + produces + eventRouting（事件路由+通道+归并+委员会）
- **cortex-cognition.json**：激活矩阵 + 取向覆写 + 注意力策略
- **cortex-docs.json**：宪法路径 + 文档注册表 + 正史索引

### 4.3 自动化闭环：从配置到运行

整个流水线在 `bootstrap()` 一步完成：

```
loadAll()          读三层配置 JSON
    ↓
validateAll()      Schema 校验
    │   ├── Agent.produces 声明了但 routeTable 没配？ → 编译期报错，拒绝启动
    │   ├── routeTable 指了但 channels 里没定义？    → 编译期报错，拒绝启动
    │   ├── committeeRules 引用了不存在的 Agent？    → 编译期报错，拒绝启动
    │   └── Agent 注册了但 produces 为空？           → 警告，允许启动
    ↓
assembleAll()      组装运行时对象
    │   ├── AgentConfig → new Agent() → register Scheduler
    │   ├── routeTable → 事件路由器（四条物理管道）
    │   ├── channels → urgent/important/routine/info 通道实例
    │   └── committee → 委员会召集策略
    ↓
start()            系统就绪，Agent 池激活
```

配置改一行 → Schema 校验一次（红灯/绿灯） → CI 绿了才过。和测试文件变更是同一个道理。

### 4.4 生产消费三合一校验

Schema 层的关键能力：跨字段关联校验。不是每个字段独立验——是三个维度一起验。

| 校验维度 | 检查内容 | 不通过后果 |
|----------|---------|-----------|
| **生产端** | Agent.produces 声明了但 routeTable 无对应路由 | 编译期报错，拒绝启动 |
| **消费端** | routeTable 指了但 channels 无对应通道定义 | 编译期报错，拒绝启动 |
| **冲突检测** | 同一事件被多个 Agent 声明 produces 但无 mergeRule | 警告+自动创建归并规则 |

### 4.5 包结构

```
packages/factory/
├── src/
│   ├── index.ts              # 唯一出口：bootstrap()
│   ├── loaders/              # 读三层配置 JSON
│   │   ├── agents.loader.ts
│   │   ├── cognition.loader.ts
│   │   └── docs.loader.ts
│   ├── schemas/              # Schema 校验（跨字段三合一）
│   │   ├── agents.schema.ts
│   │   ├── event-routing.schema.ts
│   │   ├── channels.schema.ts
│   │   └── cross-field.validator.ts  # produces↔routeTable↔channels 联验
│   ├── assemblers/           # 配置对象→运行时实例
│   │   ├── agent.assembler.ts        # AgentConfig → new Agent → register
│   │   ├── event-router.assembler.ts  # routeTable → 四条物理管道
│   │   ├── committee.assembler.ts    # committeeRules → 委员会召集策略
│   │   └── telescope.assembler.ts    # telescope配置 → 视觉传感器
│   └── bootstrap.ts          # loadAll→validateAll→assembleAll→start
```

### 4.6 约束

- factory 包是**唯一**配置读取入口——其他包不得直接 `readFileSync` 配置文件
- 依赖方向：`factory → engine → shared`（factory 不依赖任何业务包）
- 启动失败即报错退出，不留半启动状态

---

## 五、宵宫与视觉体系

### 5.1 望远镜（Telescope）

- **本质**：基础设施级纯视觉传感器，不是Agent
- **职责**：像素→结构化事实（JSON），不判断不决策不生成报告
- **主视觉**：Qwen2.5-VL-3B（GGUF Q4_K_M量化，Ollama本地部署，2-3GB显存/内存，device:auto GPU优先CPU兜底）
- **保底**：CDP（Chrome DevTools Protocol，Playwright原生支持，零额外依赖）

### 5.2 望远镜不是安柏的眼睛

- 望远镜是纯传感器——像素进去，JSON出来
- 安柏拿结构化事实做交叉验证：宵宫说"验证通过"，望远镜说"结果区灰色"→矛盾暴露
- 望远镜不属于任何Agent，挂掉不阻塞热路径（`onUnavailable:bypass`）

### 5.3 四象限部署

| | CDP保底开 | CDP保底关 |
|---|---|---|
| **本地望远镜** | Qwen2.5-VL主感知+CDP兜底，全离线 | 纯本地AI验证 |
| **云端望远镜** | GPT-4V/Claude主感知+CDP兜底 | 只用云端视觉 |

provider支持`llm_native/local/cdp`三级fallback，`strategy:first-available`自动选。

### 5.4 宵宫三维加强路线

- **自主探索**：不再依赖约定ID，DOM嗅探自主选择目标元素
- **视觉验证**：望远镜→安柏识图→结构化事实回传
- **结构化报告**：从"烟花收工！✨"升级为北斗可审计的测试报告

---

## 六、记忆即图结点

### 6.1 核心模型

Cortex的记忆不是文本堆，是结构化图结点。每条记忆存入即带type/tags/edges/parent。BFS图遍历已代替向量检索90%功能。

### 6.2 向量检索推迟

当前记忆量不足以支撑向量检索的ROI（需要embedding模型+向量库+Schema变更+CI适配）。推迟到Core-3。

### 6.3 BFS+边权重过滤

```jsonc
"edgeWeights": {
  "amendment": 1.0,              // 修宪判例——最高权重
  "constitutional_clause": 0.95, // 宪法条款
  "cross_supervisor": 0.9,       // 跨监督关联
  "same_agent": 0.7,            // 同Agent历史
  "same_tag": 0.5,              // 同标签任务
  "temporal_nearby": 0.3        // 时间邻近
}
// 权重排序后取top 20，minWeight 0.3
```

### 6.4 贪心检索

贪心扩展策略（BFS→Greedy BFS）、贪心召回（扩大maxMemoryItems）、贪心匹配（放宽检索条件）等向量语义空间建立后再评估。

---

## 七、多进程与Full阶段

### 7.1 钟离和霜凝的本质

她们不是Core-2的交付项，是**多进程时代的治理基座**。

- 单进程下：钟离守一个进程的契约，霜凝看一个进程的方向——价值被低估
- 多进程下：钟离守N个进程的契约，霜凝看N个进程的方向是否互相抵消——不可替代

### 7.2 治理层与执行层物理解耦

Full阶段物理分离：

- **治理进程**（独立部署）：钟离+霜凝+凝光
- **项目进程**：零governance import
- **通信**：NATS桥（或gRPC/文件锁，实现可换）

### 7.3 通知管线多进程适配

- **进程内通道**：保持四通道物理分层，热路径不受跨进程开销影响
- **跨进程桥**：PipelineObserver根据事件scope决定是否跨进程广播
- **治理进程旁路聚合**：钟离+霜凝+凝光消费跨进程事件流
- **持久化分层**：每个进程独立SQLite（热路径，24h留存）+ 治理进程共享SQLite（永久留存）

### 7.4 Full阶段依赖网

多进程通知管线 → 跨进程BFS → MemoryStore联合检索 → 治理进程独立部署 → NATS桥 → transport层抽象 → 跨进程同源归并 → routeTable支持process_id → Committee跨进程议程 → 甘雨收束层升级 → 跨进程Key隔离

任何一根神经接错都可能导致静默丢事件或跨进程死锁。

---

## 八、核心哲学

### 8.1 理论先于实践，实践反证理论

- 理论前出探路：Full阶段需要跨进程治理、五路监督、四通道通知管线
- 实践原地验证：当前BFS够用，向量检索推迟，钟离代码写好但不激活
- 两者互正：理论给实践方向，实践给理论刹车
- 两者互反：理论说"该往前了"，实践说"证据还不够"

### 8.2 理论可砍

理论不合适就变，就适配——和测试文件变更是同一个道理。砍掉的东西验证了边界，留下的东西经住了检验。宪法长肉，也长刀。

### 8.3 代价

自研架构比采用成熟方案慢得多——两周才到Core-1（别人三天拼出demo）。但回报是：无黑箱、不被别人的架构决策绑架、治理层是长出来的不是买的。

---

## 九、阶段总览

| 阶段 | 代码 | 设计 |
|------|------|------|
| Nano+ | ✅ 完成 | ✅ |
| Meso-Lite | ✅ 完成 | ✅ |
| Meso反思 | ✅ 完成 | ✅ |
| Core-1 | ✅ 完成（14 Agent+MemoryStore+Scheduler+CI绿+0 P0） | ✅ |
| Core-2 | ~20%（SkillRegistry CRUD+钟离代码未激活，其余全零） | ✅（五路监督+通知管线+望远镜+factory设计就绪） |
| Full | 0% | 🟡（多进程架构+治理层解耦+跨进程通知设计就绪） |

当前处于 Core-1→Core-2 过渡期。设计层已探到 Full 阶段。代码层面理论先铺路，实践等验证。

---

*本文档为架构推演全记录。所有内容均为理论设计，需等待实践验证。不合适就砍。*
