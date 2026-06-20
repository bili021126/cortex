# Cortex Core-2 阶段全景

**定位**：从 Core-1 终局到 Core-2 过渡期完整收束。一份文档覆盖所有已落地模块、已建文档、已结晶技能和当前架构全景。读完这份，不需要再翻任何碎片。

**前置阅读**：[概念设计全面整合](概念设计全面整合-项目实际阶段与路线图.md)（概念谱系）→ [Core-2 过渡阶段改造计划](Core-2-过渡阶段-全面接入改造计划.md)（执行清单）

**元方法论**：本文档是 [Cortex 演进方法论](Cortex-演进方法论-九阶段闭环.md) 第九阶段（归纳）的产出。阅读方法论可理解"我们是怎么走到这里的"。

**归档日期**：2026-06-19
**归档人**：昔涟（Cyrene），与开拓者共同完成

---

## 一、阶段判定

```
Core-1 ████████████████ 100%  ← 14 Agent + MemoryStore + Scheduler + CI 全绿
Core-2 ████████░░░░░░░░ ~40%  ← 治理层代码 ~20% + 过渡期 plumbing 全部落地
Full   ░░░░░░░░░░░░░░░░   0%  ← 设计就绪，等铁三角
```

**铁三角状态**：Electron ❌ / MCP ⚠️ 已接入但无鉴权 / Committee MVP ❌。不再是"等待中"——是在 Core-1 地基上自然长出 Core-2 形状，已落地部分稳固可运行。

---

## 二、已建成模块全景

### 2.1 engine/src/core/ 新增（10 模块）

| # | 模块 | 行数 | 职责 | Phase |
|---|------|------|------|-------|
| 1 | `prompt-manager.ts` | 213 | prompt-kit 编排器薄封装，双模式回退 | P0 |
| 2 | `loop-strategy-registry.ts` | 116 | 四策略注册表 + canHandle 规则路由 | P1 |
| 3 | `task-router.ts` | 119 | 统一策略+模型路由，三层优先级 | P1 |
| 4 | `environment-aware-router.ts` | 252 | 环境感知模型降级，健康检查+熔断 | P1 |
| 5 | `sentinel-signal-filter.ts` | 217 | 哨兵 L1/L2/L3 信号分层，去噪+风暴检测 | P1 |
| 6 | `governance-events.ts` | 115 | 四类治理事件发射器 | P2 |
| 7 | `decision-gate-bridge.ts` | 168 | DECISION_REQUIRED → ConfirmGate 桥接 | P2 |
| 8 | `resilience-integration.ts` | 133 | 韧性策略工厂（retry/circuit/timeout） | P3 |
| 9 | `notification-runtime.ts` | 192 | PipelineObserver → NotificationPipe 桥接 | P3 |
| 10 | `capability-registry.ts` | — | Agent 能力自声明注册表 | P1 |

### 2.2 其他包新增

| 包 | 文件 | 职责 |
|----|------|------|
| `@cortex/notification` | `semantic-layer.ts` (82行) | FYI/WARNING/DECISION_REQUIRED 语义标注 |
| `prompts/ganyu/` | `intent-clarification.md` (69行) | 甘雨意图澄清模式 |
| `packages/engine/tests/` | 7 新增测试文件 | 78 用例覆盖全部新模块 |

### 2.3 Bootstrap 运行时接线

`bootstrap-engine.ts` §6.2 一次性接入全部 orphan 模块：

```
TaskRouter          ← scheduler.modelRouter 注入
EnvironmentAwareRouter ← 独立创建，模型优先级列表
SentinelSignalFilter   ← 订阅 CRITICAL 事件
NotificationRuntime    ← 新创 NotificationPipe + 桥接 observer
ResiliencePolicyFactory ← 注册 llm-call + tool-exec 策略
GovernanceEventEmitter ← 注入 observer
DecisionGateBridge     ← 注入 observer + gate，start()
```

---

## 三、测试覆盖

| 类型 | 文件数 | 用例数 | 结果 |
|------|--------|--------|------|
| 新模块单元测试 | 9 | 98 | ✅ 全绿 |
| 集成测试扩展 | 1 (bootstrap-integration) | 7 | ✅ 全绿（含 Core-2 断言） |
| 回归测试 | 76 | 871 | 842 pass / 29 预存失败（非本次引入） |

---

## 四、技能体系

### 4.1 项目技能（skills/*.json）

41 个已结晶技能。本次新增：

| ID | 名称 | 类型 |
|----|------|------|
| P39 | 包接入缺口扫描 | analysis |
| P40 | 设计 spec 标准模板 | architect |
| P41 | 计划执行后审查 | review |

### 4.2 Agent 技能（.qoder/skills/）

4 个可自动加载的 markdown 技能：

- `cortex-engine-core-module` — 新增 engine 模块标准流程
- `cortex-package-gap-scan` — 包接入缺口审计
- `cortex-design-spec` — 设计 spec 四段模板
- `cortex-plan-review` — 计划执行后审查

### 4.3 待建：技能体系升级

[设计方案](技能体系升级-斜杠命令与作用域分层.md)：`/` 命令系统 + 四级作用域（跨域/项目/包/Agent）。~380 行，等待执行。

---

## 五、文档体系总览

| 层 | 文档 | 状态 |
|----|------|------|
| **入口** | `README.md` | ✅ 导航地图 |
| **宪法** | `constitution/Cortex 概念顶层设计 v2.5.35.md` | ✅ 唯一权威 |
| **收敛** | `core/概念设计全面整合-项目实际阶段与路线图.md` | ✅ 一切概念的最终收敛 |
| **计划** | `core/Core-2-过渡阶段-全面接入改造计划.md` | ✅ 已执行完毕 |
| **治理** | `core/治理层设计.md` | ✅ 已落地/设计锚点/超前设计 |
| **防御** | `core/consistency-design.md` | ✅ 六层防御 spec |
| **技能** | `core/技能沉淀机制设计.md` | ✅ 技能闭环 spec |
| **策略** | `core/循环策略注册表设计.md` | ✅ 已实现 |
| **联邦** | `core/黄金裔Agent体系与跨项目联邦架构设计.md` | ✅ Core-3 预留 |
| **评估** | `core/pattern-extractor-integration-assessment.md` | ✅ 暂不集成 |
| **升级** | `core/技能体系升级-斜杠命令与作用域分层.md` | ✅ 设计完成，待执行 |
| **分析** | `analysis/思考执行体系总纲.md` + `core-2-governance-implementation-gap.md` | ✅ 参考 |
| **归档** | `archive/` 下全部历史文档 | ✅ 不活跃引用 |

---

## 六、架构决策记录（关键决策）

| # | 决策 | 日期 | 依据 |
|---|------|------|------|
| D1 | 循环策略注册表采用轻量 Map 而非重量 Registry 模式 | 06-14 | MEMORY_QUERY_REGISTRY 已验证 |
| D2 | prompt-kit 接入采用双模式回退（assembler + 手拼） | 06-14 | 最小化下游改动 |
| D3 | 哨兵从零构建而非复用已有基类（不存在） | 06-14 | 代码审查发现哨兵仅存于注释 |
| D4 | 通知管线三层路由实际已在 ButlerAgent 中实现 | 06-14 | 代码审查修正计划前提 |
| D5 | 技能体系暂不开放人直接写 SKILL.md（方向 C） | 06-19 | 用户知识储备门槛，等 A/B 落地后再议 |
| D6 | 技能作用域从三级扩展到四级（新增跨域级） | 06-19 | 对标 Claude Code personal skills |
| D7 | 新增代码需附带严格测试验收 + 架构统一度评估 | 06-19 | 避免"实现完无验证"的上一轮教训 |

---

## 七、下一阶段

### 立即可做（不等铁三角）

| 事项 | 代码量 | 
|------|--------|
| 技能体系升级（`/` 命令 + 四级作用域） | ~380 行 |

### 等铁三角

Committee MVP、钟离/霜凝激活、监理独立实体、TrustModel/TrustAgent、Agent 间通信协议实现、多进程治理——电子 + MCP + Committee 三者同时就位后解锁。

### Core-3 展望

WorldSimulator、完整生存范式（能量管理+风险预算+预测性修复）、自组织派发、黄金裔联邦激活、向量检索、多进程治理独立部署。

---

## 八、数据快照

| 指标 | 数值 |
|------|------|
| monorepo 总包数 | 25 |
| engine 新增核心模块 | 10 |
| engine 测试文件 | 76 |
| engine 测试用例 | 871 |
| 技能总数 | 41 (+3 新增) |
| Agent 技能 | 4 |
| 核心文档 | 13 |
| 本次新增代码（不含测试） | ~1,500 行 |
| 本次新增测试代码 | ~1,300 行 |
| 未接入包（待未来接入） | pattern-extractor (9,571行) / cache (1,157行) |

---

*归档：昔涟（Cyrene），2026-06-19*
*与开拓者一同完成。这不是终点——是 Core-2 过渡期收束后的新基线。*
*铁三角就位之日，本档案自动触发更新。*
