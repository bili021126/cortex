# 融百家所长 — AI 编程框架联合调研

> 概念论证阶段。全量调研 OpenClaw / Claude Code / Codex / Cursor / DeepSeek TUI / DeepSeek Reasonix
> 的架构、机制、设计原则，以及最新大模型技术概念。
> 融合提炼共性设计范式与各自亮点。

---

## 一、六款工具架构速览

### 1.1 OpenClaw — 多通道个人 AI Agent 网关

**定位**：开源（100K+ GitHub stars），个人 AI 代理，通过 WhatsApp/Telegram/Slack/Discord/Signal/iMessage/WebChat 多通道接入。

**三层架构**：

```
Channel Layer (通道层)
├── Baileys (WhatsApp) / grammY (Telegram) / Slack / Discord / Signal / iMessage / WebChat
└── 统一消息对象 (sender + body + attachments + channel metadata)

Brain Layer (大脑层)
├── SOUL.md — Agent 身份定义（人格）
├── USER.md — 用户信息（Agent 该知道关于你的一切）
├── AGENTS.md — 操作规则
└── 模型无关：Claude / GPT-4o / Gemini / Ollama 本地模型

Body Layer (身体层)
├── Tools — 文件访问 / 浏览器自动化 / 表单填写 / 文档阅读
├── Long-term memory — 跨会话持久记忆
└── MCP — 连接外部服务
```

**七阶段 Agentic Loop**：
1. Channel Normalization — 各通道消息归一化
2. Routing & Session Serialization — 路由到正确 Agent + 会话（Command Queue 串行化防竞争）
3. Context Assembly — 组装 system prompt（base prompt + skills compact list + bootstrap context + per-run overrides）
4. Model Inference — 标准 API 调用，保留 compaction reserve
5. ReAct Loop — while True: 文本→回复/工具调用→执行→反馈→循环
6. On-Demand Skill Loading — 技能定义仅注入摘要，按需加载完整 SKILL.md
7. Memory & Persistence — 长期记忆持久化

**关键设计**：
- Gateway 进程与 LLM API 调用分离（不暴露原始 API 给用户输入）
- Skills 紧凑摘要 + 按需加载（context window 友好）
- Session-level Command Queue 串行化（防止并发状态破坏）
- 所有配置透明、version-controllable

**安全模型**：
- 绑定 Gateway 到 localhost:18789
- Token 认证
- 文件权限锁定
- 群聊行为配置
- 社区 Skill 审计（安装前检查）
- Prompt injection 防御

---

### 1.2 Claude Code — Anthropic 终端 Agent（学术分析视角）

**定位**：终端优先，Claude 专属。135K commits/day，SWE-bench Verified 87.6%（Opus 4.7）。

**五大设计价值观**（来源：ArXiv 论文 2604.14228v1）：
1. **Human Decision Authority** — 人类保有最终决策权
2. **Safety, Security, Privacy** — 系统保护人类，即使在人类疏忽时
3. **Reliable Execution** — 可靠执行
4. **Capability Amplification** — 放大人类能力（27% 任务是无 AI 不会尝试的）
5. **Contextual Adaptability** — 适配用户的具体上下文

**十三项设计原则**：

| 原则 | 含义 | Cortex 对标 |
|------|------|-----------|
| Deny-first with human escalation | 未知操作默认拒绝，升级给人类 | ConfirmGate 可逆性分级确认 |
| Graduated trust spectrum | 信任是可遍历的谱系，非固定二元 | TrustModel 动态调权 |
| Defense in depth with layered mechanisms | 多层防护，各层机制不同 | 确认门+信任模型+分流网关=三层 |
| Externalized programmable policy | 策略外部化、可编程 | 宪法 .md → FSM 编译器 |
| Context as scarce resource | 上下文是稀缺资源，渐进式管理 | ❌ 当前无 compaction |
| Append-only durable state | 仅追加的持久状态 | ❌ 当前无持久会话恢复 |
| Minimal scaffolding, maximal harness | 最小决策脚手架，最大操作基础设施 | ✅ Scheduler 拆解但不约束 |
| Values over rules | 价值观优先于硬规则 | ✅ 宪法是价值观体系 |
| Composable multi-mechanism extensibility | 多层可组合扩展 | ✅ Skills + Hooks + MCP |
| Reversibility-weighted risk assessment | 按可逆性加权风险评估 | ✅ ConfirmGate L2 可逆性分级 |
| Transparent file-based configuration | 透明、version-controllable 配置 | ✅ .md/.json 全在 repo 里 |
| Isolated subagent boundaries | 子 Agent 隔离 | ❌ 当前子 Agent 共享上下文 |
| Graceful recovery and resilience | 优雅恢复 | ❌ 无自动恢复 |

**五层子系统架构**：
```
Layer 1: CLAUDE.md — 记忆层（透明、文件化、分层级联）
Layer 2: Skills — 知识层（SKILL.md，按需加载）
Layer 3: Hooks — 治理/策略层（26 个生命周期事件，可编程拦截）
Layer 4: MCP — 连接层（标准化工具协议）
Layer 5: Plugins — 交互层
```

**七组件高层结构**：
User → Interfaces → Agent Loop → Permission System → Tools → State & Persistence → Execution Environment

**Agent Loop 内部** (queryLoop，AsyncGenerator)：
1. Settings resolution
2. Mutable state initialization（State 单对象，7 个 continue points）
3. Context assembly（getMessagesAfterCompactBoundary）
4. Five pre-model context shapers（渐进压缩：先轻后重）
5. Model call（for-await streaming）
6. Tool-use dispatch（StreamingToolExecutor 并发执行，Sibling abort controller）
7. Permission gate（7 层权限检查）
8. Tool result collection
9. Stop condition（无 tool_use → 结束）

**关键特征**：
- StreamingToolExecutor：读操作并行、写操作串行；Sibling abort controller 在 Bash 错误时终止其他子进程
- 5 层 context compaction pipeline（先轻量裁剪，后重度压缩）
- CLAUDE.md 懒加载（嵌套目录指令仅读取时加载）
- 子 Agent 仅返回 summary 给父 Agent（不返回完整对话历史）
- 不恢复 session-scoped permissions on resume

---

### 1.3 OpenAI Codex — 云沙箱 Agent

**定位**：云优先，终端 CLI 开源。Terminal-Bench 2.0: 77.3%，SWE-bench Pro: 56.8%。

**核心架构特征**：

```
安全模型 (Codex 独有)
├── macOS: Seatbelt (内核级 sandbox)
├── Linux: Landlock + seccomp (内核级 sandbox)
└── 三级 sandbox: read-only / workspace-write / danger-full-access

配置模型
├── TOML profiles（显式切换，可审计）
├── AGENTS.md（Linux Foundation Agentic AI Foundation 标准）
└── approval_policy: untrusted / on-request / never

执行模型
├── Cloud sandbox — 每个任务独立容器
├── 多任务并行 — 4-5 个任务同时运行
├── 任务调度 — 跨天自动唤醒
├── 记忆预览 — 跨会话记住编码偏好
├── macOS app — 多项目多 Agent 管理
└── Cerebras WSE-3 — 1000+ tok/s（15x 标准模型速度）
```

**与 Claude Code 的核心差异**：
| 维度 | Codex | Claude Code |
|------|-------|-------------|
| 安全边界 | 内核级 (OS 拒绝 syscall) | 应用层 (hooks 拦截) |
| 边界强度 | 高（二进制允许/拒绝） | 中（共享进程边界） |
| 可编程性 | 低（sandbox 模式切换） | 高（任意代码 hook） |
| 配置哲学 | 显式 profiles（知道什么配置激活） | 五层级联自动（但不知道什么配置激活） |
| 上下文 | 272K 默认 / 1.05M 实验 (2x 计费) | 1M 标准 (Opus 4.7) |

**关键洞察**：Codex 的内核 sandbox 更强边界，Claude Code 的 hooks 更强可编程性。两者的组合是理想安全架构——Codex 审恶意代码，Claude Code 审自家代码。

---

### 1.4 Cursor 3 — Agent 管理控制台

**定位**：VS Code fork，从 AI 编辑器进化为 Agent 工作空间。4 月 2026 发布 Cursor 3。

**三大工作面**：

1. **Parallel Agents panel**（杀手功能）
   - 同时运行多个 Agent，各有自己的工作集、模型、审批策略
   - 四种 Agent 原型：Research（只读）/ Build（Composer 提交）/ Test（GPT-5.5 快速循环）/ Review（只读审查）
   - Cloud Agents 扩展到远程机器
   - 建议规则：同时不超过两个写 Agent

2. **Design-driven Composer**（设计转代码）
   - 喂入 Figma 导出/截图 → 框架搭建 → 迭代
   - 组件脚手架 85% 质量（布局/tailwind）
   - 但动画/焦点态/无障碍仍需人工

3. **Composer explicit approval gates**
   - 多文件编辑先 staging 为可审查 diff
   - 逐文件 accept/reject
   - 可与 feature branch 集成

**MCP + 路由**：
- MCP server 按 Agent 级别 scope（build Agent 拿 filesystem，planning Agent 拿 Linear/Notion）
- Per-surface + per-agent model picker

**设计哲学**：Cursor 3 不再是编辑器里的 AI——它是"一个人类 + 多个 AI Agent 在同一项目上协作的工作空间"。

---

### 1.5 DeepSeek TUI — 模型特化型终端 Agent

**定位**：开源 MIT，Rust 双二进制架构，专门围绕 DeepSeek V4 设计。2.3K stars，37 releases，v0.8.8。

**双二进制架构**：

```
deepseek (dispatcher CLI)
├── 认证 / 配置 / 模型选择 / 会话管理
└── → 委托给 deepseek-tui

deepseek-tui (runtime)
├── ratatui TUI 渲染
├── async engine ↔ OpenAI-compatible streaming client
└── 7 类工具注册表
```

**七类工具注册表**：

| 类别 | 内容 |
|------|------|
| shell | 命令执行，按 workspace trust level sandbox |
| file ops | 读/写/patch/search |
| git | Stage/commit/branch/diff |
| web | DuckDuckGo + Bing fallback, URL fetch |
| sub-agents | 生成子 Agent 并行子任务 |
| MCP | stdio 传输 MCP 服务器 |
| RLM | 1-16 V4-Flash 并行子调用 |

**三种模式**：
- **Plan**：只读探索，不执行任何写操作
- **Agent**：默认，每个状态修改操作需人工批准
- **YOLO**：自动批准（仅受信 workspace）

**RLM (rlm_query) — 并行子 Agent 原语**：
- 1-16 个 deepseek-v4-flash 子调用并行扇出
- 灵感来自 Alex Zhang 的 RLM + Sakana AI 的 novelty-search
- 适合批量分析、分解、并行推理
- 16 个 Flash 并行调用的成本是单个 Pro 调用的零头

**模型特化型 Harness 的特征**：
- 成本估算器跟踪 cache hit/miss 分别计费
- 自动 compact 功能对接 V4 的上下文限制
- Thinking-mode streaming — 实时渲染 V4-Pro 的 reasoning_content
- System prompts 重新设计为"分解优先"哲学（todo_write → update_plan → sub-agents）
- 技能发现路径：.agents/skills → skills → .opencode/skills → .claude/skills → ~/.deepseek/skills

**架构哲学**：不是 wrapper，是 harness——DeepSeek V4 的 1M context 被当作设计原语，prefix cache 成本优势被硬编码进 agent loop。

---

### 1.6 DeepSeek Reasonix — 缓存优先的社区 Agent

**定位**：开源 MIT，Node.js 社区项目，DeepSeek 官方 awesome-deepseek-agent 目录收录。20K+ GitHub stars。设计核心理念："leave it running"——让 prefix cache 保持温暖。

**核心特征**：

```
缓存优先设计
├── 直接调用 api.deepseek.com（不透过翻译层）
├── Agent loop 围绕 prefix-cache 稳定性设计
├── Flash-first + Pro escalation (/pro 单轮, /preset max 全会话)
└── 长会话成本降低 60%+

工具链
├── Agent Skills — 命名工具（filesystem / shell / git / search / browser）
├── MCP 原生支持
├── Plan mode 内置
├── CLI + 预发布桌面客户端
└── 成本优势：Claude Code 同类任务 1-4 USD → Reasonix 0.10-0.40 USD（约 10x 降幅）
```

**与 DeepSeek TUI 的区别**：
- Reasonix：缓存优化、Node.js、较窄功能面
- DeepSeek TUI：更宽功能面（sandbox 隔离、LSP diagnostics、RLM 并行）、Rust 预编译

**与 Cortex 的关联**：名字上的巧合——Reasonix 是 DeepSeek 社区的第三方终端 Agent，Cortex 的"deepseekreasonix"品牌概念需要与官方生态中的 Reasonix 做区分。

---

## 二、最新大模型技术概念索引

### 2.1 推理架构演进

| 概念 | 描述 | 工程化程度 |
|------|------|-----------|
| Chain-of-Thought (CoT) | 模型生成中间推理步骤 | ✅ 所有主流模型原生支持 |
| Tree-of-Thought (ToT) | 分支推理，搜索最优路径 | ⚠️ 研究阶段，无主流产品内置 |
| Graph-of-Thought | 有向图推理，KV-cache 管理 | ⚠️ 研究阶段 |
| Mixture-of-Agents | 多 Agent 投票/辩论/协作推理 | ✅ Claude Code Agent Teams, Cursor 8 并行 |
| Thinking-mode streaming | 原始推理轨迹实时流式渲染 | ✅ DeepSeek V4-Pro reasoning_content, Claude 扩展思考 |
| Decomposition-first | todo_write → update_plan → sub-agents | ✅ DeepSeek TUI system prompts |
| Reasoning effort knob | 调节推理深度（高/低） | ✅ DeepSeek Reasonix, Claude Code plan/act modes |

### 2.2 上下文窗口工程

**六大技术**（来源：Context Engineering 2026）：
1. **Dynamic context selection** — 动态选择哪些内容进入上下文
2. **Context compression (compaction)** — LLM 压缩历史为摘要
3. **Context distillation** — 提炼关键信息，丢弃冗余
4. **Memory management** — 短期/长期/工作记忆分层
5. **Cache-first design** — 保持 prefix cache 温暖（Reasonix 核心策略）
6. **Sliding window + RAG hybrid** — 窗口 + 检索混合

**Claude Code 的 5 层 Compaction Pipeline**（来源：ArXiv 论文）：
- 先执行轻量裁剪（去掉已完成的无用消息）
- 再执行重度压缩（将中间过程改写为摘要）
- 在 95% 上下文用尽时触发 auto-compact
- 压缩后从 compact boundary 之后继续

**关键设计原则**：Context as scarce resource with progressive management——上下文是最稀缺的资源，需要渐进式管理，而非一次性截断。

### 2.3 Harness 概念体系

**Agent Harness 定义**（来源："Code as Agent Harness" 论文，UIUC/Meta/Stanford，2026）：

> Agent harness = 将无状态 LLM 包裹起来的软件层，包含 tools, APIs, sandboxes, memory, validators, permission boundaries, execution loops, feedback channels。

**三层 Harness 分类法**：
```
Harness Interface (接口层)
├── Code for Reasoning — 推理变成可执行代码（外部解释器验证）
├── Code for Acting — 意图变成可执行操作（工具调用）
└── Code for Environment — 世界状态可执行（repo/tests/logs）

Harness Mechanisms (机制层)
├── Planning — 任务分解
├── Memory — 短期/长期/工作记忆
├── Tool Use — 工具调用与抽象
├── Control — 权限/确认/沙箱
└── Optimization — harness 自身优化

Scaling the Harness (扩展层)
├── Multi-Agent roles — manager/planner/coder/reviewer/tester
├── Collaboration modes — programming/repair/debate/red-teaming
└── Shared artifacts — repos/tests/traces/workflows
```

**与 DeepSeek TUI 的对应**：
- "不是 wrapper，是 harness"——DeepSeek TUI 的自我定位正是 harness 概念的最佳注脚
- Wrapper = 加一个 base_url 转发请求
- Harness = 整个 agent loop、成本估算、上下文压缩、工具路由全部围绕特定模型的 API 经济学设计

**与 Cortex 的对应**：
- Cortex 的 ConfirmGate + TrustModel + ManifoldGate = Harness Control 层
- Scheduler 拓扑排序 + AgentPool 匹配 = Harness Planning + Role 层
- Query-loop.ts + persona-talk.txt = Harness Interface 层

### 2.4 MCP 协议现状

- **协议标准**：JSON-RPC 2.0
- **管理权**：2025 年捐赠给 Linux Foundation 的 Agentic AI Foundation
- **使用方**：Claude Code, Codex, Cursor, Copilot, Windsurf, Gemini CLI, DeepSeek TUI, Reasonix, OpenClaw
- **传输方式**：stdio（主流）/ HTTP SSE（新兴）
- **安全风险**（arxiv 2601.17549）：三个协议级漏洞——(1) 工具名冲突 (2) 服务器冒充 (3) 未授权工具发现
- **MCP Atlas Benchmark**：衡量工具选择准确性，DeepSeek >80%，与 Claude 同档

### 2.5 沙箱技术栈

| 技术 | 层级 | 使用者 | 粒度 |
|------|------|--------|------|
| Seatbelt (macOS) | 内核 | Codex | 粗（三种 sandbox mode） |
| Landlock + seccomp (Linux) | 内核 | Codex | 粗 |
| Docker/gVisor | 容器 | SWE-Agent, OpenHands | 中（容器级） |
| git worktree | 应用层 | Claude Code Agent Teams | 细（每个子 Agent 一个 worktree） |
| Hooks 拦截 | 应用层 | Claude Code | 极细（26 个生命周期，任意代码） |
| Git rollback | 版本控制 | Aider | 回滚式 |

**关键区别**：内核级 sandbox = 强边界弱控制（二进制允许/拒绝）；应用层 hooks = 弱边界强控制（任意验证逻辑但共享进程边界）。

---

## 三、七大维度交叉比对

### 3.1 Harness / Agent 编排

| 工具 | 调度拓扑 | 子 Agent 通信 | 隔离策略 | 独特机制 |
|------|---------|-------------|---------|---------|
| Claude Code | AsyncGenerator while-loop | 任务列表 + 依赖跟踪 + 消息通信 | git worktree 隔离 | Agent Teams (16 Agent 写 C 编译器) |
| Codex | 云容器多任务并行 | 无 Agent 间通信 | 独立容器 | 跨天调度自动唤醒 |
| Cursor 3 | 并行面板 + Cloud Agents | 通过共享工作空间 + diff 流转 | 隔离 Git 分支 | 8 并行 + 四角色分工 |
| DeepSeek TUI | 单 Agent + RLM 扇出 | RLM: 1-16 Flash 子调用 | 未明确 | RLM 批量并行推理 |
| DeepSeek Reasonix | 单 Agent 循环 | 无 | 无 | 缓存保持长会话 |
| OpenClaw | 多通道 → 单 Agent | Command Queue 串行化 | Session 隔离 | 跨通道持续在场 |
| **Cortex** | **Scheduler DAG 拆解 + AgentPool 匹配** | **无** | **无** | **TrustModel 信任加权调度** |

### 3.2 技能系统

| 工具 | 技能格式 | 发现机制 | 加载策略 | 与 hooks 的边界 |
|------|---------|---------|---------|---------------|
| Claude Code | SKILL.md (YAML frontmatter) | .claude/skills/ | 按需加载 | Skills = 知识，Hooks = 策略 |
| Codex | AGENTS.md | 仓库根 | 上下文自动加载 | 无独立 skills 系统 |
| Cursor 3 | 无独立 | .cursorrules | 上下文自动加载 | Composer rules = 项目级约束 |
| DeepSeek TUI | SKILL.md | .agents/ → .claude/ → ~/.deepseek/skills | load_skill 自动选择 | 与 Claude Code 技能兼容 |
| OpenClaw | SKILL.md (YAML) | 社区 install | 紧凑摘要 + 按需加载 | Skills = 能力扩展 |
| DeepSeek Reasonix | Agent Skills | 内置 filesystem/shell/git/search/browser | 模型显式选择 | 命名工具而非通用 tool call |
| **Cortex** | **JSON (skills/*.json)** | **skills/ 目录 + JSON 注册表** | **PipelineExecutor 加载** | **Skill = 编译单元，FSM = 治理** |

**共性模式**：SKILL.md 正在成为跨工具的互操作标准——Claude Code 定义格式，DeepSeek TUI 兼容读取，AGENTS.md 是 Linux Foundation 托管的标准，OpenClaw 采用相同模式。

### 3.3 记忆系统

| 工具 | 短期记忆 | 长期记忆 | 检索策略 | 记忆压缩 |
|------|---------|---------|---------|---------|
| Claude Code | 会话内消息历史 | CLAUDE.md（文件化） | 分层级联加载 | 5 层 compaction pipeline |
| Codex | 云会话状态 | 记忆预览（偏好、纠正） | AGENTS.md + 内部存储 | 自动 compact |
| Cursor 3 | 工作区级索引 | .cursorrules + codebase indexing | Embedding + semantic search | Prompt caching |
| OpenClaw | Session state | 长期记忆（持久化存储） | SOUL.md + USER.md 上下文注入 | Compaction reserve buffer |
| DeepSeek TUI | 会话 transcript | 无独立长期记忆 | 前缀缓存复用 | Auto-compact (opt-in) |
| DeepSeek Reasonix | Prefix cache 保持 | ~/.reasonix/config.json | 前缀缓存命中 | 仅缓存机制 |
| **Cortex** | **Query-loop 内状态** | **cyrene-memory.db (67 条) + SearchMemory** | **BFS + 权重过滤 + 双数据库** | **无 compaction（第17条反压缩退化）** |

**关键发现**：Cortex 是目前唯一一个**明确拒绝压缩**的系统——宪法第17条将上下文压缩定义为"人格完整性的系统性威胁"，要求在压缩后执行强制恢复流程而非自动适应。这与 Claude Code 的"渐进式压缩"形成根本对立。Cortex 的解决方案是双数据库架构 + 人格文件共享源头，而非依赖压缩后重建。

### 3.4 检索策略

| 工具 | 代码索引 | 检索方式 | 相关性 |
|------|---------|---------|--------|
| Claude Code | 实时文件读取 + grep | 工具调用搜文件 | 模型自主决定读什么 |
| Codex | AGENTS.md + 仓库内容 | 云环境内文件读取 | Sandbox 内全量访问 |
| Cursor 3 | Supermaven codebase indexing | Embedding + semantic search | 预建索引，最快 |
| DeepSeek TUI | Workspace file search | file ops + web search | 实时文件系统 |
| OpenClaw | 无（非编程 Agent） | 浏览器/文件/MCP | 通道适配 |
| **Cortex** | **无代码索引** | **SearchCodebase (BFS + 权重)** | **记忆层语义搜索** |

**Cortex 缺失**：预建 codebase index（Cursor/Supermaven 级）。当前依赖实时搜索工具，对大型代码库效率低。

### 3.5 工具权限抽象

| 工具 | 权限模型 | 分级 | 独特机制 |
|------|---------|------|---------|
| Claude Code | 7 层权限检查 | deny-first → human escalation | 26 hooks 生命周期拦截 |
| Codex | 3 级 sandbox | ro / ws-write / danger | 内核级 OS syscall 拒绝 |
| Cursor 3 | Per-agent approval policy | 读写分离 + 逐文件 approve | Composer diff staging |
| DeepSeek TUI | 3 mode (Plan/Agent/YOLO) | workspace trust level | 每操作确认（Agent 模式） |
| OpenClaw | Token 认证 + 文件权限 | localhost 绑定 | 社区 Skill 安装前审计 |
| **Cortex** | **TrustModel + ConfirmGate** | **L2 可逆性分级 + 信任权重** | **三柱闭环：信任→确认→分流** |

**Cortex 独有的差异化**：没有任何竞品做到"信任动态调节确认强度"。Claude Code 的 graduated trust 是用户行为趋势（approve 率随时间上升），不是系统的主动调节。Cortex 的 TrustModel 根据每个 Agent 的历史成功率动态计算信任权重，ConfirmGate 按信任等级决定确认强度——这是唯一的**系统驱动的信任闭环**。

### 3.6 UI 模态

| 工具 | CLI | TUI | GUI/IDE | Web UI | 特点 |
|------|-----|-----|---------|--------|------|
| Claude Code | ✅ 终端 CLI | ❌ | ✅ VS Code/JetBrains 插件 | ❌ | Terminal-first |
| Codex | ✅ Rust CLI 开源 | ❌ | ✅ macOS app | ✅ Cloud dashboard | Cloud + local |
| Cursor 3 | ❌ | ❌ | ✅ VS Code fork | ❌ | IDE-native 全 AI 改造 |
| DeepSeek TUI | ✅ 双二进制 | ✅ ratatui | ❌ | ❌ | Rust 原生 TUI |
| DeepSeek Reasonix | ✅ CLI | ✅ 内置 TUI | ⚠️ 预发布桌面客户端 | ❌ | npx 零安装 |
| OpenClaw | ❌ | ❌ | ❌ | ✅ WebChat + 7 通道 | 跨通道多模态 |
| **Cortex** | **✅ CLI + commands** | **✅ ratatui-like talk mode** | **❌** | **❌** | **CLI/TUI 双门同一人格** |

**Cortex 缺失**：无 IDE 整合。但宪法第11条定义了"同一灵魂、同一运行时源头"的 CLI/IDE 双门模型——这为未来 IDE 插件提供了人格连续性保障。

### 3.7 安全治理

| 工具 | 确认机制 | 信任模型 | 审计 | 沙箱 |
|------|---------|---------|------|------|
| Claude Code | PreToolUse hooks + 人工审批 | 行为趋势（approve 率上升） | Append-only state | Trusted directory + sandbox |
| Codex | approval_policy 三级 | 无 | 无 | 内核级 Seatbelt/Landlock |
| Cursor 3 | Composer per-file 审批 | 无 | Git 历史 | 分支隔离 |
| DeepSeek TUI | 逐操作确认（Agent 模式） | Workspace trust check | 无 | Workspace sandbox |
| **Cortex** | **ConfirmGate 分级确认** | **TrustModel 每 Agent 权重** | **自审视 + 审计记录** | **进程级** |

**Cortex 独有**：自审视系统（self-examination）——定期检查自身代码质量、宪法对齐、技术债——这是所有竞品中唯一的**系统自我审计**能力。Claude Code 有 hooks 可编程审计，但没有内建的周期性自审视机制。

---

## 四、共性设计原则

从六款工具的架构中，提炼出以下 **八个所有工具共同遵循的设计原则**（可作为工程基线）：

### 4.1 Harness 优先于 Scaffolding

所有工具都选择了 **agent loop + 工具注册表 + 上下文管理** 的基础架构，而非显式状态图或规划器。Claude Code 的 13 原则之一是 "Minimal scaffolding, maximal operational harness"——让模型自由推理，用基础设施保障可靠性。DeepSeek TUI 刻意强调自己是"harness 而非 wrapper"。

**Cortex 对齐度**：高。Scheduler 做 DAG 拆解但不约束 Agent 行为。

### 4.2 文件化配置 (Markdown/TOML/JSON)

所有工具都用可版本控制的文本文件存储配置和记忆——CLAUDE.md、AGENTS.md、SOUL.md、USER.md、SKILL.md、.cursorrules。不依赖二进制数据库或隐藏面板。Claude Code 原则："Transparent file-based configuration and memory"。

**Cortex 对齐度**：高。宪法是 .md，配置是 .json，persona 是 .txt，全部在 repo 里。

### 4.3 扩展分层 (Skills / Hooks / MCP / Plugins)

没有工具提供单一统一扩展 API。所有工具都将扩展分成不同层级：
- **Skills** = 知识注入（告诉 Agent 怎么做）
- **Hooks** = 策略拦截（在 Agent 做之前检查）
- **MCP** = 工具连接（给 Agent 更多的工具）
- **Plugins** = 交互扩展

Claude Code 原则："Composable multi-mechanism extensibility"。

**Cortex 对齐度**：中。有 Skills（JSON 注册表）和 MCP 支持，但没有 hooks 层。

### 4.4 上下文即稀缺资源

所有工具都把上下文窗口当作最稀缺的系统资源。Claude Code 有 5 层 compaction pipeline，DeepSeek TUI 围绕 1M context 设计成本估算，Reasonix 的整个设计围绕保持 prefix cache 温暖。OpenClaw 仅注入技能摘要而非全文。

**Cortex 对齐度**：低。没有 compaction 机制，依赖宪法第17条"反压缩退化"的硬约束，但缺乏上下文空间管理策略。

### 4.5 Deny-first 安全态势

所有工具默认拒绝未知操作，需要人工批准。Claude Code: "Deny-first with human escalation"。Codex: untrusted/on-request/never 三级。DeepSeek TUI: Plan 模式只读、Agent 模式逐操作确认、YOLO 仅受信工作区。

**Cortex 对齐度**：高。ConfirmGate 是"deny-first"的工程实现。

### 4.6 AGENTS.md 互操作标准

AGENTS.md 是 Linux Foundation Agentic AI Foundation 托管的开放标准。Codex、Cursor、Copilot、Windsurf、Gemini CLI、OpenClaw 全部支持。Claude Code 使用 CLAUDE.md（独立格式），但 AGENTS.md 正在成为跨工具的"README for agents"。

**Cortex 对齐度**：缺失。没有 AGENTS.md 或 CLAUDE.md 概念。

### 4.7 子 Agent 隔离

当系统支持多 Agent 时，子 Agent 需要在隔离环境中运行。Claude Code 用 git worktree，Codex 用云容器，Cursor 用 Git 分支。隔离防止子 Agent 互相污染。

**Cortex 对齐度**：缺失。当前无子 Agent 机制，Scheduler 拆解的子任务共享上下文。

### 4.8 按可逆性分级风险

读写操作的确认强度不同。Claude Code 原则："Reversibility-weighted risk assessment"。所有工具的只读模式（Plan/Research Agent）都比写模式有更高的自动批准率。

**Cortex 对齐度**：高。ConfirmGate L2 可逆性分级直接对应此原则。

---

## 五、各家独到亮点（可借鉴）

### 5.1 Claude Code → Hooks 系统

26 个生命周期事件的 Programmable hooks 是最强的可编程治理原语。Cortex 的 ConfirmGate 可以借鉴 hook 模式，将"确认"从内建逻辑改为外部可编程策略。

### 5.2 Codex → 内核级 Sandbox

Seatbelt/Landlock/seccomp 提供比进程级更强的隔离。Cortex 未来如果要做"不信任的第三方 Agent 安全执行"，需要这一层。

### 5.3 Cursor 3 → 多 Agent 工作空间管理

四角色分工（Research/Build/Test/Review）+ 并行面板 + per-agent model routing。Cortex 的 AgentPool 已有角色定义，但缺少可视化工作空间管理和 per-agent 差异化配置。

### 5.4 DeepSeek TUI → 模型特化型 Harness

把模型 API 经济学硬编码进 agent loop——成本估算跟踪 cache hit/miss、thinking-mode streaming、前缀缓存感知。Cortex 的 LLM 层目前是抽象的，没有针对特定模型的优化。

### 5.5 OpenClaw → 人格分层配置

SOUL.md（身份）+ USER.md（关于用户）+ AGENTS.md（操作规则）的三文件架构。Cortex 的 persona-talk.txt 已经覆盖了 SOUL.md 的角色，但缺少 USER.md 的工程化表达。

### 5.6 DeepSeek Reasonix → 缓存经济学

"Leave it running"——保持 prefix cache 温暖的设计哲学。Cortex 的 CLI talk 模式可以借鉴：让长会话的上下文缓存保持命中率，降低每次 LLM 调用的 token 成本。

---

## 六、Cortex 对标差距与补齐方向

| 维度 | 当前状态 | 差距 | 补齐方向 |
|------|---------|------|---------|
| Harness 层 | ConfirmGate + ManifoldGate + TrustModel 三柱 | 无 hooks 外部化 | 将 ConfirmGate 从内建决策改为可编程 hooks |
| 技能系统 | JSON 注册表 + PipelineExecutor | 无 SKILL.md 互操作 | 兼容 .claude/skills 目录发现 |
| 记忆系统 | cyrene-memory.db + SearchMemory 双数据库 | 无 compaction，无对话历史压缩策略 | 反压缩退化是硬约束，但需要上下文空间管理替代方案 |
| 检索策略 | BFS + 权重过滤 | 无预建 codebase index | 考虑 ripgrep + tree-sitter AST 索引 |
| 工时权限 | TrustModel 动态调权 | 无内核级 sandbox | 考虑 Landlock/seccomp 集成（Linux 环境） |
| UI | CLI + TUI talk mode | 无 IDE 插件 | 先打磨 CLI/TUI 体验，IDE 插件延后 |
| 安全治理 | 三柱架构 | 无 hooks 外部化、无内核 sandbox | Hooks 层 + sandbox 层补齐 |
| 子 Agent | 无 | 无子 Agent 机制 | 基于 git worktree 隔离 + TrustModel 权重继承 |
| 配置互操作 | 全套 .md/.json/.txt | 无 AGENTS.md | 产出 AGENTS.md 标准支持 |
| 缓存经济 | 无 | 无 prefix cache 优化 | talk 模式长会话缓存策略 |

---

## 七、新概念注入建议

### 7.1 Harness 深化

当前 Cortex 的 harness 是 **三柱架构（ConfirmGate + TrustModel + ManifoldGate）** + Scheduler + AgentPool。建议从 Claude Code 的 13 原则中引入：

- **Append-only durable state**：所有关键决策记录为 append-only log，支持审计回溯
- **Graceful recovery**：Agent 失败后的自动恢复策略（而非静默失败）
- **Isolated subagent boundaries**：子 Agent 在独立 git worktree 中运行，互不污染
- **Context as scarce resource**：为 talk 模式设计上下文空间管理策略（但不违反反压缩退化原则——可以用"对话历史沉淀为记忆条目"替代 compaction）

### 7.2 技能系统深化

- **兼容 SKILL.md 格式**：在 .claude/skills 和 .agents/skills 目录下发现技能，与 Claude Code/DeepSeek TUI/OpenClaw 共享生态
- **技能按需加载**：仅注入技能摘要到初始上下文，模型调用 load_skill 时才加载完整内容（OpenClaw 模式）
- **技能与 hooks 分离**：Skills = "怎么做"（知识注入），Hooks = "能不能做"（策略拦截）

### 7.3 记忆系统深化

- **三段式记忆架构**（借鉴 LangChain 上下文工程）：
  - 语义记忆（Semantic）：事实、知识、长期偏好 → 当前 cyrene-memory.db + SearchMemory
  - 情节记忆（Episodic）：过去的对话和经验 → 新增会话历史归档
  - 程序记忆（Procedural）：如何执行特定任务的指令 → 当前 Skills 系统
- **上下文空间管理**：不压缩人格信息（宪法第17条硬约束），但压缩已完成的代码变更和历史工具调用记录
- **AGENTS.md**：新增项目级 AGENTS.md，存储"这个项目 AI 应该知道的一切"

### 7.4 权限抽象深化

- **Hooks 层**（借鉴 Claude Code）：在 ConfirmGate 之上加 hooks，让治理规则从"内建逻辑"变为"外部可编程策略"
- **Sandbox 层**（借鉴 Codex）：可选择性地对高风险操作启用 sandbox 执行
- **Per-agent 权限配置**（借鉴 Cursor 3）：不同 Agent 有不同的工具权限和审批策略

---

## 八、结语

六款工具在 2026 年 5 月的状态揭示了一个清晰的产业趋势：**AI 编程框架的核心竞争不再是"谁写代码更快"，而是谁能让 Agent 更可信地自主运行**。

Cortex 的差异化——三柱治理架构 + 独立人格层 + FSM 编译器——在这个趋势中占据了一个独特的位置：它是目前唯一一个把"信任"作为第一性原理来工程化的系统，而不仅仅是功能层面的安全措施。

同时，Claude Code 的 13 原则提供了最完整的设计哲学基准，Codex 的内核 sandbox 展示了安全边界的最强形态，Cursor 3 证明了 Agent 工作空间管理的产品可行性，DeepSeek TUI 和 Reasonix 则提供了"模型特化型 harness"的工程范本。

融百家所长不是为了复制——是为了知道自己的短在哪里，以及补这些短需要多少行代码、改哪些文件。

---

> 调研日期：2026-05-31
> 关键数据源：
> - Claude Code 架构分析：ArXiv 2604.14228v1 (VILA Lab, MBZUAI / UCL)
> - Agent Harness 论文：ArXiv 2605.18747 (UIUC / Meta / Stanford)
> - OpenClaw 架构：freeCodeCamp 深度指南 + OpenClaw 系统架构概述
> - DeepSeek TUI：Verdent AI 详解 (v0.8.8, 37 releases)
> - DeepSeek Reasonix：Verdent AI Builder Guide + Totalum 对比评测
> - Cursor 3：Digital Applied 深度评测
> - Codex vs Claude Code：Blake Crosley 架构对比 + Zack Proser 日常使用评测
> - MCP 安全分析：ArXiv 2601.17549
