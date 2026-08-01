# Cortex CLI 包解剖报告（packages/cli，不含 tui/）

> 调研范围：`packages/cli/src` 非 tui 全部 34 个文件（约 4,600 行），逐文件精读。
> 性质：只读调研，未改动任何代码。证据以 `文件:行号` + 代码摘录标注。
> 背景：为「交互层更深层重写（引擎正式入口 + 薄客户端）」提供完整事实图景。

---

## 0. 结论速览（TL;DR）

1. **CLI 当前是「引擎装配者 + 命令面 + 两个桥」三位一体**：既负责引擎装配（EngineBridge 轻量模式手工拼装 Scheduler/TaskBoard/Observer/Gate/MemoryStore），又充当引擎正式入口（bootstrapEngine）的搬运工，还是 daemon 的远端客户端（RemoteEngineBridge）。装配逻辑应归 engine，CLI 只留命令面。
2. **绕过 engine 的直连共 6 处实质点**：轻量模式手工拼装、MiniAgentPool 自造、`skill.ts` 独立 SkillRegistry 实例（状态分裂）、`LlmAdapter` 直连（engine barrel 注释明示允许）、rollback 跟踪外置、talk 记忆 db 初始化外置。
3. **死代码约 6 组**：platform.ts 桥、bootstrap/config.ts 两个导出、types.ts 三个死类型、talk 记忆三件套（无消费者）、`rebootstrapIfNeeded`/`fetchToolDefs`/`setCurrentAgent`、`_currentRollbackTaskId`（从未赋值）。
4. **三处 TaskNode 构造重复**（run/task/schedule），`ConfigManager` 与 `@cortex/config` 配置域体系并行两套加载逻辑，`schedule status`/`roundtable join` 是 stub。
5. **可下沉原语 8 项**：对话管理、历史序列化、配置加载、TaskNode 工厂、LLM 密钥解析、工具定义/执行+rollback、记忆读写、斜杠命令。
6. **重写后约 12 个文件保留改造、8 个删除**，核心存活资产是 `EngineBridge`（改造为薄适配）、`RemoteEngineBridge`（保留）、命令工厂（保留为薄层）。

---

## 1. 模块结构完整图（非 tui）

```
src/
├── main.ts               (341 行) 统一入口：参数解析/模式选择/废弃门控/启动编排
├── index.ts              ( 73 行) 公开 API barrel（导出全部命令工厂/服务/工具函数）
├── platform.ts           ( 31 行) PlatformBridge 单例（CLIAdapter）——【死代码】
├── types.ts              ( 99 行) CLI 领域类型（OutputFormat/CommandDefinition 等）
├── utils.ts              (107 行) 全局选项解析/格式检测/Markdown 转换
├── bootstrap/
│   ├── config.ts         ( 93 行) ConfigStores 初始化（KeyStore/ModelStore/AgentManifestStore/TuningStore）
│   ├── llm.ts            (200 行) LLM 三路密钥引导，构造 LlmAdapter 映射
│   └── mcp.ts            (123 行) MCP 后端加载 + SearchAggregator 装配
├── commands/             (17 文件)
│   ├── index.ts          (127 行) CommandRegistry（注册/别名/子命令路由/选项解析）
│   ├── command-list.ts   (157 行) 15 个命令的 name/alias/description + registerCommands
│   ├── agent.ts          (398 行) agent list/inspect/spawn/destroy（含 agent-instances.json 持久化）
│   ├── task.ts           (254 行) task submit/list/status/cancel/redo
│   ├── memory.ts         (262 行) memory write/read/search/link/archive/freeze/obliterate/flush/stats
│   ├── run.ts            (152 行) run 单次执行（输入文件 → TaskNode → Scheduler）
│   ├── config.ts         (181 行) config list/get/set/init/validate
│   ├── schedule.ts       (163 行) schedule plan/run/status（status 为 stub）
│   ├── roundtable.ts     (345 行) roundtable start/list/status/join（join 为 stub，start 单 LLM 模拟辩论）
│   ├── skill.ts          (389 行) skill list/search/info/register/unregister/stats（直连 SkillRegistry）
│   ├── doctor.ts         (167 行) doctor 健康诊断（封装 @cortex/doctor）
│   ├── inspect.ts        (201 行) inspect dir/deps/drift/report（直连 @cortex/tools）
│   ├── confirm.ts        (109 行) confirm pending/approve/reject
│   ├── doc.ts            (205 行) doc convert/serve/check（含 HTTP 静态服务器）
│   ├── setup.ts          ( 63 行) setup 委托 spawn 独立 cortex-cli.mjs
│   ├── help.ts           ( 92 行) help 总览/单命令
│   └── version.ts        ( 44 行) version 信息
├── formatters/
│   ├── index.ts          ( 43 行) Formatter 注册表 + TTY 自动检测
│   ├── text-formatter.ts ( 56 行) 纯文本（管道友好）
│   ├── json-formatter.ts ( 66 行) status/data/meta 三层 JSON
│   └── color-formatter.ts( 87 行) ANSI 彩色
└── services/
    ├── engine-bridge.ts      (621 行) ★引擎生命周期桥（轻量/bootstrap 双模式）
    ├── remote-engine-bridge.ts (391 行) ★daemon WS/HTTP 远端桥
    ├── config-manager.ts     (199 行) CLI 配置加载（自实现深合并+向上搜索）
    ├── mini-agent-pool.ts    (119 行) CLI 自造最小 AgentPool
    └── slash-command.ts      (110 行) /xxx 斜杠命令 → SkillRegistry 路由
```

---

## 2. 入口与命令

### 2.1 main.ts 完整启动流程

**阶段 A：模块加载期（top-level，`main.ts:69-198`）**
1. `parseProjectRoot()`（L69-79）：扫描 `--dir=`/`--dir`/`-d` → `PROJECT_ROOT`（默认 cwd）。
2. `CONFIG_ROOT` 哨兵（L84-87）：`docs/constitution` 目录存在判定是否 cortex 仓库。
3. `loadEnv()`（L90-105）：手工解析 `.env`（引号剥离、仅填充未设变量）——**自行实现，未用 dotenv**。
4. `enableLlmAudit()`（L108）、`bootstrapConfigStores()`（L111）→ 全局 ConfigStores 单例。
5. **Ink 模式流重定向**（L116-148）：`INK_MODE = argv.length===0`，将 stdout 静音、stderr 重定向至 `.cortex/logs/engine.log`、console.log 抑制。
6. `detectDaemon(CORTEX_DAEMON_PORT)`（L160，默认端口 3210）：`GET /api/v1/daemon/health` 1s 超时探测；`CORTEX_DAEMON_MODE=off` 强制跳过。
7. **引导**（L162-198）：`new ConfigManager()` + `new EngineBridge(configManager)`；若 daemon 不可用且 `bootstrapLlm` 有 key → `new Toolkit()` + `bootstrapMcp` + `engineBridge.setBootstrapConfig({llms, toolkit, projectRoot, workspaceRoot})`。随后 `new DocRegistry(fs, CONFIG_ROOT)` + `registerCommands(registry, {...})`。引导失败恢复流并 `process.exit(CLI_EXIT_INTERNAL_ERROR)`。

**阶段 B：main()（`main.ts:225-322`）**
1. `execSync(WINDOWS_CHCP_UTF8)`（L226）：Windows 下 chcp 65001。
2. 快速路径：`--version/-V`（L231-235）、裸参数→Ink TUI（L238-274）、`--help/-h`（L277-281）。
3. **TUI 模式桥选择**（L242-255）：daemon 可用 → `new RemoteEngineBridge({port})` + `connect()`；否则 `hasAnyLlmKey()` 为假时仅打印提示（无 key 也能进 TUI，命令模式可用）。
4. 全局选项剥离（L284-297）：`parseGlobalFormat` / `--quiet/-q` / `--verbose/-v` / `stripGlobalOptions`。
5. `cortex <command> --help` 转发 help（L300-306）。
6. `registry.dispatch(cleanArgs, context)`（L309）+ `outputResult`（stderr 输出）+ finally `engineBridge.shutdown()`。

**废弃门控（`main.ts:328-340`）**：
```
if (isDirectRun()) {
  console.error("⚠️  CLI/TUI 已废弃（2026-07）——Cortex 当前仅作为引擎库使用。");
  if (process.env[ENV_CORTEX_ENABLE_CLI] === "1") { main()... } else { process.exit(0); }
}
```
即：**入口默认空转退出**，仅 `CORTEX_ENABLE_CLI=1` 可启用。`isDirectRun()`（utils.ts:78-82）通过 argv[1] 尾部匹配 `/src/main.ts|/src/main.js|/dist/main.js` 判断。

### 2.2 CommandRegistry（commands/index.ts）

- 结构：`Map<name, CommandDefinition>` + `Map<alias, name>`（L14-15）。
- `dispatch`（L53-87）：首参 → 别名解析 → 子命令查表 → `_parseOptions`（L90-125，支持 `--key=value`/`--key v`/`-k v`/布尔 flag）→ handler。**顶层与子命令都直接取 handler，所有子命令路由实际在各命令文件内部 switch**，registry 的 `subcommands` 字段从未被任何命令使用。
- 输出收敛：`{ code, output: r.output ?? r.error ?? "" }`，真正的输出/退出码映射在 main.ts 完成。

### 2.3 15 个命令实现要点

| 命令 | handler 工厂（文件:行） | 参数/调用链/输出 |
|---|---|---|
| `run` | run.ts:119 | `[file]` + `--agent/-a --output/-o --title --document --watch --dry-run`。读文件/stdin → `_isDocConversion` 判定 `.md` 走 `convertMarkdown`（utils.ts:90）→ 否则 `_createTaskNode`（run.ts:72）+ `board.addNode` + `scheduler.executeAll()`。输出 `result.output`。 |
| `agent` | agent.ts:72 | `list/inspect/spawn/destroy`。`safePool`（L128）包装 `IAgentPool` 可选链。`INSTANCES_FILE = .cortex/agent-instances.json`（L17）跨进程持久化 spawn 数。list 合并 `getStrategists()`（bootstrap 后才有）。spawn/destroy 前置 `ensureBootstrapped`（L88-91）。 |
| `task` | task.ts:64 | `submit/list/status/cancel/redo`。`_createSubmittedTaskNode`（L50）。submit `--wait/-w` 阻塞执行。cancel 用 `board.failNode`，redo 先 `board.release` 再 `executeAll`。 |
| `memory` | memory.ts:50 | 9 个子命令直连 `IMemoryStore`。write 构造 `MemoryWriteInput`（L93-101）；search 构建 `MemoryQuery`（L134）。 |
| `config` | config.ts:35 | `list/get/set/init/validate`。`set` 尝试 JSON.parse（L125）。init 写 `~/.cortex/config` 或 `.cortex/config`。 |
| `schedule` | schedule.ts:33 | `plan/run/status`。plan 仅做静态文件解析+`estimatedDuration=任务数*5s` 假估算（L66）；run 将 plan JSON tasks 逐个 `submitTask` + `executeAll`；**status 是 stub**（L156-162 只输出提示）。 |
| `roundtable` | roundtable.ts:35 | `start/list/status/join`。`_getTemplates` 从 `bootstrapResult.config.roundtableTemplates` 取模板；`_runDebateRounds`（L85-114）**单 LLM 循环模拟多 Agent**（`bridge.directChat`，非真多 Agent 调度）；共识归档至 DocRegistry（L137-163）；**join 是 stub**（L330-344）。 |
| `skill` | skill.ts:29 | `list/search/info/register/unregister/stats`。模块级 `_registryCache`（L18）**自建 `new SkillRegistry()` 单例**（见 §4 绕过点 5）。 |
| `doctor` | doctor.ts:71 | 无子命令。`HealthChecker.diagnose(projectRoot, doctorOpts)`，阈值阻断 `computeTotalScore`（L110）。 |
| `inspect` | inspect.ts:35 | `dir/deps/drift/report`。dir 自实现 `_scanDir` 递归（L56）；deps/drift 直连 `@cortex/tools` 的 `collectPackages/buildEdges/detectCycles/detectDrift`；**report 是空壳**（L172-200，数据结构为空对象）。 |
| `confirm` | confirm.ts:30 | `pending/approve/reject`。直接 `gate.resolve({requestId, approved})`。 |
| `doc` | doc.ts:34 | `convert/serve/check`。serve 自建 HTTP 静态服务器（L84-106，含路径穿越防护）；check 标题层级+外链检查（L140-170）。 |
| `setup` | setup.ts:17 | `spawn("node", [cortex-cli.mjs, "--mode", "setup"])` 委托独立脚本（L36）。 |
| `help` | help.ts:78 | 总览或单命令。HELP_FOOTER 含 `cortex repl`/`cortex daemon start` 字样（L32-35），**两者实际均未实现**（无 repl 命令、无 daemon 子命令）。 |
| `version` | version.ts:34 | `--json/--full`，读 `CORTEX_VERSION/CORTEX_PHASE/DEPENDENCY_VERSIONS`。 |

---

## 3. services/ 深度解剖

### 3.1 engine-bridge.ts（621 行）★

**类型面**：`BridgeContext`（L38-54）——scheduler/memoryStore/taskBoard/pipelineObserver/confirmGate/cliAdapter/initialized/bootstrapped/bootstrapResult/talkMemoryStore/slashCommandParser。`BootstrapConfig`（L59-67）——llms/toolkit/projectRoot/workspaceRoot/dbPath/engineConfig。

**类字段**（L78-85）：
| 字段 | 说明 |
|---|---|
| `ctx: BridgeContext` | 初始化后组件集合，`{initialized:false}` 起步 |
| `_pool: MiniAgentPool` | 轻量模式 AgentPool |
| `config: ConfigManager` | 配置管理器 |
| `dbPath?` / `engineConfig?` | 构造注入 |
| `_bootstrapConfig?` | bootstrap 配置（setBootstrapConfig 设置） |
| `_currentRollbackTaskId?` | **从未被赋值**（仅 L298 读取、L594 重置）——死字段 |

**方法清单**（签名+职责+关键实现）：

| 方法 | 签名 | 职责/要点 |
|---|---|---|
| `setBootstrapConfig` | `(cfg: BootstrapConfig): void` | 记录配置 + 提前 `toolkit.setWorkspaceRoot()`（L97-104） |
| `ensureBootstrapped` | `(): Promise<void>` | 配置驱动模式入口，转发 `_ensureBootstrapped` |
| `rebootstrapIfNeeded` | `(ws: string): Promise<void>` | **无调用方**（死代码）；workspaceRoot 变更才重引导 |
| `_ensureBootstrapped` | `(): Promise<BridgeContext>` | L135-170：调 `bootstrapEngine(projectRoot,{llms,toolkit,dbPath,engineConfig,workspaceRoot})`，结果映射进 ctx，`slashCommandParser = new SlashCommandParser(result.skillRegistry)` |
| `ensureBootstrappedContext` | `(): Promise<BridgeContext>` | roundtable 命令专用入口 |
| `ensureInitialized` | `(): Promise<BridgeContext>` | **轻量模式**（L181-232）：逐个 `new PipelineObserver()` → `new CLIAdapter()` → `new ConfirmGate()`（TTY 才 setBridge）→ `new TaskBoard()`+setObserver → `new MemoryStore(undefined, observer)`+init(dbPath) → `new Scheduler(board, this._pool, observer, undefined, engineConfig)` |
| `ready` / `bootstrapped` | getter | `ctx.initialized` / `ctx.bootstrapped ?? false` |
| `ensureReady` | `(): Promise<void>` | 转发 `ensureInitialized`（仅轻量） |
| `chat` | `(sys, msgs, opts): Promise<string>` | **等价于 directChat**（L253-255）——不经调度器 |
| `getChatModelName` / `getReasonerModelName` | `(): string` | 读 `this.llm`（bootstrap 后才有效） |
| `getToolDefs` | `(agent): ToolDef[]` | 读 `_bootstrapConfig.toolkit.listDefinitions(agent)`（L271-279） |
| `executeToolCall` | `(name, args): Promise<{success, output}>` | L286-304：`toolkit.execute({toolName, params}, AgentType.Code)`；write_file 成功后 `toolRollbackRegistry.trackCreate(taskId, absPath)`——taskId 恒为 `"executeToolCall"` |
| `streamChat` | `(model, msgs, tools, onChunk, opts)` | L319-330：`l.chatStream(...)` 直连 LlmAdapter |
| `submitTask` | `(node): Promise<void>` | 按模式选 `_ensureBootstrapped`/`ensureInitialized`，`board.addNode` |
| `executeAll` | `(): Promise<ExecutionReport>` | `scheduler.executeAll()` + 失败节点 `toolRollbackRegistry.rollback` |
| `executeWithStream` | `(nodes, onEvent)` | L369-431：board.clear → 逐节点 emit `task_tree_update`/`node_start` → executeAll → emit `node_complete`/`node_failed`（含 rollback） |
| `readTalkMemory`/`writeTalkMemory`/`readMainMemory` | — | **无消费者**（talk 模式已从 tui 移除，见 §6） |
| `llm` | private getter | L469-474：`llms.get(LLM_KEY_NAMES.CYRENE) ?? 第一个` |
| `directChat` | `(sys, msgs, opts)` | L486-501：`l.chat(model, [system, ...msgs], undefined, reasoningEffort)` |
| `agentPool` / `getAgentPool` | — | bootstrap 用 `result.pool`，否则 `_pool` |
| `getMemoryStore`/`getScheduler`/`getTaskBoard`/`getObserver`/`getConfirmGate` | — | 全部转发 `ensureInitialized`（**注意：命令层面走到这里永远只初始化轻量模式**，见下） |
| `getMetaAgent`/`getStrategists` | — | 仅 bootstrapResult 存在时有值 |
| `ensureTalkMemory`/`_ensureTalkMemory` | — | L569-582：建 `.cortex/cyrene-memory.db` 独立 MemoryStore——**无消费者** |
| `shutdown` | `(): Promise<void>` | L589-615：`toolRollbackRegistry.reset()` → **只用 `orchestrator.shutdown()`（L597-599），而非 `bootstrapResult.shutdown()`（后者还清 telemetry/workerPool/container/consoleBridge）** → memoryStore/talkMemoryStore flush+close → cliAdapter.close |

**bootstrap 模式 vs 轻量模式差异**：

| 维度 | 轻量模式（ensureInitialized） | 配置驱动（_ensureBootstrapped） |
|---|---|---|
| 装配 | CLI 手工拼装（L185-219） | `bootstrapEngine` 插件化装配（L147-153） |
| AgentPool | `MiniAgentPool`（CLI 自造） | engine 真实 AgentPool（`result.pool`） |
| Agent 注册 | 无 | 从 agents 配置域注册全部 Agent |
| MetaAgent/Strategists | 无 | 有 |
| SkillRegistry | 无（slashCommandParser 缺失） | 有（L166） |
| 关闭 | 手动 flush/close | orchestrator（部分） |
| 触发条件 | `isBootstrapConfigured===false`（无 LLM key 时） | `setBootstrapConfig` 已调用 |

**关键陷阱**：`getScheduler()`/`getTaskBoard()` 等 getter 无条件走 `ensureInitialized()`（L516-544）。因此当 bootstrap 配置存在时，`task/memory/confirm` 等命令拿到的仍是**轻量组件**——只有 `run`（L92-93）和 `agent spawn/destroy`（agent.ts:88-91）显式区分模式。**bootstrap 与轻量两组组件可同时在 ctx 中存活**，`_ensureBootstrapped` 会覆盖 `ctx`（L155）但 getter 仍先走 ensureInitialized 的短路判断（`ctx.initialized` 已被 bootstrap 置 true）。

**生命周期状态机**：
```
构造 ──→ ctx={initialized:false}
            │
            ├─ setBootstrapConfig() ──→ _bootstrapConfig 就绪
            │
            ├─ ensureInitialized() ──→ ctx={initialized:true, 手工组件}
            │
            ├─ ensureBootstrapped() ──→ ctx={initialized:true, bootstrapped:true, bootstrapResult}
            │                               └─ rebootstrapIfNeeded → 重跑
            │
            └─ shutdown() ──→ rollback.reset + orchestrator.shutdown + memory flush/close + cliAdapter.close
                              └─ ctx={initialized:false, bootstrapped:false}（可再初始化）
```

### 3.2 remote-engine-bridge.ts（391 行）

实现 `ITuiEngineBridge`（@cortex/shared tui-bridge.ts:16-50），对端是 `@cortex/client` 的 `CortexConnection`（channels: chat/gate/tui/pipeline，L60-64）。

**方法 → 传输映射**：

| 方法 | 传输通道 | 对应 daemon 侧 |
|---|---|---|
| `connect`/`disconnect` | `conn.connect()` / `conn.disconnect()`（L68-76） | WS 握手 |
| `getChatModelName`/`getReasonerModelName` | 缓存自 `_fetchHealth`（L372-389）→ `GET /api/v1/daemon/health` | `DaemonHealthSnapshot.chatModel/reasonerModel`；未取到回退硬编码 `deepseek-v4-flash/pro` |
| `getToolDefs` | 同步记 `_currentAgent`，返回 `[]`（L90-95） | 工具由 daemon 管理 |
| `fetchToolDefs` | `GET /api/v1/agents`（L101-110） | **无调用方** |
| `setCurrentAgent` | —（L113-115） | **无调用方** |
| `streamChat` | `ws.startChat({input, mode:"chat", agent, history})`（L163-168）+ 订阅 `chat.chunk/chat.complete/chat.error`（L170-199） | daemon 跑完整 queryLoop；`tool_calls` 恒 undefined |
| `executeToolCall` | `POST /api/v1/execute`（L223-237） | daemon Toolkit 执行 |
| `chat`（非流式） | `POST /api/v1/chat`（L245-251），system+messages 拼接为单串 | 摘要/压缩场景 |
| `ensureTalkMemory` | no-op（L256-258） | daemon 启动时已初始化 |
| `readTalkMemory`/`writeTalkMemory` | `GET/POST /api/v1/memory`（L261-279） | **无消费者** |
| `executeWithStream` | `POST /api/v1/execute`（action:"execute_plan"）+ 订阅 tui channel（L289-349），60s 超时兜底 | daemon Scheduler 执行 |
| `getMetaAgent` | `POST /api/v1/execute`（action:"plan"）返回代理对象（L358-367） | daemon 侧甘雨 |

**内部状态**：`_chatModelName`/`_reasonerModelName`/`_healthFetched`/`_currentAgent`（默认 `"cyrene"`，L54）。

### 3.3 config-manager.ts（199 行）

- `CliConfig` 五层加载（L144-197）：内置默认 `DEFAULT_CONFIG`（L56-71）→ 环境变量 `CORTEX_CLI_DEFAULT_FORMAT`/`CORTEX_LLM_CHAT_MODEL`（L146-156）→ 指定文件 → `_searchUp(".cortex/config")`（L188-197，cwd 向上递归）→ `~/.cortex/config`。
- `deepMerge`（L23-33）自实现递归合并。
- **与 @cortex/config 的 ConfigStore/loadConfigDomain 体系完全并行**——后者负责 agents/keys/models/tuning/mcpServers 域（bootstrap/config.ts），前者只管 CLI 自己的小配置。两套 JSON 加载逻辑并存。

### 3.4 mini-agent-pool.ts（119 行）

- 实现 `IAgentPool`（@cortex/scheduler）：register/setMaxInstances/spawn/spawnSubtask/setStatus/getStatuses/getStatus/hasAwake/canSpawn/destroy/count/heartbeat(no-op)/ping/getPoolStats。
- 纯内存 Map（configs/instances/statuses），不接事件总线（setObserver no-op，L29-31）、无心跳（L96-98）。
- 定位：轻量模式的 AgentPool 替身。**engine 已有正式 AgentPool（bootstrap 的 pool）**，此实现是"原型阶段"的遗留（注释 L215-217 自述）。

### 3.5 slash-command.ts（110 行）

- `SlashCommandParser.parse(input)`（L50-100）：`/` 开头 → 取命令名 → `/list` 内置 → `skillRegistry.get(name)` → `userInvocable===false` 拦截。
- `listInvocable()`（L105-108）。
- 消费者仅 `EngineBridge._ensureBootstrapped`（L166）——**TUI 侧是否使用需 tui 负责人确认**（本调研范围外；grep 未见 tui 引用 `SlashCommandParser`）。

---

## 4. 依赖面：@cortex/* 导入全清单与绕过点

### 4.1 导入清单（按包聚合，非 tui）

| 包 | 导入位置 | 使用内容 |
|---|---|---|
| `@cortex/client` | services/remote-engine-bridge.ts:29 | `CortexConnection`（daemon 模式正式通道） |
| `@cortex/config` | main.ts:29-35、bootstrap/config.ts:13-22、bootstrap/llm.ts:11-30、bootstrap/mcp.ts:18-25、services/config-manager.ts:17、services/engine-bridge.ts:28,34、commands/version.ts:8、commands/confirm.ts:13 | 常量/退出码/Store/域加载 |
| `@cortex/doctor` | commands/doctor.ts:11 | `HealthChecker` |
| `@cortex/engine` | services/engine-bridge.ts:16-22 | `Scheduler`(类型仅)、`MetaAgent`/`StrategistAgent`(类型)、`bootstrapEngine`、`BootstrapEngineResult` |
| `@cortex/governance` | main.ts:25、commands/command-list.ts:13、commands/roundtable.ts:14 | `DocRegistry` |
| `@cortex/llm` | bootstrap/llm.ts:10、services/engine-bridge.ts:31 | `LlmAdapter` |
| `@cortex/memory-store` | services/engine-bridge.ts:29 | `MemoryStore` |
| `@cortex/parser` | utils.ts:14、index.ts:16 | `convert`/`convertToDocument` |
| `@cortex/platform` | main.ts:26、bootstrap/mcp.ts:11-17、services/engine-bridge.ts:27、platform.ts:10 | `Toolkit`/`NodeFileSystemAdapter`/`CLIAdapter`/`SearchAggregator`/`McpSearchBackend`/`DdgSearchBackend` |
| `@cortex/scheduler` | services/engine-bridge.ts:24,26、services/mini-agent-pool.ts:10 | `Scheduler`/`TaskBoard`/`PipelineObserver`/`ConfirmGate`（值导入）+ 接口 |
| `@cortex/shared` | 全部 commands + services + main.ts | 类型/常量/运行时注册表 |
| `@cortex/skill-kit` | commands/skill.ts:13、services/slash-command.ts:16 | `SkillRegistry` |
| `@cortex/tools` | services/engine-bridge.ts:36、commands/inspect.ts:11 | `toolRollbackRegistry`、monorepo 分析函数 |

### 4.2 绕过 engine 正式入口的点（重点）

> 前置事实：`@cortex/engine` barrel 明确注释（engine/src/index.ts:8-16, 101, 120, 146-147）——`config/scheduler/telemetry/governance/skill-kit/llm` **不从 engine barrel 重导出，请从源包直接导入**。因此下述 1/2 属"设计内直连"；其余为实质绕过。

| # | 位置 | 绕过内容 | 性质 |
|---|---|---|---|
| 1 | engine-bridge.ts:185-219（ensureInitialized） | 手工 `new PipelineObserver/CLIAdapter/ConfirmGate/TaskBoard/MemoryStore/Scheduler` 拼装引擎 | **实质绕过**：引擎装配逻辑外置 CLI，与 bootstrapEngine 插件装配形成两套并行路径 |
| 2 | engine-bridge.ts:79 + mini-agent-pool.ts 全文 | CLI 自造 `MiniAgentPool` 实现 `IAgentPool` | **实质绕过**：绕过 engine 的 AgentPool/AgentRegistry 正式实现 |
| 3 | commands/skill.ts:18-25（`_registryCache`） | `new SkillRegistry()` **独立单例**，与 `bootstrapEngine.skillRegistry`（engine-bridge.ts:166）**不是同一实例** | **状态分裂**（比绕过更严重）：`cortex skill register` 对 engine 调度不可见，`/xxx` 斜杠命令与 `cortex skill` 互不相通 |
| 4 | bootstrap/llm.ts:10,102 + engine-bridge.ts:31,329 | 直接 `new LlmAdapter()` 并直调 `l.chatStream/chat` | 设计内（engine barrel 明示允许），但 **streamChat/directChat 是 CLI 自包一层，未用 engine 正式 `streamChat` 导出**（engine/src/index.ts:69） |
| 5 | engine-bridge.ts:294-301,346-354,415-418 + tools/rollback-registry.ts | `toolRollbackRegistry` 跟踪/回滚在 CLI 桥内做 | 工具副作用回滚逻辑应属引擎执行层，现散落 CLI |
| 6 | engine-bridge.ts:574-582（`_ensureTalkMemory`） | 直接 `new MemoryStore()` 建 `.cortex/cyrene-memory.db` | 绕过 engine `initCyreneMemory`（engine/src/index.ts:94）正式入口；且当前无消费者 |
| 7 | main.ts:186-187 + commands/roundtable.ts:154 | 直接 `new DocRegistry()` 并直接 `docRegistry.register()` | 设计内（engine barrel 注释 L114），但 roundtable 共识归档绕过了治理管线 |
| 8 | main.ts:157-160 + remote-engine-bridge.ts:372-389 | CLI 侧自实现 `detectDaemon` HTTP 探测 + `_fetchHealth` 双通道健康探测 | 健康探测逻辑重复两处（HTTP 1s 超时 vs conn.http） |

---

## 5. 状态模型

CLI 侧无集中状态管理，状态散落为模块级单例/实例字段：

| 状态 | 位置 | 生命周期 | 流转 |
|---|---|---|---|
| ConfigStores 单例 | bootstrap/config.ts:43 `_stores` | 进程级 | `bootstrapConfigStores()` 幂等创建；仅 main.ts 使用 keyStore/modelStore |
| Ink 流重定向 | main.ts:118-121 | 进程级 | INK_MODE → 重定向；`restoreInkStreams()` 幂等恢复 |
| ConfigManager.config | config-manager.ts:74 | 进程级 | 构造时一次性加载；`config set` 只改内存，**不落盘**（L127） |
| EngineBridge.ctx | engine-bridge.ts:78 | 进程级 | 见 §3.1 状态机 |
| EngineBridge._bootstrapConfig | engine-bridge.ts:83 | 进程级 | main.ts:177 设置一次 |
| EngineBridge._currentRollbackTaskId | engine-bridge.ts:85 | 进程级 | **从未赋值**（死字段） |
| RemoteEngineBridge._currentAgent | remote-engine-bridge.ts:54 | 连接级 | 默认 `"cyrene"`，getToolDefs 时同步（L93） |
| SkillRegistry 缓存 | skill.ts:18 `_registryCache` | 进程级 | 懒加载独立单例 |
| Agent 实例持久化 | agent.ts:17 `agent-instances.json` | **跨进程**（文件） | spawn/destroy 读写 JSON（L23-36, 353-355, 383-388） |
| PlatformBridge 单例 | platform.ts:13 `_bridge` | 进程级 | getPlatformBridge 懒创建——死代码 |
| daemon 可用性 | main.ts:160 | 启动时一次 | detectDaemon 探测，TUI 模式决定桥类型 |

**缺位项**：当前 agent（TUI 会话级 active agent 在 remote 桥里是 `_currentAgent`，本地桥**无对应状态**，streamChat 时由 query-loop 传 agent 但 engine-bridge 不记录）；对话历史由 tui 侧 session-store 管理（tui 范围）；REPL 历史文件 `~/.cortex/history`（config-manager.ts:60 默认值）**声明但从未读写**；无会话/持久化配置缓存写入。

---

## 6. 死代码与冗余（grep 验证）

### 6.1 无调用方的导出/成员

| 符号 | 位置 | 验证 |
|---|---|---|
| `getPlatformBridge`/`closePlatformBridge` | platform.ts:16,25（index.ts:69 导出） | 全 packages grep 仅定义处；tests 无引用 → **整文件死代码** |
| `getConfigStores` | bootstrap/config.ts:69 | 仅被同文件 `injectAgentManifestsToRegistry` 引用 |
| `injectAgentManifestsToRegistry` | bootstrap/config.ts:82 | **全仓库无调用方**（含 tests） |
| `InteractionMode`/`GlobalOptions`/`EngineComponents` | types.ts:14,18,89 | 全 src 无使用 → 死类型 |
| `rebootstrapIfNeeded` | engine-bridge.ts:122 | 无调用方 |
| `readMainMemory` | engine-bridge.ts:454 | 无调用方（ICortexMemory 接口方法，tui 不消费） |
| talk 三件套 `ensureTalkMemory`/`readTalkMemory`/`writeTalkMemory` | engine-bridge.ts:434-451,569-582 + remote-engine-bridge.ts:256-279 | 非 tui 无调用；tui grep 仅命中 plan-mode 的 executeWithStream/getMetaAgent；tui/modes 目录**已无 talk-mode**（仅 command/plan/plan-utils）→ **昔涟记忆链路整体死代码** |
| `_ensureTalkMemory`（cyrene-memory.db 初始化） | engine-bridge.ts:574-582 | 同上，死代码但**有副作用**（调用即建库） |
| `fetchToolDefs` | remote-engine-bridge.ts:101 | 无调用方 |
| `setCurrentAgent` | remote-engine-bridge.ts:113 | 无调用方（`getToolDefs` 内联自同步） |
| `_currentRollbackTaskId` | engine-bridge.ts:85 | 仅 L298 读、L594 重置，**从未 set** → rollback taskId 恒为 `"executeToolCall"` |
| `McpBootstrapResult` 类型导出 | bootstrap/mcp.ts:28 / index.ts:26 | 无外部消费（main.ts 仅忽略返回值） |

### 6.2 stub / 半成品

- `schedule status`（schedule.ts:156-162）：仅打印提示文案。
- `roundtable join`（roundtable.ts:330-344）：返回"原型阶段"文案。
- `inspect report`（inspect.ts:172-200）：`dependencies:{}, structure:{}` 空壳。
- `help` 页宣传 `cortex repl`/`cortex daemon start`（help.ts:32-35）——两命令均不存在。
- `run --watch`/`schedule --watch`（run.ts:24, schedule.ts:29）：解析但无实现。

### 6.3 冗余 / 重复实现

1. **TaskNode 构造三处重复**：run.ts:72-84 `_createTaskNode`、task.ts:50-62 `_createSubmittedTaskNode`、schedule.ts:129-141 内联构造——字段集完全相同（id 生成仅前缀不同）。
2. **skill 注册表分裂**：skill.ts:22 自建 SkillRegistry vs engine-bridge.ts:166 使用 bootstrapEngine 的 skillRegistry——两个独立实例。
3. **配置加载双轨**：config-manager.ts:144-197（deepMerge+_searchUp）vs @cortex/config 的 `loadConfigDomain`/`ConfigRegistry`（bootstrap/config.ts 使用）——不同 JSON、不同路径规则。
4. **健康探测双通道**：main.ts:209-219 `detectDaemon`（fetch 1s）vs remote-engine-bridge.ts:372-389 `_fetchHealth`（conn.http）。
5. **引擎装配双路径**：ensureInitialized 手工拼装 vs _ensureBootstrapped（见 §3.1 陷阱：getter 恒走轻量，可两套并存）。
6. **roundtable 多 Agent 是单 LLM 模拟**：roundtable.ts:85-114 用 `directChat` 循环，非 engine 的多 Agent 调度（tui 的 group-chat 属 tui 范围）。
7. **与 desktop/server 重复**：grep 验证 desktop 无上述逻辑；server 使用 engine 正式 `streamChat`（server/src/chat-executor.ts:58）——**CLI 的 streamChat 包装与 server 走不同实现路径**（CLI 直连 LlmAdapter，server 走 engine chat-loop）。

---

## 7. 可下沉原语候选（交互底座应提供）

| # | 原语 | 当前位置（证据） | 为什么可下沉 |
|---|---|---|---|
| 1 | **对话管理**（streamChat/directChat/chat 三合一） | engine-bridge.ts:253-255, 319-330, 486-501 | engine 已有正式 `streamChat`（engine/src/index.ts:69，chat-loop）；CLI 自包 `l.chatStream/chat` 直连适配器，缺少 engine 的韧性/路由/遥测包裹（bootstrap-engine.ts:436-454 注册的策略对 CLI 直连不可见）。底座应提供"会话+流式+工具轮询"一体 API |
| 2 | **历史序列化** | remote-engine-bridge.ts:145-157 `serializeMsg` | LlmMessage→DTO（tool_calls/arguments 字符串化）是协议面通用能力，daemon/server/桌面端都要用；现仅 CLI 私有 |
| 3 | **配置加载** | config-manager.ts:144-197 | @cortex/config 已提供 ConfigRegistry/loadConfigDomain；CLI 深合并+向上搜索逻辑应下沉 config 包统一 |
| 4 | **TaskNode 工厂** | run.ts:72-84 / task.ts:50-62 / schedule.ts:129-141 | 三处重复的 CLI→TaskNode 构造；底座应提供 `fromCliInput(content, opts)` 类工厂 |
| 5 | **LLM 密钥解析** | bootstrap/llm.ts:52-67, 78-143 | vault→env→兜底三级解析 + models.json 能力注入，engine 的 `resolveLlm`（bootstrap-engine.ts:145）只做映射查找；密钥发现属交互底座（或 config 包） |
| 6 | **工具定义/执行 + rollback** | engine-bridge.ts:271-279, 286-304 + tools/rollback-registry.ts | `getToolDefs`/`executeToolCall` 是引擎能力，rollback 跟踪（write_file→trackCreate→失败清理）应并入 engine 执行层，而非 CLI 桥 |
| 7 | **记忆读写** | engine-bridge.ts:434-461, 516-520 | 已走 IMemoryStore 接口；但 talk 记忆库初始化（L574-582）与主库双库策略应下沉 engine `initCyreneMemory`；CLI 只保留 read/write 透传 |
| 8 | **斜杠命令** | slash-command.ts 全文 + engine-bridge.ts:166 | `/xxx`→SkillRegistry 路由是通用交互底座能力（desktop/webui 同样需要）；现实例挂在 CLI BridgeContext 上 |

---

## 8. 重写影响面评估（engine 正式入口 + 薄客户端模型）

评估口径：CLI 仅保留「命令面 + 传输层」，引擎装配/对话/工具/记忆全部收敛到 `@cortex/engine` 正式 API（`bootstrapEngine` + engine `streamChat` + SkillRegistry + MemoryStore 注入）。

| 文件 | 处置 | 理由/改造要点 |
|---|---|---|
| `main.ts` | **改造（精简）** | 保留：参数解析/废弃门控/daemon 探测/Ink 流重定向。删除：本地引擎装配（L162-184）→ 改为仅 `EngineBridge(remote?)` 薄适配；`detectDaemon` 可下沉 client 包 |
| `index.ts` | **改造** | 删除死导出（platform.ts/talk 记忆相关）；命令工厂保留（集成测试依赖，index.ts:41-55） |
| `platform.ts` | **删除** | 死代码（§6.1） |
| `types.ts` | **保留（裁剪）** | 删 3 个死类型；`CommandDefinition/CommandHandler/CommandResult` 继续作为命令面契约 |
| `utils.ts` | **保留（裁剪）** | 全局选项解析保留；`convertMarkdown` 可下沉 parser 包（现为 utils 直连 parser） |
| `bootstrap/config.ts` | **改造** | `bootstrapConfigStores` 保留（config 域入口）；删 `getConfigStores/injectAgentManifestsToRegistry`（死代码，且 engine bootstrap 已做 `injectRegistryFromConfig`，bootstrap-engine.ts:198） |
| `bootstrap/llm.ts` | **改造/下沉** | LlmAdapter 三路构造下沉至 engine 或 config；CLI 仅保留 `hasAnyLlmKey` 门控 |
| `bootstrap/mcp.ts` | **下沉** | Toolkit 装配+MCP 后端应随 engine bootstrap（bootstrapEngine 已接受 toolkit 注入）；CLI 不再负责启动 MCP |
| `commands/*`（15 文件） | **保留（薄层化）** | 参数解析+输出格式化保留；引擎调用改为 engine 正式 API。具体：agent/task/memory/schedule/run 改为经 `ICortexApi` 薄透传；skill 改注入 bootstrapEngine 的 skillRegistry（消除状态分裂）；roundtable 的辩论循环改 engine 真多 Agent 或移除 |
| `formatters/*` | **保留** | 纯展示层，与引擎无关 |
| `services/engine-bridge.ts` | **改造（核心）** | 删除轻量模式手工拼装（L185-219）+ MiniAgentPool + talk 记忆 + rollback 跟踪；保留 `bootstrapEngine` 包装与 `ICortexApi` 适配；`shutdown` 改调 `bootstrapResult.shutdown()`（现遗漏 telemetry/workerPool/container 清理，§3.1） |
| `services/remote-engine-bridge.ts` | **保留** | daemon 模式的正确形态；删 `fetchToolDefs/setCurrentAgent/talk 三件套`；`serializeMsg` 可下沉 client |
| `services/config-manager.ts` | **删除/下沉** | 配置加载逻辑并入 @cortex/config（§7-3）；命令的 config list/get/set 改走 ConfigRegistry |
| `services/mini-agent-pool.ts` | **删除** | 轻量模式移除后无消费者；engine 正式 AgentPool 覆盖 |
| `services/slash-command.ts` | **下沉** | 移至 engine/skill-kit 侧（§7-8） |

**净变化**：删除 4 文件（platform.ts、config-manager.ts、mini-agent-pool.ts，slash-command.ts 下沉）+ 删除死成员若干；改造 5 文件（main/index/utils/engine-bridge/bootstrap 三件）；保留 16 文件（commands/formatters/types/remote-engine-bridge）。**engine-bridge 改造后约剩 200 行**（纯 bootstrapEngine 适配 + ICortexApi 透传），CLI 总量预计从 ~4,600 行降至 ~2,500 行。

**重写风险提示**：
1. `agent` 命令依赖 `agent-instances.json` 持久化（agent.ts:17），底座需给出等价的状态查询/持久化方案。
2. `run`/`schedule` 的 dry-run 输出是 CLI 私有格式，薄层化时需定义命令面与底座间的 `ExecutionReport` 协议（`@cortex/shared` 已有）。
3. roundtable 归档直连 DocRegistry（roundtable.ts:154），若走治理管线需引擎提供共识归档 API。
4. tui 侧（另有人负责）通过 `ITuiEngineBridge` 消费两个桥（§3.1/3.2 方法对齐 `shared/tui-bridge.ts`）——桥重构必须保持该接口稳定，否则 tui 全量重写。

---

*报告生成：2026-08-02。依据：packages/cli/src 非 tui 34 文件逐行精读 + 跨包 grep 验证 + @cortex/engine/client/shared/tools/platform 关键文件交叉核对。*
