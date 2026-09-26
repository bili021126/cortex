// ============================================================
// @cortex/protocol — REST 线格式类型（桶导出）
//
// ── 模块 ↔ 端点 ↔ 实现状态（2026-09-26 核实）────────────────────
//
// **「在这里声明了类型」不等于「这个端点存在」。** 本目录混着三类东西：
// 活端点、为**尚未实现**的端点写的 DTO、以及没人采用的包装别名。
// 判断依据以 `packages/server/src/http/router.ts` 的 18 条路由与
// `capabilities.api` 的 true/false 为准（两处一致性由
// `packages/server/tests/api-contract.test.ts` 与
// `packages/client/tests/contract-gap.test.ts` 守护）。
//
//  模块              覆盖端点                        端点是否已实现
//  ────────────────  ──────────────────────────────  ────────────────────────
//  pagination.ts     通用 SingleResponse /           不适用（非端点类型）
//                    PaginatedResponse / 分页查询
//  capabilities.ts   GET /capabilities               ✅
//  health.ts         GET /health、GET /daemon/health ✅
//  state.ts          GET /state                      ✅
//  nodes.ts          GET /nodes、GET /nodes/:id      ✅（POST /nodes 无对应类型，见下）
//  execute.ts        POST /execute                   ✅
//  chat.ts           POST /chat                      ✅
//  memory.ts         GET/POST /memory、              ✅
//                    DELETE /memory/:id
//  sessions.ts       GET/POST /sessions、            ✅
//                    DELETE /sessions/:id
//  events.ts         GET /events                     ❌ **未实现**——capabilities.api.events === false
//  config.ts         POST /models、PATCH /models/:id、❌ **未实现**——capabilities.api.config === false
//                    POST /keys、PATCH /tuning、      客户端对这些方法经 `_assertSupported` 快速失败
//                    POST /config/validate、
//                    GET /config/version
//
// ── 本目录**缺**的类型（已实现但无模块）────────────────────────
//   · GET  /agents                     → 客户端在 `client/src/types.ts` 自建类型
//   · GET  /scheduler                  → 同上（`SchedulerSnapshot`）
//   · POST /scheduler/execute          → 同上（`SchedulerExecutionReport`）
//   · POST /nodes                      → 同上（`NodeSubmitRequest`）
//   这四处的类型由消费方各自内联定义，不在本包——所以本包不是线契约的
//   完整单一来源。见 core-3-design-backlog.md N-23。
//
// ── 本目录里「声明了但无人采用」的包装别名 ────────────────────
//   GetEventsQuery / GetEventsResponse / ExecuteRequest / ExecuteResponse /
//   MemoryQueryRequest / MemoryQueryResponse / MemoryWriteResponse /
//   GetNodesQuery / GetNodesResponse / AgentManifestDTO
//   （另有一个不在本目录：`ws/events.ts` 的 WSServerEventByChannel）
//   它们**是准确的**（逐条与 router 的实际返回比过，未发现漂移），只是消费方
//   直接内联组合（例如 client 写 `PaginatedResponse<TaskNodeSnapshot>`，与
//   `GetNodesResponse` 的定义逐字相同）。删它们会让线契约彻底没有形式化落点；
//   留着又没人用——记在 N-23，不动。
// ============================================================

export * from "./pagination.js";
export * from "./state.js";
export * from "./nodes.js";
export * from "./health.js";
export * from "./execute.js";
export * from "./events.js";
export * from "./config.js";
export * from "./chat.js";
export * from "./memory.js";
export * from "./sessions.js";
export * from "./capabilities.js";
