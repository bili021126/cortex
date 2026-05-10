# 🔭 北斗部署就绪性诊断报告

**评估者**：北斗（南十字船队 Ops Agent）
**评估日期**：2026-05-06
**评估范围**：工程化约定、配置文件一致性、环境依赖、跨平台兼容性
**评估方法**：静态文件审计（审视模式，禁止命令执行）

---

## 一、工程化约定审计

### 1.1 Monorepo 结构 ✅

```
cortex/
├── packages/
│   ├── engine/     — @cortex/engine    (核心引擎)
│   ├── shared/     — @cortex/shared    (共享类型)
│   └── testing/    — @cortex/testing   (测试工具)
├── docs/           — 设计文档
├── doc-govern/     — 文档治理委员会记录
├── webui/          — 前端占位
└── pnpm-workspace.yaml
```

| 约定项 | 状态 | 说明 |
|--------|------|------|
| pnpm workspace | ✅ | `packages/*` 标准配置 |
| 包命名规范 `@cortex/*` | ✅ | 三个包均遵循 |
| 模块系统 ESM | ✅ | 全部 `"type": "module"` |
| 构建产物 `dist/` | ✅ | 统一输出目录 |
| .gitignore 覆盖 | ✅ | 排除 node_modules/ dist/ .env .cortex/ |

### 1.2 🔴 tsconfig 继承策略不统一

| 包 | extends base? | references | 问题 |
|----|--------------|------------|------|
| engine | ✅ `../../tsconfig.base.json` | ✅ → shared | 正确 |
| shared | ❌ 独立配置，硬编码重复 | — | 🔴 **未继承 base**，与 base 配置重复维护 |
| testing | ✅ `../../tsconfig.base.json` | ❌ 无 | 🟡 依赖 shared 但未声明 references |

> **风险**：shared 修改 tsconfig 时无法享受 base 统一升级。testing 缺少 references 可能导致增量构建顺序错误（tsc --build 模式下）。

### 1.3 🔴 vitest 版本分裂

| 位置 | vitest 版本 |
|------|------------|
| `package.json` (root devDeps) | `^4.1.5` |
| `packages/engine/package.json` (devDeps) | `^2.1.0` |

> **风险**：两个大版本共存。vitest 2.x 和 4.x API 存在差异，engine 的测试可能使用过时 API，而 workspace 提升的 vitest 4.x 行为不一致。pnpm 的 hoist 策略可能导致不可预测的版本解析。

### 1.4 🔴 eslint 脚本无配置

| 包 | lint 脚本 | eslint 配置文件 |
|----|----------|----------------|
| engine | `"eslint src/"` | ❌ 不存在 |
| shared | `"eslint src/"` | ❌ 不存在 |
| testing | `"eslint src/"` | ❌ 不存在 |

> **风险**：`pnpm -r lint` 将直接失败。项目无 `.eslintrc.*` / `eslint.config.*`。全局搜索确认无任何 eslint 配置。

### 1.5 🟡 scripts 覆盖率不统一

| 脚本 | engine | shared | testing |
|------|--------|--------|---------|
| build | ✅ tsc | ✅ tsc | ✅ tsc |
| typecheck | ✅ | ✅ | ✅ |
| test | ✅ vitest | ❌ 无 | ❌ 无 |
| lint | ✅ eslint | ✅ eslint | ✅ eslint |
| dev | ✅ tsc --watch | ❌ 无 | ❌ 无 |

> **shared 虽然有 `tests/types.test.ts` 测试文件，但 package.json 中没有 test 脚本。**

### 1.6 🟡 engine 包含非标准 packages/ 子目录

`packages/engine/packages/` 子目录存在，不符合 monorepo 约定——engine 是叶子包，不应再有 packages 子目录。

---

## 二、配置文件一致性审计

### 2.1 🔴 类型定义与测试脱节

`packages/shared/tests/types.test.ts` 引用了**大量在当前 `shared/src/index.ts` 中不存在的类型**：

| 测试中引用 | 当前 index.ts 中是否存在 |
|-----------|------------------------|
| `CortexEventType` | ❌ 不存在 |
| `Orientation` | ❌ 不存在（当前用 PlatformKind） |
| `PillarId` | ❌ 不存在（v1.1 残留） |
| `CortexEvent` | ❌ 不存在 |
| `Transport` | ❌ 不存在 |
| `TaskTree` | ❌ 不存在（当前用 TaskNode） |
| `PillarRunner` | ❌ 不存在 |
| `ExecutionContext` | ❌ 不存在 |
| `ToolStaining` | ❌ 不存在 |
| `PlanningDirective` | ❌ 不存在 |
| `CommitteePlan` | ❌ 不存在 |
| `ResourceLock` | ❌ 不存在 |
| `InteractionChannel` | ❌ 不存在 |
| `SystemOutput` | ❌ 不存在 |
| `MesoLiteIntervention` | ❌ 不存在 |

> **全局搜索确认**：以上 v1.1 类型在 src/ 中零引用，仅存在于 types.test.ts 中。这是 v1.1 → v2.0 重构的遗留物。

### 2.2 🔴 环境变量命名不一致

| 文件 | 变量名 | 值 |
|------|--------|-----|
| `.env` (root) | `DEEPSEEK_CHAT_MODEL` | `deepseek-v4-flash` |
| `.env` (root) | `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` |
| `packages/engine/.env` | `DEEPSEEK_CHAT_MODEL` | `deepseek-reasoner` |
| `packages/engine/.env` | `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` |
| `packages/engine/vitest.config.ts` | `DEEPSEEK_MODEL` | `deepseek-chat`（默认值） |
| `shared/src/index.ts` (LlmAdapterConfig) | `chatModel` / `reasonerModel` | —（接口定义） |

> **三个不一致**：
> 1. root `.env` 和 engine `.env` 中 `CHAT_MODEL` 不同（`deepseek-v4-flash` vs `deepseek-reasoner`）
> 2. vitest.config.ts 使用 `DEEPSEEK_MODEL`，而 `.env` 使用 `DEEPSEEK_CHAT_MODEL`——命名不对齐
> 3. root `.env` 和 engine `.env` 重复定义且冲突——运行时的实际值取决于 cwd

### 2.3 🟡 tsconfig references 不完整

```
engine ──references──→ shared   ✅
testing ──依赖 shared 但无 references   🟡
```

testing 的 `dependencies` 中有 `"@cortex/shared": "workspace:*"`，但 tsconfig.json 未声明 references。在 `tsc --build` 模式下，构建顺序可能不正确。

### 2.4 ✅ pnpm-workspace.yaml

简洁合法，无问题。

### 2.5 🔴 vitest.config.ts 硬编码默认 API Key

```ts
DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "sk-d00309ca85564161acc1ee9d0ee98bb9",
```

> **安全风险**：API key 硬编码在源码中。虽然 `.env` 已加入 `.gitignore`，但 vitest 配置文件中的硬编码 key 可能被提交到版本控制。两个不同的 key（vitest 中 vs .env 中）表明密钥管理混乱。

---

## 三、环境依赖审计

### 3.1 依赖树分析

| 包 | 外部依赖 | 类型 | 平台兼容 |
|----|---------|------|---------|
| @cortex/engine | `playwright ^1.59.1` | 浏览器自动化 | 🟡 需安装浏览器二进制 |
| @cortex/engine | `sql.js ^1.14.1` | WASM SQLite | ✅ 纯 WASM |
| @cortex/testing | `uuid ^10.0.0` | 纯 JS | ✅ |
| @cortex/shared | 无外部依赖 | — | ✅ |

### 3.2 🟡 playwright 浏览器依赖

- `playwright` 作为 `dependencies` 而非 `devDependencies`声明，会在生产安装时下载 ~400MB 浏览器二进制
- 无安装后脚本 (`postinstall`) 自动执行 `npx playwright install`
- CI/Docker 环境需显式处理

### 3.3 🟡 Node.js 版本约束

```json
"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
```

- 未指定上限，未来 Node.js 大版本兼容性未知
- `packageManager` 字段锁定 `pnpm@9.15.4`，但 engines 允许 `>=9.0.0`——存在歧义

### 3.4 🟢 零原生编译依赖

三个包均无 `node-gyp`、`node-pre-gyp`、C++ binding 依赖，跨平台兼容性优秀。

---

## 四、跨平台兼容性审计

### 4.1 平台抽象层

| 组件 | 当前状态 | 评估 |
|------|---------|------|
| `PlatformBridge` 接口 | 已定义（shared） | ✅ 设计良好 |
| `CLIAdapter` | 已实现（engine） | ✅ stdin/stdout |
| `ElectronAdapter` | 预留，未实现 | 🟡 Core-2 阶段 |
| `PlatformKind` 枚举 | `cli \| electron` | ✅ |

### 4.2 操作系统兼容性

| 检查项 | 结果 |
|--------|------|
| `process.platform` 条件分支 | ✅ 未发现 |
| 路径硬编码（反斜杠） | ✅ 使用 Node.js path 模块 |
| 文件系统操作 | ✅ 通过工具注册层抽象 |
| WASM（sql.js） | ✅ 所有现代 Node.js 均支持 |
| 终端交互（readline） | ✅ 跨平台 |
| ESM imports | ✅ 全部 `"type": "module"`，路径使用 `.js` 扩展名 |

### 4.3 评分

| 维度 | 分数 | 判定 |
|------|------|------|
| 工程化约定一致性 | ⭐⭐⭐ (3/5) | tsconfig 分裂、eslint 缺失、vitest 分裂 |
| 配置文件完整性 | ⭐⭐ (2/5) | 类型测试脱节、环境变量冲突、硬编码密钥 |
| 环境依赖 | ⭐⭐⭐⭐ (4/5) | 零原生依赖，playwright 是唯一关注点 |
| 跨平台兼容性 | ⭐⭐⭐⭐⭐ (5/5) | 抽象到位，无平台锁定 |

---

## 五、问题汇总与优先级

### 🔴 阻断级（构建/测试无法通过）

| # | 问题 | 影响 |
|---|------|------|
| 1 | shared 测试引用了不存在的 v1.1 类型 | `pnpm test` (shared) 编译失败 |
| 2 | 缺少 eslint 配置文件 | `pnpm -r lint` 全部失败 |
| 3 | vitest 版本分裂 (root 4.x vs engine 2.x) | 不可预测的测试行为 |

### 🟡 高风险（可构建但不稳定）

| # | 问题 | 影响 |
|---|------|------|
| 4 | tsconfig 继承不统一（shared 未 extend base） | 配置漂移 |
| 5 | 环境变量命名不一致（MODEL vs CHAT_MODEL） | 运行时连接失败 |
| 6 | hardcoded API key 在 vitest.config.ts | 安全泄漏 + 密钥管理混乱 |
| 7 | testing 缺少 tsconfig references | 增量构建顺序不可靠 |
| 8 | engine/.env 与 root/.env 重复且冲突 | 运行时环境不确定 |

### 🟢 改善项

| # | 问题 | 影响 |
|---|------|------|
| 9 | playwright 作为生产依赖 + 无 postinstall | 部署体积大 |
| 10 | shared/testing 缺少 test 脚本 | 覆盖率盲区 |
| 11 | engines.node 无上限约束 | 未来兼容性 |
| 12 | engine 包内存在异常 packages/ 子目录 | 结构混乱 |

---

## 六、修复建议（按优先级）

### 紧急 (P0)

1. **清理 shared 测试** → 将 `types.test.ts` 对齐到当前 v2.0 类型定义，或删除过时测试重写
2. **添加 eslint 配置** → 创建 `eslint.config.mjs`，至少继承 `@typescript-eslint/recommended`
3. **统一 vitest 版本** → 将 engine 的 vitest 升级到 `^4.1.5`，或降级 root 到 `^2.1.0`，二选一

### 重要 (P1)

4. **shared tsconfig 继承 base** → 添加 `"extends": "../../tsconfig.base.json"`
5. **统一环境变量** → 确定规范命名（建议 `DEEPSEEK_API_KEY` / `DEEPSEEK_CHAT_MODEL` / `DEEPSEEK_REASONER_MODEL`），移除 engine/.env 与 root/.env 的重复
6. **移除硬编码密钥** → vitest.config.ts 仅从 `process.env` 读取，不使用 fallback 明文密钥
7. **testing 添加 references** → `{ "path": "../shared" }`
8. **合并 .env 文件** → engine/.env 与 root/.env 二选一，消除冲突

### 改善 (P2)

9. playwright 移入 devDependencies 或 optionalDependencies
10. shared 和 testing 补充 test 脚本
11. engines.node 添加上限 `"<24.0.0"` 或至少标注已测试版本
12. 清理 engine 下的异常 packages/ 子目录

---

## 七、总体评估

```
        工程化约定  ████████░░ 3/5
        配置文件    ██████░░░░ 2/5
        环境依赖    ████████░░ 4/5
        跨平台      ██████████ 5/5
        ─────────────────────
        综合        ███████░░░ 3.5/5  🟡 有条件就绪
```

**结论**：Cortex 在跨平台设计上表现优秀——零原生编译依赖、PlatformBridge 抽象到位、纯 ESM/TypeScript 技术栈。但**工程化纪律有明显短板**：tsconfig 分裂、eslint 空壳、vitest 版本冲突、v1.1 测试残留。这些问题不致命，但会在 CI 管线中集中引爆。建议在进入 Core-1 正式开发前，优先处理 3 个阻断级问题，确保 `pnpm build:check` 可以无报错通过。

---

*北斗签收。到港，一切已盘清。*
