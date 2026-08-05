# Cortex 全量深度审计报告（2026-08-05）

> 审计方式：全包模式扫描（28 包 src 非测试文件）+ 高信号深挖 + 已知项汇总
> 范围：类型安全 / 资源治理 / 可观测性 / 接线完整性 / 错误处理 / 测试体系 / 行为验证

---

## 总览

```
Critical：0
High：    3
Medium：  4
Low：     3
```

**总体判断**：工程层健康度**高**——类型安全、资源治理、接线完整性经扫描验证达标；主要缺口集中在**可观测性收敛**（裸 console）、**测试污染根因**、**行为验证落地**三处。

---

## 扫描验证的强项（数据支撑）

| 维度 | 扫描结果 | 判定 |
|---|---|---|
| **类型安全** | `as any` 全仓实际仅 1 处（memory/embedding.ts:165——第三方对象 dispose 探测——可接受）——65 处统计为注释误报 | 🟢 达标 |
| **Timer 治理** | setInterval 6 处 / clearInterval 7 处——**全部配对**（engine/server/cli 每处都有清理路径） | 🟢 达标 |
| **接线完整性** | reportSuccess/reportFailure 定义+调用正常（D2 修复后验证）——之前断的线已通 | 🟢 达标 |
| **空 catch** | engine 实际仅 2 处可疑（scheduler B5 cleanup 容错 + hard-verification-gate——均有注释说明）——76 处统计为单行 catch 误报 | 🟢 达标 |
| **CI 门禁** | 五步门禁全绿 + 失败详情显示已修（强信号优先） | 🟢 达标 |

---

## High（3 项——建议优先修）

### H1. 裸 console 违反统一可观测原则（memory 包重灾区）

**证据**：memory-compressor.ts 11+ 处 `console.log`（"[MemoryCompressor] ..." 诊断）；memory 包共 103 处裸 console；engine 499 处（多为 console.error stderr 诊断——部分为设计路径，但 console.log 类应收敛）。

**影响**：诊断信息不进 telemetry/observer——无法被监控/过滤/分级消费；与 R11-31 的"console→observer 迁移审计"目标不一致（已迁部分，memory 包未迁）。

**修复方向**：memory 包的诊断走 `process.stderr.write`（已有模式）或 telemetry；R11-31 审计覆盖 memory 包。

### H2. 测试污染根因未修（bootstrap 共享 WORKSPACE_ROOT）

**证据**：bootstrap 类测试写同一 `WORKSPACE_ROOT/.cortex`——本地并行（默认 forks）时 8 个失败，串行（CI maxForks=1）才过——**根因在测试设计不在 CI 配置**。

**影响**：本地开发跑全量测试必红——开发者被迫用 CI 配置跑（慢）；并行度提升时 CI 也可能随机失败。

**修复方向**：bootstrap 测试用独立临时工作区（mkdtemp + 最小 agents.json 副本）——评测层的 eval-runner 已采用此模式（harness-deep-dive §3.5）——同方案反哺测试。

### H3. 行为层评测未落地（体系缺口）

**证据**：harness-deep-dive 方案决策完备（eval-gate 接口/golden schema/评分/CI 节奏）——但 `packages/engine/tests/eval/` 不存在——行为验证仍是"代码对"有门禁、"行为对"无门禁。

**影响**：人格一致性/记忆域/决策链等行为回归只能靠人肉——R11/R12 评审发现的"接线断裂"类问题（D1 决策链全死）会再次静默复发。

**修复方向**：P0-1 落地（eval-gate.ts + golden 首批 16 例 + CI report 模式）——方案已完备，纯执行。

---

## Medium（4 项）

### M1. 审计工具未接入（auditMemoryStore 零调用）

memory-audit.ts 的悬空检查（R11-23 相关）只导出无调用——检查结果不可见。补 CLI 命令（`cortex mem audit`）或定期接入。

### M2. server 的 setInterval 清理依赖 stop 路径

daemon/state-handler/session-manager 的 timer 在 stop() 清理——进程强杀（SIGKILL）时泄漏。低风险（进程退出即回收）但缺最后防线（`process.on("exit")` 兜底 clearInterval）。

### M3. 文档漂移检查未建

doc-registry 管登记不管漂移——架构文档与代码的同步无自动检查。可建轻量脚本（关键接口签名 vs 文档引用比对）或接入 architecture-health 类流程。

### M4. engine 裸 console 的收敛（部分）

engine 499 处中 console.error 的诊断路径（process.stderr 包装）是设计——但部分 `console.error` 直接输出（未走 diagnostic/observer）——可批量收敛（R11-31 审计的 engine 剩余部分）。

---

## Low（3 项）

### L1. as any 1 处（embedding.ts:165）
`(pipe as any)?.dispose?.()`——第三方对象探测——可改 `as unknown as { dispose?: () => void }`（零成本）。

### L2. 空 catch 2 处（有注释）
scheduler B5 cleanup 容错 + hard-verification-gate——均有注释说明"失败不阻断"——可接受。

### L3. 死导出/死方法（抽查）
getAgentsConfig 已清（H3 轮）——其余抽查未见明显死方法——后续可跑 barrel 死导出扫描（曾有清理历史——维持）。

---

## 与上次审计（R12）的对比

| 维度 | R12 时 | 现在 |
|---|---|---|
| 接线断裂（D 组） | 8 处（决策链全死等） | **已全修**（扫描验证） |
| 降级守卫（P0-1） | 只拦读不拦写 | 已修（写侧拒绝+备份） |
| 归一化（P0-2） | 全同分 0.5 污染 | 已修（range=0 → 0） |
| WS 鉴权（P0-3） | 无鉴权 | 已修（令牌校验） |
| 注入防护（F 组） | 无标记 | 已实现（围栏+来源注释+trial） |
| 行为验证 | 无 | 方案完备（未落地——H3） |

**趋势**：R12 的 25 项 + R11 全清 + 本轮 F/R11-23/B3——**遗留问题从"机制断裂"转为"机制收敛与落地"**——体系在正向演化。

---

## 修复优先级建议

```
P0：H1（裸 console 收敛——memory 包）+ H2（测试污染根因）
P1：H3（eval-gate 落地——方案已完备）
P2：M1（审计接入）+ M4（engine console 收敛）+ L1（as any）
P3：M2/M3/L2/L3（低风险——随迭代）
```

---

## §2 深度审计追加（依赖图 / 跨层 / 契约）

> 第二轮：依赖声明 vs 实际引用、包间 import 图、契约路由对齐、配置集中度

### 2.1 依赖审计（28 包）

| 发现 | 判定 | 详情 |
|---|---|---|
| 架构分层 | 🟢 干净 | shared 无任何 engine 反向引用（3 处"@cortex/engine"均为注释说明）——依赖方向单向向下 |
| 死依赖 | ⚠️ 2 个 | engine 声明 @cortex/testing/@cortex/tools 但 src 未引用——**确认为 devDep 测试用**（tests 目录引用）——非真死依赖，可移入 devDependencies 明确（若已在则无需动） |
| 自引用 | 🟢 误报 | client/config/doctor 等的"引用未声明"是脚本把包自身 import 计入——排除后无真实缺失 |

### 2.2 跨层 import 图（关键路径）

```
shared ← 全部（底层）
config ← cli/engine/server/scheduler/memory-store/governance/platform 等（配置唯一真相源——引用集中）
engine → shared/llm/platform/memory-store/scheduler/config/skill-kit/governance/telemetry/notification/plugin-runner/logging/context-manager/memory/prompt-kit/resilience（16 个——hub 但全部向下）
server → engine/protocol/shared/config/llm/platform/telemetry/notification/scheduler（服务端聚合——合理）
```

**结论**：无循环依赖（此前 CI 修的 cli→engine 循环未复发）——分层单向，hub 模式（engine 聚合）是设计选择——无违规。

### 2.3 契约路由对齐（client 28 条 vs server）

- client 的 28 条 REST 路由（state/nodes/agents/health/execute/events/models/keys/tuning/config/chat/memory/sessions/daemon/capabilities）
- server 路由逐一对应（getNode 单节点路由已在 H3 轮补齐——此前唯一缺口）
- **结论**：🟢 契约对齐——client 无孤儿路由（指向不存在的服务端路径）

### 2.4 配置集中度

- config 包承担全部常量/环境变量解析（12 处 process.env 集中在 config）——唯一真相源成立
- cli（25）/server（16）的 process.env 访问多为**转发**（读取后传 config 或直接透传运行时参数）——抽查未见绕过 config 的新增硬编码
- **结论**：🟢 配置治理达标（此前硬编码禁令的存量已清）

### 2.5 深度审计新增结论

```
新增 High：0
新增 Medium：1（M5——engine devDep 的 testing/tools 应明确用途或移除——低优先级）
新增 Low：0
```

---

*深度审计完成——依赖图/契约/配置三维度达标，无新增高危。*
