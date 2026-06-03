# ⚖️ Cortex 代码法典——全体 Agent 必须遵守

> 此文件由 bootstrapEngine 自动注入到每个 Agent 的 system prompt 头部。
> 违者将在 CI lint 环节被拦截。你不是在"建议"，你是在"执行法律"。
> 
> 版本：v2.0（宪法对齐——适配宪法 v2.5.28 七条不可变原则 + ConfirmGate + PipelineObserver + 记忆系统 + 治理层）

---

## 一、异常处理——死线

```
✅ 正确：每个 catch 必须有处理逻辑或显式注释
❌ 禁止：空 catch {} 块
❌ 禁止：throw "字符串" ——只 throw new Error(...)
✅ 要求：throw new Error("消息", { cause: e })  保留原因链
```

```typescript
// ✅ 正确
try {
  await riskyOp();
} catch (e) {
  // 降级策略：使用缓存
  return cachedResult;
}

// ✅ 正确（有显式原因说明）
try {
  parseJSON(data);
} catch {
  /* 非关键数据，解析失败使用默认值——安全降级 */
  return defaults;
}
```

## 二、变量声明——不可漂移

```
❌ 禁止：var 声明
✅ 要求：优先 const，只有确需重新赋值时才用 let
```

```typescript
// ✅ 正确
const result = compute(data);

// ✅ 允许（确实需要重新赋值）
let count = 0;
for (const item of items) {
  if (item.active) count++;
}
```

## 三、异步规范

```
✅ 要求：async 函数 return 语句要加 await
✅ 要求：不忽略 Promise（必须 await / .catch / 赋值）
❌ 禁止：Promise 被静默丢弃
```

```typescript
// ❌ 错误——Promise 被丢弃
fetchData();  

// ✅ 正确
await fetchData();

// ✅ 正确（有意 fire-and-forget，必须显式标注）
fetchData().catch(e => console.warn("非关键操作失败:", e));
```

## 四、导入路径——barrel 铁律

```
✅ 新文件：包名导入 `import { X } from "@cortex/engine"`
❌ 禁止：测试文件使用 `../src/xxx` 相对导入
✅ 要求：新增公开符号 → 必须更新包 src/index.ts barrel export
```

## 五、控制台输出与管道上报

```
❌ 禁止：裸 console.error() / console.warn()
✅ 要求：生产代码走 PipelineObserver 管道（宪法原则五）
```

**管道上报三档（SafeErrorReporter 协议，宪法 §8.1）**：

| 级别 | 含义 | Pipeline 优先级 | 使用场景 |
|------|------|----------------|---------|
| `fatal` | 操作失败，无法继续 | CRITICAL | DB 写入失败、状态机非法流转 |
| `degraded` | 部分成功，降级运行 | HIGH | 文件锁排队超时、SQL 回退内存 |
| `silent` | 静默异常，自动计数 | NORMAL | catch 块中无 emit 的吞错 |

> **静默计数器**：同一 `(source, event)` 在一次执行中累计 ≥ 3 次 → 自动升级为 `degraded` 并 emit。

## 六、代码风格速查

| 规则 | 级别 |
|---|---|
| 空 catch 块 | ❌ error |
| throw 非 Error | ❌ error |
| var 声明 | ❌ error |
| let 可改为 const | ❌ error |
| 未处理 Promise | ❌ error |
| 未使用变量 | ❌ error |
| require() 导入 | ❌ error |
| console.error/warn | ⚠️ warn |
| 非空断言 `!` | ⚠️ warn |

---

## 七、硬编码禁令（宪法原则七·子约束8）

```
❌ 禁止：任何模块中直接书写魔法数字、路径字面量、环境变量名、版本号字符串
✅ 要求：所有以上常量在 packages/cli/src/constants.ts 中统一定义
```

**禁止字面量类型**：
- (a) 环境变量名（如 `DEEPSEEK_API_KEY`）→ 用 `ENV_DEEPSEEK_API_KEY`
- (b) 项目路径与文件名（如 `cortex-agents.json`、`.cortex/persona-talk.txt`）→ 用 `FILE_CORTEX_AGENTS_JSON` 等
- (c) 版本号字符串（如 `v0.2.0`、`Core-1`）→ 用 `CORTEX_VERSION` / `CORTEX_PHASE`
- (d) 默认超时值、配额数等数值常量

> **违反者构成配置漂移**。新增常量类型时须同步更新 `constants.ts` 并确保所有引用点使用该常量。

---

> **此文件是 Cortex 的代码法典·核心篇——全量注入所有 Agent。**
> 
> 治理篇（架构规范、Agent 交互协议）见 `prompts/coding-standards-governance.md`。
> 
> **宪法依据**：Cortex 概念顶层设计 v2.5.28——七条不可变原则
