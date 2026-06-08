# @cortex/skill-validator 包定位文档

> 作者：纳西妲（AnalysisAgent）
> 版本：v0.1.0
> 状态：draft

---

## 目录

1. [Q1: 现有体系缺什么？](#q1-现有体系缺什么)
2. [Q2: 定位是什么？](#q2-定位是什么)
3. [Q3: 价值在哪里？](#q3-价值在哪里)
4. [附录：API 设计草案](#附录api-设计草案)

---

## Q1: 现有体系缺什么？

### 1.1 类型覆盖缺口——SkillManifest 与真实 JSON 文件存在字段偏差

当前 `@cortex/skill-kit` 定义了 `SkillManifest` 接口（`packages/skill-kit/src/types.ts`），
但该定义与 `skills/` 目录下 **21 个真实技能 JSON 文件** 之间存在显著差异：

| 字段 | SkillManifest (skill-kit) | 实际 JSON 文件 (skills/*.json) | 缺口 |
|------|--------------------------|-------------------------------|------|
| `adoptionCount` | ❌ 缺失 | ✅ 全部文件必有（值为 0/1/2/6） | `SkillTemplate`（shared）有此字段，`SkillManifest` 无 |
| `rejectionCount` | ❌ 缺失 | ✅ 全部文件必有（全部为 0） | 同上 |
| `tagHits` | ❌ 缺失 | ⚠️ `SkillTemplate` 定义含 `tagHits?: Record<string, number>` | 运行时追踪字段，manifest 可选 |
| `status` | `?: "draft" \| "trial" \| "active" \| "deprecated"`（可选） | ✅ 全部文件为 `"trial"`（必填） | 类型应改为必填 |
| `agentType` | `string`（无约束） | `"ops" \| "loop" \| "review" \| "code" \| "fix" \| "audit" \| "inspector" \| "refactor"` | 缺少 `AgentType` 联合约束 |
| `triggerTags` | `string[]` | 实际值需与 `cortex-agents.json` 中 Agent tags 匹配 | 缺少值域约束 |
| `discoveredBy` | `?: string`（可选） | ✅ 全部文件为 `"mona-pattern-scan"` 或 `"Mona"` | 应改为必填（业务需要追踪来源） |
| `createdAt` | `?: number`（可选） | ✅ 全部文件必有（Unix 毫秒时间戳或 0） | 应改为必填 |

**结论**：`SkillManifest` 类型定义不完整，导致：
- 校验 `skills/*.json` 时漏检 `adoptionCount`/`rejectionCount` 等运维字段
- `agentType` 为自由字符串，无法静态约束为有效的 Agent 类型
- 缺少对实际 JSON 文件字段完整性的断言能力

### 1.2 校验器缺口——现有校验器不针对 JSON manifest

当前 `SimpleSkillValidator`（`packages/skill-kit/src/validator.ts`）的工作流：

```
validateManifest(manifest)
  → 转为 SkillMeta（丢弃 agentType/adoptionCount/rejectionCount 等字段）
  → 校验 SkillMeta 版本/category/description 等字段（JSON 文件常缺这些字段）
  → 校验 agentType 是否非空
  → 返回结果（但未校验 adoptionCount/rejectionCount/tagHits/步骤质量等）
```

**问题**：
1. `validateManifest` 被设计为 `validateMeta` 的适配器，缺乏针对 JSON 格式的特化校验
2. 未校验 `adoptionCount`、`rejectionCount` 等运维字段的数值合法性
3. 未校验 `agentType` 是否为有效的 `AgentType`（应参照 `cortex-agents.json`）
4. 未校验 `triggerTags` 是否与 Agent 标签体系一致
5. 未校验 `steps` 的内容质量（步骤是否过于模糊、是否有可操作性）
6. 不支持跨文件校验（ID 唯一性、agentType 一致性、文件命名规范）
7. 不支持目录级批量校验

### 1.3 生命周期管理缺口

`SkillTemplate`（`packages/shared/src/agent-skill-types.ts`）定义了技能的生命周期字段：

```typescript
status: "draft" | "trial" | "active" | "deprecated";
adoptionCount: number;   // 连续采纳次数（active 后自动清零）
rejectionCount: number;  // 连续拒绝次数（>=3 -> deprecated）
```

但当前体系 **缺少以下能力**：

| 缺失能力 | 影响 |
|---------|------|
| 状态转换规则校验（draft→trial→active→deprecated 的有向图） | 无法防止非法状态跃迁（如 draft→deprecated 跳过 trial） |
| 采纳/拒绝阈值业务规则（rejectionCount ≥ 3 → 自动 deprecated） | 依赖手动感知，无自动化检测 |
| status 与 adoptionCount/rejectionCount 的一致性（active 时 adoptionCount 应清零） | 数据可能不一致 |
| 版本演进语义（createdAt 与 status 的关系，active 技能需有时间锚点） | 无法追踪技能成熟度曲线 |

### 1.4 内容质量校验缺口

现有校验只做**结构校验**（字段存在性、类型正确性），不做**内容校验**：

| 内容维度 | 当前状态 | 应覆盖 |
|---------|---------|--------|
| `steps` 条目可操作性 | ❌ 未校验 | 每步应包含动词开头的可执行指令 |
| `trigger` 描述充分性 | ❌ 未校验 | 应包含触发场景、前置条件、典型上下文 |
| `expectedOutput` 具体性 | ❌ 未校验 | 应包含产出格式、文件路径、输出结构描述 |
| `steps` 中包含占位符一致性 | ❌ 未校验 | `{placeholder}` 应在某处有定义 |
| `outputFile` 模板路径有效性 | ❌ 未校验 | 模板路径中的变量应与上下文匹配 |
| `id` 命名规范合规性 | ❌ 未校验 | 应有统一命名模式（如 `skill-p{N}-{slug}-{timestamp}`） |

### 1.5 跨包职责碎片化

目前技能相关的校验职责分散在三个包中，职责边界模糊：

```
@cortex/shared
  └─ SkillTemplate（定义数据形状，但无校验逻辑）

@cortex/skill-kit
  └─ SimpleSkillValidator.validateManifest（轻量适配器，设计目标非 JSON 特化）

@cortex/engine
  └─ DefaultSkillRegistry（注册时做运行时校验，但逻辑内联在 engine 中）
```

**问题**：
- 校验逻辑散布，无单一真相源
- engine 包承担了其不应该承担的校验职责
- shared 包定义了数据形状但无对应的 schema/validator
- skill-kit 的 validator 对 JSON 格式支持不足

---

## Q2: 定位是什么？

### 2.1 一句话定位

> **`@cortex/skill-validator` 是 monorepo 中「技能 JSON 清单」的专用校验层——为 `skills/*.json` 文件提供端到端的结构校验、内容校验、生命周期校验、跨文件校验和 Schema 导出能力。**

### 2.2 定位边界

```
                    ┌─────────────────────────────────────┐
                    │       技能生态系统 (Skill System)      │
                    ├─────────────────────────────────────┤
                    │                                     │
┌──────────────────┐│  ┌──────────────────────────────┐   │
│  @cortex/shared   ││  │  @cortex/skill-kit            │   │
│  SkillTemplate    ││  │  SkillDefinition (TS 模块)    │   │
│  (数据形状定义)   ││  │  SimpleSkillValidator         │   │
└────────┬─────────┘│  │  (校验 TS 模块格式的完整实现)  │   │
         │          │  └──────────────────────────────┘   │
         │          │                                     │
         ▼          │  ┌──────────────────────────────┐   │
┌──────────────────┐│  │  @cortex/skill-validator      │   │
│  本包定位        ││  │  SkillManifestValidator       │   │
│                  ││  │  (校验 JSON 清单格式的特化)    │   │
│  JSON 清单专用   ││  │  ManifestSchemaValidator     │   │
│  校验层          ││  │  DirectoryValidator           │   │
└──────────────────┘│  │  CrossFileValidator           │   │
                    │  │  LifecycleValidator           │   │
                    │  │  ContentQualityValidator      │   │
                    │  └──────────────────────────────┘   │
                    │                                     │
                    │  ┌──────────────────────────────┐   │
                    │  │  @cortex/engine               │   │
                    │  │  DefaultSkillRegistry          │   │
                    │  │  (运行时注册，依赖校验器结果)  │   │
                    │  └──────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

### 2.3 职责清单

#### ✅ 属于本包职责
- `skills/*.json` 文件的**结构 Schema 校验**（字段存在性、类型、格式）
- `agentType` 对 `cortex-agents.json` 的**值域约束校验**
- `triggerTags` 对 Agent 标签体系的**一致性校验**
- `adoptionCount`/`rejectionCount` 的**数值合法性校验**（非负整数）
- `status` 的**生命周期转换规则校验**（状态机有向图）
- `steps`/`trigger`/`expectedOutput` 的**内容质量校验**（可操作性、描述充分性）
- `id` 的**命名规范校验**（自动提取模式、合规检查）
- 目录级**批量校验**（扫描整个 `skills/` 目录）
- **跨文件校验**（ID 唯一性、agentType 一致性、文件命名无冲突）
- **JSON Schema 文件导出**（生成 `.schema.json` 供 CI/IDE 使用）
- **校验报告输出**（结构化报告，支持 CI 集成）

#### ❌ 不属于本包职责
- `SkillDefinition` 的完整校验（属于 `@cortex/skill-kit`）
- 技能执行逻辑（属于 `@cortex/engine` / `@cortex/skill-kit`）
- 技能动态加载（属于 `@cortex/skill-kit`）
- 技能注册表管理（属于 `@cortex/engine`）
- 技能的运行时性能分析（属于 `@cortex/engine`）

### 2.4 依赖关系

```
@cortex/skill-validator
  ├── 依赖: @cortex/shared（SkillTemplate 类型、AgentType 枚举、Tag 类型）
  ├── 依赖: node:fs / node:path（文件读取）
  ├── 依赖: (可选) ajv / json-schema（高级 Schema 校验）
  └── 被依赖: @cortex/engine（构建时+运行时调用校验）
  └── 被依赖: CI 脚本（pnpm validate:skills 入口）
```

### 2.5 非竞争的清晰边界

本包不取代任何现有包的职责，而是填补它们之间的空白：

| 能力 | skill-kit 保留 | skill-validator 新增 | 说明 |
|------|---------------|---------------------|------|
| `SkillDefinition` (TS 模块) 校验 | ✅ `SimpleSkillValidator.validate()` | ❌ 不涉及 | TS 模块的完整校验留在 skill-kit |
| `SkillMeta` 校验 | ✅ `SimpleSkillValidator.validateMeta()` | ❌ 不涉及 | 元信息校验是 skill-kit 核心能力 |
| JSON 文件结构校验 | ⚠️ 当前有 `validateManifest()` | ✅ 接管并深度特化 | 从 skill-kit 中移出 JSON 特化校验到本包 |
| 内容质量校验 | ❌ 未覆盖 | ✅ 新增 | 全新能力，现有体系完全缺失 |
| 生命周期校验 | ❌ 未覆盖 | ✅ 新增 | 全新能力，现有体系完全缺失 |
| 目录级批量校验 | ❌ 未覆盖 | ✅ 新增 | 全新能力，现有体系完全缺失 |
| JSON Schema 导出 | ❌ 未覆盖 | ✅ 新增 | 全新能力，现有体系完全缺失 |

---

## Q3: 价值在哪里？

### 3.1 直接价值（开发者体验）

| 价值点 | 场景 | 收益 |
|-------|------|------|
| **提交前拦截** | 开发者在 `skills/` 下新增/修改 JSON 后，`pnpm validate:skills` 秒级反馈 | 避免格式错误进入 PR，减少审查轮次 |
| **CI 门禁加固** | CI 流水线中 `@cortex/skill-validator` 作为前置检查步骤 | 阻止不合规的技能定义进入主分支 |
| **IDE 内联提示** | 导出的 `.schema.json` 被 VSCode 识别，编写 JSON 时获得自动补全+校验 | 降低手动查阅字段定义的认知负荷 |
| **One-shot 理解** | 新 contributor 第一次查看 `skills/` 目录时，通过 Schema 快速理解所有字段含义 | 降低项目认知门槛 |

### 3.2 间接价值（系统质量）

| 价值点 | 当前问题 | 解决后状态 |
|-------|---------|-----------|
| **数据一致性** | `adoptionCount`/`rejectionCount` 无校验，可能出现负数/NaN | 所有数值字段强类型约束 + 范围校验 |
| **Agent 类型约束** | `agentType` 为自由字符串，可能写错（如 `"ops"` vs `"op"`） | 自动与 `cortex-agents.json` 中的 AgentType 列表比对 |
| **生命周期合规** | `status` 可随意设置，无状态机约束 | 状态转换有向图校验，`rejectionCount ≥ 3` 自动标记 deprecated |
| **内容质量基线** | `steps` 可能过于模糊（如"检查代码"），`trigger` 可能缺乏触发场景 | 内容质量评分，低于阈值给出 warning |
| **技能资产可发现** | 无法快速知道 skills/ 目录下有多少技能、各是什么状态 | 批量校验报告自动统计技能资产分布 |

### 3.3 架构价值

| 价值点 | 说明 |
|-------|------|
| **职责收敛** | 将分散在 engine/shared/skill-kit 三处的 JSON 校验逻辑统一收束到一个包中，消除「哪个包负责校验」的认知迷雾 |
| **单一真相源** | `@cortex/skill-validator` 包中的 Schema 定义是 `skills/*.json` 的唯一官方规范，其他包通过 dependency 引用 |
| **可组合性** | 校验器可被 engine（运行时注册前）、CLI（手动触发）、CI（自动化门禁）三方独立调用 |
| **可插件化** | 内容质量校验器可插拔替换（如从规则评分切换到 AI 辅助评分），不影响校验管线的其他环节 |
| **Schema 即文档** | 导出的 JSON Schema 文件可直接作为技能文件的类型声明，减少维护独立的 markdown 文档 |

### 3.4 量化收益预估

| 指标 | 当前 | 预期（上线后一个月） |
|------|------|-------------------|
| skills/*.json 格式错误数（/月） | ~5-8 次（人为疏忽） | < 1 次（CI 拦截） |
| agentType 拼写错误数（/月） | ~2-3 次 | 0（自动校验） |
| status 状态不一致数（/月） | ~3 次（手工修改导致） | 0（状态机约束） |
| 新技能添加到 CI 验证的时间 | 手工 review ~5 min/个 | 自动校验 < 0.5 min/个 |
| 技能资产全貌可见性 | 需要手动 `ls skills/` + 逐个打开 | `pnpm validate:skills --report` 一键输出 |

### 3.5 技术债预防

当前 monorepo 有 **21 个技能 JSON 文件**，随着 LoopAgent 持续沉淀新技能，
`skills/` 目录的文件数会持续增长（预期 3 个月内达到 50+ 个）。

不提前建设校验层，将积累以下技术债：

```
┌─ 技能文件增长曲线 ───────────────────────────┐
│                                                │
│  数量                                          │
│  50 ┤                                        ╱   │
│  40 ┤                                    ╱       │
│  30 ┤                              ╱             │
│  20 ┤                        ╱                   │
│  10 ┤            ╱───╱                          │
│   0 ┼──╱──────────────────────────────────       │
│      T0    T1    T2    T3    T4    T5  时间       │
│                                                │
│  ● 当前 21 个技能（无校验 = 可管理）            │
│  ▲ 30+ 技能后（无校验 = 混乱）                  │
│  ■ 50+ 技能后（无校验 = 不可维护）              │
└────────────────────────────────────────────────┘
```

**过早失效** vs **过晚建设的比较**：

| 建设时机 | 成本 | 风险 |
|---------|------|------|
| 现在（21 个文件） | 低 — 2-3 人日 | 低 — 可一次性修正所有现存问题 |
| 30 个文件时 | 中 — 5 人日 | 中 — 需同步修正历史数据 |
| 50 个文件时 | 高 — 10+ 人日 | 高 — 数据不一致已根深蒂固 |

**结论：现在是建设 `@cortex/skill-validator` 的最佳时机——技能数量还少，历史数据可一次性修正。**

---

## 附录：API 设计草案

### 核心接口

```typescript
// ============================================================
// 1. 增强的 SkillManifest（补全缺失字段）
// ============================================================

/** 技能状态——完整生命周期枚举 */
export type SkillStatus = "draft" | "trial" | "active" | "deprecated";

/** 技能清单——对齐实际 JSON 文件的完整定义 */
export interface SkillManifestFull {
  /** 技能唯一标识（如 "skill-p10-ci-gate-full-cycle-1778962384000"） */
  id: string;
  /** 归属 Agent 类型（必须为 cortex-agents.json 中定义的 AgentType） */
  agentType: string;
  /** 展示名称（如 "P10: CI 门禁全流程"） */
  name: string;
  /** 触发标签——与 Agent 标签匹配 */
  triggerTags: string[];
  /** 触发条件描述 */
  trigger: string;
  /** 步骤序列 */
  steps: string[];
  /** 预期产出格式 */
  expectedOutput: string;
  /** 输出文件模板路径（可选，可含 {placeholder}） */
  outputFile?: string;
  /** 技能生命周期状态 */
  status: SkillStatus;
  /** 连续采纳次数（≥0，active 后自动清零） */
  adoptionCount: number;
  /** 连续拒绝次数（≥0，≥3 触发 deprecated） */
  rejectionCount: number;
  /** 提炼者/发现者 */
  discoveredBy: string;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
  /** 标签命中计数（运行时动态追踪，可选） */
  tagHits?: Record<string, number>;
}

// ============================================================
// 2. 校验结果类型
// ============================================================

export interface ManifestValidationResult {
  /** 是否完全通过 */
  valid: boolean;
  /** 文件路径（单文件校验时设置） */
  filePath?: string;
  /** 错误列表 */
  errors: ManifestValidationError[];
  /** 警告列表 */
  warnings: ManifestValidationWarning[];
  /** 信息列表（提示性） */
  infos: ManifestValidationInfo[];
}

export interface ManifestValidationError {
  field: string;        // 字段路径（如 "agentType"、"steps[2]"）
  message: string;      // 错误描述
  code: string;         // 错误码（如 "INVALID_AGENT_TYPE"、"NEGATIVE_ADOPTION_COUNT"）
  severity: "error";
}

export interface ManifestValidationWarning {
  field: string;
  message: string;
  code: string;
  severity: "warning";
}

export interface ManifestValidationInfo {
  field?: string;
  message: string;
  code: string;
}

/** 目录级校验结果 */
export interface DirectoryValidationResult {
  /** 目录路径 */
  dirPath: string;
  /** 扫描到的文件数 */
  totalFiles: number;
  /** 有效文件数 */
  validFiles: number;
  /** 无效文件数 */
  invalidFiles: number;
  /** 每个文件的校验结果 */
  fileResults: ManifestValidationResult[];
  /** 跨文件校验结果 */
  crossFileResult?: CrossFileValidationResult;
}

/** 跨文件校验结果 */
export interface CrossFileValidationResult {
  /** 重复的 ID */
  duplicateIds: Array<{ id: string; files: string[] }>;
  /** 未知的 agentType 列表 */
  unknownAgentTypes: string[];
  /** 文件命名规范违规 */
  namingViolations: Array<{ file: string; issue: string }>;
  /** 统计摘要 */
  summary: CrossFileSummary;
}

export interface CrossFileSummary {
  /** 按 agentType 分组的技能计数 */
  byAgentType: Record<string, number>;
  /** 按 status 分组的技能计数 */
  byStatus: Record<string, number>;
  /** 按 discoveredBy 分组的技能计数 */
  byDiscoverer: Record<string, number>;
  /** 总技能数 */
  total: number;
}

// ============================================================
// 3. 校验器接口
// ============================================================

/** 主校验器——组合所有子校验器 */
export interface IManifestValidator {
  /** 校验单个清单对象 */
  validate(manifest: unknown): ManifestValidationResult;

  /** 校验单个 JSON 文件 */
  validateFile(filePath: string): Promise<ManifestValidationResult>;

  /** 校验目录下所有 *.json 文件 */
  validateDirectory(
    dirPath: string,
    options?: DirectoryValidationOptions,
  ): Promise<DirectoryValidationResult>;

  /** 生成 JSON Schema 文件 */
  generateSchema(options?: SchemaGenerationOptions): Record<string, unknown>;

  /** 获取校验器版本信息 */
  version(): string;
}

/** 目录校验选项 */
export interface DirectoryValidationOptions {
  /** 文件名 glob 模式（默认 "*.json"） */
  filePattern?: string;
  /** 是否执行跨文件校验（默认 true） */
  crossFileValidation?: boolean;
  /** 是否在第一个错误时停止（默认 false） */
  failFast?: boolean;
  /** 最大文件数（默认 200） */
  maxFiles?: number;
}

/** Schema 生成选项 */
export interface SchemaGenerationOptions {
  /** Schema 标题 */
  title?: string;
  /** Schema 描述 */
  description?: string;
  /** Schema 版本 */
  schemaVersion?: string;
  /** 是否包含描述性注释（默认 true） */
  includeDescriptions?: boolean;
}

// ============================================================
// 4. 子校验器类型
// ============================================================

/** 字段校验器——校验单个字段的存在性、类型、格式 */
export interface IFieldValidator {
  validate(manifest: Record<string, unknown>): ManifestValidationError[];
}

/** AgentType 校验器——校验 agentType 是否为有效的 AgentType */
export interface IAgentTypeValidator {
  setValidAgentTypes(types: string[]): void;
  validate(agentType: unknown): ManifestValidationError | null;
}

/** 生命周期校验器——校验 status 转换规则 */
export interface ILifecycleValidator {
  /** 检查状态转换是否合法 */
  canTransition(from: SkillStatus, to: SkillStatus): boolean;
  /** 校验 adoptionCount/rejectionCount 与 status 的一致性 */
  validateLifecycle(manifest: SkillManifestFull): ManifestValidationError[];
  /** 获取所有合法转换 */
  getAllowedTransitions(): Array<{ from: SkillStatus; to: SkillStatus }>;
}

/** 内容质量校验器——校验 steps/trigger/expectedOutput 的内容质量 */
export interface IContentQualityValidator {
  /** 校验 steps 的可操作性 */
  validateSteps(steps: unknown): ManifestValidationResult;
  /** 校验 trigger 的描述充分性 */
  validateTrigger(trigger: unknown): ManifestValidationResult;
  /** 校验 expectedOutput 的产出描述明确性 */
  validateExpectedOutput(output: unknown): ManifestValidationResult;
}

/** 命名规范校验器——校验 id 的命名规范 */
export interface INamingConventionValidator {
  /** 设置命名规范模式（正则） */
  setPattern(pattern: RegExp): void;
  /** 校验 id 是否符合命名规范 */
  validate(id: string): ManifestValidationError | null;
  /** 从已有文件名自动推断命名模式 */
  inferPattern(files: string[]): RegExp;
}

/** 跨文件校验器——校验 ID 唯一性、agentType 一致性、文件命名合规 */
export interface ICrossFileValidator {
  validate(manifests: Array<{ file: string; manifest: SkillManifestFull }>): CrossFileValidationResult;
}

// ============================================================
// 5. 规则配置类型
// ============================================================

/** 校验规则配置——用于控制校验的严格程度和行为 */
export interface ValidationRules {
  /** 字段存在性规则 */
  fields: {
    /** 必填字段列表（默认所有非可选字段） */
    required: (keyof SkillManifestFull)[];
    /** 是否允许未知字段（默认 false） */
    allowExtraFields: boolean;
  };

  /** AgentType 校验规则 */
  agentType: {
    /** 有效 AgentType 列表（默认从 cortex-agents.json 加载） */
    validTypes: string[];
    /** 是否严格匹配（默认 true） */
    strict: boolean;
  };

  /** 生命周期校验规则 */
  lifecycle: {
    /** 允许的状态转换图 */
    transitions: Array<{ from: SkillStatus; to: SkillStatus }>;
    /** rejectionCount 触发 deprecated 的阈值（默认 3） */
    rejectionThreshold: number;
    /** 是否启用生命周期一致性校验（默认 true） */
    enabled: boolean;
  };

  /** 内容质量校验规则 */
  contentQuality: {
    /** steps 最小条目数（默认 1） */
    minSteps: number;
    /** steps 每条最小字符数（默认 10） */
    minStepLength: number;
    /** trigger 最小字符数（默认 20） */
    minTriggerLength: number;
    /** expectedOutput 最小字符数（默认 10） */
    minExpectedOutputLength: number;
    /** 是否要求步骤以动词开头（默认 true） */
    requireVerbStart: boolean;
    /** 是否启用内容校验（默认 true） */
    enabled: boolean;
  };

  /** 命名规范规则 */
  naming: {
    /** ID 正则模式 */
    idPattern: RegExp;
    /** 是否严格校验命名规范（默认 true） */
    strict: boolean;
  };

  /** 数值字段规则 */
  numericFields: {
    /** adoptionCount 最小值（默认 0） */
    minAdoptionCount: number;
    /** rejectionCount 最小值（默认 0） */
    minRejectionCount: number;
    /** createdAt 是否必须 > 0（默认 false——允许占位值 0） */
    requireValidTimestamp: boolean;
  };
}

// ============================================================
// 6. 默认规则常量
// ============================================================

/** 默认生命周期转换矩阵 */
export const DEFAULT_LIFECYCLE_TRANSITIONS: Array<{ from: SkillStatus; to: SkillStatus }> = [
  { from: "draft", to: "trial" },
  { from: "trial", to: "active" },
  { from: "trial", to: "deprecated" },
  { from: "active", to: "deprecated" },
  { from: "deprecated", to: "trial" },      // 允许复活
];

/** 默认 ID 命名模式（skill-p{数字}-{slug}-{timestamp}） */
export const DEFAULT_ID_PATTERN = /^skill-p\d{1,3}-[a-z0-9]+(?:-[a-z0-9]+)*-\d{10,}$/;

/** 默认校验规则 */
export const DEFAULT_VALIDATION_RULES: ValidationRules = {
  fields: {
    required: [
      "id", "agentType", "name", "triggerTags", "trigger",
      "steps", "expectedOutput", "status", "adoptionCount",
      "rejectionCount", "discoveredBy", "createdAt",
    ],
    allowExtraFields: false,
  },
  agentType: {
    validTypes: [
      "code", "review", "analysis", "ops", "loop",
      "doc-govern", "fix", "api", "data", "inspector",
      "browser", "butler", "meta", "strategist",
    ],
    strict: true,
  },
  lifecycle: {
    transitions: DEFAULT_LIFECYCLE_TRANSITIONS,
    rejectionThreshold: 3,
    enabled: true,
  },
  contentQuality: {
    minSteps: 1,
    minStepLength: 10,
    minTriggerLength: 20,
    minExpectedOutputLength: 10,
    requireVerbStart: true,
    enabled: true,
  },
  naming: {
    idPattern: DEFAULT_ID_PATTERN,
    strict: true,
  },
  numericFields: {
    minAdoptionCount: 0,
    minRejectionCount: 0,
    requireValidTimestamp: false,
  },
};

// ============================================================
// 7. SkillManifestValidator（主校验器实现）
// ============================================================

export class SkillManifestValidator implements IManifestValidator {
  private rules: ValidationRules;
  private fieldValidator: IFieldValidator;
  private agentTypeValidator: IAgentTypeValidator;
  private lifecycleValidator: ILifecycleValidator;
  private contentValidator: IContentQualityValidator;
  private namingValidator: INamingConventionValidator;
  private crossFileValidator: ICrossFileValidator;

  constructor(rules?: Partial<ValidationRules>);

  /** 校验单个清单对象 */
  validate(manifest: unknown): ManifestValidationResult;

  /** 从文件加载并校验 */
  async validateFile(filePath: string): Promise<ManifestValidationResult> {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const manifest = JSON.parse(content);
    const result = this.validate(manifest);
    result.filePath = filePath;
    return result;
  }

  /** 目录级批量校验 */
  async validateDirectory(
    dirPath: string,
    options?: DirectoryValidationOptions,
  ): Promise<DirectoryValidationResult>;

  /** 跨文件校验 */
  validateCrossFile(
    manifests: Array<{ file: string; manifest: SkillManifestFull }>,
  ): CrossFileValidationResult;

  /** 生成 JSON Schema */
  generateSchema(options?: SchemaGenerationOptions): Record<string, unknown>;
}

// ============================================================
// 8. 独立子校验器
// ============================================================

/** 字段存在性校验器 */
export class ManifestFieldValidator implements IFieldValidator;

/** AgentType 值域校验器 */
export class ManifestAgentTypeValidator implements IAgentTypeValidator;

/** 生命周期校验器 */
export class ManifestLifecycleValidator implements ILifecycleValidator;

/** 内容质量校验器 */
export class ManifestContentValidator implements IContentQualityValidator;

/** 命名规范校验器 */
export class ManifestNamingValidator implements INamingConventionValidator;

/** 跨文件校验器 */
export class ManifestCrossFileValidator implements ICrossFileValidator;

// ============================================================
// 9. 工具函数
// ============================================================

/** 从目录加载所有技能清单 */
export async function loadManifestsFromDirectory(
  dirPath: string,
  pattern?: string,
): Promise<Array<{ file: string; manifest: SkillManifestFull }>>;

/** 从 cortex-agents.json 加载有效 AgentType 列表 */
export async function loadAgentTypesFromConfig(
  configPath: string,
): Promise<string[]>;

/** 格式化校验结果为可读文本 */
export function formatValidationResult(
  result: ManifestValidationResult,
  options?: { colorize?: boolean; showInfo?: boolean },
): string;

/** 汇总目录校验结果为 Markdown 报告 */
export function formatDirectoryReport(
  result: DirectoryValidationResult,
): string;
```

### 校验管线流程图

```
validate(manifest)
  │
  ├─ 1. 结构校验 ─────────── ManifestFieldValidator
  │   ├─ 检查必填字段存在性
  │   ├─ 检查字段类型正确性
  │   └─ 检查无多余字段
  │
  ├─ 2. AgentType 值域校验 ── ManifestAgentTypeValidator
  │   ├─ 从 cortex-agents.json 加载有效类型列表
  │   └─ 比对 agentType 是否在列表中
  │
  ├─ 3. 命名规范校验 ──────  ManifestNamingValidator
  │   └─ 检查 id 是否符合 skill-p{N}-{slug}-{ts} 模式
  │
  ├─ 4. 生命周期校验 ──────  ManifestLifecycleValidator
  │   ├─ 检查 status 是否为有效值
  │   ├─ 检查 adoptionCount ≥ 0
  │   ├─ 检查 rejectionCount ≥ 0
  │   └─ 检查 rejectionCount ≥ 阈值 → deprecated 建议
  │
  ├─ 5. 数值字段校验 ──────  ManifestFieldValidator（增强）
  │   ├─ adoptionCount 非负整数
  │   ├─ rejectionCount 非负整数
  │   └─ createdAt 时间戳合理范围
  │
  ├─ 6. 内容质量校验 ──────  ManifestContentValidator
  │   ├─ steps 非空且每步可操作
  │   ├─ trigger 描述充分
  │   └─ expectedOutput 产出明确
  │
  └─ 7. 汇总结果
      ├─ errors.length === 0 → valid: true
      └─ errors.length > 0  → valid: false
```

### 使用示例

```typescript
// 基础使用——校验单个文件
const validator = new SkillManifestValidator();
const result = await validator.validateFile("skills/skill-p37-full-chain-final-acceptance.json");
console.log(result.valid ? "✅ 通过" : "❌ 失败", result.errors);

// 目录级校验
const dirResult = await validator.validateDirectory("skills/", {
  crossFileValidation: true,
  failFast: false,
});
console.log(`共 ${dirResult.totalFiles} 个文件，有效 ${dirResult.validFiles} 个`);

// 生成 Schema
const schema = validator.generateSchema({
  title: "Cortex Skill Manifest Schema",
  description: "skills/*.json 文件的结构定义",
});
fs.writeFileSync("skills/skill-manifest.schema.json", JSON.stringify(schema, null, 2));

// CI 集成
async function ciValidate() {
  const result = await validator.validateDirectory("skills/");
  if (!result.validFiles === result.totalFiles) {
    console.error(formatDirectoryReport(result));
    process.exit(1);
  }
}
```

### 文件结构

```
packages/skill-validator/
├── PACKAGE_POSITIONING.md       ← 本文档
├── README.md                    ← 使用说明
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                 ← 桶导出
│   ├── types.ts                 ← 核心类型（SkillManifestFull、校验结果类型）
│   ├── validator.ts             ← SkillManifestValidator 主实现
│   ├── field-validator.ts       ← ManifestFieldValidator
│   ├── agent-type-validator.ts  ← ManifestAgentTypeValidator
│   ├── lifecycle-validator.ts   ← ManifestLifecycleValidator
│   ├── content-validator.ts     ← ManifestContentValidator
│   ├── naming-validator.ts      ← ManifestNamingValidator
│   ├── cross-file-validator.ts  ← ManifestCrossFileValidator
│   ├── schema-generator.ts      ← JSON Schema 生成器
│   ├── loader.ts                ← loadManifestsFromDirectory 等工具
│   ├── formatter.ts             ← 校验报告格式化
│   ├── defaults.ts              ← DEFAULT_VALIDATION_RULES 等常量
│   └── utils.ts                 ← 通用工具函数
├── tests/
│   ├── fixtures/                ← 测试夹具（有效/无效的样例 JSON）
│   │   ├── valid-skill.json
│   │   ├── invalid-missing-field.json
│   │   ├── invalid-agent-type.json
│   │   └── invalid-lifecycle.json
│   ├── validator.test.ts
│   ├── field-validator.test.ts
│   ├── agent-type-validator.test.ts
│   ├── lifecycle-validator.test.ts
│   ├── content-validator.test.ts
│   ├── cross-file-validator.test.ts
│   └── schema-generator.test.ts
└── docs/
    └── design.md                ← 详细设计文档
```
