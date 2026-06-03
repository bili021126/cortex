# Cortex Monorepo — skills/ & prompts/ 清单与引擎加载机制

> 生成日期：2026-06-12
> 范围：`D:\cortex` 根目录下的 `skills/`、`prompts/` 及引擎加载源码分析

---

## 一、skills/ 目录 — 技能模板库

**位置**: `D:\cortex\skills/`

**规模**: 21 个 JSON 文件，命名模式 `skill-p{编号}-{英文短名}.json`

### 1.1 文件清单

| 文件名 | agentType | 状态 | 采纳/拒绝 |
|--------|-----------|------|-----------|
| `skill-p10-ci-gate-full-cycle.json` | `ops` | trial | 0/0 |
| `skill-p11-skill-crystallization-loop.json` | `loop` | trial | 0/0 |
| `skill-p12-code-review-tiered-defect-report.json` | `review` | trial | 0/0 |
| `skill-p13-file-reconnaissance-inventory.json` | `inspector` | trial | 0/0 |
| `skill-p14-package-migration-to-monorepo.json` | `code` | trial | 0/0 |
| `skill-p15-port-conflict-diagnostic.json` | `fix` | trial | 0/0 |
| `skill-p16-memory-two-phase-commit.json` | `code` | trial | 0/0 |
| `skill-p17-vitest-hierarchical-test-org.json` | `code` | trial | 0/0 |
| `skill-p25-event-payload-map-consistency-audit.json` | `review` | trial | 0/0 |
| `skill-p26-targeted-python-fix-script-generator.json` | `code` | trial | 0/0 |
| `skill-p27-monorepo-package-compliance-scanner.json` | `ops` | trial | 0/0 |
| `skill-p28-claimed-fixed-cross-verification.json` | `review` | trial | 0/0 |
| `skill-p29-agent-tags-overlap-detection.json` | `review` | trial | 0/0 |
| `skill-p30-any-type-leak-scanner.json` | `review` | trial | 0/0 |
| `skill-p31-console-to-observer-migration-audit.json` | `audit` | trial | 0/0 |
| `skill-p32-cross-package-migration-test-fix.json` | `fix` | trial | 0/0 |
| `skill-p33-dual-path-code-dedup-extraction.json` | `refactor` | trial | 1/0 |
| `skill-p34-invariant-reporting-boilerplate-consolidation.json` | `refactor` | trial | 6/0 |
| `skill-p35-double-init-guard-pattern.json` | `fix` | trial | 1/0 |
| `skill-p36-alert-throttle-guard-pattern.json` | `fix` | trial | 1/0 |
| `skill-p37-full-chain-final-acceptance.json` | `ops` | trial | 1/0 |

### 1.2 JSON Schema（SkillTemplate 类型）

每个技能 JSON 遵循以下结构（对应 `@cortex/shared` 中的 `SkillTemplate` 类型）：

```typescript
interface SkillTemplate {
  /** 唯一标识，格式: `skill-p{NN}-{slug}-{timestamp}` 或 `skill-p{NN}-{slug}` */
  id: string;

  /** Agent 类型: "code" | "review" | "ops" | "fix" | "loop" | "inspector" | "audit" | "refactor" */
  agentType: string;

  /** 人类可读名称，如 "P10: CI 门禁全流程" */
  name: string;

  /** 触发标签 — 用于 MetaAgent 匹配 */
  triggerTags: string[];

  /** 自然语言触发条件描述 */
  trigger: string;

  /** 执行步骤数组 — 每步为一段自然语言指令 */
  steps: string[];

  /** 预期产出描述 */
  expectedOutput: string;

  /** 输出文件路径（可选） */
  outputFile?: string;

  /** 技能状态: "trial" | "active" | "draft" | "deprecated" */
  status: "trial" | "active" | "draft" | "deprecated";

  /** 采纳次数 — ≥5 次 trial→active 晋级条件 */
  adoptionCount: number;

  /** 拒绝次数 — ≥3 次 → deprecated */
  rejectionCount: number;

  /** 发现者标识 */
  discoveredBy: string;

  /** 创建时间戳 (ms) */
  createdAt: number;

  /** 标签命中统计（自动维护） */
  tagHits?: Record<string, number>;
}
```

### 1.3 agentType 分布

| agentType | 数量 | 技能 |
|-----------|------|------|
| `code`    | 4    | P14, P16, P17, P26 |
| `review`  | 5    | P12, P25, P28, P29, P30 |
| `ops`     | 3    | P10, P27, P37 |
| `fix`     | 4    | P15, P32, P35, P36 |
| `loop`    | 1    | P11 |
| `inspector` | 1 | P13 |
| `audit`   | 1    | P31 |
| `refactor`| 2    | P33, P34 |

---

## 二、prompts/ 目录 — Agent 提示模板

**位置**: `D:\cortex\prompts/`

### 2.1 目录结构

```
prompts/
├── coding-standards.md          ← 代码法典·核心篇（全量注入所有 Agent）
├── coding-standards-dev.md      ← 开发规范（人类与 AI 协作者守则）
├── coding-standards-governance.md  ← 代码法典·治理篇（注入调度/治理类 Agent）
├── albedo/                      ← Code Agent（阿贝多）
│   ├── system.md                ← 系统提示（角色人格 + 工作守则）
│   └── roundtable.md            ← 圆桌会议角色提示
├── alhaitham/                   ← Data Agent（艾尔海森）
│   ├── system.md
│   └── roundtable.md
├── amber/                       ← Inspector Agent（安柏）
│   ├── system.md
│   └── roundtable.md
├── beidou/                      ← Ops Agent（北斗）
│   ├── system.md
│   └── roundtable.md
├── cyrene/                      ← Butler Agent（昔涟）
│   ├── system.md
│   └── roundtable.md
├── ganyu/                       ← MetaAgent（甘雨）— 特殊，含规划/重规划提示
│   ├── system.md                ← 系统提示
│   ├── planning.md              ← 规划提示（任务拆解与 DAG 生成）
│   ├── replan.md                ← 重规划提示（失败修复决策）
│   └── roundtable.md            ← 圆桌会议角色
├── keqing/                      ← Review Agent（刻晴）
│   ├── system.md
│   └── roundtable.md
├── kuki/                        ← API Agent（久岐忍）
│   ├── system.md
│   └── roundtable.md
├── mona/                        ← Loop Agent（莫娜）
│   ├── system.md
│   └── roundtable.md
├── nahida/                      ← Analysis Agent（纳西妲）
│   ├── system.md
│   └── roundtable.md
├── ningguang/                   ← DocGovern Agent（凝光）
│   ├── system.md
│   └── roundtable.md
├── shuangning/                  ← Strategist Agent（霜凝）— 无双圆桌
│   └── system.md
├── sigewinne/                   ← Fix Agent（希格雯）
│   └── system.md
├── yoimiya/                     ← Browser Agent（宵宫）
│   ├── system.md
│   └── roundtable.md
└── zhongli/                     ← Strategist Agent（钟离）
    ├── system.md
    └── roundtable.md
```

### 2.2 prompt 模板格式

**`system.md`** — 角色人格 + 工作守则
- 头部：角色扮演定义（🎭 + 角色名 + Agent 类型）
- 视觉描述：外貌、衣着、气质
- 角色引言：性格化开门语
- 工作守则：具体的执行规则（每个 Agent 不同）
- 社交区："当旅行者只是来访"的非任务人格

**`roundtable.md`** — 圆桌会议角色
- 角色定义与会议中的定位
- 审视领域说明
- 性格与说话风格描述
- 专长领域列举
- 发言规则（何时发言 / 何时 [PASS]）

**`planning.md`**（仅甘雨）— 规划提示
- 最高原则：时序依赖
- 依赖链规则（children 嵌套表达）
- 可用兵种列表（Agent 类型 → 角色映射）
- 标签匹配规则（关键——标签错误导致节点失败）
- 输出格式（JSON TaskNode 数组）

**`replan.md`**（仅甘雨）— 重规划提示
- 六层框架：情境 → 身份 → 分寸 → 范围 → 信息 → 输出
- 修复节点生成规则

### 2.3 编码规范注入机制

三份编码规范各有用途：

| 文件 | 注入目标 | 说明 |
|------|----------|------|
| `coding-standards.md` | **所有 Agent** | 由 `bootstrapEngine` 自动注入每个 Agent 的 system prompt 头部。含异常处理、变量声明、异步规范、导入路径、控制台输出、代码风格、硬编码禁令等七章 |
| `coding-standards-dev.md` | **人类开发者** | 非注入文件。面向协作者的开发契约，含 15 条次原则 |
| `coding-standards-governance.md` | **Scheduler/MetaAgent/AgentPool/DocGovernAgent/记忆系统** | 注入治理/调度类 Agent。含 Agent 权限、记忆系统、Agent 生命周期、测试规范、治理记录、调度策略、循环方式、Agent 交互、MetaAgent 策略、架构定位、Harness 四层架构、技能系统闭环等 12 章 |

注入代码路径：`packages/engine/src/bootstrap/load-config.ts` 的 `injectStandards()` 函数——将编码规范文本 prepend 到 Agent 的 system prompt 前。

---

## 三、引擎加载机制

### 3.1 启动流水线（bootstrapEngine）

`packages/engine/src/bootstrap/bootstrap-engine.ts` 定义 10 步启动流水线：

```
loadConfig             → 加载 cortex-agents.json（含 prompt 文件引用）
  ↓
configAndInject        → 注入运行时注册表 + 工具元数据 + 编码规范
  ↓
createEngineCore       → observer, pool, gate, cliAdapter, board
  ↓
createSpecialAgents    → MetaAgent（甘雨）+ Strategist（钟离）
  ↓
createScheduler        → 调度器
  ↓
initMemoryStore        → 记忆存储
  ↓
initConsistencyLayer   → 一致性层
  ↓
registerAgents         → 按配置创建并注册所有 Agent
  ↓
initSkillSystem        → 技能系统初始化（核心关注点）
  ↓
assemble               → 组装返回结果
```

### 3.2 Prompt 加载机制

`packages/factory/src/loaders/agents.loader.ts` 的 `loadAgentsConfig()`：

1. **读取 `cortex-agents.json`**：从项目根目录 JSON 解析
2. **Agent 字段校验**：每个 agent 必须有 `type` / `role` / `produces` / `model` / `key`；且至少包含 `systemPrompt` 或 `systemPromptFile`
3. **解析 prompt 文件引用**（`_resolvePromptFiles` 函数）：
   - `systemPromptFile` → 读取文件内容，写入 `systemPrompt` 字段
   - `roundtable.personaPromptFile` → 读取文件内容，写入 `roundtable.personaPrompt` 字段
   - `planningPromptFile` → 读取文件内容，写入 `planningPrompt` 字段（仅甘雨）
   - `replanPromptFile` → 读取文件内容，写入 `replanPrompt` 字段（仅甘雨）

`cortex-agents.json` 中定义的 Agent 及其 prompt 文件引用：

| Agent ID | 类型 | systemPromptFile | roundtable 文件 | 特殊 prompt |
|----------|------|-----------------|-----------------|-------------|
| albedo | code | prompts/albedo/system.md | prompts/albedo/roundtable.md | — |
| keqing | review | prompts/keqing/system.md | prompts/keqing/roundtable.md | — |
| nahida | analysis | prompts/nahida/system.md | prompts/nahida/roundtable.md | — |
| beidou | ops | prompts/beidou/system.md | prompts/beidou/roundtable.md | — |
| mona | loop | prompts/mona/system.md | prompts/mona/roundtable.md | — |
| ningguang | doc-govern | prompts/ningguang/system.md | prompts/ningguang/roundtable.md | — |
| sigewinne | fix | prompts/sigewinne/system.md | — | — |
| kuki | api | prompts/kuki/system.md | prompts/kuki/roundtable.md | — |
| alhaitham | data | prompts/alhaitham/system.md | prompts/alhaitham/roundtable.md | — |
| amber | inspector | prompts/amber/system.md | prompts/amber/roundtable.md | — |
| yoimiya | browser | prompts/yoimiya/system.md | prompts/yoimiya/roundtable.md | — |
| cyrene | butler | prompts/cyrene/system.md | prompts/cyrene/roundtable.md | — |
| ganyu | meta | prompts/ganyu/system.md | prompts/ganyu/roundtable.md | planningPromptFile + replanPromptFile |
| zhongli | strategist | prompts/zhongli/system.md | prompts/zhongli/roundtable.md | — |
| shuangning | strategist | prompts/shuangning/system.md | — | — |

### 3.3 技能系统初始化（initSkillSystem）

`packages/engine/src/bootstrap/init-skills.ts` 实现完整的技能系统启动：

1. **创建 SkillRegistry**：内存注册表，三重索引（byTag / byAgent / byId）
2. **创建 SkillExecutor**：执行引擎，支持标签匹配、技能注入、反馈记录
3. **注册技能持久化管线**（`registerSkillPipeline`）：
   - 监听 Scheduler 的 NodeComplete 事件 → 自动提取技能
4. **MetaAgent 注入**：`metaAgent.setSkillRegistry(skillRegistry)`—规划时查询技能
5. **从 MemoryStore 恢复技能**（优先路径）：
   - `loadSkillsFromMemory(memory)` → 读取 `kind: "Skill"` 且 `state: "Active"` 的记忆
   - 调用 `skillRegistry.registerAll(loadedSkills)`
6. **JSON 文件冷启动兜底**（弃用路径）：
   - 当 MemoryStore 为空时，从 `.cortex/skills-crystallized.json` 恢复
   - 后续版本将移除此路径

### 3.4 SkillRegistry 实现

`packages/engine/src/registry/skill-registry.ts`：

- **三重索引**：`_byTag` (Map<Tag, SkillTemplate[]>) / `_byAgent` (Map<AgentType, SkillTemplate[]>) / `_byId` (Map<string, SkillTemplate>)
- **注册**：id 去重（先 unregister 再 register），同时更新全部索引
- **查询**：`queryByTags(tags)` — 交集匹配（skill.triggerTags ∩ queryTags ≠ ∅），仅返回 `active` 或 `trial` 状态
- **序列化**：`toJSON()` / `fromJSON()` / `loadJson()` / `saveJson()` — 支持持久化
- **批量注册**：`registerAll(templates)` — 来自 MemoryStore 恢复

### 3.5 SkillExecutor 执行引擎

`packages/engine/src/core/skill-executor.ts`：

- **`matchSkill(tags)`**：最佳匹配排序规则：`active > trial > draft`，同状态按 `adoptionCount` 降序
- **`injectSkillContext(skillId)`**：将技能步骤格式化为可注入 Agent system prompt 的文本块
- **`injectByTags(tags)`**：组合 match + inject，供 MetaAgent 规划阶段使用
- **`recordFeedback(skillId, adopted)`**：
  - 采纳：`adoptionCount++`，连续 5 次 `trial → active`
  - 拒绝：`rejectionCount++`，连续 3 次 `→ deprecated`
  - 状态变更时触发持久化回调（MemoryStore + 知识结晶）
- **`validate(skillId)`**：检查 id/name/triggerTags/trigger/steps 完整性
- **`diagnoseGhostTags(skillId)`**：检测标签健康度（幽灵标签检测）

### 3.6 技能沉淀闭环

完整闭环（`packages/engine/src/components/skill-persister.ts`）：

```
Agent 执行 → Scheduler 完成节点
  → PipelineObserver 触发 NodeComplete 事件
  → SkillPipeline 订阅事件 → 技能提取
  → SkillRegistry.registerAll()
  → persistSkillsToMemory() → MemoryStore (MemoryType.Skill)
  → (可选) 结晶为知识: crystallizeSkillToKnowledge()
    → 先 verifySkillKnowledge()（内部情景记忆 + 外部 web_search 双重验证）
    → 写入 MemoryType.Knowledge，版本追踪，证据链链接
```

**文件回溯扫描**（`scanOutputFilesForSkills`）：
- 扫描 pattern*.md / design*.md / review*.md / audit*.md / architecture*.md
- 深度 ≤ 6，跳过 node_modules 和隐藏目录
- 提取策略优先级：JSON 块 → P0-P9 段落 → 模式段落 → 文件标题兜底

### 3.7 可执行技能系统（Executable Skill Registry）

除了上述 JSON 技能模板，引擎还有第二套技能系统：

`packages/engine/src/registry/executable-skill/`：

- `DefaultSkillRegistry` — 完整注册表实现（支持依赖图、中间件、生命周期）
- `Skill` 接口 — `run(context)` / `validate(input)` / `onInit()` / `onDestroy()`
- 内置技能：`EchoSkill` / `CalculatorSkill` / `RegistryInfoSkill`

这是 **Core-2 规划中的可执行技能**，目前内置技能仅用于测试验证，尚未接入主循环。

---

## 四、关键数据流总结

### 技能数据流

```
skills/*.json (21 个 JSON 模板)
    ↓ (暂未自动加载 — 等待 LoopAgent 扫描沉淀)
MemoryStore (kind: "Skill")
    ↓ loadSkillsFromMemory()
SkillRegistry (内存三重索引)
    ↓ MetaAgent 规划时 queryByTags()
SkillExecutor.matchSkill() / injectByTags()
    ↓ 匹配结果注入 Agent system prompt
Agent 执行节点
    ↓ NodeComplete 事件
SkillPipeline 自动提取
    ↓ 新技能写入 MemoryStore (闭环)
```

### Prompt 数据流

```
prompts/{agent}/*.md
    ↓ cortex-agents.json 引用 systemPromptFile
packages/factory (agents.loader.ts _resolvePromptFiles)
    ↓ readFileSync 读入内存
AgentDefinition.systemPrompt (含角色 + 编码规范注入)
    ↓ injectStandards() prepend coding-standards.md
最终 system prompt (编码规范 + 角色定义 + 工作守则)
    ↓ 传给 Agent 工厂 createAgent()
ReActContext.systemPrompt → LLM → Agent 执行
```

---

## 五、关键文件索引

| 文件路径 | 职责 |
|---------|------|
| `skills/*.json` | 21 个 JSON 格式技能模板 |
| `prompts/*/system.md` | 15 个 Agent 系统提示（角色人格+工作守则） |
| `prompts/*/roundtable.md` | 13 个 Agent 圆桌会议角色提示 |
| `prompts/ganyu/planning.md` | MetaAgent 规划提示（任务拆解+标签规则） |
| `prompts/ganyu/replan.md` | MetaAgent 重规划提示（失败修复决策） |
| `prompts/coding-standards.md` | 代码法典核心篇（全量注入所有 Agent） |
| `prompts/coding-standards-dev.md` | 开发规范（人类协作者守则） |
| `prompts/coding-standards-governance.md` | 代码法典治理篇（注入调度/治理 Agent） |
| `cortex-agents.json` | Agent 定义主配置（prompt 文件引用+工具权限+路由） |
| `packages/engine/src/bootstrap/bootstrap-engine.ts` | 引擎启动流水线编排 |
| `packages/engine/src/bootstrap/init-skills.ts` | 技能系统初始化 |
| `packages/engine/src/bootstrap/load-config.ts` | 配置加载 + 编码规范注入 |
| `packages/engine/src/registry/skill-registry.ts` | SkillRegistry 三重索引实现 |
| `packages/engine/src/core/skill-executor.ts` | 技能匹配/注入/反馈引擎 |
| `packages/engine/src/components/skill-persister.ts` | 技能 ↔ MemoryStore 双向持久化 |
| `packages/engine/src/registry/executable-skill/` | 可执行技能系统（Core-2 规划） |
| `packages/factory/src/loaders/agents.loader.ts` | cortex-agents.json 加载+prompt 文件解析 |
