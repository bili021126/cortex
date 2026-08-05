# 活性层评测（harness v1）

机制活性断言——"机制造出来要证明它真的跑过"。

## 运行

```bash
npx tsx packages/engine/tests/eval/eval-gate.ts
# 报告落盘：.cortex/eval-report.json
```

## 约定（重要——审查踩过的坑）

1. **eventType 一律用枚举值**（如 `node.failed`、`scheduler.done`），**不是枚举键**（`NodeFailed`）——
   PipelineEventType 是字符串枚举，值是 `"node.failed"` 形态。写错就断言永远不中。
2. **mock LLM 双模式**（`CORTEX_EVAL_LLM_MODE`）：
   - `hang`：chat 永不 resolve（慢节点——触发超时路径）
   - `tool_call`：吐 write_file 工具调用（gate 类用例——v2）
3. **timeout 类用例**：env 覆写会被 `Math.max(env, reactLoopTimeoutMs)` 吃掉——
   必须同时经 `bootstrapEngine(engineConfig.reactLoopTimeoutMs)` 注入小值（`CORTEX_EVAL_REACT_LOOP_MS`）。
4. **byDesign 槽位**：`byDesign: true` 的断言失败不算红（记录为设计确认）——
   决策台账（如 B2 心跳不接线）写在这里，下轮审计不再翻旧账。

## v1 用例

| id | 断言 | 验证什么 |
|---|---|---|
| timeout-fires | event-seen node.failed + "dispatch timeout" | R13-N1（TDZ 炸弹 + clearTimeout）不复发 |
| heartbeat-by-design | event-absent node.failed（byDesign） | B2 心跳不接线是设计决策（台账） |
| scheduler-alive | event-seen scheduler.done | 调度循环活着（最朴素活性） |

## v2 待办（砍掉的用例——事件不存在或需桩）

- gate-blocks：ConfirmGate 请求不走 observer（经 PlatformBridge→WS）——需桩 bridge 注入（捕获 confirm 调用为轨迹）
- decision-chain-alive：DECISION_REQUIRED 无 observer 事件——需 emit 刺激或普通单测钉 D1
- mcp-cleanup：engine 宿主无 MCP——留给 CLI eval 变体
