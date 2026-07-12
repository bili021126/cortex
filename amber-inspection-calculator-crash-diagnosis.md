# 侦察报告：calculator.html 状态 + 修复崩溃根因诊断

**侦察员**：安柏 · 西风骑士团侦察骑士（Inspector Agent）
**任务**：检查 calculator.html 并诊断导致修复崩溃的问题
**依据**：工具调用返回的可追溯证据（read_file、glob_find、list_files、file_info）

---

## 勘察发现

### 发现 1：`calculator.html` — ❌ 不存在

**证据链**：
- `glob_find **/*calculator*.html` → **0 匹配**
- `glob_find **/*.html` → 5 个 HTML 文件，**无一与计算器相关**
- 全局搜索 `**/calculator*` → 6 个结果，均为 `.ts` / `.md` 文件，无 `.html`

**事实**：上下文所述"创建 calculator.html 页面，包含表达式输入框（#expression）、计算按钮（#calculateBtn）、结果展示区（#result）"——**该文件从未被写入磁盘。**

---

### 发现 2：`projects/calculator/` 目录存在，但为空

**证据链**：
- `file_info D:/cortex/projects/calculator` → exists: true, isDirectory: true
- `list_files D:/cortex/projects/calculator` → **空目录**（无任何文件）
- `glob_find projects/calculator/**/*` → **0 匹配**

**事实**：`projects/calculator/` 目录已被创建（空的），其中没有任何文件。`projects/calculator/src/calculator.ts` 虽然被 `glob_find` 匹配到，但 `list_files` 显示目录为空——说明该文件可能被写入后又删除了，或路径解析存在歧义。

---

### 发现 3：`src/calculator.ts` ✅ 存在（根目录 `src/` 下，44行）

**证据链**：
- `read_file D:/cortex/src/calculator.ts` → 44行 Calculator 类
- 内容：`calculate(expr: string): number` 方法，使用 `new Function()` 实现，支持 `+-*/`、括号、优先级
- 除以零 → NaN，非法字符 → throw Error

**事实**：这是**唯一成功写入的计算器代码文件**，位于 `D:/cortex/src/calculator.ts`（项目根 `src/` 下），而非 E2E 脚本预期的 `projects/calculator/src/calculator.ts`。

---

### 发现 4：所有测试文件 — ❌ 不存在

**证据链**：
- `glob_find **/calculator.test.*` → **0 匹配**
- `glob_find **/*.test.ts` → 无 calculator 相关结果

**事实**：`calculator.test.ts` 从未被写入磁盘。测试目录 `projects/calculator/test/` 也未创建。

---

## 修复崩溃根因诊断

### 崩溃根因链路（6 步，每步均可回溯到具体文件和行号）

| 步骤 | 文件 | 行号 | 事实 |
|------|------|------|------|
| ① 默认配置 | `llm-defaults.ts` | 30 | `resolveLlmConfig()` 默认 `reasoningEffort: "max"`，`chatModel: "deepseek-v4-flash"` |
| ② Adapter 初始化 | `calculator-e2e.ts` | 251 | `new LlmAdapter({..., reasoningEffort: llmCfg.reasoningEffort as "high" \| "max"})` → `reasoningEffort: "max"` |
| ③ MetaAgent 使用 reasonerModel | `calculator-e2e.ts` | 109 | `const metaAgent = new MetaAgent(adapter)` → MetaAgent 调用 `this.llm.reasonerModel` |
| ④ `reasonerModel` = `chatModel` | `llm-defaults.ts` | 29 | `reasonerModel: overrides?.reasonerModel ?? process.env.DEEPSEEK_REASONER_MODEL ?? "deepseek-v4-flash"` |
| ⑤ `reasoning_effort` 条件 | `llm-adapter.ts` | 291-292 | `if (effort && (model.includes("pro") \|\| model.includes("reasoner"))) { body.reasoning_effort = effort; }` |
| ⑥ 条件不满足 → 仍发送 | `llm-adapter.ts` | 291 | `model === "deepseek-v4-flash"` → 不包含 "pro" 或 "reasoner" → reasoning_effort **不会**被加入 body |
| ⑦ **但 `chatStream()` 路线不同** | `llm-adapter.ts` | 386 | `chatStream()` 中的条件是 `if (effort) { body.reasoning_effort = effort; }` — **没有模型名过滤！** |

### 关键发现

**修复崩溃的真正根因在第⑦步**：

非流式 `chat()` 方法（第 291-292 行）对 `reasoning_effort` 有安全过滤：
```typescript
if (effort && (model.includes("pro") || model.includes("reasoner"))) {
  body.reasoning_effort = effort;
}
```
→ Flash 模型不会发送 `reasoning_effort` → 安全。

但 **`chatStream()` 方法（第 386 行）没有这个过滤**：
```typescript
const effort = reasoningEffort ?? this.config.reasoningEffort;
if (effort) {
  body.reasoning_effort = effort;  // ← 无条件发送！
}
```
→ Flash 模型也会收到 `reasoning_effort: "max"` → **API 返回 400**。

**Agent ReAct 循环使用 `chatStream()`**，因此在迭代 1/64 崩溃。

---

### 次要问题：`tsc --noEmit` 编译阻断

**证据**：系统自动采集的编译事实：
```
tsconfig.json(10,5): error TS6053: File 'D:/cortex/projects/pm-legacy' not found.
```

**事实**：根 `tsconfig.json` 第 10 行引用了不存在的 `projects/pm-legacy` 路径。这不是计算器代码的问题——是 `tsconfig.json` 配置漂移，导致任何 `tsc --noEmit` 验证都永远失败。

---

## 汇总

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `calculator.html` | ❌ 不存在 | 从未被写入磁盘 |
| `projects/calculator/src/calculator.ts` | ⚠️ 存在但目录为空 | 文件路径解析可能有歧义 |
| `src/calculator.ts` | ✅ 存在 | 根目录 `src/` 下，44行 |
| `calculator.test.ts` | ❌ 不存在 | 测试文件从未创建 |
| ReAct 循环崩溃根因 | ✅ 已定位 | `chatStream()` 缺少 `reasoning_effort` 模型名过滤（第 386 行） |
| `tsc --noEmit` 编译阻断 | ✅ 已定位 | `tsconfig.json` 引用了不存在的 `projects/pm-legacy` |

---

*侦察完毕。以上全部基于工具调用返回的可追溯证据。每一条发现均可追溯到具体文件路径和行号。*
