# ConfirmGate Agent 化 · 设计稿

> Core-2 参考设计 | 2026-07-04

---

## 一、现状

ConfirmGate 是一个静态确认门。核心逻辑是 L0-L3 可逆性分级：

```
L0: 只读（自动放行）
L1: 低风险（自动放行，记日志）
L2: 中风险（人工确认）
L3: 不可逆（双重确认）
```

问题：分级是工具级别的，不是调用级别的。

- `write_file` = L2 → 永远需要人工确认
- 安柏连续写了 50 次侦察报告，每次都要手动 `Approve? [y/N]`
- E2E 测试因为人工确认无法全自动运行

信任模型不存在——ConfirmGate 对每个 Agent 一视同仁，没有能力根据历史行为调整判断。

---

## 二、目标

ConfirmGate 升级为第 15 个 Agent——不是"执行确认"而是"做判断"。

```
不是                           而是
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

write_file = L2                write_file 的确认等级取决于
→ 总是要确认                    调用者 + 历史 + 上下文

                               安柏（连续 50 次侦察无误）
                               → 自动放行，事后审计

                               阿贝多（第一次写新文件）
                               → L2 确认，建立初始信任

                               阿贝多（第 30 次，零失败）
                               → 自动放行

                               E2E 模式
                               → 全局自动放行
```

---

## 三、信任模型

### 3.1 三个核心判断

1. **谁在调** —— Agent 身份 + 历史成功率
2. **在什么上下文里调** —— E2E / 手动会话 / 计划执行
3. **调完之后怎么审计** —— 自动放行必须留 `confirm-gate.auto-approved` 事件

### 3.2 信任分计算

```
TrustScore = base_trust + history_bonus - risk_penalty

base_trust:     Agent 类型初始分
                inspector=0.9 / code=0.5 / fix=0.7 / ops=0.6

history_bonus:  最近 N 次同类工具调用成功率 × 0.3
                成功率 = 1.0 则 +0.3

risk_penalty:   工具可逆性等级 × 历史失败率 × 0.5
                write_file(L2) + 10% 失败率 → -0.1
```

### 3.3 自动放行阈值

```
TrustScore >= 0.8  →  自动放行 + 事后审计
TrustScore >= 0.6  →  自动放行 + 实时审计
TrustScore <  0.6  →  人工确认
```

### 3.4 E2E 模式

```
context.isE2E === true  →  全局自动放行
                          不记入信任分（不污染信任模型）
                          confirm-gate.auto-approved 事件仍然留痕
```

---

## 四、审计机制

自动放行 ≠ 不留痕迹。

```
自动放行
    ↓
写入 confirm-gate.auto-approved 事件
    {
      agent: "inspector",
      tool: "write_file",
      trustScore: 0.92,
      reason: "history_bonus",
      timestamp: ...,
      file: "webui/report.md"
    }
    ↓
自审视系统周期性审计自动放行记录
    ↓
如果自动放行的操作在后续被发现有问题
    ↓
降低对应 Agent 的 trustScore + 标记事件为 disputed
```

---

## 五、Agent 定义

```typescript
// cortex-agents.json 新增
{
  "type": "confirmGate",
  "tags": ["confirm", "gatekeeper"],
  "model": "internal",        // 不需要 LLM
  "toolPermissions": [],
  "trustModel": {
    "baseTrust": {
      "inspector": 0.9,
      "code": 0.5,
      "fix": 0.7,
      "ops": 0.6,
      "doc-govern": 0.85,
      "analysis": 0.8,
      "review": 0.75,
      "loop": 0.7
    },
    "decayFactor": 0.05,      // 每次失败衰减
    "recoveryRate": 0.02,     // 每次成功恢复
    "autoApproveThreshold": 0.8,
    "e2eAutoApprove": true
  }
}
```

### 为什么不需要 LLM

ConfirmGate 的判断是纯计算——信任分公式 + 阈值比较 + 历史数据查询。不存在需要 LLM 推理的场景。Agent 化不是"让 LLM 做判断"——是"让确认机制获得感知上下文的能力"。

---

## 六、信任历史存储

数据源：MemoryStore。重用已有管线。

```typescript
interface TrustRecord {
  agentType: string;
  toolName: string;
  count: number;
  successCount: number;
  lastUpdated: number;
  trustScore: number;
}
```

每次 Agent 调用工具后，异步写入一条 `confirm-gate.trust_update` 事件。ConfirmGate Agent 周期性从 MemoryStore 读取 TrustRecord 更新信任分缓存。

---

## 七、与现有系统的关系

| 现有组件 | 关系 |
|----------|------|
| ReversibilityLevel | 保留——作为 `risk_penalty` 的基础值 |
| L0-L3 分级 | 降级为 `risk_penalty` 计算的输入，不再直接决定确认策略 |
| Toolkit.execute() | 调用前先过 ConfirmGate Agent 的 approve() 方法 |
| PipelineObserver | 自动放行事件通过 observer 发射 |
| E2E 测试 | `isE2E=true` 时完全跳过确认 |
| 自审视系统 | 周期性审计自动放行记录 |

---

## 八、实现路线图

| Phase | 内容 | 依赖 |
|-------|------|------|
| 1 | ConfirmGate Agent 注册 + 信任分计算引擎 | MemoryStore 接入 |
| 2 | 自动放行 + 事后审计 | Phase 1 |
| 3 | trustScore 动态更新（基于工具调用结果） | Phase 2 + PipelineObserver |
| 4 | 自审视周期性审计自动放行记录 | Phase 3 + 自审视系统 |
