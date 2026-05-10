# 🌿 纳西妲架构全景分析报告 v2

## 一、包间依赖图（验证篇）

```
shared(零依赖) ← engine(prod) + testing(prod)
engine → testing 仅 devDependency，无 runtime 引用
```

**证据：** `from "@cortex/shared"` 22 处引用；`from "@cortex/testing"` 0 处引用；`from "../"` 0 处。**严格单向，无循环。**

## 二、shared/ 模块语义审视

### 2.1 infra.ts — 9 领域 27 类型的"杂物间"

| 关注点 | 类型数 |
|--------|--------|
| 工具定义/可逆性/确认门/信任模型/管道事件/文件锁/平台抽象/LLM 协议/Agent接口 | 27 |

**前次结论继承：** infra.ts 承载过多无关领域。建议 Core-2 前拆分为 tool.ts / llm.ts / gate.ts / observable.ts。

### 2.2 Agent 接口命名漂移

Agent 接口在 infra.ts 而非 agent.ts — 为打破 agent↔task 循环依赖的手术疤痕。**根本解耦方案**应是让 Agent 接口不直接依赖 TaskNode（通过泛型或中间接口）。

## 三、engine 内部依赖图（5 层严格单向）

```
L0: 7 个独立模块 (llm-adapter, confirm-gate, pipeline-observer, file-lock-manager, agent-pool, task-board, cli-adapter)
L1: toolkit → confirm-gate, file-lock-manager
    memory-store → pipeline-observer
L2: react-helper → llm-adapter, toolkit
    meta-agent, butler-agent (独立，不继承 BaseAgent)
L3: base-agent (模板方法基类)
L4: 8 Agent 实现 (全部继承 BaseAgent)
L5: scheduler + index.ts (编排器)
```

**高扇入：** base-agent.ts(8), llm-adapter.ts(10+), toolkit.ts(10+), memory-store.ts(9)
**高扇出：** scheduler.ts(6), base-agent.ts(5), toolkit.ts(5+)

## 四、架构模式

- **🟢 模板方法** — BaseAgent 封装 ReAct 循环，子类只覆写 type/systemPrompt/钩子
- **🟢 策略/自描述匹配** — Scheduler 通过 AGENT_TAGS 反向匹配 Agent
- **🟢 DIP** — shared 定义接口，engine 提供实现
- **🟡 "领而不执"重规划** — replan 新节点只入板不执行，下轮统一调度

## 五、单点脆弱性

### 🔴 LlmAdapter 无多模型降级
单一 DeepSeek endpoint，无 vendor-agnostic fallback。且超时/重试策略统一，无按 Agent 类型区分。

### 🟠 InspectorAgent 动态 require（3 处）
`const { execSync } = require("node:child_process")` — 唯一 CommonJS 残留。纯 ESM 下爆炸。

### 🟠 BrowserAgent 构造函数副作用
`toolkit.register("browser_do", handler)` 在构造函数中注册 — 两条工具注册路径（内置 vs Agent 自注册），无治理规则。

### 🟡 ButlerAgent/MetaAgent"体外循环"
不继承 BaseAgent。ButlerAgent.execute() 声明 0 参数（标准需 2 参数），但不会被 Scheduler 调用（纯死代码）。

### 🟡 Scheduler↔MetaAgent 紧耦合
MetaAgent 可选，未注入时失败节点静默丢弃，无降级通知。

## 六、扩展成本

| 场景 | 成本 | 说明 |
|------|------|------|
| 新增 Agent | 🟢 极低 | ~25 行（LoopAgent 示例） |
| 新增工具 | 🟢 低 | TOOL_META + _registerBuiltins() |
| 新增 Agent+自定义工具 | 🟡 中 | 无统一注册模式 |
| LLM 供应商切换 | 🟠 中高 | 无 LlmProvider 抽象层 |
| CLI→Electron | 🟢 低 | PlatformBridge 接口预留 |

**最佳扩展点：** PlatformBridge（CLI → Electron）
**最差扩展点：** LlmAdapter（供应商硬耦合）

## 七、跨文件一致性

- AgentType 三表（TAG_VOCABULARY / AGENT_TAGS / AGENT_TOOL_PERMISSIONS）覆盖完整 ✓
- import type 使用规范：无误用 ✓
- maxLoops 覆写：仅 InspectorAgent(24) 覆写默认(48)，合理 ✓

## 八、总体评价

| 维度 | 评分 |
|------|------|
| 依赖方向 | 🟢 A |
| 模块内聚 | 🟡 B+ |
| 接口设计 | 🟢 A |
| 扩展性 | 🟡 B |
| 容错性 | 🟡 B- |
| 一致性 | 🟢 A |

### 三件需要关注的事

1. **🟡 infra.ts 杂物间 + Agent 接口命名漂移** — Core-2 前拆分
2. **🟠 InspectorAgent 的 3 处动态 require** — 唯一 CommonJS 残留，立即修复
3. **🟠 工具注册路径不统一** — 建立"内置 vs Agent专有"的治理准则

**前次分析发现的两项风险（命名漂移 + require 定时炸弹）未被修复。看得见的风险而不处理，比看不见的风险更需要警惕。** 🌿

---

*—— 纳西妲。第二次行走完毕。*
