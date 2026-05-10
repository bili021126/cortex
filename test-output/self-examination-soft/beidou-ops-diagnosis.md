# ⚓ 北斗·工程就绪性诊断报告

> **诊断人：** 北斗（Ops Agent）
> **诊断时间：** 2025-07-09 23:50 CST
> **船队范围：** `packages/engine` · `packages/shared` · `packages/testing`
> **诊断等级：** 全量扫描（构建 + 依赖 + 配置 + 运行时 + 测试）

---

## 一、🔨 构建链路（Build Chain）

### 1.1 构建拓扑

```
tsconfig.base.json（根，统一编译选项）
   ├─ packages/shared/      → tsc → dist/     ✅ 构建成功，0 错误
   ├─ packages/testing/     → tsc → dist/     ✅ 构建成功，0 错误
   └─ packages/engine/      → tsc → dist/     ✅ 构建成功，0 错误
```

### 1.2 关键配置

| 项目 | 值 | 状态 |
|------|----|------|
| TypeScript | `^5.7.0`（实际锁 5.9.x） | ✅ |
| 目标 | ES2022 | ✅ |
| 模块 | Node16 | ✅ |
| strict | `true` | ✅ |
| composite | `true`（增量构建） | ✅ |
| Package Manager | pnpm 9.15.4 | ✅ |
| Node | v24.12.0（≥20，合规） | ✅ |

### 1.3 构建结果

| 包 | 命令 | 状态 | 耗时 |
|---|------|------|------|
| `@cortex/shared` | `tsc` | ✅ 通过 | ~2s |
| `@cortex/testing` | `tsc` | ✅ 通过 | ~1s |
| `@cortex/engine` | `tsc` | ✅ 通过 | ~3s |

### 1.4 ⚠️ 确信问题

**问题 B1 — 增量构建缓存风险**
- `composite: true` + `incremental: true` 开启后，`.tsbuildinfo` 文件会缓存增量信息。
- 若 `dist/` 被清理而 `.tsbuildinfo` 残留，`tsc` 可能报告**假增量成功**（认为无须重新编译）。
- **建议：** CI 中 `pnpm build` 前执行 `pnpm clean` 或 `rm -rf packages/*/tsconfig.tsbuildinfo`。

---

## 二、🌳 依赖树（Dependency Tree）

### 2.1 依赖图

```
root (devDeps only: eslint, vitest, typescript-eslint)
 │
 ├─ @cortex/shared@0.1.0
 │    devDeps: typescript, vitest
 │    （纯类型定义包，零运行时依赖 ✅）
 │
 ├─ @cortex/testing@0.1.0
 │    deps: @cortex/shared (workspace:*), uuid ^10.0.0
 │    devDeps: @types/uuid, typescript, vitest
 │
 └─ @cortex/engine@0.1.0
      deps: @cortex/shared (workspace:*), sql.js ^1.14.1
      devDeps: @cortex/testing (workspace:*), @types/node ^22,
               @types/sql.js ^1.4.11, playwright ^1.59.1,
               typescript ^5.7.0, vitest ^2.1.0
```

### 2.2 依赖健康检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 循环依赖 | ✅ 无 | 所有边均为单向 |
| workspace 协议 | ✅ 一致 | 所有 `workspace:*` 正确解析为 `link:` |
| lockfile 一致 | ✅ | `pnpm-lock.yaml` v9，无冲突版本 |
| 版本大版对齐 | ✅ | typescript 统一 5.x，vitest 统一 2.x |
| 类型包匹配 | ✅ | `@types/uuid` → `uuid ^10`；`@types/sql.js` → `sql.js ^1.14` |
| 引擎约束 | ✅ | node ≥20，pnpm ≥9 |

### 2.3 ⚠️ 待验证项

**问题 D1 — `sql.js` WASM 加载路径**
- `sql.js` 是唯一的运行时外部依赖（WASM SQLite）。
- 其 WASM 二进制加载路径在不同运行时环境（Node CLI vs Electron vs Web）表现不同。
- **建议验证：** 在生产打包场景下确认 `sql.js` 的 `initSqlJs()` 能否正确定位 `.wasm` 文件。若使用 `node:fs` 直接加载，需确保 wasm 文件随包分发。

**问题 D2 — `playwright` 版本耦合**
- `playwright ^1.59.1` 作为 `@cortex/engine` 的 devDep — 仅 e2e 测试使用，不影响生产构建。
- 但 e2e 测试依赖浏览器二进制文件，CI 中需要显式安装（`npx playwright install --with-deps`），否则 e2e 测试静默跳过或报错。
- **建议：** 在 `package.json` 中添加 `scripts.e2e-setup` 或 CI pipeline 中注明此步骤。

---

## 三、📐 配置一致性（Config Consistency）

### 3.1 TypeScript 配置

| 文件 | 模式 | 一致性 |
|------|------|--------|
| `tsconfig.base.json` | 根基类 | ✅ 基线 |
| `packages/shared/tsconfig.json` | `extends` base | ✅ 一致 |
| `packages/testing/tsconfig.json` | `extends` base | ✅ 一致 |
| `packages/engine/tsconfig.json` | `extends` base + `references: [shared]` | ✅ 一致 |

所有子配置仅重写 `outDir` 和 `rootDir`，无冲突覆盖。

### 3.2 ESLint 配置

- **文件：** `eslint.config.mjs`（Flat config，ESLint 10 原生格式）
- **ignores：** `dist/`、`node_modules/`、`tmp/`、`test-output/`、`.cortex/`
- **规则亮点：**
  - `no-console` 仅允许 `log/info/debug/trace/dir/time/timeEnd`，**禁止 `console.error/warn`** — 强制走 `PipelineObserver` 管道 ✅
  - `no-empty` 为 **error**，禁止空 catch — 防止静默吞错 ✅
  - `@typescript-eslint/no-unused-vars` 为 warn，`argsIgnorePattern: "^_"` ✅

### 3.3 ⚠️ 确信问题

**问题 C1 — `.env` 包含真实 DeepSeek API Key（安全泄漏）**

```
DEEPSEEK_API_KEY=sk-1e1ffd5f19f3428d9d264c26ec0589a6
```

- `.env` 未被 `.gitignore` 忽略？查看 `.gitignore`：`.env` 和 `*.env` 都已列入 → **本地安全**。
- 但考虑到 `.env` 已在本地文件系统中明文存储，且有被误提交的历史风险。
- **建议：**
  1. 立即轮换该 API Key（若已在生产使用）。
  2. 检查 git history 是否曾暴露过该 key：`git log --all --diff-filter=A -- '.env' | grep sk-`。
  3. 考虑使用 secrets manager（如 1Password CLI / Doppler）替代 `.env` 文件。

**问题 C2 — Vitest 配置意外注入真实 API 凭据**

```typescript
// packages/engine/vitest.config.ts
env: {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
}
```

- vitest 配置将 `process.env` 中的 API key 注入到测试环境变量中。
- 若开发者运行测试时 `.env` 已加载，测试中可能意外触发真实 LLM API 调用，**产生费用且暴露 key**。
- **建议：** 测试环境中应优先使用 mock，仅当显式标记 `E2E=true` 时才注入真实凭据。
  可改为：`DEEPSEEK_API_KEY: process.env.E2E ? (process.env.DEEPSEEK_API_KEY ?? "") : ""`

### 3.4 环境变量配置

| 检查项 | 状态 |
|--------|------|
| `.env` 存在 | ✅ |
| `.env.example` 存在 | ✅ |
| 字段对齐 | ✅ `.env` 与 `.env.example` 的 key 完全一致 |
| `.env` 含敏感信息 | ⚠️ 见问题 C1 |

---

## 四、🔥 运行时脆弱点（Runtime Vulnerabilities）

### 4.1 架构关键路径

```
用户输入 → MetaAgent(规划) → TaskBoard(认领) → Scheduler(调度)
     → Agent(Code/Review/Analysis/Ops/...) 
       → ReAct Loop(runReActHelper) 
         → Toolkit(工具执行) → ConfirmGate(确认门)
         → LlmAdapter(LLM 调用) → 结果回写
```

### 4.2 ⚠️ 确信问题

**问题 R1 — `console.error/warn` 被禁止但部分路径可能绕过 PipelineObserver**

- ESLint 规则 `no-console` 禁止 `console.error/warn`，强制走 `PipelineObserver`。
- **已验证：** `PipelineObserver` + `SafeErrorReporter` 机制已在 `pipeline-observer-reporting.test.ts` 中覆盖 6 个测试用例（含 silent 升级 degraded、fatal 等场景）✅
- **风险点：** `llm-adapter.ts` 中的 `loadCache` 方法在 try-catch 中使用 `this._safeReporter?.()` 上报，但若 `_safeReporter` 为 null 则静默忽略。确保所有 Agent 和核心组件都在 bootstrap 阶段完成了 `setSafeReporter` 注入。
- **建议：** 在 bootstrap 或构造函数中添加断言：若 `_safeReporter` 未被注入则抛出警告。

**问题 R2 — `AgentPool.destroy` 绕过状态机**
- 测试日志显示：`[agent-pool] destroy 绕过状态机: created → Destroyed，强制清理`
- 这意味着 `destroy` 操作跳过了 `Awake → Draining → Destroyed` 的正常状态流转。
- **风险：** 如果强制清理时仍有进行中的任务，可能导致资源泄漏或数据不一致。
- **建议：** 检查 `destroy` 是否在所有路径前确保 agent 已空闲；考虑加入 `draining` 超时等待机制。

**问题 R3 — sql.js 内存数据库无持久化保护**
- `memory-store.ts` 依赖 `sql.js`（WASM SQLite）作为持久化存储。
- 若 Node.js 进程异常退出（SIGKILL、OOM），**未写入磁盘的变更将全部丢失**。
- `_saveDb` 测试（`memory-store-save.test.ts`）**2 个测试失败**（见第五节），表明序列化/反序列化链路存在缺陷。
- **建议：** 实施 WAL 模式 + 定期 checkpoint，或引入写入前日志（Write-Ahead Log）机制。

### 4.3 待验证项

**问题 R4 — 跨平台路径兼容性**
- `Toolkit.setWorkspaceRoot()` 使用 `path.resolve()`，在 Windows 上为 `D:\...` 格式，在 Linux/macOS 上为 `/...` 格式。
- `sql.js` 数据库文件路径需要跨平台一致。
- **建议验证：** 在 Linux CI 上运行完整测试套件，确认路径处理无硬编码分隔符。

**问题 R5 — LLM 调用超时与重试爆炸**
- `LlmAdapter.chat()` 内置重试（最多 3 次，1s 退避）和 30s 超时。
- 若 `ReAct` 循环（默认 48 轮）每轮都触发重试，单次 Agent 执行可能耗时 `48 × 3 × 30s = 72 分钟`。
- **建议：** 在 `Scheduler` 层加入全局执行超时，或为 `maxLoops` 乘以重试惩罚系数。

---

## 五、🧪 测试基础（Test Infrastructure）

### 5.1 测试运行结果

| 指标 | 数值 |
|------|------|
| 测试文件总数 | 23 |
| 通过文件数 | 19 ✅ |
| 失败文件数 | **4 ❌** |
| 测试用例总数 | 178 |
| 通过用例数 | 170 ✅ |
| 失败用例数 | **8 ❌** |
| 耗时 | 29.61s |

### 5.2 失败测试详情

#### ❌ 失败文件 1：`tests/meta-agent.test.ts`（2 个失败）

| 测试名 | 断言失败 | 原因分析 |
|--------|---------|---------|
| 将用户意图拆解为 TaskNode 树 | `expected 3 to be 2` | MetaAgent 拆解 LLM 返回时生成了 3 个节点，但测试期望 2 个。可能原因：mock LLM 返回格式变化，或解析逻辑变更后多生成了一个通用节点。 |
| parentId 正确传递到子节点 | `expected 3 to be 2` | 同上根因——生成了额外节点后 parentId 链也对应变化。 |

**影响评估：** MetaAgent 是规划入口，节点生成错误会影响全管线调度。高优先级。

#### ❌ 失败文件 2：`tests/memory-store-save.test.ts`（2 个失败）

| 测试名 | 原因分析 |
|--------|---------|
| persists and reloads data correctly | `_saveDb` 持久化后重载数据不一致。可能：WASM 数据库序列化/反序列化或列映射出错。 |
| persists and reloads content with metadata | 带 metadata 的序列化失败。可能原因：metadata 字段在 SQL schema 中类型不匹配。 |

**影响评估：** 记忆系统无法可靠持久化—运行时脆弱点 R3 的直接证据。高优先级。

#### ❌ 失败文件 3：`tests/multi-agent-collab.test.ts`（1 个失败）

| 测试名 | 断言失败 | 原因分析 |
|--------|---------|---------|
| 父节点失败 → 子节点仍执行 | `expected 1 to be 2` | 测试期望父节点失败后子节点不执行（completed=1），但实际子节点也执行了（completed=2）。当前 Scheduler 策略是"不阻止子节点执行"。 |

**影响评估：** 这是**已知策略选择**（测试本身也标注了"当前策略"），不是回归 bug，但需与产品确认是否接受此行为。

#### ❌ 失败文件 4：`tests/task-board-stress.test.ts`（3 个失败）

| 测试名 | 断言失败 | 原因分析 |
|--------|---------|---------|
| 暗雷 R2：父节点失败 → 子节点级联 | `expected 0 to be 1` | 同策略问题——父节点失败后子节点不级联跳过，实际执行了 1 个。 |
| 暗雷 R6：同层部分节点失败不影响其他节点 | `expected 2 to be 1` | completed 应为 1（失败的不算）但得到 2。 |
| 暗雷 R6：全部节点失败时管线仍正常结束 | `expected 0 to be 2` | 全部节点应标记为 failed（completed=0），但实际标记了 2 个为 completed。 |

**影响评估：** Scheduler 的失败计数逻辑与测试期望不一致。可能原因：`all failed` 场景下 `_dispatchNode` 仍将某些节点标记为 completed，而非 failed。需检查 `executeAll` 中的错误处理分支。

### 5.3 ⚠️ 测试基础设施问题

**问题 T1 — 测试覆盖率盲区**
- 引擎核心模块 `23 个 src 文件`，对应 `23 个测试文件`（含 e2e/manual），**单元测试文件覆盖约 15 个**。
- 未覆盖的关键模块：
  - `src/analysis-agent.ts` — 无独立测试（仅通过 collab 测试间接覆盖）
  - `src/doc-govern-agent.ts` — 无独立测试
  - `src/inspector-agent.ts` — 无独立测试
  - `src/loop-agent.ts` — 无独立测试
  - `src/toolkit.ts` — 工具执行的集成测试缺失（仅有权限校验测试）
- **建议：** 为上述 Agent 添加独立单元测试，至少覆盖 execute 和 preExecuteHook。

**问题 T2 — E2E 测试被归类为 manual**
- `tests/manual/e2e/` 下的 6 个 e2e 测试不参与 `vitest run`，需要手动执行。
- 这些测试依赖真实 LLM API 和浏览器（Playwright），CI 中无自动运行。
- **建议：** 将基础 e2e 测试（calculator-e2e、mini-react-test）加入 CI nightly pipeline，使用 mock LLM + headless 模式运行。

**问题 T3 — `@cortex/testing` 的测试未运行**
- `packages/testing` 有自己的 `vitest` devDep 和 `test` script，但**当前未在根 workspace 中触发**。
- `pnpm -r test` 会运行它，但需确认其测试内容不为空。

---

## 六、📋 综合诊断摘要

### 🚨 高优先级（确信问题，需立即处理）

| 编号 | 类别 | 问题 | 影响 |
|------|------|------|------|
| **C1** | 安全 | `.env` 含真实 API Key | 凭据泄露风险 |
| **C2** | 测试安全 | Vitest 配置注入真实 API Key | 测试时意外调用真实 LLM |
| **R3** | 运行时 | sql.js 持久化链路损坏（2 个测试失败） | 记忆系统不可靠 |
| **T1b** | 测试 | MetaAgent 节点生成逻辑与测试期望不符（2 个失败） | 规划入口行为异常 |

### ⚠️ 中优先级（待验证或策略确认）

| 编号 | 类别 | 问题 | 建议动作 |
|------|------|------|----------|
| **B1** | 构建 | 增量构建缓存假阳性 | CI 中添加预清理步骤 |
| **D1** | 依赖 | sql.js WASM 加载路径环境敏感 | 打包前验证 wasm 加载 |
| **R1** | 运行时 | SafeErrorReporter 注入完整性 | 添加注入断言 |
| **R2** | 运行时 | AgentPool.destroy 绕过状态机 | 检查 draining 等待机制 |
| **T1a** | 测试 | 5 个 Agent 模块无独立测试 | 补充单元测试 |
| **T2** | 测试 | E2E 测试未自动化 | 加入 CI nightly |

### 📌 低优先级（优化建议）

| 编号 | 类别 | 问题 |
|------|------|------|
| **R5** | 运行时 | LLM 重试 × ReAct 循环可能导致总超时过长 |
| **T3** | 测试 | `@cortex/testing` 包的测试未在 CI 中验证 |
| — | 文档 | `docs/Cortex 概念顶层设计 v1.1-已废弃.md` 应清理 |

---

## 七、🏁 到港报告

```
到港，但舱底有 3 处渗水：

1️⃣ 舱底水（高优）：MetaAgent 节点生成逻辑与测试脱节 + sql.js 持久化链路断裂
   → 出港前必须补好，否则货（记忆）会沉进海里。

2️⃣ 右舷裂缝（中优）：API Key 暴露风险 + 5 个 Agent 模块无独立测试
   → 下一趟航程前安排修船。

3️⃣ 帆索松弛（低优）：增量构建缓存、e2e 自动化、旧文档残留
   → 趁着顺风时顺手收紧。

全船到港，风浪中等，需修船后再出航。
```

---

*北斗 · 日志 2025-07-09 23:50 CST*
*南十字船队 · Cortex Ops Agent*
