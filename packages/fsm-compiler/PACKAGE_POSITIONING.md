# @cortex/fsm-compiler — 包定位文档

> **版本**: v0.1.0  
> **状态**: Core-2 可用  
> **来源**: solo-flight E2E 自举生成

---

## 一、一句话定位

**@cortex/fsm-compiler** 是 Cortex 生态中的**分层有限状态机编译工具链**——提供 JSON DSL → 校验 AST → TypeScript 代码生成 → 运行时解释执行的完整链路，为任务调度、Agent 生命周期、确认门禁等场景提供类型安全的 FSM 基础。

---

## 二、解决的问题

### 2.1 痛点矩阵

| 痛点 | 此前状态 | 本包解决方式 |
|------|---------|-------------|
| **状态逻辑散落** | 调度器内部 hardcode if/switch 状态转移 | `task-node.fsm.json` DSL 声明式定义状态图，编译器生成带类型的 TS 代码 |
| **无统一建模** | AgentPool、ConfirmGate、TrustModel 各写一套状态机 | 统一 `FsmDefinition` JSON schema，复用 parser → validator → generator 管线 |
| **无编译期检查** | 手工维护枚举与转移表一致性，运行时才暴露错误 | `FsmValidator` 语义校验：不可达状态、悬挂事件、死锁段检测 |
| **无可视化** | 状态流转逻辑散落在 TypeScript 源码中，难以审计 | `DiagramGenerator` 输出 Mermaid 状态图 / Graphviz DOT |
| **无审计追溯** | 状态变迁无记录，问题复现困难 | `HistoryRecorder` 全量变迁记录，支持按状态/事件/时间范围查询 |

### 2.2 已完成定义

| 定义文件 | 建模对象 | 状态数 | 核心语义 |
|---------|---------|--------|---------|
| `task-node.fsm.json` | TaskNode 任务节点 | 5 | pending → running → paused/completed/failed |
| `agent-pool.fsm.json` | AgentPool 代理池 | 3 | idle → active → draining |
| `confirm-gate.fsm.json` | ConfirmGate 确认门禁 | 2 | open → closed |
| `manifold-gate.fsm.json` | ManifoldGate 多重门禁 | 3 | waiting → evaluating → resolved |
| `memory-entry.fsm.json` | MemoryEntry 记忆条目 | 3 | draft → confirmed → archived |
| `trust-model.fsm.json` | TrustModel 信任模型 | 3 | baseline → elevated → restricted |

### 2.3 不做的事

- ❌ 不替代调度器自身的调度逻辑 — 本包建模调度器**内部**状态，不替代外部调度
- ❌ 不自行持久化 — 快照序列化由外部调用方决定存储介质
- ❌ 不提供网络通信 — FSM 运行在单进程内，分布式协调由上层实现

---

## 三、上下游关系

### 3.1 依赖关系图

```
@cortex/fsm-compiler
  ├─ src/dsl/schema.ts       — JSON Schema 定义（零外部依赖）
  ├─ src/compiler/parser.ts  — JSON → AST 解析
  ├─ src/compiler/validator.ts — AST 语义校验（可达性、死锁）
  ├─ src/compiler/generators/  — 代码生成（TypeScript + Diagram）
  ├─ src/runtime/              — 运行时解释执行 + 守卫/动作注册表
  └─ src/cli/                  — CLI 入口（fsmc compile/validate/diagram）
       ↓ 被消费
@cortex/engine  — 调度器状态机、AgentPool 生命周期、ConfirmGate
@cortex/factory — 包生成器可编译 FSM 定义为 TS 类型（未来）
```

### 3.2 三层架构

| 层 | 模块 | 职责 |
|----|------|------|
| **Layer 1: DSL** | `dsl/schema.ts` | JSON Schema 定义 + 运行时类型守卫 |
| **Layer 2: Compiler** | `compiler/parser.ts`, `compiler/validator.ts`, `compiler/generators/` | 编译期：解析 → 校验 → 生成 |
| **Layer 3: Runtime** | `runtime/state-machine.ts`, `runtime/guard-registry.ts`, `runtime/action-registry.ts`, `runtime/history-recorder.ts` | 运行时：解释执行 + 守卫评估 + 动作触发 + 审计 |

---

## 四、核心 API 一览

```typescript
import {
  FsmParser, FsmValidator, TypeScriptGenerator, DiagramGenerator,
  StateMachine, GuardRegistry, ActionRegistry, HistoryRecorder,
  TransitionError, GuardError,
} from "@cortex/fsm-compiler";

// 编译期管线
const parser = new FsmParser();
const ast = parser.parse(fsmJson);

const validator = new FsmValidator();
const result = validator.validate(ast);
if (!result.valid) console.error(result.errors);

const tsGen = new TypeScriptGenerator();
const tsCode = tsGen.generate(ast);

// 运行时
const guards = new GuardRegistry();
guards.register("canExecute", () => true);

const machine = new StateMachine<TaskState, TaskEvent>(fsmDef, "pending", { guards });
machine.dispatch("execute");
machine.dispatch("complete");

// 审计
const recorder = new HistoryRecorder({ maxRecords: 1000 });
recorder.record(machine.history[0]);

// 快照恢复
const snapshot = machine.serialize();
const restored = StateMachine.deserialize(snapshot, fsmDef);
```

---

## 五、测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|---------|--------|---------|
| `tests/types.test.ts` | ~50 | 类型定义完整性、枚举值正确性 |
| `tests/compiler.test.ts` | ~55 | Parser/Validator 全场景、barrel 导出 |
| `tests/runtime.test.ts` | ~60 | StateMachine 全生命周期、守卫、动作 |
| `tests/integration.test.ts` | ~28 | 端到端管线、快照恢复、多机隔离、HistoryRecorder |
| `tests/compiler/parser.test.ts` | ~8 | Parser 单元测试 |
| `tests/compiler/validator.test.ts` | ~12 | Validator 单元测试 |
| `tests/runtime/state-machine.test.ts` | ~20 | StateMachine 单元测试 |
| `tests/runtime/guard-registry.test.ts` | ~6 | GuardRegistry 单元测试 |
| `tests/runtime/action-registry.test.ts` | ~6 | ActionRegistry 单元测试 |

**总计**: 187 tests, 10 test files, 0 skipped
