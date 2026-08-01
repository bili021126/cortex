# Cortex — 包定位文档

> 29 个包的职责边界与分层关系。每个包独立发版，依赖图严格 DAG。
>
> **机器可读契约**：分层的可执行真相源在 `packages/tools/src/layer-contract.ts`，
> 由 `packages/tools/tests/layer-contract.test.ts`（`@ci: contract`）门禁强制：
> 新增包或跨包依赖若破坏单向分层，门禁即刻阻断。

---

## 分层架构

```
L4 编排/入口   engine（⭐运行时内核/编排器） · cli（CLI+TUI+WebUI） · server（daemon/REST/WS） · desktop
                     │ 依赖 ↓
L3 领域/治理   governance · skill-kit
                     │ 依赖 ↓
L2 复合服务    memory-store · platform
                     │ 依赖 ↓
L1 核心服务    llm · doctor · scheduler · memory · plugin-runner · prompt-kit · context-manager · client
                     │ 依赖 ↓
L0 基础层      shared · config · tools · logging · resilience · telemetry
               notification · parser · fsm-compiler · testing · pattern-extractor · protocol · design-tokens
```

> 分层按**真实依赖 DAG** 划分（非概念角色）。高层依赖低层，反向即违规。
> `engine` 编排全部下层子系统（governance / skill-kit / memory-store …），是真正的顶层编排器。

---

## L0 — 基础层（类型 / 配置 / 无状态工具）

| 包 | 定位 | 依赖 | 边界约束（MUST NOT） |
|----|------|------|---------------------|
| `@cortex/shared` | 全项目类型协议层——AgentType、枚举、共享接口、LLM 协议类型（ReasoningEffort / ModelCapabilities / LlmAdapterConfig） | 无 | 不含运行时逻辑；不导入任何 @cortex/* 包；不定义实现类 |
| `@cortex/config` | 统一配置真相源——JSON 配置加载器、模型注册表（models.json）、环境变量常量、DeepSeek V4 参数默认值 | shared | 不含业务逻辑；不发起网络请求；不依赖 L1+ 包 |
| `@cortex/tools` | 工具注册 + monorepo 分析/分层契约强制执行 | shared | 不含 Agent 逻辑；不依赖 engine/cli |
| `@cortex/logging` | 结构化日志——统一日志接口 | 无 | 不含业务语义；不依赖任何 @cortex/* 包 |
| `@cortex/resilience` | 容错与重试——重试策略、断路器（SimpleCircuitBreaker） | 无 | 不含 LLM/HTTP 语义；纯算法层 |
| `@cortex/telemetry` | 遥测采集层——结构化事件记录、HealthCollector、PanoramaTracker | shared | 不含业务决策；不修改状态；只读采集 |
| `@cortex/notification` | 事件路由与通知——四通道物理分层（FYI/WARNING/DECISION_REQUIRED） | 无 | 不含 UI 渲染；不依赖 L1+ 包 |
| `@cortex/parser` | AST 解析——代码结构分析（tree-sitter） | 无 | 不含执行逻辑；纯解析 |
| `@cortex/fsm-compiler` | FSM 编译工具链——JSON DSL → TypeScript → Mermaid | 无 | 不含运行时状态机执行；纯编译 |
| `@cortex/testing` | 测试基础设施——Mock 工厂、集成测试工具 | shared | 仅 devDependency 使用；不进入生产 bundle |
| `@cortex/pattern-extractor` | 模式提取器——执行输出 → 技能结晶 | 无 | 不含 LLM 调用；纯文本模式匹配 |
| `@cortex/protocol` | 客户端↔engine 通信协议——纯类型 DTO + 版本协商 + 轻量校验，零运行时依赖 | 无 | 不含网络实现；不含运行时逻辑；不依赖任何 @cortex/* 包 |
| `@cortex/design-tokens` | 三端共享设计常量——双 palette（ENGINEERING/PRESENCE）+ 间距/字体/圆角 | 无 | 不含渲染逻辑；不依赖任何 @cortex/* 包 |

## L1 — 核心服务（单一职责，仅依赖 L0）

| 包 | 定位 | 依赖 | 边界约束（MUST NOT） |
|----|------|------|---------------------|
| `@cortex/llm` | DeepSeek V4 API 适配层——chat/chatStream、七级 reasoning_effort、capabilities 驱动 thinking 判定、LRU 缓存、断路器、限流、审计日志 | resilience, shared, telemetry | 不含 Agent 逻辑；不含调度逻辑；不直接操作文件系统（审计日志除外）；不依赖 engine/scheduler/platform |
| `@cortex/doctor` | 项目健康诊断——依赖、配置、完整性检查 | tools | 不含修复逻辑（只诊断）；不依赖 L1+ 包 |
| `@cortex/scheduler` | 四抽象调度引擎——IScheduleStrategy × ILoopDriver × IExecutionModel × IModelRouter | config, shared | 不含 LLM 调用；不含工具执行；通过接口注入 Agent 实现 |
| `@cortex/memory` | 记忆系统核心——记忆类型定义、生命周期状态机 | config, shared | 不含存储实现（由 memory-store 提供）；不含向量检索 |
| `@cortex/plugin-runner` | 插件运行器——沙箱插件生命周期管理 | config, shared | 不含具体插件实现；不直接调用 LLM |
| `@cortex/prompt-kit` | 提示词工程工具包——模板渲染、上下文组装、变量插值 | config | 不含 LLM 调用；纯字符串处理 |
| `@cortex/context-manager` | 上下文管理——窗口策略、压缩、token 预算分配 | config, shared | 不含 LLM 调用；不含记忆持久化 |
| `@cortex/client` | 客户端 SDK——三端共用的 engine 连接层（WS/HTTP） | protocol | 不含 UI 渲染；不含引擎逻辑；仅做通信 |

## L2 — 复合服务（组合 L1/L0）

| 包 | 定位 | 依赖 | 边界约束（MUST NOT） |
|----|------|------|---------------------|
| `@cortex/memory-store` | 记忆存储与检索——向量检索、图谱推理、SQLite 持久化 | config, fsm-compiler, llm, memory, shared, telemetry | 不含 Agent 调度逻辑；不含治理规则 |
| `@cortex/platform` | 平台层——Toolkit 工具注册、权限校验、ReversibilityLevel 分级 | config, scheduler, shared | 不含 LLM 调用；不含 Agent 生命周期管理 |

## L3 — 领域 / 治理

| 包 | 定位 | 依赖 | 边界约束（MUST NOT） |
|----|------|------|---------------------|
| `@cortex/governance` | 治理层——制度化执行引擎、宪法六原则强制、一致性校验、修宪管线 | config, memory-store, shared | 不含 LLM 调用；不含工具执行；通过事件驱动 |
| `@cortex/skill-kit` | 技能系统——技能定义、加载、执行、结晶 | config, memory-store, pattern-extractor, platform, shared | 不含 Agent 调度；不含 LLM 调用 |

## L4 — 编排 / 入口

| 包 | 定位 | 依赖 | 边界约束（MUST NOT） |
|----|------|------|---------------------|
| `@cortex/engine` | ⭐ 运行时内核——Agent 生命周期编排、ReAct 循环、Bootstrap 集成、全部下层子系统协调 | 16 包（见 layer-contract） | 不含 UI 渲染；不含 HTTP 服务；不含 CLI 命令解析 |
| `@cortex/cli` | 命令行入口 + Ink TUI 终端渲染 + WebUI 后端（/api/v1/*）+ EngineBridge 桥接 | engine 等 | 不含核心算法（委托 engine）；API 层仅做路由/校验/序列化 |
| `@cortex/server` | 独立 daemon 守护进程——托管 engine + RESTful /api/v1 + WebSocket 网关 + 会话管理（bin: cortex-daemon） | engine, config, llm, memory-store, platform, protocol, scheduler, shared, telemetry, tools | 不含核心算法（委托 engine）；不含 UI 渲染 |
| `@cortex/desktop` | Electron + Live2D 桌宠（渲染 + 主进程 IPC） | client, design-tokens, shared | 不含调度逻辑；通过 IPC 委托 engine |

---

## 边界原则

1. **单向依赖**：低层包绝不依赖高层包（L0 ← L1 ← L2 ← L3 ← L4）
2. **最小暴露**：跨包类型走 `@cortex/shared`，不跨包引用内部类型
3. **可替换**：每个包有接口定义（`I*` / `*Protocol`），实现可替换
4. **无循环依赖**：依赖图严格 DAG，CI 门禁校验
5. **能力声明驱动**：模型能力（thinking/streaming/maxTokens）由 `ModelCapabilities` 接口声明，禁止字符串匹配推断
6. **API 版本化**：所有 HTTP 端点走 `/api/v1/*` 前缀，错误响应遵循 RFC 7807 Problem Details

---

## DeepSeek V4 适配契约

Cortex 全栈围绕 DeepSeek V4 双模型构建：

| 模型 | 定位 | 上下文 | 最大输出 | Thinking | 默认 Agent |
|------|------|--------|----------|----------|-----------|
| `deepseek-v4-flash` | 快速执行 | 1M tokens | 64K | 否 | fix/review/inspector/ops/browser/api/data/doc-govern/loop/butler |
| `deepseek-v4-pro` | 深度推理 | 1M tokens | 384K | 是（七级） | code/analysis/meta |

**七级 reasoning_effort**：`off → minimal → low → medium → high → xhigh → max`

**四路 Key 隔离**：CYRENE（独立人格）/ GANYU（MetaAgent）/ CHAT（通用池）/ REASONER（专用推理）

**适配层职责链**：
```
config/models.json（能力注册）→ shared/ModelCapabilities（类型协议）
    → llm/LlmAdapter._shouldEnableThinking()（运行时判定）
    → scheduler/IModelRouter（任务级路由）
```

---

## RESTful API 契约（@cortex/cli 承载）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/v1/state` | GET | 完整 WebUIState 快照 |
| `/api/v1/nodes` | GET | TaskBoard 节点列表（分页 + 状态过滤） |
| `/api/v1/nodes/:id` | GET | 单节点详情 |
| `/api/v1/agents` | GET | AgentPool 全量状态 |
| `/api/v1/agents/:type` | GET | 按类型查询 Agent |
| `/api/v1/health` | GET | 健康快照 |
| `/api/v1/execute` | POST | 触发执行（含请求体校验） |
| `/api/v1/events` | GET | 最近事件（分页 + 类型过滤） |

**规范**：RFC 7807 错误格式 / X-Request-Id 链路追踪 / 分页（page+limit） / 405+Allow 头 / 413 体积限制
