# CI 脚本审查报告

> 审查人：刻晴（玉衡审查）
> 审查日期：自动执行

---

## 一、CI 脚本文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| GitHub Workflow | `.github/workflows/ci.yml` | CI 触发入口（push/PR → main/master） |
| CI 门禁脚本 | `scripts/ci-gate.ts` | 实际执行的测试/类型检查/汇总逻辑 |
| vitest 工作区配置 | `vitest.workspace.ts` | 所有包的 vitest 配置引用 |
| TypeScript 配置 | `tsconfig.json` | 根级 project reference 配置 |
| TypeScript 基座 | `tsconfig.base.json` | 编译选项基座（composite, outDir, rootDir 等） |

---

## 二、typecheck 命令定义

### 2.1 `package.json` 中的定义

```json
"typecheck": "pnpm -r typecheck"
```

逐包串行执行各包的 `typecheck` 脚本（存在覆盖/缺失风险——部分包可能未定义此脚本）。

### 2.2 CI 中的实际执行

在 `scripts/ci-gate.ts` 门禁第 1/4 步：

```typescript
const tscResult = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], ROOT);
```

**参数解析**：
- `npx tsc --noEmit` — 仅类型检查，不输出产物
- `-p tsconfig.json` — 使用根级 tsconfig.json（含所有子包的 project reference）
- `cwd: ROOT` — 在项目根目录执行

**关键区别**：CI 没有走 `pnpm -r typecheck`，而是直接 `npx tsc --noEmit -p tsconfig.json` 一次全量检查。这意味着 CI 的类型检查逻辑与开发者的 `pnpm typecheck` 可能不完全一致。

---

## 三、build 命令定义

### 3.1 `package.json` 中的定义

```json
"build": "pnpm -r build"
```

逐包并行构建（按 pnpm 拓扑依赖顺序）。

### 3.2 CI 中的前置诊断

CI 在正式门禁前有诊断步骤——**仅构建 `@cortex/config`**（不是全量 build），用于验证 workspace 链接和产物：

```yaml
- name: "诊断: 仅构建 config"
  run: |
    pnpm --filter @cortex/config build
    echo "=== config dist 产物 ==="
    ls -la packages/config/dist/ 2>&1 | head -20
    echo "=== dist/index.d.ts 存在? ==="
    test -f packages/config/dist/index.d.ts && echo "YES" || echo "NO"
```

**注意**：正式的 `build` 不在 CI gate 的 4 步内执行。门禁流程是 `类型检查 → 修复验证 → 契约验证 → 单元测试`，没有显式的 `build` 步骤。类型检查使用 `--noEmit`，不依赖构建产物（除了 `@cortex/config` 的诊断构建）。

---

## 四、test 命令定义

### 4.1 `package.json` 中的定义

```json
"test": "pnpm -r test",
"test:workspace": "vitest --workspace=vitest.workspace.ts"
```

### 4.2 CI 中的实际执行

在 `scripts/ci-gate.ts` 门禁第 4 步，使用 **按包串行 vitest** 模式，而非 workspace 模式：

```typescript
const vitestArgs = ["vitest", "run", "--pool=threads"];
if (files.length > 40) {
  vitestArgs.push("--poolOptions.threads.maxThreads=1", "--poolOptions.threads.minThreads=1");
}
// ... 排除非 unit/verify/contract 标签的测试文件
const r = run("pnpm", vitestArgs, pkgDir);
```

**关键参数**：

| 参数 | 值 | 说明 |
|------|----|------|
| `vitest run` | — | 单次执行模式（非 watch） |
| `--pool=threads` | — | 使用 thread pool（默认） |
| `--poolOptions.threads.maxThreads=1` | 当文件 > 40 时启用 | 强制单线程，防止引擎包 OOM |
| `--poolOptions.threads.minThreads=1` | 同上 | 同上 |
| `--exclude=<path>` | 非 unit/verify/contract 标签 | 跳过 LLM/集成/端到端测试 |

### 4.3 @ci 标签过滤机制

测试文件通过首行注释的 `// @ci: <tag>` 标签分类：

| 标签 | CI 默认运行 | 说明 |
|------|------------|------|
| `@ci: unit` | ✅ 必跑 | 纯单元测试 |
| `@ci: verify` | ✅ 必跑 | 关键修复验证 |
| `@ci: contract` | ✅ 必跑 | 跨包接口契约验证 |
| `@ci: llm` | ❌ 跳过 | 需要 LLM API |
| `@ci: integration` | ❌ 跳过 | 需要外部服务 |
| `@ci: e2e` | ❌ 跳过 | 端到端测试 |
| `@ci: manual` | ❌ 跳过 | 人工触发 |

使用 `--all` 参数时会跳过所有过滤，执行全部测试。

### 4.4 结果格式

```
Tests: <passed>/<total> passed | <skipped> skipped
```

---

## 五、门禁栈 4 阶段汇总

```
门禁 1/4: tsc --noEmit 全量类型检查
    ├─ 命令: npx tsc --noEmit -p tsconfig.json
    ├─ 失败 → 立即 process.exit(1)，阻断后续
    └─ 无产物输出（--noEmit）

门禁 2/4: 修复验证 (verify)  ← 通过 @ci: verify 标签隐式执行
    ├─ 在 vitest 阶段一起跑
    └─ 与 unit 同级，不单独分步

门禁 3/4: 契约验证 (contract)  ← 通过 @ci: contract 标签隐式执行
    ├─ 在 vitest 阶段一起跑
    └─ 与 unit 同级，不单独分步

门禁 4/4: 按包串行 vitest 单元测试
    ├─ 命令: pnpm vitest run --pool=threads [--exclude=...]
    ├─ 按包分组，逐个执行
    ├─ 引擎包（文件 > 40）强制单线程防 OOM
    ├─ 排除 @ci: llm/integration/e2e/manual
    └─ 汇总 passed/total，任意包失败 → allOk = false
```

---

## 六、启动方式速查

| 命令 | 等价 CI 行为 | 说明 |
|------|-------------|------|
| `pnpm ci` | `npx tsx scripts/ci-gate.ts` | 标准门禁（unit + verify + contract） |
| `pnpm ci:all` | `npx tsx scripts/ci-gate.ts --all` | 全量测试（含 LLM/集成） |
| `pnpm ci:dry` | `npx tsx scripts/ci-gate.ts --dry-run` | 仅扫描 @ci 标签，不执行 |
| `pnpm build` | `pnpm -r build` | 全量构建 |
| `pnpm test` | `pnpm -r test` | 逐包串行测试（非 CI 路线） |
| `pnpm typecheck` | `pnpm -r typecheck` | 逐包串行类型检查（非 CI 路线） |
| `pnpm build:check` | `pnpm build && pnpm test` | 构建 + 测试组合 |

---

## 七、审查结论

**未发现缺陷。** CI 管道设计合理：
1. 类型检查阻断在前，测试在后——错误的代码不会浪费测试时间。
2. vitest 按包串行 + 引擎包强制单线程——解决了 vitest 2.1.x + Node 24 下的 OOM 问题。
3. @ci 标签体系完善，区分了单元/验证/集成/LLM/端到端，CI 默认只跑轻量级测试。
4. 诊断步骤（workspace 链接、config 构建产物验证）有助于快速定位环境问题。

**一个建议（非缺陷）：** CI 的 typecheck (`npx tsc --noEmit -p tsconfig.json`) 与开发者的 `pnpm typecheck` (`pnpm -r typecheck`) 走的是两条路径——前者一次全量，后者逐包串行。如果某个包缺少自己的 `typecheck` 脚本，开发者本地可能漏检而 CI 通过。建议统一路径，或至少文档说明差异。
