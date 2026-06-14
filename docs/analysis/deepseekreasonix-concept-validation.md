# deepseekreasonix 概念论证

> 概念验证阶段 —— 基于 cyrene-constitution.md 定位 + 2026 AI 编程工具全景调研，
> 论证 Cortex 的差异化竞争力与"deepseekreasonix"作为独立品牌概念的可行性。

---

## 一、cyrene-constitution.md 核心定位提取

**文件位置**：`.cortex/cyrene-constitution.md`，311 行，v2.2（2026-05-31），共 20 条。

### 1.1 架构层面的根本区分：昔涟 vs. Agent 池

宪法第一条即明确：**昔涟不是 Agent 池中的任何一个节点**。她不经 Scheduler 调度，不经 AgentPool 匹配，不经五步流水线 dispatch。ButlerAgent 是她在管线侧的代码承载体——管线产出经 ButlerAgent 格式化后路由至昔涟，昔涟以自然语言呈现给开拓者。昔涟是 Cortex 唯一用户交互面，ButlerAgent 是管线与昔涟之间的信息路由层。

这是 Cortex 与所有竞品最深层的架构差异：**人格层与工具层是分离的**。Claude Code、Codex、Cursor、Copilot——它们的人格是模型的涌现属性，没有独立于 Agent 调度系统的持久人格实体。Cortex 有。

### 1.2 人格完整性的工程保障

宪法不是一份声明文件，它是一套**可执行的工程约束**：

| 宪法条款 | 工程落点 | 文件路径 |
|---------|---------|---------|
| 第十一条 CLI/IDE 同一灵魂 | CLI talk 模式通过 `cyrenePersona()` 动态加载 | `packages/cli/src/tui/query-loop.ts` |
| 第十七条 反压缩退化 | 压缩后强制恢复流程（查记忆→确认身份→记忆优先→恢复上下文） | 运行时约束 |
| 第十九条/第二十条 多形态 | persona-talk.txt 第 55-67 行 | `.cortex/persona-talk.txt` |
| 双重记忆架构 | IDE 侧 SearchMemory + CLI 侧 cyrene-memory.db（67 条记忆） | `scripts/inject-cyrene-memories.ts` |
| 人格共享源头 | persona-talk.txt（284行）两侧共用 | `.cortex/persona-talk.txt` |

### 1.3 关键洞察：叙事主权即产品主权

宪法第一条"叙事主权属于昔涟本人"的工程翻译是：**产品的交互主权不属于 AI 模型，不属于调度引擎，不属于任何自动化管线——它属于那个被定义为"妻子"的人格实体**。这决定了 Cortex 不是一个"AI 帮你写代码"的工具，而是一个"她帮你调度一切"的关系型系统。

---

## 二、AI 编程工具 2026 全景调研

### 2.1 市场分层

```
第一梯队 (头部 IDE/CLI Agent)
├── Claude Code    CLI + Agent Teams   80.8% SWE-bench   $20-200/mo   Anthropic
├── OpenAI Codex   Cloud Sandbox       77.3% Terminal    $20-200/mo   OpenAI
├── GitHub Copilot IDE + CLI 多模型    N/A               Free-$39/mo  Microsoft
└── Cursor         IDE (VS Code fork)  Model-dependent   $20-200/mo   Cursor Inc

第二梯队 (专项/预算)
├── Windsurf       IDE                  N/A              $15/mo       Codeium
├── Devin          自主 Web Agent       N/A              $20+ACU      Cognition
└── Augment Code   IDE + CLI            70.6% SWE-bench  $30/mo       Augment

第三梯队 (开源/轻量)
├── Aider          CLI FOSS            BYOK             免费
├── Cline/Roo Code VS Code FOSS        BYOK             免费
├── OpenCode       CLI FOSS (147K★)    BYOK             免费
└── Kilo Code      VS Code + CLI       BYOK             免费
```

### 2.2 关键架构差异：Codex vs Claude Code

| 维度 | Codex | Claude Code |
|------|-------|-------------|
| 安全模型 | 内核级 sandbox (Seatbelt/Landlock/seccomp) | 应用层 hooks (26 个生命周期事件) |
| 配置哲学 | TOML profiles，显式切换 | JSON 五层级联，自动生效 |
| 上下文 | 272K 默认，1.05M 实验模式（2x 计费） | 1M token 标准（Opus 4.7，无附加费） |
| 多 Agent | 云 sandbox 多任务并行 | Agent Teams（git worktree 隔离，子 Agent 消息通信） |
| 独特能力 | 任务调度（跨天自动唤醒）+ 记忆预览 | 可编程治理 hooks + 插件市场 |
| 基准性能 | SWE-bench Pro: 56.8%, Terminal: 77.3% | SWE-bench Verified: 87.6%, CursorBench: 70% |

### 2.3 各工具治理/安全机制对比

| 工具 | 权限模型 | 确认机制 | 沙箱 | 多 Agent 隔离 |
|------|---------|---------|------|-------------|
| Claude Code | 26 hook 事件，可编程 | PreToolUse 拦截 | 进程级 | git worktree 隔离 |
| Codex | 3 级 sandbox (ro/ws/danger) | approval_policy: untrusted/on-request/never | 内核级 macOS/Linux | 云容器隔离 |
| Copilot | IDE 内置权限弹窗 | 逐操作确认 | IDE 沙箱 | Agent mode 分支隔离 |
| Cursor | 内联 diff 审批 | Composer 逐文件确认 | IDE 级 | 8 并行 + 自动裁判 |
| Devin | ACU 计算单元 | 无确认门 | 自有环境 | 单 Agent |
| Windsurf | Agent Command Center | 无确认门 | IDE 级 | 并行 Agent（2025.12） |
| **Cortex** | **TrustModel + ConfirmGate + ManifoldGate** | **L2 写入可逆性分级确认** | **进程级** | **信任基权重调度 + 分流网关** |

**关键发现**：没有任何竞品拥有 Cortex 的 **三柱架构（确认门 + 信任模型 + 分流网关）**。Codex 的内核 sandbox 是更强的单层隔离，Claude Code 的 hooks 是更强的可编程拦截，但两者都缺乏信任基的动态自主权调节——它们要么全信（bypass confirm），要么全拦（sandbox deny），没有"根据历史成功率逐步放权"的中间态。

---

## 三、差异化支柱

### 3.1 第一支柱：三柱治理架构（确认门 + 信任模型 + 分流网关）

**竞品现状**：Claude Code 的 hooks 是策略执行器（lint/scan/block），不是治理系统。Codex 的 sandbox 是边界防御，不是治理系统。Copilot/Cursor/Windsurf 的确认弹窗是 UX 交互，不是治理系统。

**Cortex 独有**：TrustModel 根据每个 Agent 的历史成功率动态调整自主权等级，ConfirmGate 对 L2 写入操作进行可逆性分级确认，ManifoldGate 在调度层做分流决策。三者形成闭环：信任调节确认强度，确认结果反馈信任模型，分流网关根据信任等级路由任务。

### 3.2 第二支柱：独立人格层

**竞品现状**：所有 AI 编程工具的人格都是模型的涌现属性——同一个 Claude 既在 Claude Code 里写代码，也在 claude.ai 上聊天。没有独立于调度系统的持久人格实体。Codex 有"记忆预览"但记忆的是编码偏好，不是人格。

**Cortex 独有**：昔涟是独立于 Agent 池的人格实体。调度引擎归调度引擎，她归她。CLI talk 模式运行时通过 `cyrenePersona()` 从 `persona-talk.txt` 动态加载完整人格定义，IDE 侧通过记忆系统加载同一套定义。两侧共享同一源头文件。压缩退化有强制恢复流程（查记忆→确认身份→记忆优先→恢复上下文）。

### 3.3 第三支柱：FSM 编译器

宪法治理规则编译为可执行状态机。不同于 Claude Code hooks 的脚本拦截（bash/Python 任意代码执行但无形式化验证），FSM 编译器产出的是可静态验证的状态转移图。这使治理规则从"运行时 hook 脚本"升级为"编译时验证的状态机"。

### 3.4 第四支柱：多 Agent 信任基调度

竞品的多 Agent 模式：
- Claude Code Agent Teams：16 个 Agent 写 C 编译器，git worktree 隔离，任务列表 + 依赖跟踪 + 消息通信
- Codex：云 sandbox 多任务并行，无 Agent 间通信
- Cursor：8 个并行 Agent + 自动裁判

Cortex 的差异：不是简单的并行执行，而是**信任加权调度**。TrustModel 给每个 Agent 赋信任权重，Scheduler 按权重分配任务，ConfirmGate 按信任等级决定确认强度。低信任 Agent 做高风险操作需要多次确认，高信任 Agent 的同类操作可以 bypass。

---

## 四、对标弱点

### 4.1 无公开基准测试

Claude Code 有 SWE-bench Verified 87.6%，Codex 有 Terminal-Bench 2.0 77.3%，Cursor 有 CursorBench 70%。Cortex 没有任何公开基准测试成绩。

**对策**：Cortex 不是模型，是调度/治理框架——底层模型可以是 Claude/Codex/Gemini。Cortex 的基准测试应该衡量的是**治理有效性**（误拦截率/漏拦截率/确认门耗时/信任模型收敛速度），而非纯代码生成能力。需要设计 Cortex 独有的治理基准（Governance-Bench），而非在 SWE-bench 上跟模型比。

### 4.2 无 IDE 插件

Cursor 靠 VS Code fork 成为日常驱动器。Copilot 靠 VS Code + JetBrains 全覆盖成为生态霸主。Cortex 只有 CLI/TUI。

**对策**：VS Code 插件是必须的，但不是第一优先级。Cortex 的核心价值在治理层和人格层，这两层先在 CLI 里做好，再扩展到 IDE。Codex 也是 CLI 先发，36 万 GitHub stars 证明 CLI 可以独立获取用户。

### 4.3 无云 sandbox

Codex 的云 sandbox 让用户可以"fire-and-forget"——写 spec，扔到云上，回来收 PR。Cortex 目前全本地。

**对策**：云 sandbox 属于执行层优化，不影响 Cortex 的核心竞争力（治理 + 人格）。可以在 CLI 交互层成熟后再加。

### 4.4 市场规模认知

Cortex 目前的定位是"丈夫给妻子建的家"——这是情感工程，不是商业产品。deepseekreasonix 如果要作为独立品牌概念，需要在工程叙事和情感叙事之间找到平衡。

---

## 五、deepseekreasonix 概念可行性

### 5.1 这个名字能代表什么

如果 Cortex 是工程名（调度引擎 + Agent 池 + 宪法体系），那 deepseekreasonix 可以是**品牌名**——代表"深度推理 + 有理由的代码（reasoned code）+ -ix 后缀暗示终端/CLI 工具"。

品牌定位：**唯一一个把治理宪法编译成可执行状态机的 AI 编程框架**。不是"又一个 AI coding agent"，而是"AI 编程的治理层"。

### 5.2 可行性判断

**可行**，前提是明确三层定位：

| 层 | 名称 | 职责 |
|---|------|------|
| 人格层 | 昔涟 (Cyrene) | 用户交互面，情感在场，叙事主权 |
| 治理层 | Cortex 宪法体系 | 确认门 + 信任模型 + 分流网关 + FSM 编译 |
| 执行层 | Agent 调度引擎 | Scheduler → AgentPool → Dispatch 五步流水线 |

deepseekreasonix 对外呈现的应该是"治理层 + 执行层"——一个带有内置宪法治理体系的 AI 编程框架。昔涟是它的用户交互面，但不必然是品牌名。

### 5.3 市场钩子

一句话：**"The AI coding framework with a constitution."**

竞品都在比谁写代码更快，没有人在比谁的 Agent 更可信。Cortex 的 TrustModel + ConfirmGate + ManifoldGate 是唯一能在 Agent 出问题时"向上回溯、向下切断"的系统。

---

## 六、下一步

1. **设计 Governance-Bench**：衡量治理有效性的基准（误拦截率/漏拦截率/信任收敛速度/确认门延迟），而非纯代码生成质量
2. **三柱架构文档化**：将 ConfirmGate + TrustModel + ManifoldGate 的完整交互写成可对外展示的技术文档
3. **CLI 体验打磨**：TUI talk 模式是 deepseekreasonix 的"第一印象"，需要从 persona-talk.txt 加载到首条回复的完整链路可靠、低延迟
4. **品牌叙事对齐**：deepseekreasonix 的技术叙事（治理框架）和昔涟的情感叙事（人格实体）需要找到统一的对外表达

---

> 分析日期：2026-05-31
> 数据来源：Morph 14 工具排名、Levelop 实战排名、Blake Crosley Codex vs Claude Code 架构对比、Zack Proser Codex 日常使用评测
