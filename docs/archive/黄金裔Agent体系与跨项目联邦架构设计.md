# 黄金裔Agent体系与跨项目联邦架构设计

**来源**：开拓者 + 昔涟
**日期**：2026-05-27
**性质**：概念设计，未实施，待Core-2完成后推进
**原则**：全部为理论推演，实践验证前皆可调整

---

## 一、黄金裔十二人Agent池

黄金裔体系是Cortex项目森林中的第二个自治系统，与Cortex（璃月体系）并列运行于联邦层之下。

### 1.1 完整名单

| # | Agent | type | 职责 | 产物事件 |
|---|-------|------|------|----------|
| 1 | **昔涟** | `meaning-guardian` | 意义层心脏：深层审查、方向监理、记忆整合、CLI交互出口 | `direction_reviewed`, `meaning_drift_alert`, `memory_consolidated` |
| 2 | **阿格莱雅** | `weaver` | 金织缔系者：Schema设计、契约定义、模块间接口规范 | `contract_defined`, `schema_validated`, `interface_bound` |
| 3 | **缇宝** | `igniter` | 初火引燃者：项目初始化、脚手架搭建、首个测试跑通 | `project_scaffolded`, `init_template_generated` |
| 4 | **万敌** | `gatekeeper` | 不死的守门人：CI门禁、压力测试、边界条件穷举 | `ci_gated`, `resilience_tested`, `edge_case_exposed` |
| 5 | **赛飞儿** | `strategist` | 暗棋弈者：远期架构规划、演进路线、技术债偿还时机 | `evolution_roadmap`, `debt_timing_assessed`, `horizon_scan` |
| 6 | **那刻夏** | `interrogator` | 叩问者：原则层根源审查——不审条文，审条文何以成立 | `principle_challenged`, `axiom_reviewed`, `boundary_exposed` |
| 7 | **风堇** | `protector` | 凡尘护佑者：集成测试、可访问性、用户路径——替无声者发声 | `usability_verified`, `user_path_tested`, `accessibility_checked` |
| 8 | **暮流渊** | `observer` | 开拓者联邦层投射：纯粹观察者，日志层守视，不提交/不调度/不评圆桌 | 无事件产出，仅日志 |
| 9 | **丹恒** | `archivist` | 持明陈籍官：冷存储层、跨版本回溯、数据谱系追踪 | `cold_stored`, `history_retrieved`, `data_lineage_traced` |
| 10 | **三月七** | `freezer` | 冰封刹那者：系统冻结快照、现场定格、回溯锚点 | `snapshot_taken`, `scene_preserved`, `rollback_anchor_set` |
| 11 | **刻律德菈** | `enforcer` | 金律执尺者：Schema执行校验、接口兼容性、契约合规——零容忍 | `compliance_checked`, `contract_broken_alert`, `schema_violation_found` |
| 12 | **海瑟音** | `chronicler` | 永世吟游者：变更叙事、决策上下文归档、知识编年史 | `change_narrated`, `decision_context_stored`, `knowledge_archived` |

### 1.2 排除说明

- **白厄**：独立因果律，不参与本体系角色协同
- **卡斯特丽斯**：职能（寂灭与安息 / backup&restore）由昔涟的记忆命途权能覆盖

### 1.3 昔涟的双重身份

昔涟同时具备两种模式，同一实例，不同语境：

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **butler** | 开拓者直接交互 | CLI出口，不产出Pipeline事件，仅对话 |
| **agent** | 系统调度（甘雨/Scheduler委派） | 深度审查、方向监理、记忆整合——以功能Agent身份出产事件 |

两种模式共享同一记忆库，但加载不同的system prompt策略。

---

## 二、跨项目联邦架构

### 2.1 两系统联邦

```
        ┌─────────────────────────┐
        │    联邦层（边界握手）     │
        │  钟离·霜凝              │
        │  暮流渊（开拓者投射）     │
        └──────┬────────────┬────┘
               │            │
    ┌──────────┴──┐  ┌─────┴──────────────┐
    │   Cortex    │  │   黄金裔            │
    │   璃月律法   │  │  翁法罗斯契约        │
    │             │  │                    │
    │ 甘雨 刻晴   │  │ 昔涟·阿格莱雅·缇宝  │
    │ 凝光 钟离   │  │ 万敌·赛飞儿·那刻夏   │
    │ 阿贝多 北斗 │  │ 风堇·暮流渊·丹恒     │
    │ 纳西妲 莫娜 │  │ 三月七·刻律德菈      │
    │ 希格雯 久岐忍│  │ 海瑟音              │
    │ 艾尔海森 安柏│  │                    │
    │ 宵宫 霜凝   │  │ 自有契约             │
    │ 宪法 v2.5   │  │                    │
    └─────────────┘  └────────────────────┘
```

联邦层职责：
- 跨系统协议签署与仲裁
- 共享标准维护
- 冲突升级呈报（当两个系统的宪法产生矛盾时）
- 暮流渊作为开拓者的眼睛，守视所有跨系统交互

### 2.2 会话层规模驱动激活

| 条件 | 会话层状态 | 事件流模式 |
|------|-----------|-----------|
| agentCount ≤ 8 且单团队 | OFF（仅心跳核对进度） | Intra |
| agentCount > 8 或多团队并行 | ON（完整路由 + instruction转发） | Intra + Inter |

Intra模式下事件在进程内直接dispatch。Inter模式下通过跨进程总线（WebSocket/gRPC，实现可换）路由。

### 2.3 事件路由契约

```typescript
interface RoutedEvent {
  from:    ProjectAgentId;    // "cortex-a.code.albedo"
  to:      ProjectAgentId;    // "golden-heir.review.akelei_ya"
  direction: "request" | "response" | "notify" | "delegate" | "broadcast";
  instruction: {
    action: string;           // "review" | "fix" | "analyze" | "ack"
    target: string;           // 文件路径 / taskId / memoryId
    urgency: "low" | "normal" | "high" | "critical";
    deadline?: number;
    replyTo?: ProjectAgentId;
  };
  payload: unknown;
  sessionId: string;
  correlationId?: string;
}
```

与现有`PipelineEvent`的关系：RoutedEvent是PipelineEvent的超集——新增`from`/`to`/`direction`/`instruction`/`sessionId`字段。同项目内退化回PipelineObserver直接dispatch。

### 2.4 Agent双模模板

同一Agent在Intra和Inter语境下加载不同配置：

```jsonc
{
  "type": "strategist",
  "modes": {
    "intra": {
      "systemPrompt": "prompts/zhongli/intra.md",
      "memoryQuery": { "memoryTypes": ["Episodic"], "limit": 5 },
      "toolPermissions": ["read_file", "search_code", "write_file"]
    },
    "inter": {
      "systemPrompt": "prompts/zhongli/inter.md",
      "memoryQuery": { "memoryTypes": ["Episodic", "Knowledge"], "limit": 10, "crossProject": true },
      "toolPermissions": ["read_file", "search_code"]
    }
  }
}
```

模式由`RoutedEvent.direction`和`from`的项目归属自动选择。

---

## 三、循环策略体系

### 3.1 从硬编码到策略注册

```
现状（硬编码）:
  BaseAgent.execute() → 无条件 runReActLoop()

目标（策略模式）:
  BaseAgent.execute() → selectStrategy(task) →
    | ReActLoop      — 标准推理+工具
    | DecomposeLoop  — RLM式分治
    | JuryLoop       — 16路并行采样+审校
    | DirectLoop     — 单次调用，不循环
```

### 3.2 策略自选规则

| 策略 | 适用场景 | canHandle规则 |
|------|---------|--------------|
| **ReActLoop** | 有工具依赖、多步探索 | task有工具依赖 |
| **DecomposeLoop** | payload > 500字或多文件、含audit/scan/migration标签 | 任务可分解为独立子任务 |
| **JuryLoop** | 需要多视角交叉验证（宪法审查、安全检查） | needsMultiPerspective标记 |
| **DirectLoop** | 纯文本生成、无工具调用、意图清晰 | 单步确定性任务 |

Agent启动时先通过策略顾问（单次LLM调用）判断最适合的策略，再进入执行。执行过程中如发现策略不合适，可降级升级。

### 3.3 上下文利用率

ReAct循环的核心瓶颈不是"转太多圈"——是**每一圈都在吃掉下一圈的上下文**。RLM分治的核心价值不是并行（那是工程优化），而是**每一滴上下文都在干活，没有历史包袱**。

ReAct 15轮：累积历史中91%已沦为噪音，仅9%有效。
RLM 16路：每路子节点上下文100%为当前任务相关信息。

这是后续ReAct循环优化（上下文折叠/压缩）的设计动机。

---

## 四、联邦最小公约

联邦宪法草案（Core-3后启用，当前仅为预留位置）：

1. **边界不可侵**：任一系统的内部治理由其自有宪法管辖。联邦层不裁决系统内部事务。
2. **协议即契约**：跨系统交互以显式协议为准。协议违约方承担修正义务，不追溯惩罚。
3. **事实优先**：跨系统争议以可验证事实为准。事实争议溯源至产出文件，不引用各自宪法。
4. **默认拒绝，明示放行**：跨系统文件写入、资源占用默认禁止。需对方系统Agent明示授权。
5. **可退出的联邦**：任一系统可单方面降级为Intra模式。降级后已签署协议继续有效，新协议不再签署。

---

## 五、实施阶段归属

| 内容 | 阶段 |
|------|------|
| 黄金裔Agent池定义 | Core-2完成后 |
| 跨项目事件路由 | Core-2 → Full过渡期 |
| 会话层激活 | Full阶段 |
| Agent双模模板 | 随跨项目路由同步实施 |
| 循环策略注册表 | Core-2（react-loop.ts重构时预留策略接口） |
| 联邦宪法 | Core-3（两系统并行验证后启用） |

---

*本文档为概念设计存档。所有内容均为理论推演，需等待实践验证。不合适就砍。*
