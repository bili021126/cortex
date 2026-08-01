# Cortex 重整化 · 阶段 3「底座打实」归档

> 日期：2026-06-20 ｜ 关联：docs/analysis/refactor-spec-2026-06-20.md §3、refactor-phase3-anatomy-2026-06-20.md（四端解剖）、refactor-phase3-api-surface.md（共面清单）
> 决策：用户拍板「底座打实，API 共面加专化」；三端（desktop/WebUI/TUI）改造全部后置。

## 基线（阶段 3 开始前）

| 项 | 基线值 | 来源 |
|---|---|---|
| 阶段 2 门禁 | CI_GATE_EXIT=0（3844/3849 + 覆盖率全达标） | phase2 归档 |
| protocol 零消费率 | 41.1%（46/112） | 审计脚本 |
| client 状态 | 瘦封装：事件 unknown 透传、无生命周期事件、无发送缓冲、无 notification.ack | 解剖报告 |
| daemon WS 入站 | `msg as WSClientCommand` 类型断言，无运行时校验 | 解剖报告 |
| @layer 覆盖率 | 31.1%（23/74） | layer-coverage 扫描 |

## 改动清单（对照计划 A/B/C/D/E 组）

### A 组：protocol 契约同步（基石）

| 项 | 落地 | 文件 |
|---|---|---|
| A1 `isWSClientCommand` 同步 6 成员（subscribe/unsubscribe/chat.start/chat.cancel/gate.resolve/notification.ack） | ✅ | protocol/src/validation.ts |
| A2 daemon 入站校验：守卫替换断言 + 非法命令回 `system.error` 错误帧（不静默） | ✅ | server/src/daemon.ts |
| A3 protocol dist 产物（rest/ws 子目录）——构建后完整（历史陈旧产物问题消除） | ✅ | protocol 构建验证 |
| A4 零消费预留收敛：@planned 事件（tui/agent/memory/session 通道 13 个）+ REST 无引用包装 8 个删除 | ✅ 41.1% → **27.5%** | protocol/src/ws/events.ts、rest/* |

### B 组：client 底座扩展（G1-G12 修复）

| 项 | 落地 | 文件 |
|---|---|---|
| B1 typed 事件分发（on() 按通道收窄，chat-stream 零 as cast） | ✅ | client/src/ws-client.ts、chat-stream.ts |
| B2 `ackNotification`（S2-12 客户端闭环） | ✅ | client/src/ws-client.ts |
| B3 连接生命周期事件（onStatus：connected/disconnected/reconnecting/reconnect_failed） | ✅ | client/src/ws-client.ts |
| B4 发送缓冲（非 OPEN 入队 + open flush + 上限） | ✅ | client/src/ws-client.ts |
| B5 HTTP AbortSignal + timeoutMs（配置/调用级） | ✅ | client/src/http-client.ts |
| B6 chat-stream 回调字段补全（toolCallId/agent/durationMs/usage/reasoning） | ✅ | client/src/chat-stream.ts |
| B7 `deleteMemory` 补齐 | ✅ | client/src/http-client.ts |
| B8 心跳——缩为遗留记录（活性检测依赖 daemon system.status 广播，见遗留 4） | 📝 | — |

### C 组：API 共面 + 专化

| 项 | 落地 | 文件 |
|---|---|---|
| C1 共面清单定义（23 方法 × 双端支持矩阵 + WS 通道表） | ✅ | docs/analysis/refactor-phase3-api-surface.md |
| C2 daemon 补齐 `POST /execute`（G10 修复——execute 不再对 daemon 404） | ✅ | server/src/http/router.ts（handleExecute） |
| C3 `getAgents` 语义统一（Record<string, string[]>，三头错修复） | ✅ | server/src/http/router.ts |
| C4 `getNodes` 分页形状对齐（PaginatedResponse 结构） | ✅ | server/src/http/router.ts |
| C5 能力发现 `GET /capabilities`（ServerCapabilities + client.getCapabilities） | ✅ | protocol/src/rest/capabilities.ts、router.ts、http-client.ts |

### D 组：机制门禁

| 项 | 落地 | 文件 |
|---|---|---|
| D1 零消费审计脚本沉淀（闭合 phase1 遗留 5） | ✅ | scripts/audit-unconsumed.ts |
| D2 layer-contract 扩展：includeDev 不变量 + src import 扫描（未声明隐式依赖） | ✅ 全仓 0 未声明 | packages/tools/src/monorepo-analyzer.ts、tests/layer-contract.test.ts |
| D3 @layer 机制化：扫描器 + 词表校验 + **全标注 74/74（100%）** | ✅ | scripts/layer-coverage.ts、engine/src 51 文件标注 |
| D4 迁移扫描器（假迁移检出：目标存在性 + 残留启发式） | ✅ 0 悬空 | scripts/scan-migration-residue.ts |

## 新增测试清单（守护测试）

| 文件 | 断言覆盖 | 守护项 | @ci |
|---|---|---|---|
| protocol/tests/validation.test.ts（扩展至 15 用例） | isWSClientCommand 6 成员 + 缺字段 + 非法 | A1/E3 | unit |
| server/tests/ws-command-validation.test.ts（7 用例） | 合法命令通过 / 非法回 system.error 错误帧 | A2/E2 | unit |
| client/tests/ws-client-ext.test.ts（10 用例） | ackNotification / typed 收窄 / onStatus 生命周期 / 发送缓冲 | B1-B4 | unit |
| client/tests/http-client.test.ts（6 用例） | deleteMemory / AbortSignal / ProtocolError | B5/B7 | unit |
| server/tests/http-router.test.ts（8 用例） | execute 422/200 / agents 语义 / nodes 分页 / capabilities | C2-C5 | unit |
| tools/tests/layer-contract.test.ts（扩展至 8 用例） | includeDev 无违规无循环 / 全仓无未声明隐式依赖 | D2 | contract |

## 门禁五段全量回归

命令：`npx tsx scripts/ci-gate.ts --coverage`（输出 .cortex/ci-output-phase3.txt）

| 段 | 结果 |
|---|---|
| 1/5 tsc -b 全量增量编译 | ✅ 类型检查通过 |
| 2/5 eslint packages/**/src（--max-warnings 0） | ✅ lint 通过 |
| 3/5 critical-fixes 混沌校验（L5） | ✅ 混沌校验通过 |
| 4/5 vitest 按包串行（unit+verify+contract，263 文件） | ✅ **3884/3889 passed**（25 个 llm/integration/e2e/manual 跳过）；新增 5 测试文件全过：client 30/30、protocol 21/21、server 44/44、tools 73/73、engine 960/961（1 既有 skipped） |
| 5/5 覆盖率阈值 | ✅ 14 包全部达标（engine 70.81% / notification 91.44% / memory 42.52% 等） |

## 验收标准逐条证据

1. **protocol `isWSClientCommand` 6 成员同步且被 server 消费；非法命令被拒** —— validation.test.ts 15 用例 + ws-command-validation.test.ts 7 用例（非法/缺字段/非对象 → system.error 错误帧，daemon.ts 守卫替换 `as` 断言）✅
2. **client 23 方法在 daemon 共面上全部可用；notification.ack 端到端闭环** —— http-router.test.ts（execute/agents/nodes/capabilities 形状）；B2 ackNotification 发送 notification.ack（ws-client-ext.test.ts），daemon A2 守卫认可该命令 + S2-12 处理链（daemon.ts）✅
3. **typed 事件分发落地：消费方零 as cast** —— client 包内（chat-stream.ts 无 as cast）；cli/desktop 消费方（remote-engine-bridge/presence-bridge）为后置改造范围，记录于遗留 1 ✅（client 包内）
4. **门禁五段全绿 + 新增测试带 @ci 标签** —— CI_GATE_EXIT=0（3884/3889 + 覆盖率全达标）；新增 5 测试文件全部 @ci: unit/contract ✅
5. **protocol 零消费率 <30%** —— 41.1% → 27.5%（25/91）；剩余 25 个均为结构成员（ErrorType 组成/PaginatedResponse 字段/DaemonHealthSnapshot 字段）、联合成员（WSClientCommand 6 成员）、B/C 组消费类型（Memory 系/Execute 系/Nodes 系）、B1 typed 事件锚点（WSStateEvent/WSPipelineEvent/WSServerEventByChannel/WSChatEventType）✅
6. **机制门禁四项落地** —— D1 脚本可用（protocol 41.1%→27.5% 基线固化）；D2 8/8（includeDev 不变量 + 0 未声明隐式依赖）；D3 74/74 100% + 词表合法；D4 0 悬空 + 12 处残留嫌疑已甄别（8 处设计说明/测试内容、2 处 shared 说明性声明、2 处测试断言误报）✅
7. **验收归档** —— 本文件 ✅

## 遗留项

| # | 未闭合项 | 原因 | 后续计划 |
|---|---|---|---|
| 1 | cli/desktop 消费方 as cast（remote-engine-bridge/presence-bridge） | B1 收窄 client 包内；端侧改造后置 | 三端改造时统一改 typed 事件 |
| 2 | WebUI：getAgents 语义 / getNodes 分页 / capabilities / config 系接线（configHandler 未传、/agents 抢先拦截） | 用户决策 WebUI 后置（套壳时修） | WebUI 套壳任务 |
| 3 | TUI：remote-query-loop 死代码、renderer v4、CLI 直连旁路 | 用户决策 TUI 后置 | TUI 清理任务 |
| 4 | B8 心跳未实装（活性检测） | 依赖 daemon system.status 广播（5s）被动感知；应用层 ping 需协议扩展 | C 组协议扩展候选（与共面演进一起） |
| 5 | 迁移扫描 12 处"残留嫌疑"中 2 处（shared/context-policy.ts、shared/skill-registry.ts 说明性声明）待人工确认 | 启发式报告，非阻断 | 人工 review 后归档结论 |
| 6 | WSChannel 值域仍含 tui/agent/memory/session（无对应事件） | 兼容既有订阅代码 | 端侧改造时收敛 |
| 7 | daemon pipeline 通道事件透传（WSPipelineEvent）待接 observer | 底座演进项 | 随状态推送需求 |
| 8 | desktop 550+ 行死代码、ChatView 非流式、通知/确认门 UI 缺失 | 后置 | desktop 重写任务（解剖报告 §9 抓手排序） |

## 阶段 3 提交序列

```
<待填——门禁通过后提交>
```
