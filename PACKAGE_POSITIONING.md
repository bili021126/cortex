# Cortex — 包定位文档

> 26 个包的职责边界与分层关系。每个包独立发版，依赖图严格 DAG。

---

## 分层架构

```
L0 类型/配置     shared → config → tools
                     ↓
L1 引擎/调度     engine (⭐内核) → scheduler → fsm-compiler → llm → plugin-runner → platform
                     ↓
L2 治理/校验     doctor → notification → telemetry → governance → consistency → logging → resilience
                     ↓
L3 交互/技能     cli → tui → prompt-kit → skill-kit → context-manager → memory → memory-store
                     ↓
L4 辅助/工具     parser → pattern-extractor → testing
```

---

## L0 — 类型与配置（零依赖层）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/shared` | 全项目类型协议层——AgentType、枚举、共享接口 | 无 |
| `@cortex/config` | 统一配置真相源——JSON 配置加载器，零外部依赖 | shared |
| `@cortex/tools` | 工具注册与适配——工具元数据、参数 Schema | shared |

## L1 — 引擎与调度（运行时核心）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/engine` | ⭐ 运行时内核——Agent 生命周期、记忆、工具包、调度入口 | shared, config, llm, memory, scheduler |
| `@cortex/scheduler` | 三抽象调度执行引擎——策略 × 驱动 × 范式 | shared |
| `@cortex/fsm-compiler` | FSM 编译工具链——JSON → TypeScript → Mermaid | shared |
| `@cortex/llm` | LLM 适配器——DeepSeek/通用 API 封装、限流 | shared |
| `@cortex/plugin-runner` | 插件运行器——沙箱插件生命周期 | shared |
| `@cortex/platform` | 平台层——Toolkit 工具注册、权限校验 | shared, tools |

## L2 — 治理与校验（制度化保障）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/doctor` | 项目健康诊断——依赖、配置、完整性检查 | shared |
| `@cortex/notification` | 事件路由与通知——四通道物理分层 | shared |
| `@cortex/telemetry` | 遥测采集层——结构化事件记录 | shared |
| `@cortex/governance` | 治理层——制度化制度执行引擎 | shared |
| `@cortex/consistency` | 一致性检查——跨包依赖与接口契约验证 | shared |
| `@cortex/logging` | 结构化日志——统一日志接口 | shared |
| `@cortex/resilience` | 容错与重试——重试策略、断路器 | shared |

## L3 — 交互与技能（Agent 能力层）

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/cli` | 命令行入口 + EngineBridge 桥接 | shared, engine, tui |
| `@cortex/tui` | 终端渲染层（独立包，被 cli 依赖） | shared |
| `@cortex/prompt-kit` | 提示词工程工具包——模板渲染、上下文组装 | shared |
| `@cortex/skill-kit` | 技能系统——技能定义、加载、执行 | shared |
| `@cortex/context-manager` | 上下文管理——窗口策略、压缩 | shared |
| `@cortex/memory` | 记忆系统核心——记忆类型、生命周期 | shared |
| `@cortex/memory-store` | 记忆存储与检索——向量检索、图谱推理 | shared, memory |

## L4 — 辅助与工具

| 包 | 定位 | 依赖 |
|----|------|------|
| `@cortex/parser` | AST 解析——代码结构分析 | shared |
| `@cortex/pattern-extractor` | 模式提取器——执行输出 → 技能结晶 | shared, parser |
| `@cortex/testing` | 测试基础设施——Mock 工厂、集成测试工具 | shared |

---

## 边界原则

1. **单向依赖**：低层包绝不依赖高层包（L0 ← L1 ← L2 ← L3 ← L4）
2. **最小暴露**：跨包类型走 `@cortex/shared`，不跨包引用内部类型
3. **可替换**：每个包有接口定义（`I*` / `*Protocol`），实现可替换
4. **无循环依赖**：依赖图严格 DAG，CI 门禁校验
