# Cortex Monorepo Packages/ 分析报告

> 报告生成时间：2026-04-10  
> 分析范围：`/cortex/packages/`  
> 报告人：久岐忍（Api Agent）

---

## 一、包清单与版本

| 包名 | 版本 | 路径 | 描述 |
|------|------|------|------|
| `@cortex/shared` | 0.1.0 | `packages/shared` | 类型中枢 — 共享类型定义、枚举、常量 |
| `@cortex/llm` | 0.1.0 | `packages/llm` | LLM 适配层 — 封装大模型调用 |
| `@cortex/engine` | 0.1.0 | `packages/engine` | 引擎核心 — 调度、Agent、记忆系统 |
| `@cortex/testing` | 0.1.0 | `packages/testing` | 测试工具包 — Mock 数据生成器 |

---

## 二、包依赖关系

### 2.1 依赖图

```
@cortex/shared  (零内部运行时依赖)
    ├── @cortex/llm
    │     └── @cortex/engine
    └── @cortex/testing
```

### 2.2 依赖详情

| 源包 | 目标包/依赖 | 类型 | 声明 |
|------|-------------|------|------|
| `@cortex/engine` | `@cortex/llm` | runtime | `workspace:*` |
| `@cortex/engine` | `@cortex/shared` | runtime | `workspace:*` |
| `@cortex/engine` | `@xenova/transformers` | runtime | `^2.17.2` |
| `@cortex/engine` | `better-sqlite3` | runtime | `^11.0.0` |
| `@cortex/engine` | `@cortex/testing` | dev | `workspace:*` |
| `@cortex/llm` | `@cortex/shared` | runtime | `workspace:*` |
| `@cortex/testing` | `@cortex/shared` | runtime | `workspace:*` |
| `@cortex/testing` | `uuid` | runtime | `^10.0.0` |

### 2.3 外部依赖一致性

| 外部依赖 | 使用方 | 解析版本 | 范围 |
|----------|--------|----------|------|
| `typescript` | 全部 4 包 + 根 | 5.9.3 | ^5.7.0 |
| `vitest` | 全部 4 包 + 根 | 2.1.9 | ^2.1.0 |
| `eslint` | engine, testing, 根 | 10.3.0 | ^10.3.0 |
| `@types/node` | engine, llm | 22.19.17 | ^22.0.0 |
| `better-sqlite3` | engine | 11.10.0 | ^11.0.0 |
| `@xenova/transformers` | engine | 2.17.2 | ^2.17.2 |
| `uuid` | testing | 10.0.0 | ^10.0.0 |
| `playwright` | engine (dev) | 1.59.1 | ^1.59.1 |

---

## 三、循环依赖分析

### 结论：**无循环依赖** ✅

#### 验证方法
- 遍历 `packages/*/package.json` 的 `dependencies` 字段
- 遍历 `packages/*/src/` 中所有 `import` / `export` 语句的包引用
- 结合 `pnpm-lock.yaml` 验证解析路径

#### 逐项验证

| 检查项 | 结果 |
|--------|------|
| `shared` → 导入任何内部包 | ❌ 无。shared 零内部运行时依赖 |
| `llm` → 导入 `engine` / `testing` | ❌ 无。llm 仅导入 shared |
| `engine` → 导入自身 | ❌ 无 |
| `testing` → 导入 `engine` / `llm` | ❌ 无。testing 仅导入 shared |
| devDependencies 形成循环 | ❌ 无。devDeps 不参与运行时环检测 |

依赖图为**有向无环图（DAG）**，不存在环。

---

## 四、版本冲突分析

### 结论：**无版本冲突** ✅

#### 内部包
- 所有 workspace 引用均使用 `workspace:*` 协议
- pnpm 通过 `link:../xxx` 解析为本地路径，版本完全锁定

#### 外部依赖
- 检查 `pnpm-lock.yaml` 中所有依赖解析记录
- **所有外部依赖均只存在一个解析版本**，无多版本共存现象

#### 潜在风险提示
- `@xenova/transformers@2.17.2` 依赖 `sharp`、`onnxruntime` 等原生模块，部署环境需具备编译工具链
- `better-sqlite3@11.10.0` 为原生模块，Node.js 需 ≥20.0.0（当前约束 `>=20.0.0 <25.0.0` 满足）
- pnpm 9.15.4 ≥ 9.0.0 约束满足

---

## 五、架构模式分析

### 5.1 分层架构（Layered Architecture）

```
┌──────────────────────────────────────────────┐
│              @cortex/engine                   │  业务逻辑层
│  Scheduler, TaskBoard, AgentPool,             │
│  MemoryStore, Toolkit, BaseAgent, 各 Agent    │
├──────────────────────────────────────────────┤
│              @cortex/llm                      │  适配层
│  LlmAdapter                                   │
├──────────────────────────────────────────────┤
│              @cortex/shared                   │  类型契约层
│  AgentType, TaskNode, MemoryEntry, 等         │
├──────────────────────────────────────────────┤
│              @cortex/testing                  │  测试工具层（侧边）
│  syntheticTaskNode, generateSyntheticMemories │
└──────────────────────────────────────────────┘
```

关键设计原则：
- **单向依赖**：上层依赖下层，下层绝不反向依赖
- **类型契约**：shared 定义所有跨包类型，消除循环类型引用
- **测试工具独立**：testing 仅依赖 shared，不参与生产运行时

### 5.2 类型中枢（Type Hub）模式

`@cortex/shared` 充当 monorepo 的类型中枢：

```typescript
// shared/src/index.ts —— 桶导出所有类型
export * from "./agent.js";        // AgentType, AgentStatus, TAG_VOCABULARY
export * from "./task.js";         // TaskNode, NodeResult, PipelineEventType
export * from "./memory.js";       // MemoryEntry, MemoryState, MemoryQuery
export * from "./toolkit.js";      // ToolInvocation, ToolResult, ToolHandler
export * from "./infra.js";
export * from "./cli-adapter.js";
export * from "./file-lock-manager.js";
export * from "./skill-registry.js";
```

- 所有业务包从同一源头获取类型定义，避免类型碎片化
- `export *` 简化导入路径

### 5.3 适配器（Adapter）模式

```typescript
// @cortex/llm  LlmAdapter 适配不同 LLM 后端
export class LlmAdapter {
  async chat(taskNode: TaskNode, model: string): Promise<string>
}
```

- engine 通过 `LlmAdapter` 调用 LLM，不依赖具体 API
- 可替换为 OpenAI / Anthropic / 本地模型而不影响 engine

### 5.4 工厂（Factory）模式

```typescript
// engine  v2.1 组合式架构
createAgent(codeAgentConfig(), llm, toolkit, memory) → Agent
```

- 每个 Agent 类型提供 `*AgentConfig()` 配置函数
- 配置与实现分离，便于测试和替换
- 替代旧版 `new CodeAgent(llm, toolkit, memory)` 继承方式

### 5.5 外观（Facade）模式 — MemoryStore

```
MemoryStore (Facade)
  ├── MemoryStorage      (Map<id, MemoryEntry>)
  ├── MemoryPersistence  (SQLite WAL write-through)
  ├── MemoryLifecycle    (四态状态机 CAS)
  └── MemoryQueryEngine  (内存扫描 + BFS + 向量召回)
```

- 统一对外暴露 `write / read / link / cas / archive / freeze / obliterate`
- 异常处理：DB 失败回滚内存（假阳性禁止原则）

### 5.6 状态机（State Machine）模式

**Agent 生命周期：**
```
Created → Awake → Active → Draining → Destroyed
```

**Memory 四态状态机：**
```
Active → Archived → Frozen → Obliterated
         (30天TTL)   (只读)    (不可逆)
```

- CAS 保证原子性，非法转换被拒绝
- 状态变更持久化到 SQLite，异常时回滚

### 5.7 模板方法（Template Method）模式

```typescript
abstract class BaseAgent {
  // 模板方法：定义算法骨架
  async execute(node, model) {
    const enriched = await this.preExecuteHook(node);  // 钩子
    return executeWithMemoryPipeline({...}, enriched, model, ...);
  }

  // 钩子方法：子类可覆写
  protected preExecuteHook(node) { return node; }
  protected getMemoryQuery(node) { ... }
}
```

- CodeAgent 覆写 `getMemoryQuery` 优先 `PRODUCED_BY`
- ReviewAgent 优先 `CITED_IN_COMMITTEE`
- DocGovernAgent 含 `Archived` 态记忆（审计追溯）

### 5.8 观察者（Observer）模式

`PipelineObserver` 在关键路径发射事件：
- `MemorySqlDegraded`（SQL 查询退化至内存扫描）
- `MemoryDbWriteFailed`（DB 写入失败）

优先级：`CRITICAL` > `HIGH` > `NORMAL`

### 5.9 组合式 Agent 架构（v2.1）

| 维度 | 旧版（@deprecated） | 新版（组合式） |
|------|-------------------|---------------|
| 创建方式 | `new CodeAgent(llm, tk, mem)` | `createAgent(codeAgentConfig(), ...)` |
| 配置 | 硬编码在类中 | 纯配置对象 |
| 扩展 | 继承 BaseAgent | 组合配置 + 工厂 |
| 状态管理 | 各自实现 | `PoolAwareState` 统一管理 |
| 可测试性 | 中等 | 高（DI + 纯配置） |

---

## 六、代码健康度

### 6.1 测试覆盖

| 包 | 测试文件 | 框架 | 备注 |
|----|---------|------|------|
| `shared` | `src/__tests__/types.test.ts` | vitest | 类型、枚举、接口形状测试 |
| `llm` | 未发现 | vitest | `--passWithNoTests` 允许空测试 |
| `engine` | 未在 `src/__tests__` 下 | vitest | 可能有测试在 `tests/` |
| `testing` | 未发现 | vitest | 本身为测试工具包 |

### 6.2 废弃 API 存量

`engine/src/index.ts` 中 `@deprecated` 标记的导出（计划 v2.2 移除）：
- `CodeAgent`, `ReviewAgent`, `AnalysisAgent`, `OpsAgent`, `LoopAgent`, `DocGovernAgent`, `FixAgent`, `InspectorAgent`, `BrowserAgent`
- `runReActLoopLegacy`

### 6.3 代码规范

- 全部包使用 TypeScript 5.9.3 + ESLint 10.3.0
- `shared` 和 `engine` 的入口文件包含完整契约文档
- 类型导入使用 `import type`，运行时与类型分离

---

## 七、发现的问题与建议

### 7.1 已确认无问题项
- ✅ 无循环依赖
- ✅ 无版本冲突
- ✅ workspace 协议一致
- ✅ 包命名规范（`@cortex/*`）
- ✅ pnpm 工作区配置正确
- ✅ Node.js 引擎约束满足

### 7.2 建议改进

| # | 严重程度 | 描述 | 建议 |
|---|---------|------|------|
| S-01 | 🟡 中 | `engine` 将 `@cortex/llm` 声明为 `dependencies`，但仅以 `import type` 引用类型。 | 确认构建产物不包含运行时引用，或改为 `peerDependencies` |
| S-02 | 🟢 低 | `testing` 的 `uuid` 在 `dependencies` 而非 `devDependencies` | 移至 `devDependencies` 减少生产安装体积 |
| S-03 | 🟡 中 | 核心包测试覆盖不足 | 优先为 `MemoryStore` 和 `LlmAdapter` 补充测试 |
| S-04 | 🟢 低 | 废弃类 Agent 与组合式 Agent 并存 | 按计划 v2.2 移除废弃类 |
| S-05 | 🔵 信息 | `engine/index.ts` 导出 40+ 符号，API surface 较大 | 考虑将废弃导出移至独立文件 |

---

## 八、总结

Cortex monorepo 的 `packages/` 目录呈现**分层 + 类型中枢**架构，依赖管理规范，无循环依赖和版本冲突。架构模式丰富（工厂、适配器、外观、状态机、模板方法、观察者），v2.1 组合式重构有序推进。

**三个关键结论：**
1. **依赖健康** — DAG 结构清晰，workspace 协议统一，lockfile 无重复版本
2. **架构规范** — 分层明确，模式使用得当，代码注释包含契约文档
3. **改进空间** — 测试覆盖待加强，废弃 API 需按计划清理

---

*报告完毕。奉行文书不需要序言。——久岐忍*
