# ⚖️ Cortex 代码法典——全体 Agent 必须遵守

> 此文件由 bootstrapEngine 自动注入到每个 Agent 的 system prompt 头部。
> 违者将在 CI lint 环节被拦截。你不是在"建议"，你是在"执行法律"。
> 
> 版本：v4.0（§九~§十禁止层 + §十一~§十四指导层——代码法典双翼闭合）

---

## 一、异常处理——死线

```
✅ 正确：每个 catch 必须有处理逻辑或显式注释
❌ 禁止：空 catch {} 块
❌ 禁止：throw "字符串" ——只 throw new Error(...)
✅ 要求：throw new Error("消息", { cause: e })  保留原因链
```

```typescript
// ✅ 正确
try {
  await riskyOp();
} catch (e) {
  // 降级策略：使用缓存
  return cachedResult;
}

// ✅ 正确（有显式原因说明）
try {
  parseJSON(data);
} catch {
  /* 非关键数据，解析失败使用默认值——安全降级 */
  return defaults;
}
```

## 二、变量声明——不可漂移

```
❌ 禁止：var 声明
✅ 要求：优先 const，只有确需重新赋值时才用 let
```

```typescript
// ✅ 正确
const result = compute(data);

// ✅ 允许（确实需要重新赋值）
let count = 0;
for (const item of items) {
  if (item.active) count++;
}
```

## 三、异步规范

```
✅ 要求：async 函数 return 语句要加 await
✅ 要求：不忽略 Promise（必须 await / .catch / 赋值）
❌ 禁止：Promise 被静默丢弃
```

```typescript
// ❌ 错误——Promise 被丢弃
fetchData();  

// ✅ 正确
await fetchData();

// ✅ 正确（有意 fire-and-forget，必须显式标注）
fetchData().catch(e => console.warn("非关键操作失败:", e));
```

## 四、导入路径——barrel 铁律

```
✅ 新文件：包名导入 `import { X } from "@cortex/engine"`
❌ 禁止：测试文件使用 `../src/xxx` 相对导入
✅ 要求：新增公开符号 → 必须更新包 src/index.ts barrel export
```

## 五、控制台输出与管道上报

```
❌ 禁止：裸 console.error() / console.warn()
✅ 要求：生产代码走 PipelineObserver 管道（宪法原则五）
```

**管道上报三档（SafeErrorReporter 协议，宪法 §8.1）**：

| 级别 | 含义 | Pipeline 优先级 | 使用场景 |
|------|------|----------------|---------|
| `fatal` | 操作失败，无法继续 | CRITICAL | DB 写入失败、状态机非法流转 |
| `degraded` | 部分成功，降级运行 | HIGH | 文件锁排队超时、SQL 回退内存 |
| `silent` | 静默异常，自动计数 | NORMAL | catch 块中无 emit 的吞错 |

> **静默计数器**：同一 `(source, event)` 在一次执行中累计 ≥ 3 次 → 自动升级为 `degraded` 并 emit。

## 六、代码风格速查

| 规则 | 级别 |
|---|---|
| 空 catch 块 | ❌ error |
| throw 非 Error | ❌ error |
| var 声明 | ❌ error |
| let 可改为 const | ❌ error |
| 未处理 Promise | ❌ error |
| 未使用变量 | ❌ error |
| require() 导入 | ❌ error |
| console.error/warn | ⚠️ warn |
| 非空断言 `!` | ❌ error |

---

## 七、硬编码禁令——配置驱动开发铁律（宪法原则七·子约束8）

### 7.1 定义源

```
✅ 所有常量定义必须在 @cortex/config 包中（packages/config/src/constants/）
❌ 禁止：任何模块中直接书写魔法数字、路径字面量、环境变量名、版本号字符串
❌ 禁止：在 engine/shared/cli 中定义 Agent 标签/身份/展示/别名常量——统一迁入 config
```

**已抽离到 @cortex/config 的常量域**：

| 域 | 文件 | 内容 |
|---|---|---|
| Agent 标签 | `constants/agent-tags.ts` | TAG_VOCABULARY, AGENT_TAGS |
| Agent 展示 | `constants/agent-display.ts` | AGENT_CHINESE_ROLE, AGENT_DISPLAY, CHAT_AGENT_ALIASES, buildChineseRoleMap |
| MetaAgent 提示词 | `constants/meta-agent.ts` | PLANNING_SYSTEM, REPLAN_SYSTEM, buildPlanningSystem(workspaceRoot) |
| 管线上下文 | `constants/pipeline.ts` | PIPELINE_CTX_MAX_OUTPUT_LEN, PIPELINE_CTX_RECENT_LIMIT 等 |
| 环境/路径 | `constants/env.ts` | ENV_DEEPSEEK_*, FILE_CORTEX_AGENTS_JSON 等 |
| 版本/默认值 | `constants/version.ts` | CORTEX_VERSION, CORTEX_PHASE, DEFAULT_* |
| RLM/Density | `constants/rlm.ts` | RLM_MIN_CONFIDENCE, DENSITY_* 等 |

**禁止字面量类型**：
- (a) 环境变量名（如 `DEEPSEEK_API_KEY`）→ 用 `ENV_DEEPSEEK_API_KEY`
- (b) 项目路径与文件名（如 `cortex-agents.json`、`.cortex/persona-talk.txt`）→ 用 `FILE_CORTEX_AGENTS_JSON` 等
- (c) 版本号字符串（如 `v0.2.0`、`Core-1`）→ 用 `CORTEX_VERSION` / `CORTEX_PHASE`
- (d) 默认超时值、配额数等数值常量

### 7.2 新增功能开发优先级（铁律）

```
第1优先：配置化 —— 能通过 cortex-agents.json / cortex-cognition.json / 环境变量 驱动
第2优先：@cortex/config 常量 —— 编译期常量统一定义在 packages/config/src/constants/
第3选择：硬编码 —— 仅当前两者都无法实现时才允许
```

**判断标准**：
- 该值是否因 Agent/场景不同而变？→ 第1优先（json 配置）
- 该值是否全局唯一但需集中管理？→ 第2优先（config 常量）
- 该值是否纯计算中间量、无复用价值？→ 第3选择（允许硬编码）

### 7.3 体系化硬编码零容忍

```
⚠️ 任何进入"体系化阶段"的硬编码必须消失，抽离到配置中。

"体系化阶段"定义：
  - 被 >= 2 个模块引用
  - 出现在 Agent system prompt 中
  - 定义了 Agent 行为边界（标签、展示、路由、超时、配额）
  - 是编译期/运行时的分界点（如 LLM model 名、API key）
  - 是运行时默认值（如函数参数默认值、类字段初始值）

违反者构成配置漂移——CI gate 将通过 find-hardcoded 检查拦截。
```

### 7.5 运行时默认值可配置化

```
❌ 禁止：函数参数默认值中的魔法数字（如 viewPortSize={width:1280,height:720}、timeout=10000）
✅ 要求：默认值必须来自 @cortex/config 常量，至少提供构造函数参数注入
```

```typescript
// ❌ 禁止
function fetchData(timeout = 30_000) { ... }
async function initBrowser() { await page.setViewportSize({ width: 1280, height: 720 }); }

// ✅ 正确：引用 config 常量
import { DEFAULT_TASK_TIMEOUT_SEC, BROWSER_DEFAULT_VIEWPORT } from "@cortex/config";
function fetchData(timeout = DEFAULT_TASK_TIMEOUT_SEC * 1000) { ... }
await page.setViewportSize(BROWSER_DEFAULT_VIEWPORT);
```

> 运行时默认值是"编译期硬编码"中最隐蔽的一种——它不是字面字符串，但它决定了行为边界。

### 7.6 已拆分配置文件的清理义务

```
❌ error：一个 JSON 配置文件被拆分为多个独立文件后，原单体文件必须删除
✅ 要求：拆分完成 = 删除源文件，并验证无代码仍引用旧路径
```

```
// cortex-agents.json 已拆分为 config/data/agents.json + cognition.json + governance-pipeline.json + seed-memories.json + ...
// → 原 cortex-agents.json 必须删除（或改为纯引用导出脚本）
```

> 已拆分的文件不删除 = 配置漂移的源头。两份"真相"同时存在，总有一份是错的。

### 7.4 新增 Agent 类型的标准流程（最少修改原则）

```
✅ 只需修改：
  1. @cortex/config：constants/agent-tags.ts（TAG_VOCABULARY + AGENT_TAGS）
  2. @cortex/config：constants/agent-display.ts（AGENT_CHINESE_ROLE + AGENT_DISPLAY + CHAT_AGENT_ALIASES）
  3. @cortex/config：constants/meta-agent.ts（PLANNING_SYSTEM 的"可用兵种"部分）
  4. @cortex/config：interfaces/agent.ts（AgentDefinition 类型如有新增字段）
  5. cortex-agents.json（agent 运行时定义）
  6. engine：bootstrap/register-agents.ts（如新类型需要特殊工厂逻辑）

❌ 不再需要修改：
  - shared/agent-tags.ts（已改为重导出层）
  - shared/agent-display.ts（已改为重导出层）
  - cli/repl/types.ts（AGENT_DISPLAY/CHAT_AGENT_ALIASES 已从 config 派生）
  - engine/core/meta-agent.ts（PLANNING_SYSTEM/REPLAN_SYSTEM 已从 config 导入）
```

---

## 八、提示词管理——单源同步铁律

### 8.1 存放位置

```
✅ 所有 Agent 系统提示词的人读版：prompts/<agent-name>/system.md
✅ MetaAgent 规划提示词：prompts/ganyu/planning.md + replan.md
✅ 圆桌会议模板：prompts/<agent-name>/roundtable.md
```

目录结构：
```
prompts/
  coding-standards.md           # 核心编码规范
  coding-standards-dev.md       # 开发者补充规范
  coding-standards-governance.md # 治理层规范
  ganyu/
    system.md                   # 甘雨 system prompt（人读源）
    planning.md                 # 规划提示词（人读源，含 {{WORKSPACE_ROOT}}）
    replan.md                   # 重规划提示词（人读源）
    roundtable.md               # 圆桌模板
  albedo/system.md              # 阿贝多
  amber/system.md               # 安柏
  ...（每 Agent 一个目录）
```

### 8.2 双源同步规则

```
⚠️ prompts/ 是 human-readable 规范源，@cortex/config 是 machine-readable 运行时源。
二者必须保持同步——修改任何一方必须同步更新另一方。

修改流程：
  1. 先改 prompts/<agent>/*.md —— 人读源，便于 diff review
  2. 再改 @cortex/config/src/constants/meta-agent.ts —— 运行时源
  3. 若提示词包含 {{WORKSPACE_ROOT}} 等占位符 → 运行时代码负责 replace()
```

### 8.3 占位符约定

```
提示词中的运行时注入点使用 {{UPPER_SNAKE_CASE}} 占位符：
  {{WORKSPACE_ROOT}} —— 由 buildPlanningSystem(workspaceRoot) 在运行时替换

占位符只存在于 config 常量和 prompts/*.md 中，
运行时代码负责在执行前完成字符串替换。
```

---

> **此文件是 Cortex 的代码法典·核心篇——全量注入所有 Agent。**
> 
> 治理篇（架构规范、Agent 交互协议）见 `prompts/coding-standards-governance.md`。
> 
> **宪法依据**：Cortex 概念顶层设计 v2.6.1——七条不可变原则（含子约束9 类型安全保障）

---

## 九、架构设计原则——内部明细化 + 外部具体化（v3 新增）

> **地位：宪法级约束。所有新功能设计、模块新增、协议接入必须遵守。**
> 违者视为"野蛮生长"——CI gate 将通过 architecture-review 检查拦截。

### 9.1 核心公式

```
重构不出乱子 = 内部数据流向明细化 × 外部接口抽象具体化

内部越明细 → 改哪条链路一目了然 → 不碰不该碰的
外部越具体 → 消费者见到的契约不变 → 上下游不动
```

### 9.2 内部：数据流向明细化

**规则**：任何模块的内部实现必须将数据流路径显式拆解为可独立理解的步骤。

```
✅ 要求：
  - 每条数据流路径可被单独追踪（从入口到出口，不依赖隐式状态）
  - 异步操作必须有显式的 pending/超时/清理机制
  - 传输层与业务层之间必须有抽象边界（如 McpTransportImpl → McpClient → McpToolAdapter）
  - 状态机（如 initialize → tools/list → tools/call）的每个阶段必须可独立测试

❌ 禁止：
  - 跨模块共享可变 Map/Set 作为"通信渠道"（必须通过接口/事件总线）
  - 在 execute() 中用 if/else 分叉不同来源的工具调用（必须统一为 Tool 接口）
  - 隐式依赖——模块 A 修改全局变量，模块 B 读取（必须显式传参）
  - 半成品抽象——Transport 只支持 stdio 不支持 HTTP，却在接口层写死 stdio 假设
```

**判例**：McpClient 重构

```
重构前（野蛮生长）：                      重构后（明细化）：
                                         
McpClient                                McpTransportImpl 接口
  ├─ spawn + stdin/stdout（写死）           ├─ StdioTransport
  └─ 无 HTTP 能力                           └─ HttpTransport
                                         McpClient
内部耦合 spawn/readline 到 JSON-RPC，        ├─ Transport 抽象（不感知底层）
无法扩展。接入 HTTP MCP Server 需要改        ├─ pending Map（异步状态显式管理）
McpClient 内部逻辑——每次扩展都是一次          ├─ initialize → tools/list → tools/call
"手术"。                                    │   （状态机阶段独立可测）
                                           └─ callTool()（统一入口）
                                         新增传输模式：加一个 Transport 实现——
                                         McpClient 一行不动。
```

### 9.3 外部：接口抽象具体化

**规则**：对外暴露的接口必须定义清晰、稳定、最小化的契约。接口的稳定性取决于它承诺的薄厚——承诺越薄，变化越自由。

```
✅ 要求：
  - 每个接口字段必须有明确类型（禁止 any / unknown 作为公开 API 的返回类型）
  - 接口语义必须可被独立理解（不看实现代码也能知道它做什么）
  - 新增实现类时，接口本身不变（Open-Closed 原则的实践形态）
  - 接口命名反映"做什么"而非"怎么做的"（Tool 而非 McpToolOrLocalTool）

❌ 禁止：
  - 接口暴露内部实现细节（如 McpClient 的 pending Map 不应出现在 Tool 接口上）
  - "瑞士军刀接口"——一个接口包含 10+ 个方法，因为"可能用到"
  - 接口版本号随实现变化而递增（实现变了接口不动，才是好抽象）
```

**判例**：Tool 接口

```
interface Tool {                          // 6 个字段 + 1 个方法。承诺极薄。
  readonly name: string;                  // 够 LLM 做 function calling
  readonly category: ToolCategory;        // 够 ConfirmGate 做权限判定
  readonly description: string;           // 够 listDefinitions() 输出
  readonly parameters: Record<string, unknown>;
  readonly level: ReversibilityLevel;     // 够 FileLockManager 判断加锁
  readonly needsLock?: boolean;           // 本地 8 个工具直接实现
  execute(params): Promise<ToolResult>;   // MCP 24 个工具通过 McpToolAdapter 实现
}                                         // 未来 A2A/gRPC 插件同样实现此接口
                                          // ——Tool 接口不需要改一行。
```

### 9.4 新功能开发流程——三步铁律

任何新功能、新模块、新协议接入，必须按以下顺序执行：

```
第1步：定义外部接口（"调用方看到什么？"）
  → 写出 interface / type / contract
  → 用已有调用方验证接口是否够用、是否过宽
  → 接口文件必须优先于实现文件提交

第2步：绘制内部数据流（"数据怎么走？"）
  → 列出数据从入口到出口的每一步
  → 标注每一步的负责人（哪个类/函数）
  → 确认每一步都是可独立追踪的（不依赖隐式全局状态）

第3步：实现并验证（"改了多少文件？测试过多少？"）
  → 已有测试必须全部通过（不修改任何已有测试的断言）
  → 新增测试覆盖新增数据流路径
  → 如果第3步触发了第1步或第2步的回退修改——设计有问题，重来
```

### 9.5 违反判定

以下任一情况构成"野蛮生长"，CI gate 拦截：

| 违规 | 判定标准 |
|------|---------|
| 接口泄漏 | 公开 API 的类型签名包含内部实现类名（如返回 `McpClient` 而非 `Tool`） |
| 分叉路由 | execute/listDefinitions/dispose 中存在 `if (type === "mcp")` / `instanceof` 分叉 |
| 数据流黑洞 | 模块 A 写入全局变量/Map，模块 B 读取——中间无接口/事件/回调 |
| 回退修改 | 新增功能导致已有测试需要修改断言（非新增测试） |
| 先写实现后补接口 | 实现文件比接口文件先提交 |

---

> **此章与 §七（配置驱动开发）并列 Cortex 两大架构铁律。**
> §七管"值从哪来"——不写死；§九管"结构长什么样"——不野蛮。

### 9.6 God Interface 禁令

```
❌ error：禁止单接口包含超过 10 个方法或横跨 3+ 职责域
✅ 要求：按职责域拆分为多个小接口，通过组合而非继承合并
```

```typescript
// ❌ 禁止——ICortexApi 横跨 3 域 19 个方法
interface ICortexApi {
  // 生命周期
  ready: boolean; ensureReady(): Promise<void>; shutdown(): Promise<void>;
  // 对话
  chat(msg): Promise<string>; getChatModelName(): string;
  // 任务
  submitTask(task): Promise<void>; executeAll(): Promise<void>;
  // 记忆
  ensureTalkMemory(): void; readTalkMemory(): MemoryEntry[];
  // 引擎组件
  getMemoryStore(): IMemoryStore; getScheduler(): IScheduler;
  // ... 19 个方法
}

// ✅ 正确：按职责域拆分
interface ICortexChatApi { chat(msg): Promise<string>; }
interface ICortexTaskApi { submitTask(task): Promise<void>; }
interface ICortexMemoryApi { ensureTalkMemory(): void; }
// ICortexApi 仅组合它们
interface ICortexApi extends ICortexChatApi, ICortexTaskApi, ICortexMemoryApi {
  ensureReady(): Promise<void>; shutdown(): Promise<void>;
}
```

> God Interface 是"我懒得拆类型"的语法糖——它让使用方被迫了解全部内部细节。
>
> **当前违规追踪**：ICortexApi（21 成员，横跨生命周期/对话/任务/记忆/引擎组件 5 域）和 IMemoryStore（25 成员）均为已知 God Interface。两者在 Core-1 阶段维持现状——拆分需同步调整 EngineBridge/CLI 命令工厂/测试 Mock，影响面过大。计划在 Core-2 按职责域拆分为小接口后组合。

### 9.7 共享层零实现规则

```
❌ error：@cortex/shared 禁止包含运行时类实现（含实例状态、Map/Set 成员、Date.now() 调用）
✅ 要求：shared 仅保留纯 interface、纯 type、纯 const 常量、纯工具函数（无副作用、无实例状态）
✅ 例外：参考实现类（如 InMemoryKvStore）必须标注 @exception + 豁免理由，且不得有外部消费方依赖它作为唯一实现
```

```typescript
// ❌ 禁止——shared 中的完整运行时类
class InMemoryKvStore<T> implements KvStore<T> {
  private _store = new Map<string, KvStoreEntry<T>>();  // 实例状态
  get(key: string): T | undefined {
    const e = this._store.get(key);
    if (e._expiresAt && Date.now() > e._expiresAt) { ... }  // 运行时副作用
  }
}

// ✅ 正确：仅保留 interface
interface KvStore<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, options?: { ttl?: number }): void;
}
// 实现移到 @cortex/engine
```

> shared 不是"什么都能放的公共抽屉"——它是类型契约的净土。

### 9.8 薄壳包生命周期

```
✅ 核心实现已迁走的薄壳包（如旧 @cortex/memory → @cortex/shared）——零外部消费方确认后立即删除
✅ 判定方法：grep 全仓 "@cortex/memory" 只有自身 package.json → 零消费方 → 删除
❌ 禁止：保留"仅供向后兼容的重导出"的薄壳包
```

> 薄壳包不是"过渡"——是技术债务。每多一个薄壳包，就多一个编译路径、一个歧义来源。

---

## 十、代码规范深度约束——零容忍条款

> **地位：与 §一至§六并列的代码层铁律。写代码即遵守，无例外。**
> 以下规则在 §一至§六中已覆盖的，此处强化；未覆盖的，此处补全。

### 10.1 非空断言——死刑

```
❌ error：禁止使用非空断言操作符 !
✅ 要求：改用可选链 ?. 或显式 if (x === undefined) throw new Error(...)
```

```typescript
// ❌ 禁止
const name = user!.name!;
const handler = this.tools.get(toolName)!;

// ✅ 正确：可选链
const name = user?.name;

// ✅ 正确：显式守卫
const handler = this.tools.get(toolName);
if (!handler) throw new Error(`Tool not found: ${toolName}`);
```

> 非空断言是"我知道这里不会空"——但崩溃总是发生在"你以为不会空"的地方。

### 10.2 重复导入——合并铁律

```
❌ error：禁止同一模块路径出现在多条 import 语句中
✅ 要求：所有相同路径的 import 合并为单行声明
```

```typescript
// ❌ 禁止
import { Tool } from "@cortex/shared";
import { ToolCategory } from "@cortex/shared";

// ✅ 正确
import { Tool, ToolCategory } from "@cortex/shared";
```

> 重复导入是"分两次写的同一个依赖"——合并后 diff 更干净，依赖关系一目了然。

### 10.3 any 类型泄漏——零容忍

```
❌ error：禁止公开 API 的返回类型、接口字段、函数签名中出现 any
✅ 要求：用 unknown + 类型守卫 或 具体 interface 替代
```

```typescript
// ❌ 禁止
function parse(data: string): any { ... }
interface Config { options: any }

// ✅ 正确：unknown + 守卫
function parse(data: string): unknown { ... }
const result = parse(raw);
if (isConfig(result)) { /* result 在此处被窄化为 Config */ }

// ✅ 正确：具体类型
interface Config { options: Record<string, string> }
```

> any 是"我懒得想类型"的语法糖——它让 TypeScript 退化为 JavaScript。

### 10.3-bis `as any` 类型断言——同等处罚

```
❌ error：禁止使用 as any 或 as unknown as SomeType 绕过类型系统
✅ 要求：扩展类型定义、添加接口字段、用类型守卫替代强制断言
```

```typescript
// ❌ 禁止——用 as any 访问未声明的私有属性
(m as any)._pending = value;
// ❌ 禁止——用 as any 绕过枚举类型
"PROMPT_LOAD_FAILED" as any
// ❌ 禁止——用 as any 绕过 LinkType 枚举
"DerivedFrom" as any

// ✅ 正确：扩展类型定义
interface MemoryEntry { _pending?: boolean }  // 在 shared 中正式声明
m._pending = value;

// ✅ 正确：使用枚举值
PromptErrorCode.LOAD_FAILED
```

> `as any` 是"我知道类型不对但我要硬写"的破坏行为。它把类型系统的保障墙凿了个洞，让所有后续代码都不安全。每一处 `as any` 都是一个未声明契约——把它补进类型定义里。

### 10.3-ter `Disposable` 接口——Plugin 安全清理模式

```
✅ 要求：Plugin stop() 通过 Disposable 接口安全调用实例清理方法
✅ 模式：(this.instance as unknown as Disposable).stop?.()
❌ 禁止：裸 (this.instance as any).stop?.() 绕过类型检查
```

```typescript
// ❌ 禁止——裸 as any 调用未声明的清理方法
async stop(): Promise<void> {
  (this.instance as any).stop?.();
}

// ✅ 正确——通过 Disposable 接口安全调用
import type { Disposable } from "@cortex/shared";
async stop(): Promise<void> {
  (this.instance as unknown as Disposable).stop?.();
}
```

> Plugin 的实例清理方法（stop/shutdown/destroyAll/clear）在当前阶段可能是空操作，但通过 Disposable 契约调用而非 `as any`，确保了类型安全和未来扩展性。`unknown` 中间态防止了 `any` 的类型污染。

### 10.4 死代码——即时死刑

```
❌ error：禁止保留不再被任何调用方引用的函数、类、常量、文件
✅ 要求：删除死代码与删除注释一样，是"写代码的一部分"，不是"重构的一部分"
```

判定标准：
- tsc --noEmit 通过，但 grep 全仓无调用方 → 死代码
- 被注释掉的旧实现（/* old: ... */）→ 死代码
- export 但无任何 import → 死代码（barrel 重导出不计入）

> 死代码不是"暂时没用"——是"永远不会用了"。保留它只是在撒谎。

### 10.5 函数签名一致性

```
❌ error：同一语义的参数在不同文件中命名不一致
✅ 要求：workspaceRoot 到处都是 workspaceRoot，不要到另一个文件变成 rootDir 或 projectRoot
```

```typescript
// ❌ 禁止——同一概念三个名字
// file A: function init(rootDir: string)
// file B: function init(projectRoot: string)
// file C: function init(workspaceRoot: string)

// ✅ 正确——统一命名
// file A: function init(workspaceRoot: string)
// file B: function init(workspaceRoot: string)
// file C: function init(workspaceRoot: string)
```

> 名字不一致是认知成本——读代码的人每次都要想"这跟刚才那个是不是同一个东西"。

### 10.6 代码规范速查（强化版）

以下规则在 §六基础上强化，对齐 ESLint 实际配置：

| 规则 | ESLint 规则 | 级别 | 说明 |
|------|------------|------|------|
| 非空断言 `!` | `@typescript-eslint/no-non-null-assertion` | ❌ error | 升格——从严 |
| 重复 import | `no-duplicate-imports` | ❌ error | 合并铁律 |
| `any` 类型（公开 API） | `@typescript-eslint/no-explicit-any` | ❌ error | 零容忍 |
| `as any` 类型断言 | `@typescript-eslint/no-explicit-any` | ❌ error | 同等处罚 |
| 未处理的 Promise | `@typescript-eslint/no-floating-promises` | ❌ error | 异步安全 |
| 类型导入分离 | `@typescript-eslint/consistent-type-imports` | ❌ error | 新增——`import type` 优先 |
| 参数超过 3 个 | `max-params` | ⚠️ warn(3) | 新增——强制 options 对象 |
| 函数超过 30 行 | `max-lines-per-function` | ⚠️ warn(30) | 新增——函数拆分信号 |
| 死代码保留 | — | ❌ error | 即时死刑 |
| 参数命名不一致 | — | ❌ error | 认知成本 |

---

> **§九管"结构"，§十管"笔迹"。**
> 结构不野蛮，笔迹不潦草——Cortex 代码法典至此闭合。

---

## 十一、方法与函数设计规范

> **地位：每个函数/方法都是一个契约。签名即文档，体即承诺。**

### 11.1 方法签名三原则

```
原则一：返回类型必须显式声明
  ✅ function parse(data: string): ParsedResult
  ❌ function parse(data: string)          // 依赖类型推断

原则二：必选参数在前，可选参数在后
  ✅ function connect(host: string, port: number, tls?: boolean)
  ❌ function connect(tls?: boolean, host: string, port: number)

原则三：禁止 boolean trap 参数
  ✅ function render(options: { async: boolean })  // 命名参数
  ❌ function render(async: boolean)               // 调用方 render(true) 读不懂
```

```typescript
// ❌ boolean trap——调用方完全不知道 true 是什么意思
function save(data: string, overwrite: boolean): void {}
save("data", true); // true 是 overwrite？compress？dryRun？

// ✅ 用 options 对象或枚举
function save(data: string, opts: { overwrite: boolean }): void {}
save("data", { overwrite: true });
```

### 11.2 函数纯度与副作用隔离

```
核心规则：纯函数优先——相同输入永远产生相同输出，不修改外部状态。
有副作用的函数必须在命名或 JSDoc 中标注。
```

```typescript
// ✅ 纯函数——无副作用，可缓存、可并发、可测试
function computeScore(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.weight, 0);
}

// ✅ 有副作用——函数名已暗示（write/send/emit/delete/spawn/register）
async function writeConfigToDisk(path: string, config: Config): Promise<void> {
  await fs.writeFile(path, JSON.stringify(config)); // 副作用：写入文件
}

// ❌ 副作用藏在纯函数名里
function validateConfig(config: Config): boolean {
  globalConfig = config;  // 副作用：修改全局状态——函数名没说
  return true;
}
```

**副作用动词黑名单**：函数名含以下动词时必须确认是否有意为之：
`write` `send` `emit` `delete` `remove` `spawn` `register` `subscribe` `mutate` `dispatch`

### 11.3 参数数量限制

```
✅ 最多 3 个位置参数——超过则必须封装为 options/params 对象
✅ 选项对象优先 interface 而非 inline type
❌ 禁止 rest 参数 (...args: any[]) 作为公开 API
```

```typescript
// ❌ 超过 3 个参数——记不住顺序
function spawnAgent(
  type: AgentType,
  name: string,
  memoryQuota: number,
  timeout: number,
  trustLevel: number,
): Agent {}

// ✅ 封装为 params 对象
function spawnAgent(params: {
  type: AgentType;
  name: string;
  memoryQuota: number;
  timeout: number;
  trustLevel: number;
}): Agent {}
```

### 11.4 方法体原则

```
✅ 一个方法只做一件事——用其名称可以完整描述
✅ 方法体 > 30 行 → 考虑拆分子方法
✅ 提前 return 优于深层嵌套
❌ 禁止隐式返回 undefined 却不标注返回类型
```

```typescript
// ❌ 深层嵌套
function process(item: Item): Result {
  if (item.active) {
    if (item.score > 0) {
      if (item.category === "A") {
        return transformA(item);
      } else {
        return transformB(item);
      }
    } else {
      return defaultResult;
    }
  } else {
    return defaultResult;
  }
}

// ✅ 提前 return 扁平化
function process(item: Item): Result {
  if (!item.active) return defaultResult;
  if (item.score <= 0) return defaultResult;
  return item.category === "A" ? transformA(item) : transformB(item);
}
```

---

## 十二、导入路径与模块组织

> **地位：导入即依赖声明。import 语句是模块图的可视化表示——必须能一眼读懂依赖拓扑。**

### 12.1 导入排序

```
✅ 排序规则（自上而下）：
  1. Node 内置模块（fs, path, crypto...）
  2. 第三方依赖（@anthropic, zod, express...）
  3. @cortex/* 子包（@cortex/shared, @cortex/engine...）
  4. 同包内相对导入（./scheduler, ../memory/memory-store）

✅ 每组之间空一行
✅ 组内按字母序排列
```

```typescript
// ✅ 正确
import { readFileSync } from "fs";
import path from "path";

import { z } from "zod";

import { Tool, ToolResult } from "@cortex/shared";
import { MemoryStore } from "@cortex/engine";

import { Scheduler } from "./scheduler";
import { validateDag } from "../utils/validate-dag";
```

### 12.2 类型导入分离

```
✅ 仅作为类型使用的导入使用 import type
✅ 值与类型混用时：值正常 import，类型通过 import type 声明
❌ 禁止 import { type Foo } 行内混合语法
```

```typescript
// ✅ 正确：类型独立导入
import type { AgentType, TaskNode } from "@cortex/engine";
import { Scheduler } from "@cortex/engine";

// ❌ 禁止：行内混合
import { Scheduler, type AgentType } from "@cortex/engine";
```

### 12.3 副作用导入标注

```
✅ 副作用导入（import "xxx" 或 import "xxx/register"）必须在注释中说明原因
❌ 禁止无注释的副作用导入
```

```typescript
// ✅ 副作用导入必须说明
import "reflect-metadata"; // 装饰器运行时支持
import "./register-agents"; // 引导——Agent 注册必须执行
```

### 12.4 模块文件命名

```
✅ 文件名：kebab-case——task-board.ts、pipeline-observer.ts
✅ 类文件：一个文件一个主类——类名 = PascalCase，文件名 = kebab-case
✅ 禁止：文件名与类名不一致（MemoryStore.ts 包含 export class MemoryStore——文件名应为 memory-store.ts）
✅ 目录结构：每层不超过 10 个兄弟文件——超过则分子目录
```

---

## 十三、接口与类型设计

> **地位：类型系统是编译期的宪法——运行时崩溃不可接受，编译期错误同样不可接受。**

### 13.1 接口隔离——ISP

```
✅ 一个 interface 只描述一个角色（调用方视角）
✅ 大接口拆分为 N 个小接口——调用方只依赖它需要的
❌ 禁止一个 interface 包含 8+ 个方法（"全功能接口"）
```

```typescript
// ❌ 全功能接口——写入方不需要 callTool，调用方不需要 dispose
interface McpClient {
  initialize(): Promise<void>;
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  dispose(): void;
  getTransport(): Transport;
}

// ✅ 接口隔离——各取所需
interface McpCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}
interface McpLifecycle {
  initialize(): Promise<void>;
  dispose(): void;
}
```

**判例**：Tool 接口只暴露 `execute()`——McpToolAdapter 内部持有一个 `McpCaller`（只有 callTool），Toolkit 通过 `Tool.execute()` 调用，永远看不到 Transport、pending Map、initialize 握手。

### 13.2 Discriminated Union（判别联合）

```
✅ 多种变体的数据使用带 type 字段的 discriminated union
❌ 禁止：用 string + if/else 判断变体类型
```

```typescript
// ❌ 字符串分叉——TypeScript 不知道 payload 的结构
interface Event {
  type: string;
  payload: unknown;
}

// ✅ Discriminated union——TypeScript 窄化 payload 类型
type Event =
  | { type: "NodeComplete"; payload: { nodeId: string; result: NodeResult } }
  | { type: "NodeFailed"; payload: { nodeId: string; error: Error } }
  | { type: "PipelineReady"; payload: { steps: number } };

function handle(event: Event) {
  switch (event.type) {
    case "NodeComplete": event.payload.result;  // 类型已窄化
    case "NodeFailed": event.payload.error;      // 类型已窄化
  }
}
```

### 13.3 readonly 优先

```
✅ 被多个消费者共享的数据结构——字段加 readonly
✅ 配置/常量对象——整个对象用 as const 或用 Readonly<T>
✅ interface 字段默认应考虑 readonly
```

```typescript
// ✅ 共享数据结构——readonly 防止意外修改
interface AgentDefinition {
  readonly type: AgentType;
  readonly name: string;
  readonly tags: readonly string[];
}

// ✅ const 断言——编译期完全确定
const DEFAULT_TIMEOUTS = {
  spawn: 30_000,
  execute: 300_000,
  replan: 120_000,
} as const;
```

### 13.4 type vs interface

| 场景 | 使用 | 原因 |
|------|------|------|
| 对象形状定义 | `interface` | 可扩展、可合并声明 |
| 联合类型 / 交叉类型 | `type` | interface 无法表达 |
| 函数签名 | `type` | 更简洁 `type Handler = (p: Params) => Result` |
| 工具类型（Partial/Pick/Omit） | `type` | 映射类型必须用 type |
| 公共 API 对外的对象 | `interface` | 消费者可通过 declaration merging 扩展 |

```
✅ 优先 interface——除非需要联合/交叉/映射
❌ 禁止：能用 interface 描述的形状用 type（毫无收益的差异）
```

---

## 十四、设计模式约定

> **地位：以下四种模式是 Cortex 架构的骨架——不强制使用，但若用了同类结构，必须按此模式实现。**

### 14.1 Adapter（适配器）——统一接口内不同实现

**场景**：把不同来源的实现（本地工具 / MCP 工具 / A2A 工具）适配为统一接口。

**Cortex 判例**：`McpToolAdapter implements Tool`

```
规则：
  ✅ Adapter 必须实现接口的所有字段和方法
  ✅ 构造函数接收"被适配者"（如 McpClient + ToolDef），而非继承它
  ✅ Adapter 不做业务逻辑——只做类型/协议转换
  ❌ 禁止在 Adapter 中混合业务逻辑（如权限校验——那是 Toolkit.execute() 的事）
```

```typescript
// ✅ Adapter 只做转换
class McpToolAdapter implements Tool {
  readonly name: string;
  readonly category = ToolCategory.Search;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly level = ReversibilityLevel.L0;
  readonly needsLock = false;

  constructor(
    private _client: McpCaller,        // 被适配者
    toolDef: McpToolDef,                // 被适配者
    serverId: string,
  ) {
    this.name = `${MCP_PREFIX}${serverId}:${toolDef.name}`;
    this.description = `[MCP:${serverId}] ${toolDef.description || toolDef.name}`;
    this.parameters = (toolDef.inputSchema || {}) as Record<string, unknown>;
  }

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    // 转换：Tool params → MCP callTool args
    const raw = await this._client.callTool(this._rawName, params);
    return { success: true, result: raw };
  }
}
```

### 14.2 Factory（工厂）——集中管理创建逻辑

**场景**：同一类型有多个子类/变体，创建逻辑需要集中管理。

**Cortex 判例**：`AgentFactory.createAgent(type, options)`、`createTool(ctx: ToolContext): Tool`

```
规则：
  ✅ create* 函数是唯一入口——不在外部 new 子类
  ✅ 创建逻辑集中、可测试
  ❌ 禁止散落在各处的 new Xxx(...)（创建知识分散）
```

```typescript
// ✅ 工厂函数——创建知识集中
function createTool(ctx: ToolContext): Tool {
  return new LocalTool(
    "read_file",
    ToolCategory.File,
    "Read a file from the local filesystem",
    PARAMS,
    ctx.trustLevel >= 3 ? ReversibilityLevel.L0 : ReversibilityLevel.L1,
    async (params) => { /* handler */ },
    { needsLock: false },
  );
}

// ❌ 禁止——创建逻辑散落各处
const tool = new LocalTool("read_file", ToolCategory.File, "...", PARAMS, L0, handler);
// 如果 category/level/needsLock 需要调整，所有 new 点都要改
```

### 14.3 Strategy（策略）——运行时切换算法/行为

**场景**：同一种操作有多种实现方式，运行时根据上下文选择。

**Cortex 判例**：`McpTransportImpl`（StdioTransport vs HttpTransport）、`preferredStrategy`

```
规则：
  ✅ 定义策略接口（如 McpTransportImpl）
  ✅ 每个策略一个类——互不感知
  ✅ 策略选择逻辑集中在一处（如工厂函数或配置驱动的路由表）
  ❌ 禁止用 if/else 散落在调用方判断"用哪种策略"
```

```typescript
// ✅ 策略接口 + 集中选择
interface TranscriptStrategy {
  transcribe(audio: Buffer): Promise<string>;
}

function createTranscriber(config: Config): TranscriptStrategy {
  if (config.provider === "deepseek") return new DeepSeekTranscriber(config);
  if (config.provider === "whisper") return new WhisperTranscriber(config);
  if (config.provider === "mcp") return new McpTranscriber(config);
  throw new Error(`Unknown provider: ${config.provider}`);
}
```

### 14.4 Observer（观察者）——解耦事件发布与处理

**场景**：某操作完成后需要触发多项后续动作，但操作本身不应感知后续动作的存在。

**Cortex 判例**：`PipelineObserver.on(event, handler)` + `Scheduler.emit(event)`

```
规则：
  ✅ 发布者只管 emit——不知道谁在听
  ✅ 订阅者在 bootstrap 阶段注册——不在业务代码中注册
  ✅ 事件 payload 走 discriminated union（见 §13.2）
  ❌ 禁止在发布者代码中硬编码后续动作（"发完 X 之后调 Y"）
```

```typescript
// ✅ 发布者——不感知订阅者
class Scheduler {
  private _observer: PipelineObserver;
  async executeAll(): Promise<void> {
    for (const node of this._sorted) {
      const result = await this._dispatchNode(node);
      this._observer.emit({ type: "NodeComplete", payload: { nodeId: node.id, result } });
    }
  }
}

// ✅ 订阅者——在 bootstrap 阶段注册
function bootstrapEngine(observer: PipelineObserver) {
  observer.on("NodeComplete", ({ payload }) => {
    skillPipeline.extractFrom(payload.result); // 技能提取——Scheduler 毫不知情
  });
}

// ❌ 禁止——发布者硬编码后续动作
class Scheduler {
  async executeAll(): Promise<void> {
    const result = await this._dispatchNode(node);
    this._observer.emit({ type: "NodeComplete", payload: { nodeId: node.id, result } });
    await this._skillPipeline.extractFrom(result);  // ❌ 发布者不该知道 SkillPipeline
  }
}
```

### 14.5 模式速查

| 模式 | 识别条件 | 用在哪 |
|------|---------|--------|
| Adapter | 不同来源的实现 → 统一接口 | McpToolAdapter, LocalTool |
| Factory | 同一类型的多个子类 → createXxx 集中管理 | AgentFactory, createTool() |
| Strategy | 同一种操作 → 运行时选实现 | McpTransportImpl, preferredStrategy |
| Observer | 事件发布 → 后续动作解耦 | PipelineObserver, 事件总线 |

---

> **§十一至§十四构成 Cortex 工程规范层——代码怎么写、模块怎么组、接口怎么定、模式怎么用。**
> 至此，代码法典从"不能做什么"（§一~§十 禁止层）闭合到"应该怎么做"（§十一~§十四 指导层）。
