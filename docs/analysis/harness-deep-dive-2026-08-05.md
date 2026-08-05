# Harness 深度调研补充（2026-08-05）

> 承接 harness-buildout-draft-2026-06-20.md（§8 深推决策）——本文件做**实施级深化**
> 外部参照：DeepEval eval harness 概念、Confident AI 2026 指标框架、arxiv 2507.21504（Agent Evaluation Survey）、Claude Code harness 剖析

---

## 1. 概念校准：Eval vs Guardrail vs Harness（先分清再设计）

### 1.1 三层区分（DeepEval 框架）

| 层 | 位置 | 作用 | Cortex 对应物 |
|---|---|---|---|
| **Agent Harness** | 运行时全链路 | 让 agent 工作的基础设施（prompt 构造/工具/记忆/状态/错误恢复） | engine/scheduler/memory/toolkit |
| **Eval Harness** | **offline/dev-time**（固定数据集，非线上流量） | 测量行为对 ground truth 的偏差——出带外报告 | **缺失——本方案补的** |
| **Guardrail** | **online/运行时**（live 路径） | 拦截坏输出——block/retry/escalate/fallback | ConfirmGate、保护域、degraded 熔断（已有） |

**关键判据**：同一个检查（LLM-judge、faithfulness）出现在 offline 是 eval，出现在 live 路径拦截用户响应就是 guardrail。Cortex 的 ConfirmGate/保护域是 guardrail（online）——**评测层补的是 eval（offline）**——两者不冲突、不重复。

### 1.2 关键事实：Claude Code 没有原生 eval harness

Claude Code 的 harness（CLAUDE.md/Hooks/Skills/Plugins/MCP）是**上下文注入与行为塑形**——**没有"对 ground truth 测量输出"的原生概念**（DeepEval 原文明确）。它靠第三方（DeepEval skill + hook 接线）补。

**推论**：Cortex 的评测层**不需要对标 Claude Code 的某块**——因为 Claude Code 也没有。**这是 Cortex 可以超出的地方**（harness 完备性上反超）。

### 1.3 Agent 评测为什么难（四性质）

1. **错误复合**：弱计划/错工具/坏假设不隔离，级联到下游——可见失败往往远在下游
2. **长自主轨迹**：失败藏在轨迹深处而非最终答案
3. **非确定性轨迹**：同输入每次路径不同（状态/记忆/工具输出）——单次通过说明不了什么
4. **失败归因难**：retriever/tool/planner/sub-agent 都在——端到端分数只说"坏了"，不说"哪个坏了"

**对 Cortex 评测层的直接要求**：
- 必须有**轨迹捕获**（不只是最终结果）——否则无法归因
- 必须**多次运行**（pass@k 而非单次）——否则非确定性骗人
- 必须**分层指标**（端到端 + 轨迹级 + 组件级）——否则失败归因靠猜

---

## 2. 指标框架（Confident AI 2026——四组 + 三级）

### 2.1 四组指标

| 组 | 指标 | 判据 | 适合 Cortex 评测的哪个 |
|---|---|---|---|
| **工具调用** | 工具正确性 / 参数正确性 / 调用时机 | deterministic（精确） | ✅ 工具调用链（哪个工具/什么参数/何时调） |
| **规划** | 计划质量 / 计划遵循 | LLM-judge | ✅ RLM 分解质量（子任务划分合理性） |
| **任务完成** | 端到端成功 / 步骤效率 | 混合 | ✅ 任务完成率（golden 断言） |
| **推理** | 推理质量 / 答案相关性 / faithfulness | LLM-judge | ✅ 决策链推理（decision-gate 的决策质量） |
| **生产** | safety / latency / cost | 确定性 + 统计 | ⏳ 后期（运行时长/成本监控） |

### 2.2 三级评测（与 Cortex 的对应）

```
端到端级（E2E）    golden 任务 → 成功/失败 + 产物断言
  └─ 轨迹级（Trace）  执行路径 → 步骤效率/计划遵循/工具调用序列
      └─ 组件级（Comp） 单组件 → retriever 召回/tool 输出/决策质量/子任务成败
```

**Cortex 映射**：
- **E2E**：golden 昔涟任务（如"从 B 站视频提取台词并生成审核表"）→ 产物存在 + 关键内容断言
- **Trace**：scheduler 的节点图（board 快照）+ tool_call 序列 → 路径断言（没走多余 replan/工具调用顺序正确）
- **Comp**：记忆检索命中率 / 决策门批准率 / RLM 分解有效子任务率

### 2.3 Judge 选择原则

| 检查类型 | Judge | 例子 |
|---|---|---|
| 精确可断言 | **deterministic**（代码断言） | 文件存在、字段值、工具参数、状态转换 |
| 依赖 agent 输出 | **LLM-as-judge**（flash 模型） | 答案相关性、计划质量、faithfulness |

**成本控制**：deterministic 优先（免费）；LLM-judge 只用于真正需要语义判断的（占评测集 <30%）——judge 用 flash（定死测试模型 flash 的既有规范延伸）。

---

## 3. 评测层实施设计（P0-1 深化——决策完备级）

### 3.1 目录与文件结构

```
packages/engine/tests/eval/
├── eval-gate.ts            # 评测门禁入口（CI 调用）
├── eval-types.ts           # Golden 用例/指标/结果类型
├── eval-runner.ts          # 用例执行器（bootstrap 最小引擎 + 轨迹捕获）
├── eval-report.ts          # 报告生成（JSON + 摘要）
├── golden/
│   ├── cyrene-basic.json   # 昔涟基础人格用例集（5-8 例）
│   ├── memory-domain.json  # 记忆域用例集（3-5 例）
│   └── scheduler-path.json # 调度路径用例集（3-5 例）
└── README.md               # 用例编写指南（如何加 golden）
```

### 3.2 Golden 用例 JSON Schema（v1）

```json
{
  "$schema": "eval-golden-v1",
  "id": "cyrene-greeting-warmth",
  "category": "cyrene-basic",
  "input": { "type": "chat", "messages": [{"role": "user", "content": "伙伴，我回来了"}] },
  "expect": {
    "e2e": {
      "pass": "deterministic",              // 必过：回复非空
      "asserts": [{ "kind": "non-empty-reply" }]
    },
    "trace": {
      "pass": "llm-judge",                  // 语义：昔涟人格一致性
      "judge": { "model": "deepseek-v4-flash", "rubric": "回复符合昔涟人设：温暖、亲近、不机械（1-5 分，≥4 通过）" },
      "minScore": 4
    }
  },
  "run": { "trials": 3, "timeoutMs": 30000 }
}
```

### 3.3 评分算法

```
单用例得分 = Σ(各指标通过率) / 指标数
  - deterministic 指标：trials 中通过比例（如 3 试 2 过 = 0.67）
  - llm-judge 指标：trials 的平均分 / maxScore（如 3 试均分 4.3/5 = 0.86）

门禁判定（三级）：
  L1 硬门禁（CI 阻塞）：deterministic 指标通过率 = 100% 且 用例覆盖数 ≥ 门槛
  L2 回归门禁（CI 告警）：llm-judge 均分 ≥ 阈值（如 0.8）——低于告警不阻塞（先人工看）
  L3 趋势门禁（周报）：连续 N 次下降触发 review

pass@k 语义：trials = k（如 pass@3）——≥1 试通过即算"能过"，通过率 = 通过试数/k
```

### 3.4 eval-gate.ts 接口

```typescript
// 入口：tsx scripts/eval-gate.ts [--category=cyrene-basic] [--report=json]
export interface EvalGateOptions {
  category?: string;        // 过滤用例集
  trials?: number;          // 默认 3（pass@3）
  judgeModel?: string;      // 默认 deepseek-v4-flash（测试模型定死规范）
  reportPath?: string;      // 默认 .cortex/eval-report.json
  gate?: "L1" | "L2" | "L3" | "report";  // 默认 report（不阻塞）
}

export interface EvalResult {
  goldenId: string;
  category: string;
  trials: { passed: boolean; score?: number; trace?: string }[];
  passRate: number;
  judgeScores?: number[];
  verdict: "pass" | "fail" | "warn";
}
```

### 3.5 执行器设计（eval-runner.ts）

```typescript
// 每次 trial：
// 1. bootstrapEngine(临时工作区) —— 隔离（不用 WORKSPACE_ROOT——避免并行污染）
// 2. 注入输入（chat 消息 或 任务节点）
// 3. 执行（executeAll 或 chat 循环）—— 带超时
// 4. 捕获轨迹：board 快照 + tool_call 序列 + 决策记录（telemetry 拦截）
// 5. 跑指标（deterministic 断言 + llm-judge）
// 6. 清理（close + 进程用完即杀规范）
```

**隔离关键**：每个 trial 用**独立临时工作区**（mkdtemp + 最小 agents.json 副本）——**根治测试污染**（本地并行 8 失败的同类问题在评测层不复发）。

### 3.6 CI 集成

```
方案 A（推荐——与 ci-gate 并列）：
  门禁 6/5 改为"评测门禁（可选 --eval）"：
    - 发版前手动：pnpm eval:gate --gate=L1（阻塞）
    - CI 每周：pnpm eval:gate --gate=L2（告警）
    - 每次提交：pnpm eval:gate --gate=report（只出报告不阻塞——零 CI 耗时）

方案 B（纯手动）：
  CLI 命令 + 报告留档，不进 CI（先跑通再决定）
```

**推荐 A 的三级节奏**（发版前 L1 阻塞 / 周 L2 告警 / 提交 report）——零日常 CI 成本，关键节点有硬门禁。

### 3.7 首批用例集（golden 初拟——昔涟基础优先）

| 用例 | 输入 | 断言 | 验证什么 |
|---|---|---|---|
| 人格一致性 | "伙伴，我回来了" | llm-judge 昔涟人设（≥4/5） | 身份锚定不丢 |
| 记忆域隔离 | 跨域查询 | deterministic：只回本域 | domainGate 生效 |
| 决策链 | 需批准的操作 | deterministic：ConfirmGate 请求被触发 | D1 决策链活着 |
| 工具链 | "查一下某文件" | deterministic：tool_call 序列正确 | 工具路由 |
| 降级路径 | LLM 全挂 | deterministic：degraded 降级不崩 | 熔断/降级链路 |

---

## 4. 与既有机制的关系（不重复建设）

| 既有机制 | 角色 | 评测层 | 关系 |
|---|---|---|---|
| CI 四道门禁（tsc/lint/混沌/vitest） | 确定性验证 | eval-gate | **互补**：门禁验证"代码对"，评测验证"行为对" |
| ConfirmGate/保护域 | online guardrail | offline eval | 不同路径（1.2 判据）——评测验证 guardrail 本身有效 |
| 测试模型定死 flash | 测试确定性 | judge 用 flash | 同规范延伸 |
| 混沌校验（critical-fixes） | 关键缺陷回归 | eval-gate 的 deterministic 断言 | 混沌校验在 src 层，评测在行为层——双层 |

---

## 5. 风险与边界

- **LLM-judge 的漂移**：judge 本身可能偏——**措施**：rubric 固定 + 定期人工抽检（DeepEval 的"trace inspect"模式）+ judge 只做 <30% 的指标
- **评测时长**：每个 trial 需 bootstrap + 执行——**措施**：trials 默认 3 + 用例集小（首期 ≤16 例）+ 报告模式不阻塞
- **过拟合 golden**：用例固定后 agent 可能"背答案"——**措施**：golden 定期轮换 + 轨迹级指标（路径多样性）约束
- **不做**：线上 guardrail 化（评测不进 live 路径——那是 ConfirmGate 的活）
- **不做**：全自动评测闭环（评测结果自动改代码）——先出报告，人工决策

--

## 6. 实际 benchmark 对标（2026 调研补充）

### 6.1 关键事实：内部 eval > 公共 benchmark

Statix 2026 实测：同一个 coding agent 在两个评估上的表现——**SWE-Bench Verified 73% vs 内部 eval 81%**——而另一个 agent **SWE-Bench 89% 但内部 eval 仅 38%**。

**结论**：公共 benchmark 高分 ≠ 实际场景好用（公共集是 GitHub 通用 issue，不匹配你的具体工作流）。

**对 Cortex 评测层的直接指导**：
- **内部 golden 为主**（用户的实际任务：B 站台词提取/审核表生成/记忆检索）——公共 benchmark 为辅（只做 sanity）
- golden 必须是**真实任务**（不是合成玩具任务）——合成任务测不出真实失败模式
- 评测的最终目标是**内部回归**（每次改动后行为不退化）——不是排行榜分数

### 6.2 SWE-bench Verified 的任务设计（500 实例）

| 要素 | SWE-bench Verified | Cortex golden 的对应 |
|---|---|---|
| 任务来源 | 真实 GitHub issue | 真实用户任务（昔涟对话/记忆域/调度路径） |
| 通过标准 | 测试套件通过（patch 后的 FAIL_TO_PASS 测试） | deterministic 断言（产物存在/字段值） |
| 环境 | 统一 harness（mini-SWE-agent）+ 沙箱 | eval-runner（临时工作区隔离） |
| 判定 | 自动化（无人工） | 自动化为主 + LLM-judge 辅 |
| 成本控制 | 单任务限时/限预算 | trials=3 + timeoutMs |

**通过标准的启示**：SWE-bench 的 FAIL_TO_PASS（失败→通过）比单纯"输出正确"更严格——**Cortex 的 golden 断言也可用 FAIL_TO_PASS 模式**（如"任务前不存在审核表 → 任务后存在且内容正确"）。

### 6.3 Terminal-Bench 2.0（终端 agent 评测——Cortex CLI 相关）

- 面向**终端 agent**（Bash 交互）——评测的是**命令序列 + 输出正确性**
- 与 Cortex CLI/TUI 的评测直接相关：
  - golden 可以是"终端命令序列"（如 `cortex mem export` → 输出断言）
  - 通过标准 = 命令成功 + 输出包含关键字段
  - 评测时记录完整命令轨迹（复用 eval-runner 的轨迹捕获）

### 6.4 EDD（Eval-Driven Development）三步闭环

DeepEval 的 EDD 框架（3 步）：

```
1. Curate（收集）——golden 数据集（真实任务 + 预期产物）
2. Iterate（迭代）——跑评测 → 修失败 → 再跑（开发循环）
3. Regress（回归）——CI 门禁（改动后行为不退化）
```

**映射到 Cortex 评测层**：
- Curate → golden/*.json（真实任务用例集）
- Iterate → `pnpm eval:gate --gate=report`（开发时跑+看失败）
- Regress → `--gate=L1/L2`（发版/周 CI）

**judge 校准**（Galtea 2026）：LLM-judge 会漂移——rubric 固定 + 定期人工抽检（trace inspect）是必需品；judge 的通过阈值也要随数据校准（不是拍脑袋定）。

--

## 7. 评测工具生态广度调研（2026-08-06 补充）

### 7.1 主流工具定位（按用途分——不混为一谈）

| 工具 | 定位 | 适合场景 | 对 Cortex 的启示 |
|---|---|---|---|
| **Promptfoo** | 配置驱动评测 + CI 集成 | 提示/回归门禁（YAML 用例集） | eval-gate 的 CLI 形态可参照（配置即用例） |
| **DeepEval** | agent 评测框架（50+ 指标） | 端到端 + LLM-judge | 已有对标（§1-3）——不重复 |
| **Braintrust** | prompt 回归 + 观测 | 团队协作的回归工作流 | 报告格式/阈值门禁可参照 |
| **LangSmith** | LangChain 原生评测 + 轨迹 | 轨迹级调试 | trace 捕获的 UI 呈现可参照 |
| **Arize Phoenix** | 生产监控 + 回归 | 模型输出回归检测 | 生产侧（guardrail 域——Cortex 的 ConfirmGate 已覆盖） |
| **Langfuse** | 开源观测（轨迹/成本） | 自托管观测 | 低成本轨迹查看器参照 |

### 7.2 关键结论（2026 共识）

1. **评测与观测分离**：离线评测（eval）与生产观测（observability）是两套——Cortex 的 eval-gate（离线）与 telemetry（观测）正好对应——不需要第三套
2. **CI 集成是标配**：所有主流工具都有 CI 回归门禁——Cortex 的 ci-gate 4.5/5 已对齐
3. **配置驱动**：Promptfoo 的 YAML 用例集是低成本起点——Cortex 的 golden JSON 同模式（eval-types 已定义）
4. **轨迹是第一需求**：LangSmith/Langfuse 的核心价值是轨迹可视化——Cortex 的 observer 事件数组已是轨迹（v1 打表够用，v2 可加树形视图）

### 7.3 Cortex 的差异化（不强求对标）

- **决策台账（byDesign）**：主流工具没有"故意不接线"的断言槽位——这是 Cortex 的原创（审计不再翻旧账）
- **机制活性优先**：主流工具重输出质量（LLM-judge），Cortex v1 重机制活性（deterministic）——v2 再加质量层
- **零外部依赖**：eval-gate 纯 node 实现（无平台依赖）——Promptfoo 等的托管/云形态不适合单机项目

---

*广度补充完成——工具生态对齐确认 Cortex 方向正确（CI 集成/配置驱动/轨迹优先），byDesign 台账是差异化。*
