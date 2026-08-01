# Cortex 十二流全路径映射

> 生成时间: 2026-07-05 | 只读分析 | 精确到行号

---

## 1. TUI 执行流

`cortex --tui` → 用户输入 → plan → scheduler → agent → toolkit → write_file → observer → memory

### 入口

**文件**: `packages/cli/src/main.ts:158`  
**函数**: `main()` → `tuiReplHandler(registry, engineBridge, ...)`  
**输入**: `process.argv`（含 `--tui` 或无参数）  
**触发条件**: `argv.length === 0`（bare `cortex` 命令）→ 进入 TUI REPL

### 步骤列表

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 1 | `packages/cli/src/main.ts:108` | `new EngineBridge(configManager)` | ConfigManager → EngineBridge 实例 |
| 2 | `packages/cli/src/main.ts:110` | `bootstrapLlm()` | `.env` 中的 KEY → `Map<string, LlmAdapter>` |
| 3 | `packages/cli/src/main.ts:114` | `new Toolkit()` | — → Toolkit 实例（注册 20 个内置工具） |
| 4 | `packages/cli/src/main.ts:118` | `bootstrapMcp(toolkit, CONFIG_ROOT)` | MCP 配置 → Toolkit.registerMcpClient() |
| 5 | `packages/cli/src/main.ts:123` | `engineBridge.setBootstrapConfig({llms, toolkit, ...})` | {llms, toolkit, projectRoot} → 存储配置 |
| 6 | `packages/cli/src/main.ts:164` | `tuiReplHandler(registry, engineBridge, context)` | CommandRegistry + EngineBridge → TUI REPL 循环 |
| 7 | `packages/tui/src/tui-repl.ts:76-158` | `tuiReplHandler()` | — → readline 实例 + 事件绑定 |
| 8 | `packages/tui/src/tui-repl.ts:132` | `rl.on("line", ...)` → `_dispatchTuiMode()` | 用户输入行 → 按 mode 分发 |
| 9 | `packages/tui/src/tui-repl.ts:222-261` | `_dispatchTuiMode()` | mode 路由: chat→chatMode / plan→planMode / talk→talkMode / party→partyMode |
| 10 | `packages/tui/src/tui-repl.ts:537-548` | `consumeGenerator(gen, tuiEventBus, abort)` | AsyncGenerator<TuiEvent> → `tuiEventBus.emit()` 逐个转发 |
| 11 | `packages/tui/src/tui-repl.ts:174-183` | `_bindTuiEvents()` | tuiEventBus → TaskTreeRenderer / ToolLogRenderer / TokenMonitor |

### TUI → Engine 委托执行路径（非 command 模式）

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 12 | `packages/tui/src/query-loop.ts:216-418` | `queryLoop()` | input + mode + agent + bridge → AsyncGenerator<TuiEvent, string> |
| 13 | `packages/tui/src/query-loop.ts:273-282` | `bridge.streamChat(model, messages, tools, onChunk)` | messages + tools → SSE 流式 chunk → `yield llm_chunk` |
| 14 | `packages/tui/src/query-loop.ts:377-393` | `streamExecuteTools()` | tool_calls[] → 逐个执行 → `yield tool_start/tool_result` |
| 15 | `packages/cli/src/services/engine-bridge.ts:307-318` | `streamChat()` → `llm.chatStream()` | messages → LlmAdapter.chatStream() → SSE 响应 |
| 16 | `packages/cli/src/services/engine-bridge.ts:282-292` | `executeToolCall()` → `toolkit.execute()` | toolName + args → Toolkit.execute() → {success, output} |

### Plan 模式特殊路径

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 17 | `packages/tui/src/modes/plan-mode.ts` | `planMode()` | input + bridge + agent + planState → AsyncGenerator<TuiEvent> |
| 18 | `packages/cli/src/services/engine-bridge.ts:506-513` | `getMetaAgent()` | — → MetaAgent（甘雨）→ 用于生成任务计划 |
| 19 | `packages/cli/src/services/engine-bridge.ts:320-326` | `submitTask(node)` | TaskNode → TaskBoard.addNode() |
| 20 | `packages/cli/src/services/engine-bridge.ts:329-332` | `executeAll()` | — → Scheduler.executeAll() → ExecutionReport |
| 21 | `packages/cli/src/services/engine-bridge.ts:344-399` | `executeWithStream()` | nodes[] → board.clear → addNode → executeAll → TuiEvent 流 |

### 关键分支点

1. **mode 路由** (`tui-repl.ts:232-261`): `switch(m)` → chat/plan/talk/party/command 五模式
2. **斜杠命令 vs 普通输入** (`tui-repl.ts:136`): `input.startsWith(".")` → handleInternalCommand
3. **tool_calls 有无** (`query-loop.ts:377`): 有 → 执行工具后 continue 循环；无 → break 返回 finalOutput
4. **上下文压缩触发** (`query-loop.ts:340`): `promptPercent >= 95` → compactMessages

### 已知问题

- Plan 模式的三省审议（`.review`）当前阶段默认放行，完整审议待凝光/钟离/霜凝激活 (`tui-repl.ts:419`)
- TUI 的 executeToolCall 默认以 `AgentType.Code` 身份调用 (`engine-bridge.ts:290`)

### E2E 覆盖

- ✅ `packages/cli/tests/` — CLI 入口 + 命令分发
- ✅ `packages/tui/tests/` — TUI REPL + query-loop
- ❌ 缺: TUI→Engine 端到端 plan→execute 完整链路集成测试
- ❌ 缺: Ctrl+C 中断 + 会话恢复的 E2E

---

## 2. Engine Bootstrap 流

`cortex-cli.mjs` / `main.ts` → engine 就绪

### 入口

**文件**: `packages/cli/src/main.ts:215`  
**函数**: `main()` → `bootstrapLlm()` → `engineBridge.setBootstrapConfig()` → `_ensureBootstrapped()`  
**触发**: 直接执行 `main.ts` 时（`isDirectRun()`）

### 步骤列表

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 1 | `packages/cli/src/main.ts:65-73` | `parseProjectRoot()` | `process.argv` 中的 `--dir` → 项目根路径 |
| 2 | `packages/cli/src/main.ts:83-98` | `loadEnv(CONFIG_ROOT)` | `.env` 文件内容 → `process.env` |
| 3 | `packages/cli/src/main.ts:107-108` | `new ConfigManager()` + `new EngineBridge(configManager)` | — → ConfigManager + EngineBridge |
| 4 | `packages/cli/src/main.ts:110` | `bootstrapLlm()` | `process.env` 中的 DEEPSEEK_*_KEY → `Map<string, LlmAdapter>` |
| 5 | `packages/cli/src/main.ts:114` | `new Toolkit()` | — → Toolkit（_registerBuiltins 注册 20 个工具） |
| 6 | `packages/cli/src/main.ts:118` | `bootstrapMcp(toolkit, CONFIG_ROOT)` | MCP 配置 → Toolkit.registerMcpClient() |
| 7 | `packages/cli/src/main.ts:123-128` | `engineBridge.setBootstrapConfig({...})` | {llms, toolkit, projectRoot} → 存储到内部 `_bootstrapConfig` |
| 8 | `packages/cli/src/main.ts:164` / 命令触发 → `engineBridge._ensureBootstrapped()` | — → 触发 bootstrapEngine |
| 9 | `packages/cli/src/services/engine-bridge.ts:131-165` | `_ensureBootstrapped()` | _bootstrapConfig → bootstrapEngine(projectRoot, options) |
| 10 | `packages/engine/src/bootstrap/bootstrap-engine.ts:93-96` | `bootstrapEngine(projectRoot, options)` | projectRoot + options → BootstrapEngineResult |
| 11 | `packages/engine/src/bootstrap/bootstrap-engine.ts:98` | `loadConfig(projectRoot)` | 文件系统 → Agent 定义配置 |
| 12 | `packages/engine/src/bootstrap/bootstrap-engine.ts:103-109` | `enhancePrompts(config.agentDefinitions, promptManager)` | Agent 定义 → 增强后的 prompt（prompt-kit 校验+缓存+模板渲染） |
| 13 | `packages/engine/src/bootstrap/bootstrap-engine.ts:113` | `toolkit.setWorkspaceRoot(wsRoot)` | workspaceRoot → Toolkit 路径沙箱 |
| 14 | `packages/engine/src/bootstrap/bootstrap-engine.ts:116` | `injectRegistryFromConfig(config.agentDefinitions)` | Agent 定义 → 运行时注册表 |
| 15 | `packages/engine/src/bootstrap/bootstrap-engine.ts:162-163` | `new PluginLoader()` → `loader.load(pluginConfig)` | engine-plugins.json 清单 → 按拓扑排序加载全部插件 |
| 16 | `packages/engine/src/bootstrap/bootstrap-engine.ts:166-183` | 从 PluginContainer 取组件 | container.get("pipelineObserver") → observer/board/pool/gate/memory/scheduler 等 |
| 17 | `packages/engine/src/bootstrap/bootstrap-engine.ts:186` | `installConsoleBridge(observer)` | observer → 拦截 console.warn/error/log |
| 18 | `packages/engine/src/bootstrap/bootstrap-engine.ts:199-201` | `addTransport(_loggingBridge.createTransport())` | LoggingPipelineBridge → 日志→observer 桥接 |
| 19 | `packages/engine/src/bootstrap/bootstrap-engine.ts:326-331` | `initSkillSystem(observer, memory, metaAgent, projectRoot)` | observer + memory + metaAgent → SkillRegistry |
| 20 | `packages/engine/src/bootstrap/bootstrap-engine.ts:355-356` | `toolkit.setGate(gate)` + `toolkit.setObserver(observer)` | gate + observer → Toolkit |
| 21 | `packages/engine/src/bootstrap/bootstrap-engine.ts:394-451` | 组装返回 BootstrapEngineResult | 所有组件 → {scheduler, pool, observer, board, gate, memory, ...} |

### bootstrapEngine 内部子流程

| 子步骤 | 文件:行号 | 说明 |
|-------|---------|------|
| Core-2 模块接线 | `bootstrap-engine.ts:241-323` | TaskRouter + EnvironmentAwareRouter + SentinelSignalFilter + NotificationRuntime + GovernanceEventEmitter + DecisionGateBridge |
| 韧性策略注册 | `bootstrap-engine.ts:308-316` | llm-call(3 retry, 5 CB) + tool-exec(2 retry, 3 CB) |
| ONNX 预热 | `bootstrap-engine.ts:359` | `preloadModel()` — fire-and-forget |
| WorkerPool | `bootstrap-engine.ts:371-372` | maxWorkers = CPU-1，注入 LlmAdapter.setWorkerPool() |
| 启动完成事件 | `bootstrap-engine.ts:381-391` | observer.emit(ExecLifecyclePhaseChanged: uninitialized → running) |

### 关键分支点

1. **LLM 存在性** (`main.ts:113`): `llms.size > 0` → 才创建 Toolkit + MCP + setBootstrapConfig
2. **PromptManager 增强** (`bootstrap-engine.ts:104-108`): 失败 → 回退到原始 prompt，不阻断启动
3. **TrustModel 可选注入** (`bootstrap-engine.ts:172-175`): `container.has("trustModel")` → 注入 gate
4. **taskRouter 存在性** (`bootstrap-engine.ts:261-270`): 有 → 组合 TaskRouter+EnvironmentAwareRouter 为 compositeRouter

### 已知问题

- engine-plugins.json 缺失会导致 bootstrap 抛错（不可恢复）
- MCP 后端加载失败仅 warn，不阻断（`main.ts:120`）

### E2E 覆盖

- ✅ `packages/engine/tests/` — bootstrap-engine 单元测试
- ❌ 缺: 全插件拓扑排序加载 + 卸载的集成测试
- ❌ 缺: engine-plugins.json 损坏/缺失的恢复路径 E2E

---

## 3. LLM Adapter 流

`llm.chat()` → DeepSeek API → 解析响应

### 入口

**文件**: `packages/llm/src/llm-adapter.ts:190`  
**函数**: `LlmAdapter.chat(model, messages, tools?, reasoningEffort?, toolChoice?)`

### 步骤列表

| # | 文件:行号 | 函数/逻辑 | 输入 → 输出 |
|---|---------|----------|------------|
| 1 | L197-199 | Mock 拦截 | `_mockRespond` 存在 → 直接返回 mock 响应 |
| 2 | L202-216 | 缓存检查 | `_cacheKey(model, messages, tools)` → LRU 命中 → 直接返回缓存 |
| 3 | L218-245 | 构造请求体 | messages + tools → `{model, messages, temperature:0, max_tokens:32768, tools, tool_choice}` |
| 4 | L248-250 | extraBody 注入 | `config.extraBody` → `body.extra_body`（供应商扩展参数） |
| 5 | L257-263 | RateLimit 准入 | `getRateLimiter().check(label, keyFingerprint)` → allowed/rejected |
| 6 | L273-281 | 断路器 + fetch | `_circuitBreaker.call(() => _fetchWithRetry(url, opts))` → Response |
| 7 | L291-317 | JSON 解析 | cl>10KB → WorkerPool.parseJson；否则 → `res.json()` |
| 8 | L319-333 | 响应映射 | choices[0].message → `{content, tool_calls, reasoning_content, usage}` |
| 9 | L335-341 | 缓存写入 | response + cacheKey → `_cache.set()`（LRU eviction 保护） |
| 10 | L343-355 | 审计日志 | key + model + status + tokens → `.cortex/logs/api-calls.jsonl` |
| 11 | L358 | Token 消耗追踪 | `limiter.recordTokens(fp, totalTokens)` — fire-and-forget |

### chatStream 流式路径 (L403-523)

| # | 文件:行号 | 函数/逻辑 | 输入 → 输出 |
|---|---------|----------|------------|
| 1 | L417-442 | 构造请求体 | `stream: true` → body |
| 2 | L457-466 | 断路器 + fetch | 同 chat 路径 |
| 3 | L474-482 | SSE 流解析 | `res.body.getReader()` → `_readSseStream(reader, onChunk)` |
| 4 | L616-687 | `_readSseStream()` | SSE data 行 → 累积 content/reasoning/tool_calls → SseStreamState |
| 5 | L484 | `finalizeToolCalls()` | 流式累积的 tool_calls → 完整 LlmToolCall[] |
| 6 | L486-491 | 组装响应 | SseStreamState → `{content, tool_calls, reasoning_content, usage}` |
| 7 | L675-680 | 流中断降级 | 有部分内容时 → 返回 degraded:true 而非抛异常 |

### _fetchWithRetry (L553-601)

| 步骤 | 说明 |
|-----|------|
| AbortController + Promise.race 双保险超时 | 30s AbortController.signal + 35s 硬兜底 |
| 5xx/429 指数退避重试 | MAX_RETRIES=3, base=1s, factor=2 |
| 网络异常重试 | 同上 |

### 关键分支点

1. **mockRespond** (L197): 存在 → 跳过所有真实 API 逻辑
2. **缓存命中** (L203-216): TTL=10min，过期清除
3. **reasoning_effort 限定** (L227-229): 仅 `pro`/`reasoner` 模型支持
4. **tool_choice** (L240-244): 非 auto/required/none 时按 `{type:"function", function:{name}}` 格式
5. **WorkerPool 决策** (L312-317): content-length > 10KB → 独立线程 JSON 解析
6. **流中断降级** (L675-680): 有部分内容 → degraded；无内容 → throw

### 已知问题

- DeepSeek Flash 模型不支持 `reasoning_effort` 和 `tool_choice`（代码已做条件判断）
- 缓存模式 `fingerprint` 仅 sha256 前12位指纹，可能有碰撞概率
- stream 模式下 tool_call 的 arguments 增量拼接依赖 `accumulateToolCalls`

### E2E 覆盖

- ✅ `packages/llm/tests/` — chat + chatStream + cache + retry
- ❌ 缺: RateLimiter 集成测试（需真实 API 配额消耗）
- ❌ 缺: WorkerPool JSON 解析 E2E

---

## 4. Agent 执行流（ReAct Loop）

Scheduler dispatch → Agent 执行 → ReAct 循环 → 返回结果

### 入口

**文件**: `packages/engine/src/core/scheduler.ts:271`  
**函数**: `Scheduler._dispatchSingle(node)`  
**输入**: TaskNode（含 payload, type, tags）  
**输出**: NodeResult（含 nodeId, success, output/error）

### 步骤列表

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 1 | `scheduler.ts:137-195` | `Scheduler.executeAll()` | TaskBoard 上的节点 → `loopDriver.run(loopCtx)` → ExecutionReport |
| 2 | `scheduler.ts:197-244` | `Scheduler._dispatchNode(nodeId)` | nodeId → board.getNode → 单/多视角分发 |
| 3 | `scheduler.ts:215` | 多视角判断 | `node.needsMultiPerspective` → `_dispatchMulti` / `_dispatchSingle` |
| 4 | `scheduler.ts:271-293` | `_dispatchSingle(node)` | 构建 ClaimStep → SpawnStep → RlmExecuteStep → BoundaryGuardStep → CleanupStep |
| 5 | `scheduler.ts:253-268` | `_runDispatchPipeline(ctx, steps)` | 逐 step 执行，非 Cleanup 失败 → 仍运行 CleanupStep |
| 6 | `dispatch-steps/rlm-execute-step.ts:39-91` | `RlmExecuteStep.run(ctx)` | DispatchCtx → 判断拆解/直接执行 |
| 7 | `rlm-execute-step.ts:63` | 拆解判断 | `_shouldAttemptDecompose(node)` → true: LLM 拆解 / false: 直接执行 |
| 8 | `rlm-execute-step.ts:116-135` | `_directExecute()` | agent.execute(node, model) → NodeResult |
| 9 | `rlm-execute-step.ts:69-72` | `_tryDecompose()` + `shouldExecuteDecomposition` | LLM 拆解 → subTasks[] |
| 10 | `rlm-execute-step.ts:140-183` | `_executeSubTasks()` | subTasks → 按 depends_on 分层 → 并行执行 → DENSITY 压缩 → 合并结果 |
| 11 | `packages/engine/src/base-agent.ts:89-115` | `BaseAgent.execute(node, model)` | node → preExecuteHook → _selectPipeline → executeWithMemoryPipeline |
| 12 | `packages/engine/src/memory/pipeline.ts:279-309` | `executeWithMemoryPipeline(ctx, node, model)` | ReActContext + node → PipelineRunner.run(steps, pipelineCtx) |
| 13 | `packages/engine/src/memory/pipeline.ts:230-235` | `DEFAULT_PIPELINE` | [MemoryRetrievalStep, ReActLoopStep, MemoryWriteStep] |
| 14 | `packages/engine/src/memory/pipeline.ts:152-172` | `ReActLoopStep.run(ctx)` | ctx → `runReActLoop(reactCtx, node, model)` |
| 15 | `packages/engine/src/components/react-loop.ts:35-272` | `runReActLoop(ctx, node, model)` | — → while 循环（maxLoops 上限） |

### ReAct 循环内部 (react-loop.ts)

| 循环内步骤 | 行号 | 说明 |
|----------|------|------|
| 墙钟超时检查 | L86-94 | `Date.now() >= deadline` → 返回 partial output |
| 逼近上限提醒 | L99-105 | loops = maxLoops-4 → 注入截止提示 |
| LLM 调用 | L107-119 | `llm.chat(model, messages, toolDefs)` → `forceTool=required`(仅 code/fix/ops 首轮) |
| 零工具调用处理 | L148-173 | 代码任务未调用 write_file → 强制追加提醒并 continue |
| L0 工具并行 | L188-225 | L0 读工具 → `Promise.allSettled` |
| L2/L3 工具串行 | L228-249 | 写工具 → 逐个 `toolkit.execute()` |
| 崩溃处理 | L250-258 | catch → 返回 partial output + error |
| 循环结束 | L262-271 | 返回 `{success: finalOutput !== undefined}` |

### Loop 策略选择

**文件**: `packages/engine/src/core/loop-strategy-registry.ts:82-122`

| 策略 | canHandle 条件 | Pipeline |
|------|---------------|----------|
| `direct` | payload < 200 字 且 无工具依赖标签 | DIRECT_PIPELINE |
| `decompose` | payload > 500 字 或 audit/scan/migration 标签 | DEFAULT_PIPELINE |
| `jury` | needsMultiPerspective === true | DEFAULT_PIPELINE |
| `react` | **不匹配**（fallback） | DEFAULT_PIPELINE |

### 关键分支点

1. **单/多视角** (`scheduler.ts:215`): `needsMultiPerspective` → 并行所有匹配 Agent
2. **RLM 拆解决策** (`rlm-execute-step.ts:101-105`): isRlmSubtask / preferredStrategy=direct|react → 跳过拆解
3. **RRM 拆解** (`rlm-execute-step.ts:70`): `shouldExecuteDecomposition(result)` — 置信度不足则回退直接执行
4. **forceTool=required** (`react-loop.ts:115-116`): 仅 code/fix/ops 首轮 + write_file 存在时
5. **write_file 硬检测** (`react-loop.ts:150-168`): 代码任务未调用 write_file → 强制提醒

### 已知问题

- RLM 子任务成功判定：≥50% 子任务成功即标记成功 (`rlm-execute-step.ts:177`)
- 多视角节点 claim 用互斥锁保护 (`scheduler.ts:328-333`)，仍有极端竞态可能
- LoopStrategyRegistry 的 `react` 策略 `canHandle` 永远返回 false 作为 fallback

### E2E 覆盖

- ✅ `packages/engine/tests/` — ReAct loop + pipeline + scheduler
- ✅ `packages/scheduler/tests/` — dispatch steps + RLM decompose
- ❌ 缺: 多视角并行 + 部分视角失败的集成测试
- ❌ 缺: ReAct 墙钟超时 + 工具执行超时组合场景

---

## 5. Toolkit 工具流

`toolkit.execute(toolName, args)` → 文件落盘

### 入口

**文件**: `packages/platform/src/toolkit.ts:209`  
**函数**: `Toolkit.execute(inv, callerType, context?)`  
**输入**: `{toolName, params}` + AgentType + AgentContext  
**输出**: `ToolResult = {success: boolean, output?: string, error?: string}`

### 步骤列表

| # | 文件:行号 | 函数/逻辑 | 输入 → 输出 |
|---|---------|----------|------------|
| 1 | L211-230 | **权限校验** | `getAgentToolPermissions()[callerType]` / `resolveAgentPermissions(callerType, context)` → allowed 列表 → 拒绝则返回 error |
| 2 | L232-235 | **工具查找** | `this.tools.get(inv.toolName)` → Tool 对象 or unknown error |
| 3 | L238 | **可逆性判定** | `this.reversibilityOf(inv.toolName)` → L0/L1/L2/L3 |
| 4 | L239-261 | **ConfirmGate 拦截** | `gate.needsConfirmation(level, {agentType, toolName})` → true: gate.request → gate.waitFor → approved? |
| 5 | L250 | waitFor 超时 | `config.toolTimeouts.confirmWait`（默认 120s） |
| 6 | L256 | 信任模型反馈 | `gate.recordDecision(callerType, toolName, approved)` |
| 7 | L264-268 | **FileLock 检查** | `tool.needsLock && lockManager` → `lockManager.acquire(filePath, "toolkit", LockType.Write)` |
| 8 | L269-283 | **加锁执行** | 获取锁 → `tool.execute(params)` → 释放锁 |
| 9 | L292-296 | **无锁执行** | 直接 `tool.execute(params)` |
| 10 | L341-359 | **路径安全解析** | `_resolvePath(filePath)` → 符号链接检查 + 沙箱边界检查 |

### 内置工具注册 (L363-400)

| 工具名 | 工厂 | 可逆性 |
|--------|------|--------|
| `read_file` | `createReadFile` | L0 |
| `write_file` | `createWriteFile` | L2 |
| `search_code` | `createSearchCode` | L0 |
| `run_shell` | `createRunShell` | L3 |
| `list_files` | `createListFiles` | L0 |
| `delete_file` | `createDeleteFile` | L3 |
| `parse_ast` | `createParseAst` | L0 |
| `web_search` | `createWebSearch` | L0 |
| `search_symbol` | `createSearchSymbol` | L0 |
| `read_many_files` | `createReadManyFiles` | L0 |
| `grep_files` | `createGrepFiles` | L0 |
| `file_info` | `createFileInfo` | L0 |
| `glob_find` | `createGlobFind` | L0 |
| `resolve_import` | `createResolveImport` | L0 |
| `format_code` | `createFormatCode` | L2 |
| `json_query` | `createJsonQuery` | L0 |
| `edit_file` | `createEditFile` | L2 |
| `run_test` | `createRunTest` | L1 |
| `diff_files` | `createDiffFiles` | L0 |

### 可逆性等级 (ReversibilityLevel)

| 等级 | 含义 | 默认确认策略 |
|------|------|------------|
| L0 | 只读，完全可逆 | 永不确认 |
| L1 | 低风险写入 | 信任模型判定 |
| L2 | 中等风险 | **永远确认** |
| L3 | 高风险/不可逆 | **永远确认** |

### 关键分支点

1. **context-aware 权限** (`toolkit.ts:211-213`): `context !== undefined` → 动态权限提升
2. **ConfirmGate 注入** (`toolkit.ts:239`): `this.gate?.needsConfirmation()` — 无 gate → 跳过
3. **FileLockManager 注入** (`toolkit.ts:264`): `tool.needsLock && this.lockManager` — 无 lockManager → 跳过
4. **workspaceRoot 沙箱** (`toolkit.ts:342-358`): 未设 → 允许任意路径；已设 → 符号链接 + 前缀检查

### 已知问题

- 路径沙箱依赖 `fs.realpathSync.native` 解析符号链接，Windows 上行为可能与 POSIX 不同
- `toolMeta` JSON 覆盖可能在运行时与 Tool 内置元数据不一致

### E2E 覆盖

- ✅ `packages/platform/tests/` — toolkit 单元测试
- ❌ 缺: ConfirmGate + FileLock 组合场景
- ❌ 缺: 路径沙箱越界攻击的 E2E 测试

---

## 6. Memory 写入流

Agent 执行完成 → MemoryStore 持久化

### 入口

**文件**: `packages/engine/src/memory/pipeline.ts:178-188`  
**函数**: `MemoryWriteStep.run(ctx)` → `_rememberResult(memory, agentType, node, result, safeReporter)`  
**输入**: PipelineCtx（含 memory, agentType, node, result）  
**输出**: 异步写入 MemoryStore

### 步骤列表

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 1 | `pipeline.ts:312-318` | `inferKind(agentType)` | agentType → MemoryKind (TaskLog/Insight/Governance/Intent) |
| 2 | `pipeline.ts:340-353` | 构建 content 对象 | isSuccess + isFix + node → `{taskType, entities, decision, outcome, pitfall?, lesson?}` |
| 3 | `pipeline.ts:356-358` | 构建 mainSummary | isSuccess → "[完成]" / "[失败教训]" + agentType + node.type + payload 摘要 |
| 4 | `pipeline.ts:366-374` | `memory.writePending({...})` → memId | MemoryWriteInput（source, kind, summary, semantic_gist, content_blob, weight）→ Pending 条目 ID |
| 5 | `pipeline.ts:385-393` | `memory.writePending({...})` → ctxMemId | 上下文记忆（weight=2）→ ctxMemId |
| 6 | `pipeline.ts:395` | `memory.link(memId, ctxMemId, LinkType.ProducedBy)` | 主记忆 → 上下文记忆 ProduecedBy 链接 |
| 7 | `pipeline.ts:397-408` | 修复任务父节点链接 | isFix + parentId → 查找父记忆 → `memory.link(memId, parentMem.id, ProduecedBy)` |
| 8 | `pipeline.ts:410-411` | `memory.commitMemory(memId)` + `commitMemory(ctxMemId)` | Pending → Active（两阶段提交完成） |
| 9 | `pipeline.ts:412-419` | commit 部分失败上报 | ok1/ok2 任一 false → safeReporter("degraded") |
| 10 | `pipeline.ts:420-434` | 异常清理 | catch → `memory.cancel(memId)` + `memory.cancel(ctxMemId)` → 清理半成品 Pending |

### MemoryStore.commitMemory 内部 (memory-store.ts:500-510)

| 步骤 | 行号 | 说明 |
|-----|------|------|
| backend.commitMemory | L501 | Pending → Active 状态转换 |
| 异步 enrichment | L505 | embedding 生成 + dedup 缓存 + BM25 索引更新 |

### MemoryStore.write 直接写入路径 (memory-store.ts:195-268)

| 步骤 | 说明 |
|-----|------|
| 前置钩子 | `_preWriteHook` → 转换输入 |
| 嵌入生成 | ONNX 384d embedding（静默降级） |
| SHA256 去重 | `_tryDedup(contentHash)` → 命中返回已有 ID |
| 后端写入 | `backend.write(input)` → memory ID |
| BM25 索引 | `_bm25Index.addDocument(id, {summary, semantic_gist, payload})` |
| 向量去重 | `_tryVectorDedup(id, embedding)` — 后验扫描 |
| 溢出归档 | `_autoArchiveIfOverflow()` — 总量超 MAX_TOTAL_MEMORIES → 归档最久未访问 |

### 关键分支点

1. **memory 注入** (`pipeline.ts:183`): `if (memory && result)` — 无 memory → 跳过写入
2. **成功 vs 失败权重** (`pipeline.ts:373`): 成功 weight=5，失败 weight=3
3. **修复任务特殊处理** (`pipeline.ts:397`): `isFix && node.parentId` → 链接父任务记忆
4. **两阶段提交** (`pipeline.ts:410-411`): writePending → commitMemory（任一失败都有清理）

### 已知问题

- commit 失败后 cancel 清理为 best-effort（`pipeline.ts:422-423`），极端情况可能残留 Pending 条目
- BM25 索引更新在 commitMemory 异步 enrichment 中（`memory-store.ts:505`），有一定延迟

### E2E 覆盖

- ✅ `packages/engine/tests/` — MemoryWriteStep + _rememberResult
- ✅ `packages/memory-store/tests/` — write/read/commit/maintain
- ❌ 缺: 两阶段提交中途崩溃的恢复测试
- ❌ 缺: 溢出归档 + 熔断恢复的 E2E

---

## 7. Observer/遥测流

`observer.emit()` → TUI 面板显示

### 入口

**文件**: `packages/scheduler/src/core/pipeline-observer.ts:77`  
**函数**: `PipelineObserver.emit(event, meta?)`  
**输入**: ObservableEvent + 可选 EmitMeta  
**输出**: 按优先级调用注册的 handler

### 步骤列表

| # | 文件:行号 | 函数/逻辑 | 输入 → 输出 |
|---|---------|----------|------------|
| 1 | `pipeline-observer.ts:59-65` | `on(priority, handler)` | priority + handler → `handlers` Map |
| 2 | `pipeline-observer.ts:77-124` | `emit(event, meta?)` | event → 自动生成 requestId → 按 priority 查找 handlers → 逐个同步调用 |
| 3 | L79-92 | 死信追溯 | `meta.causalChain.spanId` → 查找死信队列中上游事件 → 注入 `upstreamEvents` |
| 4 | L95-97 | 幂等键生成 | `event.requestId = evt-{ts}-{random}` |
| 5 | L99-123 | Handler 迭代 | `for handlers[priority]` → try/catch 隔离，单 handler 崩溃不阻断其余 |
| 6 | L111-120 | Handler 异常处理 | `_onHandlerError(ctx)` / `_reportError(...)` |

### Console → Observer 桥接

**文件**: `packages/telemetry/src/console-bridge.ts:95-128`

| 步骤 | 说明 |
|-----|------|
| `installConsoleBridge(observer)` | 备份 `_origLog/_origWarn/_origError` → 替换 `console.log/warn/error` |
| 白名单过滤 | `MESSAGE_PREFIX_WHITELIST`（MemoryStoreMonitor, TRACE write_file）→ 直接透传 |
| 调用栈白名单 | `STACK_WHITELIST`（embedding warmup）→ 直接透传 |
| `console.warn` 拦截 | → `observer.emit(ErrorReported, NORMAL)` |
| `console.error` 拦截 | → `observer.emit(ErrorReported, HIGH)`，防重入锁 |
| `console.log` 拦截 | 白名单外 → `process.stderr.write`（不通过 observer） |
| `uninstallConsoleBridge()` | 恢复 `_orig*` 方法 |

### TUI 事件绑定

**文件**: `packages/tui/src/tui-repl.ts:174-183`

```typescript
tuiEventBus.on("task_tree_update", (e) => r.taskTree.handleEvent(e))
tuiEventBus.on("node_start",       (e) => r.taskTree.handleEvent(e))
tuiEventBus.on("node_complete",    (e) => r.taskTree.handleEvent(e))
tuiEventBus.on("node_failed",      (e) => r.taskTree.handleEvent(e))
tuiEventBus.on("tool_start",       (e) => r.toolLog.handleEvent(e))
tuiEventBus.on("tool_result",      (e) => r.toolLog.handleEvent(e))
tuiEventBus.on("token_usage",      (e) => r.tokenMonitor.handleEvent(e))
```

### 双层管道架构

```
┌──────────────────────────────────────────────────┐
│  PipelineObserver (scheduler 层)                 │
│  ├─ CRITICAL handlers: sentinelFilter            │
│  ├─ HIGH handlers: MemoryStore + Strategist      │
│  ├─ NORMAL handlers: MemoryStore + LoggingBridge │
│  └─ Handler 异常 → SafeErrorReporter             │
└──────────────────────────────────────────────────┘
         ↕ installConsoleBridge
┌──────────────────────────────────────────────────┐
│  TuiEventBus (TUI 层)                            │
│  ├─ task_tree_update → TaskTreeRenderer          │
│  ├─ node_start/complete/failed → TaskTreeRenderer│
│  ├─ tool_start/result → ToolLogRenderer          │
│  └─ token_usage → TokenMonitor                   │
└──────────────────────────────────────────────────┘
```

### 关键分支点

1. **silent 升级** (`pipeline-observer.ts:173-199`): 同一 source 连续 ≥3 次 silent → 自动升级为 degraded
2. **递归保护** (`pipeline-observer.ts:166-171`): `_reentrancyDepth >= 3` → 丢弃事件
3. **防重入** (`console-bridge.ts:115-118`): `_inErrorHandler` → 直接透传原始 console.error

### 已知问题

- PipelineObserver 和 TuiEventBus 是两个独立系统，事件不互通——需在消费端手动桥接
- 死信队列仅内存环形缓冲，进程重启清空
- console.log 白名单外被降级为 stderr 而非 observer 事件

### E2E 覆盖

- ✅ `packages/scheduler/tests/` — PipelineObserver emit/on/off
- ✅ `packages/telemetry/tests/` — console-bridge
- ❌ 缺: PipelineObserver → TuiEventBus 桥接集成测试
- ❌ 缺: 死信追溯 + silent 升级的 E2E

---

## 8. Skill 技能流

`skills/` 目录 → SkillRegistry → 查询

### 入口

**文件**: `packages/engine/src/bootstrap/init-skills.ts:20`  
**函数**: `initSkillSystem(observer, memory, metaAgent, projectRoot, externalSearch?)`  
**输入**: observer + memory + metaAgent + projectRoot  
**输出**: `SkillRegistry` 实例

### 步骤列表

| # | 文件:行号 | 函数/逻辑 | 输入 → 输出 |
|---|---------|----------|------------|
| 1 | `init-skills.ts:27` | `new SkillRegistry()` | — → 空注册表 |
| 2 | L28-74 | `onSkillStatusChange` 回调注册 | skill + oldStatus → 持久化 + 结晶（trial→active 时） |
| 3 | L79 | `metaAgent.setSkillRegistry(skillRegistry)` | skillRegistry → MetaAgent 引用 |
| 4 | L80 | `registerSkillPipeline(observer, skillRegistry, memory)` | observer + registry + memory → 注册技能管道 |
| 5 | L85-103 | 从 MemoryStore 恢复 | `loadSkillsFromMemory(memory)` → SkillTemplate[] → `registry.registerAll()` |
| 6 | L107-141 | **回退路径**: 从 skills/ 目录加载 | `skills/*.json` → `readFileSync` → `JSON.parse` → 验证 id/triggerTags/steps → `registry.registerAll()` |

### SkillRegistry 查询

| 方法 | 文件（@cortex/skill-kit） | 输入 → 输出 |
|------|------------------------|------------|
| `registerAll(templates)` | — | SkillTemplate[] → 注册到内部 Map |
| `queryByTags(tags)` | — | string[] → 匹配的 SkillTemplate[] |
| `get(id)` | — | string → SkillTemplate \| undefined |
| `deriveStatus(weight, feedbackHistory)` | `@cortex/skill-kit` | weight + feedback[] → "trial"\|"active"\|"deprecated" |

### 技能结晶为知识 (trial → active)

| # | 文件:行号 | 函数 | 说明 |
|---|---------|------|------|
| 1 | `init-skills.ts:44` | `deriveStatus(skill.weight, skill.feedbackHistory)` | 判断是否正在从 trial 变为 active |
| 2 | L46-48 | `verifySkillKnowledge(skill, memory, "analysis-agent", {externalSearch})` | 事实认证 + 外部佐证 |
| 3 | L54-57 | `crystallizeSkillToKnowledge(skill, memory, {...})` | 写入 MemoryKind.Knowledge |

### 关键分支点

1. **MemoryStore 恢复优先** (`init-skills.ts:85`): 有 memory 且 loadedSkills.length > 0 → 跳过文件系统回退
2. **skills/ 目录回退** (`init-skills.ts:107`): loadedSkills.length === 0 → 扫描 JSON 文件
3. **状态变更触发结晶** (`init-skills.ts:44`): `currentStatus === "active" && oldStatus !== "active"` → 验证+结晶

### 已知问题

- 技能文件 JSON 解析失败静默跳过（`init-skills.ts:120-122`），无聚合错误报告
- MemoryStore 和 skills/ JSON 之间无同步机制——若两处都有数据，MemoryStore 优先
- 结晶为知识的 verifySkillKnowledge 依赖 analysis-agent 可用

### E2E 覆盖

- ❌ 缺: skills/ JSON → SkillRegistry → queryByTags 完整链路
- ❌ 缺: trial→active 结晶管线的 E2E
- ❌ 缺: MemoryStore 恢复 + 文件回退的切换场景

---

## 9. 自审视流

`self-exam-soft.ts` → Phase1-6 → `final-report.md`

### 入口

**文件**: `scripts/self-exam-soft.ts:33-40`  
**命令**: `npx tsx scripts/self-exam-soft.ts`  
**前置条件**: `.env` 已配置 `DEEPSEEK_API_KEY`

### 步骤列表

#### Phase 0: 初始化 (self-exam-soft.ts:33-148)

| # | 行号 | 函数 | 输入 → 输出 |
|---|-----|------|------------|
| 1 | L33-40 | `loadEnv()` | `.env` → `process.env` |
| 2 | L42-44 | — | `test-output/self-examination-soft/` 目录创建 |
| 3 | L119-130 | LlmAdapter 初始化 | API_KEY → chatAdapter + reasonerAdapter + cyreneAdapter → `Map<string, LlmAdapter>` |
| 4 | L141 | `bootstrapEngine(ROOT, {llms, toolkit, dbPath})` | — → engine（scheduler/board/pool/observer/gate/memory） |
| 5 | L144-148 | 非交互确认桥 | `gate.setBridge({confirm: async () => ({approved: true})})` |

#### Phase 1: 6 Agent 出 Claims (L370-391)

| # | 行号 | 说明 |
|---|-----|------|
| 1 | L371-375 | 构建 6 个 TaskNode（loop/api/ops/inspector/data/review） |
| 2 | L376 | `addNodes(p1Nodes)` — 全部入 TaskBoard |
| 3 | L379 | `engine.scheduler.executeAll()` — 并行执行 6 Agent |
| 4 | L383-391 | 读取 `claims-*.json` → 统计 claim 数量 |

#### Phase 2: 对称攻防 (L400-473)

| # | 行号 | 说明 |
|---|-----|------|
| 1 | L442-448 | 收集可用 claim 文件 |
| 2 | L450-464 | 3 对互攻：loop↔review, api↔ops, inspector↔data |
| 3 | L469-471 | `addNodes(attackNodes)` + `engine.scheduler.executeAll()` |

#### Phase 3: 纳西妲裁决 (L478-552)

| # | 行号 | 函数 | 输入 → 输出 |
|---|-----|------|------------|
| 1 | L482-496 | 收集全部 claims + attacks JSON | → `allClaimsJson` + `allAttacksJson` |
| 2 | L499-541 | `callLlm(reasonerAdapter, REASONER_MODEL, [...])` | system（纳西妲指令）+ user（claims + attacks）→ 裁决 JSON |
| 3 | L546-551 | `writeJson("verdict-analysis.json", ...)` | 纳西妲裁决 → `verdict-analysis.json` |

#### Phase 4: 凝光合成 (L557-628)

| # | 行号 | 函数 | 输入 → 输出 |
|---|-----|------|------------|
| 1 | L560-582 | 收集裁决 + claims + attacks 摘要 | → prompt |
| 2 | L585-620 | `callLlm(reasonerAdapter, REASONER_MODEL, [...])` | system（凝光指令）+ user（裁决+claims+attacks）→ 报告文本 |
| 3 | L626 | `fs.writeFileSync("final-report.md", ...)` | 报告文本 → `final-report.md` |

#### Phase 5: 钟离 (预留)

Phase 5 在需求中提及（钟离契约监督），当前脚本中未实现独立 Phase，钟离 agent 已注册为 `strategist` 但在自审视中未显式调用。

#### Phase 6: 霜凝 (预留)

霜凝方向监理，当前脚本中未实现。

### 关键分支点

1. **预算检查** (`self-exam-soft.ts:208-213`): `totalTokensUsed >= BUDGET_MAX_TOKENS` → 跳过后续 Phase
2. **预算降级** (`self-exam-soft.ts:398`): 不足时 → Phase 2 每个 Agent 只攻击一个对手
3. **attack 节点为空** (`self-exam-soft.ts:466`): 无可用 claims → 跳过 Phase 2
4. **裁决 JSON 解析** (`self-exam-soft.ts:548`): 失败 → 保存 `{judge: "纳西妲", raw: content}`

### 已知问题

- Phase 5（钟离）和 Phase 6（霜凝）未实现
- Phase 3/4 使用直接 LLM 调用而非 Agent 调度器，不走 ReAct 循环
- 预算仅检查 token 消耗，不检查 API 费用

### E2E 覆盖

- ❌ 缺: 自审视完整管线的 E2E（需要 LLM API）
- ❌ 缺: 预算耗尽降级路径测试

---

## 10. CI 门禁流

`ci-gate.ts` → tsc → vitest → 放行/阻断

### 入口

**文件**: `scripts/ci-gate.ts:239-429`  
**函数**: `main()`  
**命令**: `npx tsx scripts/ci-gate.ts [--all] [--dry-run] [--json] [--coverage]`

### 步骤列表

| # | 行号 | 函数/逻辑 | 输入 → 输出 |
|---|-----|----------|------------|
| **门禁 1/5: tsc** | | | |
| 1 | L252-265 | `run("pnpm", ["exec", "tsc", "-b", "tsconfig.json"], ROOT)` | 全量增量编译 → ok/not ok |
| 2 | L257-259 | 失败阻断 | tscResult !ok → `process.exit(1)` |
| **门禁 2/5: eslint** | | | |
| 3 | L267-280 | `run("pnpm", ["exec", "eslint", "packages", "--ext", ".ts,.tsx", "--max-warnings", "0"], ROOT)` | 全包检查 → 0 错误 0 警告 |
| 4 | L271-274 | 失败阻断 | eslintResult !ok → `process.exit(1)` |
| **门禁 3/5: critical-fixes 混沌校验** | | | |
| 5 | L282-295 | `run("pnpm", ["exec", "tsx", "scripts/verify/critical-fixes.ts"], ROOT)` | 7 项 Critical 修复不回归校验 → ok/not ok |
| 6 | L287-289 | 失败阻断 | cfResult !ok → `process.exit(1)` |
| **扫描** | | | |
| 7 | L299 | `scanAllTests()` | `walkTests(packages/)` → `TestFile[]`（含 @ci 标签） |
| 8 | L301 | 过滤 target | `filter(t => t.ciTag === "unit" \|\| "verify" \|\| "contract")` |
| 9 | L302 | 标记 skipped | llm/integration/e2e/manual 跳过 |
| 10 | L304-315 | @ci 标签审计 | 未标注文件 → `process.exit(1)` 阻断 |
| **门禁 4/5: vitest** | | | |
| 11 | L346-353 | 按包分组 | `extractPackageRoot(filePath)` → `packages/<name>` |
| 12 | L359-403 | 逐包串行 vitest | `pnpm vitest run --pool=forks` → 解析 passed/total |
| 13 | L376-378 | 大包单进程 | files.length > 40 → `--poolOptions.forks.maxForks=1` |
| **门禁 5/5: coverage（可选 --coverage）** | | | |
| 14 | L409-415 | `runCoverageGate()` | 按包 lines% ≥ 阈值（`scripts/coverage-thresholds.json` 固化基线） |
| **结果** | | | |
| 15 | L405-407 | 汇总输出 | 门禁通过/未通过 + Tests: passed/total |

### @ci 标签体系 (L20-33)

| 标签 | CI 行为 | 说明 |
|------|--------|------|
| `unit` | **必跑** | 默认值 |
| `verify` | **必跑** | 关键修复验证 |
| `contract` | **必跑** | 跨包接口契约验证 |
| `llm` | 跳过 | 需要 LLM API |
| `integration` | 跳过 | 需要外部服务 |
| `e2e` | 跳过 | 端到端测试 |
| `manual` | 永远不跑 | 人工触发 |

### vitest 输出解析 (L146-165)

```typescript
// 兼容新旧两种 vitest 格式
const re = /Tests\s+(?:\d+\s+(?:failed|skipped)\s+\|\s+)?(\d+)\s+passed(?:\s+\|\s+\d+\s+(?:failed|skipped))?\s*\((\d+)\)/g;
```

### 关键分支点

1. **--dry-run** (`ci-gate.ts:317-340`): 仅扫描 @ci 标签，不执行
2. **--all** (`ci-gate.ts:247`): 全量模式（包括 llm/integration 等）
3. **--json** (`ci-gate.ts:417-426`): 机器可读 JSON 输出
4. **tsc 失败阻断** (`ci-gate.ts:257-259`): 第一步失败 → 直接 exit(1)
5. **eslint 失败阻断** (`ci-gate.ts:271-274`): 第二步失败 → 直接 exit(1)
6. **critical-fixes 失败阻断** (`ci-gate.ts:287-289`): 第三步失败 → 直接 exit(1)
7. **空包跳过** (`ci-gate.ts:364-369`): 某包无 target 测试 → 打印跳过信息
8. **coverage 跳过** (`ci-gate.ts:413-415`): 测试阶段已失败 → 覆盖率门禁跳过

### 已知问题

- tsc 是全量编译（非增量），大项目耗时较长
- vitest 按包串行，未利用并行能力（历史原因：workspace 模式 OOM）
- @ci 标签缺失直接阻断（严格推行）
- 无 e2e 验证环节（`@ci: e2e` 直接跳过）
- coverage 门禁默认跳过，需 `--coverage` 显式启用

### E2E 覆盖

- ✅ `scripts/ci-gate.ts` 自包含 `--dry-run` 模式
- ❌ 缺: ci-gate 在 CI 环境中的完整运行验证

---

## 11. WebUI 数据流

engine → observer/board/pool → StateAggregator → WSGateway → 前端渲染

### 当前状态

> **注意**: WebUI 在 `d:\cortex\webui\` 下仅有 `report.md`（6.8KB），尚未有实际前端代码实现。以下是基于代码中导出的 `PoolAwareState` 和 `Scheduler` 等接口推断的规划架构。

### 架构设计

```
┌─────────────────────────────────────────┐
│  Engine 层                              │
│  ├─ Scheduler → TaskBoard.getSnapshot() │
│  ├─ AgentPool → getAgentStates()        │
│  └─ PipelineObserver → 事件流           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  StateAggregator (规划中)               │
│  ├─ getSnapshot() → WebUIState          │
│  │   ├─ nodes: TaskNode[]               │
│  │   ├─ agents: AgentStateEntry[]       │
│  │   ├─ memory: MemoryStats             │
│  │   └─ metrics: TelemetrySnapshot      │
│  └─ subscribe(listener) → unsubscribe   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  WSGateway (规划中)                     │
│  ├─ ws.on("snapshot") → getSnapshot()   │
│  ├─ observer.on("*") → ws.send(event)   │
│  └─ pool events → ws.send(state_change) │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  前端渲染 (webui/)                      │
│  ├─ TaskTree 面板                       │
│  ├─ AgentPool 面板                      │
│  ├─ Memory 面板                         │
│  └─ Metrics 面板                        │
└─────────────────────────────────────────┘
```

### 现有相关导出

| 文件 | 符号 | 用途 |
|------|------|------|
| `packages/engine/src/index.ts:118` | `PoolAwareState` | Agent 状态聚合（方案B：状态所有权归一） |
| `packages/engine/src/core/scheduler.ts:79` | `Scheduler._sessionId` | 当前运行会话标识 |
| `packages/scheduler/src/core/agent-tracker.ts` | `AgentTracker` | Agent 心跳超时跟踪 |
| `packages/scheduler/src/core/task-board.ts` | `TaskBoard.getAllNodes()` | 获取全部节点快照 |
| `packages/telemetry/src/...` | `AuditTrail` + `MetricCounter` | 遥测数据 |

### 关键分支点

- N/A（尚未实现）

### 已知问题

- WebUI 仅存在于设计文档中（`webui/report.md`），无实际代码
- 无 WebSocket 服务端实现
- 无前端渲染代码

### E2E 覆盖

- ❌ 缺: 所有 WebUI 相关 E2E

---

## 12. ConfirmGate 确认流

工具调用 → ConfirmGate 裁决 → 放行/阻断

### 入口

**文件**: `packages/scheduler/src/core/confirm-gate.ts:26`  
**类**: `ConfirmGate`

### 确认判定流程

| # | 文件:行号 | 函数 | 输入 → 输出 |
|---|---------|------|------------|
| 1 | `confirm-gate.ts:76-101` | `needsConfirmation(level, trustContext?)` | ReversibilityLevel + {agentType, toolName} → boolean |
| 2 | L80-81 | bypass 检查 | `_bypass && 未过期` → false（跳过） |
| 3 | L84 | L0 过滤 | `level === RL.L0` → false（永不确认） |
| 4 | L87 | L2/L3 过滤 | `level === RL.L2 \|\| RL.L3` → true（永远确认） |
| 5 | L90-100 | **L1 信任模型判定** | TrustModel 离线 → fail-open(false)；在线 → `getTrustLevelForTool()` → TL<L3 需确认 |

### 确认请求-响应协议

| # | 文件:行号 | 函数 | 说明 |
|---|---------|------|------|
| 6 | `confirm-gate.ts:128-131` | `request(req)` | 登记确认请求 → 返回 requestId |
| 7 | `confirm-gate.ts:138-178` | `waitFor(requestId, timeoutMs?)` | 有 bridge → `bridge.confirm(req)`；无 bridge → Promise + 超时 |
| 8 | L158-177 | **无 bridge 路径** | `new Promise` → 等待 `resolve(approved)` 或超时 → 默认拒绝 |
| 9 | `confirm-gate.ts:184-196` | `resolve(response)` | 外部输入确认 → 调用 resolver(approved) |
| 10 | `confirm-gate.ts:203-214` | `handleTimeout(requestId)` | 超时 → 调用 resolver(false) |

### 信任模型 (TrustModel)

**文件**: `packages/scheduler/src/core/trust-model.ts:9.1KB`

| TrustLevel | 含义 | L1 工具行为 |
|-----------|------|-----------|
| TL.L1 | 最低信任 | 需确认 |
| TL.L2 | 中等信任 | 需确认 |
| TL.L3+ | 高信任 | **免确认** |

### Toolkit 集成 (toolkit.ts:239-261)

```
toolkit.execute()
  ├─ reversibilityOf(toolName) → level
  ├─ gate.needsConfirmation(level, {agentType, toolName})
  │   ├─ false → 跳过
  │   └─ true → gate.request() + gate.waitFor()
  │       ├─ approved=true → 继续执行
  │       └─ approved=false → 返回 error
  └─ gate.recordDecision(callerType, toolName, approved)
```

### 关键分支点

1. **bypass 模式** (`confirm-gate.ts:55-58`): `bypassAll()` — 测试专用，5 分钟 TTL
2. **bridge 存在性** (`confirm-gate.ts:144`): 有 bridge → 真实用户交互；无 bridge → Promise 等待
3. **TrustModel 离线** (`confirm-gate.ts:90-92`): 原则四 fail-open，L1 操作不阻断
4. **无 bridge 告警** (`confirm-gate.ts:244-247`): `_emitNoBridgeWarning()` 保证可观测

### 已知问题

- 无 bridge 时 waitFor 超时默认 120s（`DEFAULT_TIMEOUT_MS`），长超时期间 Agent 挂起
- bypass 模式不校验生产/测试环境——依赖调用方自律
- L2/L3 永远确认，无信任模型参与——高信任 Agent 也无法绕过

### E2E 覆盖

- ✅ `packages/scheduler/tests/` — ConfirmGate unit tests
- ❌ 缺: TrustModel + ConfirmGate 组合决策 E2E
- ❌ 缺: bridge 超时 + resolve 竞态测试
- ❌ 缺: bypass 过期自动关闭的集成测试

---

## 附录: 跨切面关系图

```
                              ┌──────────────────┐
                              │   cortex-cli.mjs  │
                              │   (TUI 壳)        │
                              └────────┬─────────┘
                                       │ delegate
                              ┌────────▼─────────┐
                              │   main.ts (CLI)   │
                              │   bootstrapEngine  │
                              └────────┬─────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
     ┌────────▼────────┐    ┌─────────▼──────────┐   ┌─────────▼──────────┐
     │  LlmAdapter      │    │  Engine (Scheduler) │   │  Toolkit            │
     │  chat/chatStream │    │  executeAll()       │   │  execute()          │
     │  ↓               │    │  ↓                  │   │  ↓                  │
     │  DeepSeek API    │    │  Agent.execute()    │   │  ConfirmGate        │
     └─────────────────┘    │  ↓                  │   │  → FileLock         │
                            │  ReAct Loop          │   │  → tool.execute()   │
                            │  ↓                  │   └────────────────────┘
                            │  Memory Pipeline     │
                            │  ↓                  │
                            │  MemoryStore         │
                            │  ↓                  │
                            │  PipelineObserver    │
                            └─────────────────────┘
                                       │
                            ┌──────────▼──────────┐
                            │  TuiEventBus (TUI)  │
                            │  ↓                  │
                            │  TaskTreeRenderer   │
                            │  ToolLogRenderer    │
                            │  TokenMonitor       │
                            └─────────────────────┘
```

## 附录: 测试覆盖汇总

| 流 | 单元测试 | 集成测试 | E2E | 缺覆盖关键点 |
|----|---------|---------|-----|------------|
| 1. TUI 执行 | ✅ CLI + TUI 测试 | — | ❌ | plan→execute 完整链路 |
| 2. Engine Bootstrap | ✅ bootstrap 测试 | — | ❌ | 全插件拓扑加载/卸载 |
| 3. LLM Adapter | ✅ chat + stream 测试 | ❌ | ❌ | RateLimiter 集成、WorkerPool E2E |
| 4. Agent 执行 | ✅ ReAct + pipeline | ✅ scheduler | ❌ | 多视角部分失败、超时组合 |
| 5. Toolkit 工具 | ✅ toolkit 测试 | — | ❌ | Gate+Lock 组合、沙箱越界 |
| 6. Memory 写入 | ✅ write + commit | ✅ memory-store | ❌ | 两阶段崩溃恢复、溢出归档 |
| 7. Observer/遥测 | ✅ observer + console | ❌ | ❌ | Observer→TUI 桥接、死信追溯 |
| 8. Skill 技能 | — | — | ❌ | JSON→Registry→queryByTags 全链路 |
| 9. 自审视 | — | — | ❌ | 需 LLM API 的完整管线 |
| 10. CI 门禁 | ✅ dry-run | — | ❌ | CI 环境实际运行 |
| 11. WebUI | — | — | ❌ | 完全未实现 |
| 12. ConfirmGate | ✅ Gate + Trust | ❌ | ❌ | Gate+Trust 组合、bridge 超时竞态 |
