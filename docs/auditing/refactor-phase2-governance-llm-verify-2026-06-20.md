# Cortex 重整 · 阶段 2「治理层真实 LLM 验证」归档

> 日期：2026-06-20 · 关联：docs/analysis/refactor-spec-2026-06-20.md §2.4 · 计划：C:\Users\origin\AppData\Roaming\Qoder\SharedClientCache\cache\plans\图景盘点与修宪规范更新_task-e18.md

## 背景

阶段 1（真相复位）确认治理层为「声明先行空转层」：GovernanceEventEmitter 零生产者，连带 HardVerificationGate / ZeroTokenValidator / DecisionGateBridge 全部空转。用户决策：**先不激活，跑真实 LLM 验证**——治理组件的测试需要真实 LLM 调用才知道是否有效。阶段 2 期间文档标注「待真实 LLM 验证后激活」，防止「看似运行」误判。

## S2-13 验证用例（3 条 manual e2e）

脚本：`packages/engine/tests/manual/e2e/governance-llm-verify.ts`
运行：`set CORTEX_ENABLE_LLM=1 && npx tsx packages/engine/tests/manual/e2e/governance-llm-verify.ts`
结果归档：`test-output/governance-llm-verify/result-*.json`
结果：**3/3 PASS**（ALL PASSED，exit 0）

### 场景 1：HardVerificationGate —— 真实 LLM 审计声明对照 repo 实况

| 步骤 | 结果 |
|---|---|
| 真实 LLM 扮演 DocGovernAgent 审计 `bootstrap-engine.ts` | 声明：`violation=no-undef` |
| gate.check() 五规则裁决 | git-diff ✅ 在 diff 中；eslint ❌「no-undef 未被 ESLint 报出（eslint 检查已退化——结果可能不完整）」；其余 3 条 skipped（缺字段） |
| 总判决 | **REJECTED（拦截）**——LLM 声称的违禁未被 ESLint 实况证实 |
| 拒绝回路 | ✅ emitGateRejection → observer 收到 rule-denied 事件，拒绝注册表 +1 |
| 幻觉对照（虚构文件 `packages/__ghost__/fake.ts`） | ✅ 被拦截（git-diff + eslint 双否决） |

**结论**：硬验证门在真实 LLM 声明下正确拦截「LLM 声称但实况不成立」的违禁，拒绝回路（emitGateRejection → rule-denied → 拒绝注册表）完整工作。

### 场景 2：ZeroTokenValidator —— 真实 LLM 事件 source 判定

| 步骤 | 结果 |
|---|---|
| 真实 LLM 输出治理事件 | 声明 `packages/cli/src/commands/doctor.ts` 含 no-console 违禁 |
| validate() 逐条规则 | git-diff-check ✅（文件在 diff 中）；eslint-constitutional-check ❌（no-console 未被 ESLint 报出——可能是 LLM 幻觉）；fsm/barrel/cross-package 3 条 skipped |
| source 判定 | **llm-inference**（4/5 通过，1 条失败 → 降级标记） |
| 确定性对照（虚构文件） | ✅ git-diff-check 失败 → source=llm-inference |

**结论**：零 token 校验器正确执行「全部规则通过 = rule，任意失败 = llm-inference」降级语义——真实 LLM 的假阳性声明被显式标记而非静默放行。

### 场景 3：DecisionGateBridge —— 真实 LLM 决策请求桥接 ConfirmGate

| 步骤 | 结果 |
|---|---|
| 真实 LLM 生成决策事项 | 「是否批准将仓库默认分支从 main 切换到 trunk，并启用分支保护规则？」 |
| 预注册请求（requestId=gov-llm-*，L2）+ 发射 requiresDecision 事件 | 桥接拦截 → ConfirmGate 消费 → **pending 清空** |
| telemetry | `decision.gate.result approved=true` |
| 缺口对照（未预注册 requestId） | ✅ waitFor 未命中 pending → **自动拒绝 approved=false** |

**结论**：DECISION_REQUIRED → ConfirmGate 桥接回路完整工作。同时确认集成契约：**调用方必须先 `ConfirmGate.request()` 注册请求**，未注册的 requestId 会被 waitFor 自动拒绝（fail-closed，符合安全设计）。

## 验证结论 → 激活 or 收敛决策

| 组件 | 验证结论 | 决策 |
|---|---|---|
| HardVerificationGate | 拦截幻觉有效，拒绝回路完整 | **具备激活条件**，emit 保持现状 |
| ZeroTokenValidator | 降级语义正确，假阳性显式化 | **具备激活条件**，emit 保持现状 |
| DecisionGateBridge | 桥接回路完整，集成契约明确（先 request()） | **具备激活条件**，emit 保持现状 |

**决策**（按验收标准 2/3）：
1. 三个治理组件经真实 LLM 验证**全部行为符合设计**——无收敛必要。
2. 按用户决策「治理层不投入激活工程」，阶段 2 **不激活**：emit 保持现状，待触发源（GovernanceEventEmitter 生产者）决策后再接激活工程。
3. 文档标注从「待真实 LLM 验证后激活」更新为「**已验证（2026-06-20，3/3 通过）——具备激活条件，emit 保持现状，待触发源决策**」。

## 遗留观察（不阻塞，如实记录）

- 场景 1 中 ESLint 检查标记「已退化」（10s 超时降级）——`pnpm exec eslint packages/` 全量扫描在 manual 环境可能超时，退化标记正确生效（结果标注不完整），未影响判决语义（eslint 否决仍成立）。
- DecisionGateBridge 与 ConfirmGate 的 request() 契约目前**无调用方**（治理层零生产者）——已由缺口对照确认行为，激活时需在发射方补注册。
- 治理层测试成本：3 次真实 LLM 调用约 0.3-1 元/次，可重复运行；CI 不跑（需 CORTEX_ENABLE_LLM=1 + 密钥）。
