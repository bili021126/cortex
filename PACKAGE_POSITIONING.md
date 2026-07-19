# Cortex — 包定位文档

> 25 个包的职责边界与分层关系。每个包独立发版，依赖图严格 DAG。
>
> **机器可读契约**：分层的可执行真相源在 `packages/tools/src/layer-contract.ts`，
> 由 `packages/tools/tests/layer-contract.test.ts`（`@ci: contract`）门禁强制：
> 新增包或跨包依赖若破坏单向分层，门禁即刻阻断。

---

## 分层架构

```
L4 编排/入口   engine（⭐运行时内核/编排器） · cli · desktop
                     │ 依赖 ↓
L3 领域/治理   governance · skill-kit
                     │ 依赖 ↓
L2 复合服务    memory-store · platform
                     │ 依赖 ↓
L1 核心服务    llm · doctor · scheduler · memory · plugin-runner · prompt-kit · context-manager
                     │ 依赖 ↓
L0 基础层      shared · config · tools · logging · resilience · telemetry
               notification · parser · fsm-compiler · testing · pattern-extractor
```

> 分层按**真实依赖 DAG** 划分（非概念角色）。高层依赖低层，反向即违规。
> `engine` 编排全部下层子系统（governance / skill-kit / memory-store …），是真正的顶层编排器。

---

## L0 — 基础层（类型 / 配置 / 无状态工具）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/shared` | 全项目类型协议层——AgentType、枚举、共享接口 | 无 |
| `@cortex/config` | 统一配置真相源——JSON 配置加载器 | shared |
| `@cortex/tools` | 工具注册 + monorepo 分析/分层契约 | shared |
| `@cortex/logging` | 结构化日志——统一日志接口 | 无 |
| `@cortex/resilience` | 容错与重试——重试策略、断路器 | 无 |
| `@cortex/telemetry` | 遥测采集层——结构化事件记录 | shared |
| `@cortex/notification` | 事件路由与通知——四通道物理分层 | 无 |
| `@cortex/parser` | AST 解析——代码结构分析 | 无 |
| `@cortex/fsm-compiler` | FSM 编译工具链——JSON → TypeScript → Mermaid | 无 |
| `@cortex/testing` | 测试基础设施——Mock 工厂、集成测试工具 | shared |
| `@cortex/pattern-extractor` | 模式提取器——执行输出 → 技能结晶 | 无 |

## L1 — 核心服务（单一职责，仅依赖 L0）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/llm` | LLM 适配器——DeepSeek/通用 API 封装、限流 | resilience, shared |
| `@cortex/doctor` | 项目健康诊断——依赖、配置、完整性检查 | tools |
| `@cortex/scheduler` | 三抽象调度执行引擎——策略 × 驱动 × 范式 | config, shared |
| `@cortex/memory` | 记忆系统核心——记忆类型、生命周期 | config, shared |
| `@cortex/plugin-runner` | 插件运行器——沙箱插件生命周期 | config, shared |
| `@cortex/prompt-kit` | 提示词工程工具包——模板渲染、上下文组装 | config |
| `@cortex/context-manager` | 上下文管理——窗口策略、压缩 | config, shared |

## L2 — 复合服务（组合 L1/L0）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/memory-store` | 记忆存储与检索——向量检索、图谱推理 | config, fsm-compiler, llm, memory, shared |
| `@cortex/platform` | 平台层——Toolkit 工具注册、权限校验 | config, scheduler, shared |

## L3 — 领域 / 治理

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/governance` | 治理层——制度化执行引擎（已并入 consistency 一致性校验） | config, memory-store, shared |
| `@cortex/skill-kit` | 技能系统——技能定义、加载、执行 | config, memory-store, pattern-extractor, platform, shared |

## L4 — 编排 / 入口

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/engine` | ⭐ 运行时内核——Agent 生命周期，编排全部下层子系统 | 16 包（见 layer-contract） |
| `@cortex/cli` | 命令行入口 + EngineBridge 桥接（已并入 tui 终端渲染） | engine 等 13 包 |
| `@cortex/desktop` | Electron + Live2D 桌宠（渲染 + 主进程） | engine, llm, shared |

---

## 边界原则

1. **单向依赖**：低层包绝不依赖高层包（L0 ← L1 ← L2 ← L3 ← L4）
2. **最小暴露**：跨包类型走 `@cortex/shared`，不跨包引用内部类型
3. **可替换**：每个包有接口定义（`I*` / `*Protocol`），实现可替换
4. **无循环依赖**：依赖图严格 DAG，CI 门禁校验
