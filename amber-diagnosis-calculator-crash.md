# 侦察报告：计算器表达式实现崩溃诊断

**侦察员**：安柏 · 西风骑士团侦察骑士（InspectorAgent）
**任务**：诊断计算器表达式实现崩溃原因
**依据**：上下文记忆（6条）+ 系统自动采集编译事实

---

## 勘察发现（共 2 项）

### 发现 1：ReAct 循环在迭代 1/64 崩溃 —— LLM API 400

**证据链**（上下文记忆 3 条重复记录）：
```
[ReAct loop crashed at iteration 1/64: Error: LLM API error 400:
{"error":{"message":"Thinking mode does not support this model"}}
```

**根因追溯（3 步链路，每步均可回溯到具体文件）：**

| 步骤 | 文件 | 行号 | 事实 |
|------|------|------|------|
| ① 配置 | `calculator-e2e.ts` | ~259 | `LlmAdapter` 配置 `reasoningEffort: "max"` |
| ② 模型选择 | `calculator-e2e.ts` | ~288~304 | 所有 Agent 注册使用 `CHAT_MODEL` = `deepseek-v4-flash` |
| ③ 请求发送 | `react-loop.ts` | ~102 | `llm.chat(model, messages, toolDefs, node.reasoningEffort)` — `node.reasoningEffort` 为 `undefined` |
| ④ 参数回退 | `llm-adapter.ts` | ~200 | `const effort = reasoningEffort ?? this.config.reasoningEffort` → `"max"` |
| ⑤ API 调用 | `llm-adapter.ts` | ~201 | `body.reasoning_effort = "max"` 发送至 `deepseek-v4-flash` |
| ⑥ API 拒绝 | DeepSeek API | — | 返回 400：`reasoning_effort` 不被 Flash 模型支持 |

**结论**：`deepseek-v4-flash` 不支持 thinking/reasoning 模式（`reasoning_effort` 参数）。`reasoning_effort: "max"` 仅适用于 `deepseek-v4-pro`。Agent ReAct 循环将 `reasoning_effort` 发送给了不支持该参数的模型，API 拒绝，导致迭代 1 即崩溃。

---

### 发现 2：`tsc --noEmit` 编译失败

**证据**（系统编译事实 stdout）：
```
tsconfig.json(10,5): error TS6053: File 'D:/cortex/projects/pm-legacy' not found.
```

**根因**：根目录 `tsconfig.json` 第 10 行引用了 `projects/pm-legacy` 路径，但 `D:/cortex/projects/` 目录不存在。该引用位于 tsconfig.json 的 `references` 数组（项目引用），无论计算器代码是否正确，tsc 都会因缺少该项目引用而失败。

**影响**：Inspector Agent（安柏）执行 `tsc --noEmit` 验证时，永远返回编译失败——这不是计算器代码的问题。

---

### 发现 3：测试文件找不到

**证据**（系统编译事实 tsx stderr）：
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\cortex\test\calculator.test.ts'
```

**根因**：测试运行器从 `D:\cortex\` 根目录执行，试图查找 `test/calculator.test.ts`。但 calculator-e2e.ts 将测试文件创建在 `projects/calculator/test/calculator.test.ts`，工作目录不匹配导致模块未找到。

---

## 总结

| 问题 | 严重度 | 是否计算器代码本身的问题 |
|------|--------|------------------------|
| ReAct 崩溃 (LLM API 400) | **致命** — 所有 Agent 无法执行任何 LLM 调用 | ❌ 否 — calculator-e2e.ts 配置问题：Flash 模型 + `reasoning_effort: "max"` 不兼容 |
| tsc 编译失败 | **阻断** — 编译验证永远失败 | ❌ 否 — tsconfig.json 引用了不存在的 `projects/pm-legacy` |
| 测试文件找不到 | **阻断** — 无法运行测试 | ❌ 否 — 工作目录与文件创建路径不匹配 |

**核心崩溃原因**：`deepseek-v4-flash` 模型不支持 `reasoning_effort` 参数，但 calculator-e2e.ts 对所有 Agent 统一使用 Flash 模型并配置了 `reasoningEffort: "max"`，导致 ReAct 循环第一次 LLM 调用即被 API 拒绝。

**修复方向**（侦察员不提供建议，以下为事实性选项）：
- 选项 A：将 Agent ReAct 模型改为 `deepseek-v4-pro`（支持 thinking 模式）
- 选项 B：对 Flash 模型不发送 `reasoning_effort` 参数（需修改 llm-adapter 或 calculator-e2e 注册逻辑）
- 选项 C：删掉 tsconfig.json 中对 `projects/pm-legacy` 的引用
- 选项 D：修复测试执行的工作目录为 `projects/calculator/`

---

*侦察完毕。以上全部基于工具调用返回的可追溯证据。*
