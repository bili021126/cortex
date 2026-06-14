# 🧠 Cortex 韧性（Resilience）模式探索报告

> **任务**: 探索母项目现有包结构，读取 engine/scheduler/tools 等核心包的 `src/index.ts`，
> 搜索是否存在重试、断路器、超时等韧性接口，记录已实现的功能。
>
> **报告生成时间**: 2026-07-25  
> **覆盖范围**: 全仓 19+ 包，重点覆盖 engine / scheduler / tools / llm / governance / consistency / platform / plugin-runner / notification / telemetry / shared

---

## 一、包结构总览

```
packages/
├── engine/          ★ 引擎胶水层（调度、Agent、生命周期、管线、插件）
├── scheduler/       ★ 调度核心（任务板、Agent池、分发步骤、重规划、流控）
├── tools/             monorepo 分析器 + 配置漂移检测
├── llm/             ★ LLM 适配器（含重试、限流、缓存、超时）
├── platform/        ★ 平台层（MCP 客户端、搜索后端、文件锁）
├── governance/       修宪管线（提案评判、闭环、超时处置）
├── consistency/      记忆-现实一致性校验（冲突检测、Schema 执行）
├── config/           配置常量（超时参数、环境变量映射）
├── shared/           共享类型（PipelineObserver、SafeErrorReporter、Agent 协议）
├── plugin-runner/   ★ 沙箱执行引擎（超时切断、异常隔离、拓扑批量）
├── notification/     通知管线（渠道、路由、持久化）
├── telemetry/        运行时遥测（采集、采样、批处理）
├── cli/              CLI 入口
├── memory/           记忆设计
├── memory-store/     记忆存储实现
├── doctor/           诊断工具
├── testing/          测试工具
├── factory/          工厂组件
├── prompt-kit/       提示词工具包
├── fsm-compiler/     状态机编译器
└── ...               其他辅助包
```

---

## 二、已实现的韧性接口 / 模式清单

### 🔁 1. 重试（Retry）

| 实现位置 | 触发条件 | 策略 | 最大次数 | 状态 |
|---------|---------|------|---------|------|
| `packages/llm/src/llm-adapter.ts:_fetchWithRetry()` | 网络异常 / 5xx / 429 | 指数退避 (1s, 2s, 4s) + `Retry-After` 感知 | 3 次 | ✅ **完整** |
| `packages/llm/src/llm-adapter.ts` body-read 重试 | 响应体读取失败 (terminated/aborted) | 指数退避 | 1 次 | ✅ **完整** |
| `packages/platform/src/search-backend.ts` DdgSearchBackend | HTTP 429/5xx 或网络异常 | 线性退避 (1s, 2s) | 2 次 | ✅ **完整** |
| `packages/scheduler/src/core/replan-manager.ts` | 节点执行失败 → 入重规划队列 | MetaAgent 驱动策略 | `maxReplanPerNode` 可配置 | ✅ **完整** |

**关键代码参考**:
```typescript
// LlmAdapter._fetchWithRetry — 指数退避 + Retry-After
private async _fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
  // ... AbortController + Promise.race 双重超时
  if (!res.ok && (res.status >= 500 || res.status === 429) && attempt < MAX_RETRIES) {
    const retryAfter = res.headers.get("Retry-After");
    const serverDelay = retryAfter ? parseInt(retryAfter) * 1000 : 0;
    const delay = Math.max(RETRY_BASE_MS * Math.pow(2, attempt - 1), serverDelay);
    // ... 延迟后递归重试
  }
}
```

**已知缺陷**:
- `chatStream()` 方法**未使用** `_fetchWithRetry`，流式 API 调用无重试保护（review 文档 S3-01）
- `_fetchWithRetry` 中 `AbortSignal.timeout` 在 Windows Node.js 下可能不生效（有 Promise.race 硬兜底补偿）

---

### 🛑 2. 断路器 / 熔断（Circuit Breaker）

| 实现位置 | 模式 | 状态 |
|---------|------|------|
| 独立 `CircuitBreaker` 组件 | **不存在**（设计中标记为 Core-2 功能） | ❌ **未实现** |
| `packages/scheduler/src/core/replan-manager.ts` | 重规划次数超限后放弃（类断路器行为） | ✅ **近似实现** |
| `packages/engine/tests/task-board-stress.test.ts` | R5: CircuitBreaker 熔断测试用例 | ✅ 测试覆盖 |

**状态说明**:  
宪法设计和治理层文档中多次提及 CircuitBreaker（核心-2 治理组件），但当前 Core-1 阶段**无独立断路器实现**。代码中仅有一种"类断路器"行为——`ReplanManager` 在节点达到 `maxReplanPerNode` 或全局 `maxTotalReplans` 上限后放弃重规划，发射 `SchedulerReplanLimit` 事件。

---

### ⏱ 3. 超时（Timeout）

超时是当前实现最完整的韧性模式。

| 实现位置 | 超时项 | 默认值 | 配置方式 |
|---------|-------|-------|---------|
| `packages/llm/src/llm-adapter.ts` | LLM API 请求超时 | 30,000ms | 硬编码 `REQUEST_TIMEOUT_MS` |
| `packages/plugin-runner/src/runner.ts:_withTimeout()` | 插件执行超时 | 30,000ms | `RunnerOptions.timeout` / `ctx.timeoutMs` |
| `packages/platform/src/mcp-client.ts` | MCP tool call 超时 | 15,000ms | `McpServerConfig.timeout` |
| `packages/platform/src/search-backend.ts` | 搜索后端超时 | 15,000ms | 构造函数参数 |
| `packages/scheduler/src/core/confirm-gate.ts` | 用户确认等待超时 | 120,000ms | `toolTimeouts.confirmWait` / 环境变量 |
| `packages/engine/src/lifecycle/lifecycle-manager.ts` | Shutdown 停止超时 | 15,000ms | `SHUTDOWN_TIMEOUT_MS` |
| `packages/engine/src/core/shutdown-warden.ts` | 强制退出延迟 | 2,000ms | `SHUTDOWN_FORCE_EXIT_DELAY_MS` |
| `packages/scheduler/src/core/pipeline-runner.ts` | ReAct 循环超时 | 300,000ms | `reactLoopTimeoutMs` |
| `packages/scheduler/src/dispatch-steps/manifold-gate.ts` | 流控获取超时 | 60,000ms | `manifoldGateAcquireTimeoutMs` |
| `packages/config/src/constants/timeouts.ts` | 任务超时 | 300s | `DEFAULT_TASK_TIMEOUT_SEC` |
| `packages/config/src/constants/timeouts.ts` | 命令超时 | 60s | `DEFAULT_COMMAND_TIMEOUT_SEC` |
| `packages/config/src/defaults.ts` | 工具超时集 | 见配置 | `toolTimeouts` |
| `packages/governance/src/amendment-timeout.ts` | 修宪提案 TTL 超时 | 7天/14天 | `TimeoutConfig` |

**超时模式分类**:

| 模式 | 示例 | 实现方式 |
|------|------|---------|
| `AbortSignal.timeout()` | MCP Client, SearchBackend | 标准 API，浏览器/Node18+ |
| `AbortController` | LlmAdapter._fetchWithRetry | 可编程取消 |
| `Promise.race()` | PluginRunner, LifecycleManager | 硬兜底，兼容性最好 |
| `AbortSignal.any()` | PluginRunner | 合并多个取消源 |
| `setTimeout` 检测 | ConfirmGate | 无超时传播，仅 resolve(false) |
| 基于 TTL 检查 | Governance amendment-timeout | 文件修改时间比对 |

---

### 🚦 4. 限流（Rate Limiting）

| 实现位置 | 类型 | 详情 | 状态 |
|---------|------|------|------|
| `packages/llm/src/rate-limiter.ts` | 滑动窗口 + 每日配额 | 每分钟请求上限 (RPM) + 每日 token 配额 | ✅ **完整** |
| `packages/scheduler/src/dispatch-steps/manifold-gate.ts` | 并发控制 | Agent 级别最大并发数限制 | ✅ **完整** |

**RateLimiter 配置**（环境变量）:

| 变量 | 默认 | 说明 |
|------|------|------|
| `CORTEX_LIMIT_CYRENE_RPM` | 不限 | 昔涟每分钟请求上限 |
| `CORTEX_LIMIT_CHAT_RPM` | 不限 | Chat 池每分钟请求上限 |
| `CORTEX_LIMIT_REASONER_RPM` | 不限 | Reasoner 每分钟请求上限 |
| `CORTEX_QUOTA_*_DAY_TOKENS` | 不限 | 每日 token 配额（100万/500万/50万） |

---

### 📉 5. 降级（Degradation / Graceful Degradation）

| 实现位置 | 降级场景 | 行为 |
|---------|---------|------|
| `packages/scheduler/src/core/pipeline-observer.ts` | SafeErrorReporter | `silent` 连续 3 次自动升级为 `degraded` |
| `packages/platform/src/search-backend.ts` | DdgSearchBackend | MCP 搜索失败时回退到 DDG HTML 抓取 |
| `packages/llm/src/llm-adapter.ts:chatStream()` | 流中断 | 返回已收集的部分内容而非抛异常 |
| `packages/memory-store/...` | SQL 降级 | SQL 操作失败降级为内存扫描 |
| `packages/engine/src/observer/console-bridge.ts` | Console 桥接 | 裸 console 调用转为 PipelineObserver 事件 |

**SafeErrorReporter 三档严重性协议**:

```
fatal    → PipelinePriority.CRITICAL → 同步上报
degraded → PipelinePriority.HIGH     → 异步上报
silent   → 计数器累加，≥3 次 → 自动升级为 degraded
```

---

### 🔌 6. 优雅关闭（Graceful Shutdown）

| 组件 | 关闭顺序 | 超时保护 |
|------|---------|---------|
| `ShutdownWarden` | LifecycleManager → MemoryStore.endSession → close | 15s + 2s 强制退出 |
| `LifecycleManager` | 反向拓扑序: stop + dispose | 每组件 15s 超时 |
| `PluginRunner.shutdown()` | 所有插件 destroy() → 清理工作目录 → 清空状态 | 异常隔离 |
| `McpClient.stop()` | 清理 pending → 传输层 stop | SIGTERM → 2s → SIGKILL |
| `ICortexApi.shutdown()` | 统一 CLI 入口 | — |

---

### 🛡 7. 错误隔离（Error Isolation）

| 实现位置 | 隔离策略 |
|---------|---------|
| `PluginRunner.execute()` | try/catch 包裹全部阶段，单插件崩溃不传播 |
| `PipelineObserver.emit()` | 单个 handler 异常不影响同级后续 handler |
| `SafeErrorReporter` | 统一错误回调，消除 console.error 散布 |
| `LifecycleManager._emit()` | 监听器异常不影响主流程 |

---

### 🩺 8. 健康检查（Health Check）

| 实现位置 | 状态 |
|---------|------|
| 独立 Health Check API | ❌ **未实现**（telemetry DESIGN.md 标记为缺口） |
| `PluginRunner.getStatus()` | ✅ 插件粒度运行时状态 |
| Agent 状态机 (Awake/Active/Sleeping/Destroyed) | ✅ Agent 粒度健康追踪 |

---

### 🔄 9. 重规划（Replan）

| 实现位置 | 详情 |
|---------|------|
| `packages/scheduler/src/core/replan-manager.ts` | 节点失败后入重规划队列 |
| 上限控制 | `maxReplanPerNode`（每节点）+ `maxTotalReplans`（全局） |
| MetaAgent 驱动 | `MetaAgentReplanAdapter` 桥接 |

**事件流**: NodeFailed → ReplanManager.enqueue() → NodeReplanQueued → tryFireReplan() → MetaAgent 产出新节点

---

### 🔀 10. 回退（Fallback）

| 实现位置 | 场景 |
|---------|------|
| `DdgSearchBackend` | MCP 搜索后端不可用时回退到 DuckDuckGo |
| `MetaAgent` 取向分类 | LLM 分类失败时回退关键词匹配 |
| `chatStream` | 流中断时返回部分已收集内容 |
| `cortex-agents.json` | 多模型配置支持模型级回退 |

---

## 三、韧性模式实现总览矩阵

| 模式 | 状态 | Core-1 已落地 | Core-2 计划 | 备注 |
|------|------|:------------:|:-----------:|------|
| 重试 (Retry) | ✅ **完整** | llm-adapter, search-backend | — | chatStream 是已知缺口 |
| 超时 (Timeout) | ✅ **完整** | 11 处独立实现 | — | 覆盖面最广 |
| 限流 (Rate Limiting) | ✅ **完整** | RateLimiter + ManifoldGate | — | 双层限流 |
| 错误隔离 | ✅ **完整** | PluginRunner, PipelineObserver | — | |
| 优雅关闭 | ✅ **完整** | LifecycleManager, ShutdownWarden | — | |
| 降级 (Degradation) | ✅ **基本完整** | SafeErrorReporter, DDG fallback | — | 静默升级机制独特 |
| 回退 (Fallback) | ✅ **基本完整** | 多场景 | — | |
| 重规划 (Replan) | ✅ **完整** | ReplanManager | — | |
| 断路器 (CircuitBreaker) | ❌ **未实现** | 仅类断路器行为 | 🗓 Core-2 治理组件 | 设计文档已定义 |
| 舱壁隔离 (Bulkhead) | ❌ **未实现** | — | 未计划 | 未发现相关设计 |
| 健康检查 API | ❌ **缺口** | 插件/Agent 粒度 | 🗓 待补充 | telemetry 标记 |
| 缓存 (Cache) | ✅ **完整** | LlmAdapter LRU 缓存 | — | 非典型韧性但减轻下游压力 |

---

## 四、各包韧性能力分布

```
包                    重试  超时  限流  降级  熔断  优雅关闭  错误隔离  健康检查
───                  ────  ────  ────  ────  ────  ──────  ──────  ──────
@cortex/engine        △    ●     △     ●     △     ●       ●       △
@cortex/scheduler     ●    ●     ●     ●     △     —       ●       —
@cortex/llm           ●    ●     ●     —     —     —       —       —
@cortex/platform      ●    ●     —     —     —     ●       —       —
@cortex/plugin-runner —    ●     —     —     —     ●       ●       ●
@cortex/governance    —    ●     —     —     —     —       —       —
@cortex/shared        —    —     —     ●     —     —       ●       —
@cortex/config        —    ●     —     —     —     ●       —       —
@cortex/consistency   —    —     —     —     —     —       —       —
@cortex/telemetry     —    —     —     —     —     —       —       △
@cortex/notification  —    —     —     —     —     —       —       —
@cortex/tools         —    —     —     —     —     —       —       —

图例: ● = 完整实现  △ = 部分/间接  — = 未涉及
```

---

## 五、架构观察与建议

### 亮点
1. **SafeErrorReporter 三档 + 静默升级机制** 是独特的设计——防止"有意忽略"退化为"习惯性忽略"
2. **双重超时机制** (AbortController + Promise.race 硬兜底) 考虑了 Windows Node.js 兼容性
3. **配置驱动**——几乎所有超时参数通过 `@cortex/config` 统一管理，环境变量可覆盖
4. **异常隔离** 贯穿全栈——PluginRunner → PipelineObserver → LifecycleManager 三级隔离

### 缺口
1. **CircuitBreaker 独立组件缺失**——当前仅靠 ReplanManager 上限熔断，缺少基于失败率/滑动窗口的健康熔断
2. **chatStream 无重试保护**——流式 API 是 LLM 交互的核心路径，该缺口有实际影响
3. **无统一 Health Check API**——系统可观测性缺少运行时健康探针
4. **无 Bulkhead 模式**——高负载场景下缺乏组件级资源隔离

### Core-2 韧性路线图（基于设计文档）
```
CircuitBreaker       ─ 治理组件 §3.8，Core-2 入宪
IncidentEscalator    ─ 故障归因，Core-2 治理组件
ContractEnforcer     ─ 契约校验，Core-2 治理组件
Health Check API     ─ 运行时健康检查，telemetry 缺口
```

---

*报告完毕。以上基于全仓 19+ 包的源码扫描、search_code 跨仓搜索和关键文件深度读取。*
