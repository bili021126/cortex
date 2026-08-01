# Cortex API 共面清单（阶段三 C1）

> 日期：2026-06-20 ｜ 决策：用户拍板「底座打实，API 共面加专化」
> 关联：refactor-phase3-anatomy-2026-06-20.md §3.1（服务端 API 面分裂）、refactor-phase3-survey-2026-06-20.md

## 1. 原则

- **共面**：`@cortex/client` 的 API 面是唯一公共面——服务端实现其子集，client 类型声明即契约。
- **专化**：服务端按身份实现「通用共面 + 自身专化」；未实现的能力通过 `GET /api/v1/capabilities` 显式声明，调用方依据能力标记规避（不得假定 404 即不支持）。
- 共面只含**实际消费**的能力——不预留（A4 已删除 @planned 预留类型）。

## 2. 共面清单（client 23 方法 × 服务端支持矩阵）

| client 方法 | 端点 | daemon | WebUI | 归属 |
|---|---|---|---|---|
| getState | GET /api/v1/state | ✅ | ✅ | 通用 |
| getHealth | GET /api/v1/health | ✅ | ✅ | 通用 |
| getNodes | GET /api/v1/nodes | ✅（C4 分页对齐） | ✅ | 通用 |
| getAgents | GET /api/v1/agents | ✅（C3 语义统一） | ✅（待统一） | 通用 |
| getCapabilities | GET /api/v1/capabilities | ✅（C5） | ✅（待实现） | 通用 |
| chat | POST /api/v1/chat | ✅ | ❌ | daemon 专化 |
| searchMemory / writeMemory / deleteMemory | /api/v1/memory* | ✅ | ❌ | daemon 专化 |
| getSessions / createSession / deleteSession | /api/v1/sessions* | ✅ | ❌ | daemon 专化 |
| getDaemonHealth | GET /api/v1/daemon/health | ✅ | ❌ | daemon 专化 |
| execute | POST /api/v1/execute | ✅（C2 补齐，G10 修复） | ✅ | 通用（两端已实现） |
| getEvents | GET /api/v1/events | ❌ | ✅ | WebUI 专化 |
| getModels / createModel / patchModel / deleteModel | /api/v1/models* | ❌ | ✅（handler 未接线，待修） | WebUI 专化 |
| getAgentsConfig / patchAgentConfig | /api/v1/agents* | ❌ | ⚠️（被 getAgents 抢先拦截，死路径） | WebUI 专化 |
| getKeys / createKey / deleteKey | /api/v1/keys* | ❌ | ✅（未接线） | WebUI 专化 |
| getTuning / patchTuning | /api/v1/tuning* | ❌ | ✅（未接线） | WebUI 专化 |
| validateConfig / getConfigVersion | /api/v1/config/* | ❌ | ✅（未接线） | WebUI 专化 |

> 注：WebUI 的 config 系端点当前 100% 不可达（startWebUI 未传 configHandler、/agents 被抢先拦截）——属 WebUI 端后续套壳时修复项（用户决策：WebUI 后置）。

## 3. WS 通道（共面）

| 通道 | 事件 | daemon 发射 | WebUI 发射 | 归属 |
|---|---|---|---|---|
| state | state 快照（500ms） | ✅ | ✅ | 通用 |
| pipeline | EventRecord 透传 | ✅（待接） | ✅ | 通用 |
| system | status/shutdown/error（A2 新增错误帧） | ✅ | ✅ | 通用 |
| config | config.changed | ✅ | — | 通用 |
| chat | chunk/tool_start/tool_result/complete/error | ✅ | ❌（gateway 只认订阅） | daemon 专化 |
| gate | request/notify | ✅ | ❌ | daemon 专化 |
| notification | pushed/acked（S2-11/S2-12） | ✅ | ❌ | daemon 专化 |

## 4. 类型统一（C3/C4）

- **AgentStatusMap** = `Record<string, string[]>`（agentType → status 字符串数组）——daemon 已按此返回（router.ts handleAgents），WebUI 待对齐。
- **GetNodesResponse** = `PaginatedResponse<TaskNodeSnapshot>`（`{ data, pagination: { page, limit, total, totalPages } }`）——daemon 已按此返回（C4），WebUI 待对齐。
- **ServerCapabilities**（C5）——`{ server, version, api: {...11 标记}, wsChannels }`，client 连接后先探测。

## 5. 变更记录

| 项 | 落地 | 文件 |
|---|---|---|
| C2 daemon execute 路由 | ✅ | server/src/http/router.ts（handleExecute） |
| C3 getAgents 语义统一 | ✅ daemon 侧 | server/src/http/router.ts（handleAgents） |
| C4 getNodes 分页对齐 | ✅ daemon 侧 | server/src/http/router.ts（handleNodes） |
| C5 capabilities | ✅ protocol 类型 + daemon 端点 + client 方法 | protocol/src/rest/capabilities.ts、router.ts、client http-client.ts |
| client getCapabilities | ✅ | client/src/http-client.ts |

## 6. 遗留（记录不阻塞）

- WebUI 侧：getAgents 语义、getNodes 分页、capabilities 端点、config 系接线——随 WebUI 套壳（后置）一并修复。
- daemon 的 pipeline 通道事件透传（WSPipelineEvent）待接 observer——随底座演进。
- `WSChannel` 值域仍含 tui/agent/memory/session（预留通道值，无对应事件）——A4 收敛事件后保留值域以兼容既有订阅代码，后续随端侧改造收敛。
