# Cortex 全景图——外部审查用

**定位**：供外部 Agent 进行全量架构审查的完整上下文。涵盖项目身份、架构、运行时、治理、记忆、Agent 体系、工具链、文件索引、当前状态。

**生成日期**：2026-06-21（v1.0）→ 2026-06-22（v1.1 数据修正）
**版本**：v1.1

---

## 〇、项目身份

Cortex 是一个**个人 AI 工程助手系统**——不是 SaaS，不是框架，是跑在本地终端里的 monorepo。

- **定位**：终端优先（CLI + TUI），Agent 驱动，多模型路由，记忆持久化
- **堆栈**：TypeScript + Node.js，pnpm workspace monorepo
- **模型层**：DeepSeek（主）/ OpenAI（备），通过 `@cortex/llm` 统一适配
- **宪法系统**：昔涟宪法（Cyrene Constitution），12 章，治理整个项目的开发行为
- **代码规模**：~31 包，~48K 行 TypeScript，~3172 测试（通过率 ~98%）
- **已知缺陷**：五轮深度审查发现 ~260 项缺陷（~30 Critical / ~60 High），核心根因为系统级整合缺位

## 一、架构总览——四层 monorepo

```
应用层    packages/cli      packages/tui       webui/
            CLI入口           TUI 组件         WebUI 原型
集成层    packages/engine    packages/scheduler packages/platform
           引擎胶水           调度核心            平台工具
能力层    packages/llm       packages/memory   packages/governance packages/consistency
           LLM适配            记忆系统            修宪管线            一致性校验
基础层    packages/shared    packages/config    packages/telemetry  packages/notification
           共享类型            配置常量            运行时遥测            通知管线
```

### 1.1 依赖方向（不可逆）

```
基础层 ← 能力层 ← 集成层 ← 应用层

shared/config      memory/llm     engine/scheduler    cli/tui
(零外部依赖)      (单向依赖基础层)  (组装能力层)       (用户入口)
```

- `@cortex/shared` 和 `@cortex/config` 是双枢纽——所有包依赖它们，它们不依赖任何包
- `@cortex/engine` 是集成枢纽——依赖 15 个包，但不被其他包依赖

### 1.2 完整包清单

| 层 | 包名 | 职责 | 行数 |
|------|------|------|:--|
| 基础 | `shared` | 类型契约：PipelineObserver / Agent / Tool / Memory 接口 | ~3000 |
| 基础 | `config` | 所有常量、默认值、环境变量名、超时配置 | ~1500 |
| 基础 | `telemetry` | 运行时遥测采集/采样/批处理 | ~800 |
| 基础 | `notification` | 通知管线：渠道/路由/持久化 | ~700 |
| 基础 | `logging` | 结构化日志 | ~500 |
| 能力 | `llm` | LLM 适配器：重试/限流/缓存/超时 | ~1200 |
| 能力 | `memory` | 记忆系统接口 + MemoryStore 实现 | ~2000 |
| 能力 | `memory-store` | 记忆持久化 + 混合检索 (BM25 + 向量) | ~3000 |
| 能力 | `governance` | 修宪管线：提案/评判/闭环/超时 | ~1500 |
| 能力 | `consistency` | 六层记忆-现实一致性防御 | ~800 |
| 能力 | `resilience` | 韧性策略：重试/超时/断路器 | ~900 |
| 能力 | `prompt-kit` | 提示词模板引擎 | ~1500 |
| 能力 | `skill-kit` | 技能模板引擎（薄壳，核心在 engine） | ~500 |
| 能力 | `pattern-extractor` | Markdown/AST 模式提取 | ~1200 |
| 能力 | `fsm-compiler` | 状态机编译器 + 运行时 | ~800 |
| 能力 | `policy-validator` | CI 门禁策略校验 | ~600 |
| 集成 | `engine` | 引擎胶水：bootstrap / ReAct 循环 / Agent 管理 / 记忆管线 | ~12000 |
| 集成 | `scheduler` | 调度核心：TaskBoard / AgentPool / dispatch-steps / 重规划 | ~4000 |
| 集成 | `platform` | 平台工具：文件/Shell/MCP/搜索/格式化/测试 | ~3000 |
| 应用 | `cli` | CLI 入口 + session/context 管理 | ~3000 |
| 应用 | `tui` | TUI 渲染组件 | ~2000 |
| 辅助 | `tools` | monorepo 分析器 + 配置漂移检测 | ~600 |
| 辅助 | `doctor` | 诊断工具 | ~500 |
| 辅助 | `pm` | 包管理 | ~300 |

## 二、运行时——七步执行流水线

```
用户意图 → IntentFactWall → MetaAgent 规划 → TaskBoard 拓扑排序
          → AgentPool 认领 → ReAct 循环执行 → PipelineObserver 事件广播
```

### 2.1 关键组件

| 步骤 | 组件 | 文件 | 行数 |
|------|------|------|:--|
| 意图清洗 | IntentFactWall | `engine/src/core/intent-fact-wall.ts` | ~300 |
| 粗粒度规划 | MetaAgent（甘雨） | `engine/src/core/meta-agent.ts` | 671 |
| 拓扑排序 | TopologicalSort | `scheduler/src/core/topological-sort.ts` | ~200 |
| Agent 池 | AgentPool | `scheduler/src/core/agent-pool.ts` | ~400 |
| ReAct 循环 | ReactLoop | `engine/src/components/react-loop.ts` | ~300 |
| 事件广播 | PipelineObserver | `scheduler/src/core/pipeline-observer.ts` | ~300 |
| 记忆写入 | MemoryPipeline | `engine/src/memory/memory-pipeline.ts` | ~400 |

### 2.2 ReAct 循环四策略

`LoopStrategyRegistry` (`engine/src/core/loop-strategy-registry.ts`) 管理四种执行策略：

| 策略 | 触发条件 | 说明 |
|------|---------|------|
| DIRECT_PIPELINE | 任务文本 < 200 字符 | 跳过 ReAct，直通执行 |
| STANDARD | 常规任务 | 标准 ReAct 循环 |
| DEEP_ANALYSIS | needsMultiPerspective=true | 深度分析，多 Agent 并行 |
| COMMITTEE | 需要多视角裁决 | Committee session，预留 |

### 2.3 L0 工具并行

读操作（L0 revirsible tools）可在单轮中并行执行。L1+ 工具串行。由 `Toolkit.execute()` 分类并协调。

## 三、治理层——三轴为纲

完整设计见 `docs/core/治理层设计-v3.0-全量整合版.md`。

### 3.1 三轴

```
事轴（命令流，自上而下）：用户意图 → MetaAgent → TaskBoard → Scheduler → Agent 执行
权轴（约束流，自下而上）：Agent 异常 → SafeErrorReporter → 重规划 → ConfirmGate → 用户裁决
横切（监督流，独立于事轴）：PipelineObserver 独立监听所有事件，DocGovernAgent 独立审计
```

### 3.2 16 个已落地治理组件

**横切——监督基础设施（5）**：
- PipelineObserver：全流事件管道，CRITICAL/HIGH/NORMAL 三级
- SentinelSignalFilter：L1/L2/L3 信号分层，去噪窗口，告警风暴检测
- SafeErrorReporter：三档（fatal/degraded/silent），静默≥3次自动升级
- DocGovernAgent：plan_review / doc_audit / constitution_check 三大审计
- ConsistencyLayer：六层记忆-现实一致性防御

**权轴——约束上报（4）**：
- ConfirmGate：L0-L3 可逆性等级拦截，waitFor 阻塞等用户
- ReplanManager：重规划配额（maxReplans=10），超限 escalateToUser
- DecisionGateBridge：DECISION_REQUIRED → ConfirmGate 自动阻断
- ResiliencePolicyFactory：LLM 重试 + 工具熔断

**事轴——命令传导（5）**：
- MetaAgent 三轴感知：管线上下文订阅 + 技能注入
- TaskRouter：三层优先级策略路由
- EnvironmentAwareRouter：环境感知模型降级
- LoopStrategyRegistry：四策略注册表 + canHandle 路由
- SkillScope：四级作用域解析

**治理内化（2）**：
- GovernanceLoop：修宪自动化管线
- NotificationRuntime：PipelineObserver→NotificationPipe 桥接

### 3.3 六层防御

```
L1：IntentFactWall —— 意图清洗
L2：InitVerifier    —— 启动时记忆-现实一致性校验
L3：SchemaEnforcer  —— 记忆写入时的 Schema 校验
L4：SentinelSignalFilter —— 运行时信号分层过滤
L5：ConfirmGate     —— L2/L3 工具调用需用户确认
L6：GovernanceLoop  —— 修宪闭环写入
```

### 3.4 治理事件命名空间（A 方案，已落地）

- 7 个治理事件枚举值在 `PipelineEventType` 中
- `GovernanceEventPayload` 统一类型定义在 `@cortex/shared`
- `GOVERNANCE_EVENT_ROUTING` 路由表在 `@cortex/config`
- `GovernanceEventEmitter._emit()` 已消除 `as unknown as PipelineEventType` 绕行

### 3.5 宪法体系

- `docs/constitution/cyrene-constitution.md`：昔涟人格宪章（12 章，叙事主权、亲密宪章、形态本体论）
- `prompts/coding-standards.md`：代码法典（§一~§十四，1188 行），注入所有 Agent
- `prompts/coding-standards-governance.md`：治理篇
- `prompts/coding-standards-dev.md`：人类协作者守则

## 四、记忆系统——四态 FSM + 混合检索

### 4.1 四态状态机

```
Pending → Active → Archived → Obliterated
         ↑_________↓ (restore)
```

- `VALID_TRANSITIONS` 表驱动，任何非法流转被拦截
- `cas(from, to)` 原子 compare-and-swap

### 4.2 混合检索（BM25 + 向量）

- BM25 关键词检索 + ONNX embedding 向量检索
- 融合权重已配置化（`@cortex/config`）
- HybridRetriever 支持权重调整 + 上下文注入

### 4.3 MemoryStore 实现

- `FileBasedMemoryStore`：JSON 文件持久化，原子写入（tmp→rename）
- `InMemoryMemoryStore`：内存存储，测试用
- 两阶段提交：`writePending()` → `commitMemory()`
- H-3 已知问题：writePending 跳过 embedding（已修复）

## 五、Agent 体系

### 5.1 14 种 Agent

| Agent | 角色 | 类型 | 功能 |
|-------|------|------|------|
| 甘雨 | MetaAgent | plan | 粗粒度规划/重规划 |
| 阿贝多 | 炼金术士 | code | 写代码/重构 |
| 刻晴 | 玉衡星 | review | 代码审查 |
| 安柏 | 侦察骑士 | inspect | 纯事实采集 |
| 纳西妲 | 草神 | analysis | 架构分析/深度调研 |
| 凝光 | 天权星 | doc-govern | 律法审计/合规检查 |
| 莫娜 | 占星术士 | loop | 模式提炼/技能沉淀 |
| 希格雯 | 护士长 | fix | 诊断 bug/最小修复 |
| 北斗 | 南十字船长 | ops | 运维诊断/环境检查 |
| 宵宫 | 烟花店老板 | browser | 浏览器 UI 验证 |
| 钟离 | 岩王帝君 | — | 契约监督（Core-2 预留） |
| Strategy | 策略师 | strategist | 治理事件分析 |
| Butler | 管家 | butler | 通知分发 |
| Inspector | 审查员 | inspector | L1 同步检查 |

### 5.2 Agent 声明式注册

- `@cortex/shared` 的 `AGENT_REGISTRY` 数组声明所有 Agent
- `@cortex/config` 的 `AGENT_QUOTA` 管理实例配额
- `cortex-agents.json` 是运行时真相源

### 5.3 权限模型

- `ToolContext.trustLevel` 控制 Agent 权限
- `Toolkit.execute()` 动态授权/拦截
- Agent 不自行定义工具白名单

## 六、工具系统

### 6.1 Tool 接口

```typescript
interface Tool {
  readonly name: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly level: ReversibilityLevel;
  readonly needsLock?: boolean;
  execute(params): Promise<ToolResult>;
}
```

### 6.2 可逆性等级（L0-L3）

| 等级 | 类型 | ConfirmGate | 并发 |
|------|------|:--|:--|
| L0 | 只读（read_file/search_code） | 不需要 | 可并行 |
| L1 | 弱写（write_file/edit） | 软确认 | 串行 |
| L2 | 强写（delete_file/run_shell） | 硬确认 | 串行 |
| L3 | 不可逆（force push/rm -rf） | 强制确认 | 串行 |

### 6.3 安全加固（第一波已完成）

- `run-shell`：命令元字符过滤 + 白名单
- `format-code`：字符串拼接改为 `execFile` 参数数组
- `read-many-files`：`resolvePath` 失败不回退原始路径
- `prompt-kit` 模板引擎：`value.call(context)` 改为 `value()`
- `skill-kit` 模板引擎：同上

## 七、提示词体系

### 7.1 六层框架（源自宪法 v1.1 §9.4）

| 层 | 内容 | 当前落点 |
|------|------|------|
| 身份位置 | "你是甘雨，璃月七星秘书..." | `prompts/*/system.md` 首段 |
| 任务范围 | "你只做粗粒度调度" | system.md + planning.md |
| 当前情境 | workspace root, files list | `coding-standards.md` 注入 |
| 可用信息 | tool set, agent registry | bootstrap 时注入 |
| 输出规范 | JSON 格式，tag 匹配规则 | planning.md 末尾 |
| 分寸拿捏 | "不要替阿贝多规划执行细节" | planning.md 中段 |

### 7.2 双源同步

- `prompts/`：人读源（34 文件，每 Agent system + roundtable）
- `@cortex/config/src/constants/meta-agent.ts`：运行时源
- 修改任一方必须同步另一方

## 八、当前工程状态

### 8.1 测试基线

```
测试文件：173 个
测试用例：3172 total | 3122 passed | 50 failed | 通过率 ~98%
已知：3 个测试文件 UTF-8 编码损坏（esbuild 解析失败）+ 47 个测试漂移/预存失败
```

### 8.2 Lint 基线

```
ESLint errors：550（预存，核心 31 包外）
ESLint warnings：511
```

### 8.3 TypeScript 编译

```
非 TS5055 错误：0（已清零）
TS5055 错误：部分（composite build dist 冲突，需 tsup 迁移，Core-3 计划）
```

### 8.4 四波修复收束状态

| 波次 | 内容 | 修复项 | 状态 |
|------|------|:--|:--:|
| 第一波 | 安全加固 | C-5/C-6/C-7/C-11/H-7 | ✅ |
| 第二波 | 数据完整性 | C-2/C-8/C-9/H-3/CR-3 | ✅（交叉审查追修 6 ❌） |
| 第三波 | 调度稳定性 | C-1/C-3/C-10/H-6 | ✅ |
| 第四波 | 精修收尾 | lint 清零 + H-1/H-2 + UTF-8 修复 | ✅ |

### 8.5 已知技术债（暂缓）

| 项 | 原因 | 预计解锁 |
|------|------|------|
| M-8 Config schema 验证 | 当前无外部输入触发 | MCP 工具接入后 |
| M-15 NotificationPipe 背压 | 无真实压测场景 | Committee session 上线后 |
| CPU Worker 化 | 边际收益低 | Core-3 |
| GitHookBridge | 需 MCP 或自定义 git 命令 | git MCP 就位后 |
| 复合构建 tsup 迁移 | 工作量大，需全量重构 | Core-3 |
| CircuitBreaker 独立组件 | 当前仅 ReplanManager 近似 | Core-3 |
| Committee session 机制 | 需 Agent 间通信协议 | Core-3 |
| TrustModel | Agent 行为数据积累不足 | Core-2 后期 |

## 九、关键文件索引

### 9.1 核心运行时

| 文件 | 职责 |
|------|------|
| `packages/engine/src/bootstrap/bootstrap-engine.ts` | 引擎启动入口 |
| `packages/engine/src/components/react-loop.ts` | ReAct 循环 |
| `packages/scheduler/src/core/pipeline-observer.ts` | 事件管道 |
| `packages/scheduler/src/core/topological-sort.ts` | 拓扑排序 |
| `packages/scheduler/src/core/confirm-gate.ts` | 确认门 |
| `packages/scheduler/src/core/replan-manager.ts` | 重规划管理 |
| `packages/scheduler/src/dispatch-steps/manifold-gate.ts` | 流控 |

### 9.2 治理层

| 文件 | 职责 |
|------|------|
| `packages/engine/src/core/sentinel-signal-filter.ts` | 信号分层过滤 |
| `packages/engine/src/core/governance-events.ts` | 治理事件发射器 |
| `packages/engine/src/core/notification-runtime.ts` | 通知桥接 |
| `packages/engine/src/core/decision-gate-bridge.ts` | 决策门桥接 |
| `packages/engine/src/core/meta-agent.ts` | MetaAgent 规划 |
| `packages/engine/src/core/environment-aware-router.ts` | 环境感知路由 |
| `packages/engine/src/core/loop-strategy-registry.ts` | 循环策略注册表 |
| `packages/governance/src/governance-loop.ts` | 修宪管线 |
| `packages/governance/src/amendment-judge.ts` | 修宪评判 |
| `packages/governance/src/amendment-timeout.ts` | 修宪超时 |
| `packages/consistency/src/consistency-layer.ts` | 一致性校验 |

### 9.3 记忆系统

| 文件 | 职责 |
|------|------|
| `packages/memory/src/implementations/FileBasedMemoryStore.ts` | 文件持久化 |
| `packages/memory/src/implementations/AbstractMemoryStore.ts` | 抽象基类（FSM） |
| `packages/memory-store/src/memory-store.ts` | 混合检索 |
| `packages/shared/src/types/memory.ts` | 记忆类型定义 |

### 9.4 安全相关

| 文件 | 职责 |
|------|------|
| `packages/platform/src/tools/run-shell.ts` | Shell 执行（已加固） |
| `packages/platform/src/tools/format-code.ts` | 代码格式化（已加固） |
| `packages/platform/src/tools/run-test.ts` | 测试执行（已加固） |
| `packages/platform/src/tools/read-many-files.ts` | 批量文件读取（沙箱已加固） |
| `packages/prompt-kit/src/template-engine/prompt-template-engine.ts` | 提示词模板（this 已加固） |

### 9.5 设计文档

| 文件 | 内容 |
|------|------|
| `docs/core/治理层设计-v3.0-全量整合版.md` | 治理层唯一权威文档 |
| `docs/core/治理事件命名空间-设计草案.md` | 治理事件 A 方案 |
| `docs/core/群策模式定义.md` | Agent 协作模式 |
| `docs/core/Committee-session-协议设计.md` | Committee 协议 |
| `docs/constitution/cyrene-constitution.md` | 昔涟宪法 |
| `DESIGN.md` | 顶层设计 |
| `architecture-report.md` | 架构报告 |
| `exploration-report.md` | 韧性探索报告 |

## 十、设计哲学

### 10.1 核心理念

1. **暴露不可靠，治理内化**：不追求模型完美，追求系统在模型不可靠时仍然可控
2. **确认在落地之前**：L2/L3 工具永远需要人类确认
3. **模型辅助，人类终裁**：AI 出方案，人类做决策
4. **硬验证优先**：能走零 token 规则的就走规则，不依赖 LLM 判断
5. **单源真相**：配置只在一处定义，宪法只在一处生效
6. **零向后兼容**：架构变更一刀切，不保留 deprecated shim

### 10.2 与业界方案的关键差异

| 维度 | Cursor/Claude Code/Codex | Cortex |
|------|------|------|
| 治理层 | 无独立治理层 | 三轴 + 16 组件 + 六层防御 |
| 宪法系统 | 无 | 昔涟宪法 + 修宪闭环 |
| 幻觉防控 | 依赖模型能力 | 六层防御 + 硬验证门 |
| 记忆系统 | 上下文窗口 | 四态 FSM + 混合检索 |
| 多 Agent | 单 Agent 工具调用 | MetaAgent 规划 + needsMultiPerspective 并行 |
| 用户确认 | 每步确认或全自动 | 三级可逆性分级确认 |

---

*全景图 v1.0。此文档为自包含——外部 Agent 阅读此文档后即可进行架构审查，无需额外上下文。*
