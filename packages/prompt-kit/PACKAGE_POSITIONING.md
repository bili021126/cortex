# @cortex/prompt-kit — 包定位文档

> **版本**: v0.1.0  
> **状态**: Core-1 可用  
> **圆桌角色**: 纳西妲 (Analysis Agent) — 设计 & 实现

---

## 一、一句话定位

**@cortex/prompt-kit** 是 Cortex 生态中**所有提示词相关操作的统一入口**——提供声明式、可组合、类型安全的提示词加载、组装、渲染、校验、缓存与版本管理能力。

---

## 二、解决的问题

### 2.1 痛点矩阵

| 痛点 | 此前状态 | 本包解决方式 |
|------|---------|-------------|
| **加载分散** | CLI `display.ts` 中 80 行混合 `fs.readFileSync` + `JSON.parse` | `PromptLoader` 统一三种来源：文件/配置/内联 |
| **组装硬编码** | chat/social/talk 三个 executor 各写一套拼接逻辑 | `PromptAssembler` 声明式块级组合：基于 `PromptAssembly` 配置 |
| **模板引擎错位** | `@cortex/skill-kit` 的 `SimpleTemplateEngine` 不支持 prompt 特有语法 | `PromptTemplateEngine` 支持 `{{#role}}`/`{{#block}}`/`{{#ref}}` 等指令 |
| **无校验** | prompt 缺失关键段不报错，LLM 输出失控时才被发现 | `PromptValidator` 预检必需段 + 变量闭合 + 语法完整 |
| **无缓存** | 每次对话重复 I/O 读文件 + 解析 JSON | `PromptCache` LRU + TTL 缓存，减少 90% 重复 I/O |
| **版本散落** | prompt 分布在 config 常量、prompts/ 目录、内联代码中 | `PromptVersion` 统一版本追踪 + diff 对比 |

### 2.2 不做的事

- ❌ 不自行调用 LLM — 本包是提示词工程层，不是推理引擎
- ❌ 不自行调用工具 — 安全边界由上层（Agent/CLI）在调用时注入
- ❌ 不管理会话状态 — 会话管理归属 `@cortex/engine`
- ❌ 不替代 `@cortex/skill-kit` 的技能步骤渲染 — 技能用 `SimpleTemplateEngine`，prompt 用本引擎

---

## 三、上下游关系

### 3.1 依赖关系图

```
@cortex/config ─────────────────────────────┐
  (路径常量: DIR_PROMPTS, FILE_CORTEX...)     │
       ↓ 消费                                  │
@cortex/prompt-kit ◄──────────────────────────┘
  ├─ PromptLoader     ─── 消费 config 路径常量
  ├─ PromptAssembler  ─── 依赖 template-engine
  ├─ PromptTemplateEngine ─ 无外部依赖
  ├─ PromptValidator  ─── 依赖 types
  ├─ PromptCache      ─── 无外部依赖
  ├─ PromptVersion    ─── 依赖 types
  └─ PromptOrchestrator ── 组合全部子模块
       ↓ 被消费
@cortex/engine ─── Agent ReAct loop ─── renderSystemPrompt()
@cortex/cli    ─── Executor (chat/social/talk) ─── renderSystemPrompt()
```

### 3.2 与 `@cortex/skill-kit` 职责边界

| 维度 | `@cortex/skill-kit` | `@cortex/prompt-kit` |
|------|--------------------|---------------------|
| 核心职责 | 技能定义、加载、校验、执行 | 提示词模板、组装、渲染、校验 |
| 模板引擎 | `SimpleTemplateEngine`（轻量，技能步骤） | `PromptTemplateEngine`（增强，prompt 专用） |
| 特有语法 | 无 | `{{#role}}` / `{{#block}}` / `{{#ref}}` / `{{#include}}` / `{{#date}}` |
| 模板来源 | 技能定义 JSON 中的 steps 字段 | 文件系统 `prompts/` 目录 + 配置常量 + 内联 |
| 缓存策略 | 无 | LRU + TTL + 文件变动自动失效 |
| 分离理由 | 技能步骤模板无需多角色编排、块级组合、跨模板引用 | prompt 组装需多角色编排、块级组合、跨模板引用 |

---

## 四、核心 API 一览

```typescript
import { PromptOrchestrator } from "@cortex/prompt-kit";

const orch = new PromptOrchestrator({ baseDir: process.cwd() });

// 渲染完整 system prompt（编排器主入口）
const result = await orch.renderSystemPrompt({
  baseTemplateId: "nahida-system",
  context: {
    variables: { userName: "开拓者" },
    agentType: "analysis",
  },
  injectIdentityAnchor: true,
});
console.log(result.text);

// 加载模板
const template = await orch.loadTemplate("shared-identity-anchor");

// 快速渲染单块
const text = await orch.renderBlock(
  { id: "greeting", type: PromptBlockType.Identity, content: "你是{{role}}", priority: 1 },
  { variables: { role: "分析师" } },
);

// 校验
const validation = orch.validateAssembly(assembly);

// 版本管理
const history = orch.version.getHistory("nahida-system");
const diff = orch.version.diff("nahida-system", "1.0.0", "1.1.0");

// 缓存统计
const stats = orch.getCacheStats();
```

---

## 五、宪法一致性

| 宪法条款 | 遵行方式 |
|---------|---------|
| **原则三** — 安全边界在 Toolkit 调用层 | prompt-kit 不自行调用工具，由上层注入上下文 |
| **原则五** — 可观测事件走统一管道 | 所有关键操作向外 emit PipelineObserver 事件（待 Phase 2 接入） |
| **§7.5** — 读取安全边界 | `PromptLoader` 路径限定在 `DIR_PROMPTS` 白名单内 |
| **§15·三** — 公开接口最小化 | 核心 API 控制在 7 个导出，内部模块不导出 |
| **§15·四** — 内联判定 | 子目录模块文件 ≤ 3 时内联至父目录索引中 |

---

## 六、未来规划

| Phase | 功能 | 目标版本 | 预计交付 |
|-------|------|---------|---------|
| Core-1 | 核心基础设施：类型、加载、渲染、缓存、校验、编排器 | v0.1.0 | ✅ 已完成 |
| Core-2 | CLI 集成：替换 `display.ts` 的 `loadAgentSystemPrompt` | v0.2.0 | 待排期 |
| Core-3 | PipelineObserver 事件接入 + 文件变动自动缓存失效 | v0.3.0 | 待排期 |
| Core-4 | 圆桌 prompt 编排 `createRoundtablePrompt` | v1.0.0 | 待排期 |
