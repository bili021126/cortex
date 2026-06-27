# CI 门禁审查报告

> 审查人：刻晴 · 玉衡
> 审查方式：静态分析（run_shell 权限未开放，通过文件扫描评估 CI 门禁执行就绪度）
> 审查范围：测试标签覆盖、编译配置、包结构完整性

---

## 一、CI 脚本概览

`scripts/ci-gate.ts` 是一个四阶段门禁脚本：

| 阶段 | 门禁步骤 | 说明 |
|------|---------|------|
| 1/4 | `tsc --noEmit` 全量类型检查 | 根 `tsconfig.json` project references |
| 2/4 | @ci 标签扫描 | 按文件首行 `// @ci: xxx` 过滤 |
| 3/4 | vitest 按包串行 | `only @ci: unit/verify/contract`，跳过 llm/integration/e2e/manual |
| 4/4 | 结果汇总 | exit 0/1 |

**引擎包特殊配置**：文件数 > 40 → 强制单线程 `--poolOptions.threads.maxThreads=1` 防 OOM。

---

## 二、测试标签覆盖率审计

### 2.1 已正确标记的测试文件（抽样）

| 文件 | @ci 标签 |
|------|---------|
| `packages/engine/tests/scheduler.test.ts` | `unit` ✅ |
| `packages/engine/tests/memory-store.test.ts` | `unit` ✅ |
| `packages/engine/tests/react-loop.test.ts` | `unit` ✅ |
| `packages/engine/tests/toolkit.test.ts` | `unit` ✅ |
| `packages/engine/tests/confirm-gate.test.ts` | `unit` ✅ |
| `packages/engine/tests/task-board.test.ts` | `unit` ✅ |
| `packages/engine/tests/agent-pool.test.ts` | `unit` ✅ |
| `packages/engine/tests/lifecycle-manager.test.ts` | `unit` ✅ |
| `packages/engine/tests/shutdown-warden.test.ts` | `unit` ✅ |
| `packages/engine/tests/meta-agent.test.ts` | `unit` ✅ |
| `packages/engine/tests/memory-pipeline.test.ts` | `unit` ✅ |
| `packages/engine/tests/skill-executor.test.ts` | `unit` ✅ |
| `packages/engine/tests/e2e/closed-loop-e2e.test.ts` | `verify` ✅ |
| `packages/engine/tests/contract/cross-pkg-cognitive-pipeline.test.ts` | `contract` ✅ |
| `packages/engine/tests/contract/cross-pkg-execution-pipeline.test.ts` | `contract` ✅ |
| `packages/engine/tests/contract/cross-pkg-governance-pipeline.test.ts` | `contract` ✅ |
| `packages/config/tests/constants.test.ts` | `unit` ✅ |
| `packages/governance/tests/smoke.test.ts` | `unit` ✅ |
| `packages/cli/tests/cli.test.ts` | `unit` ✅ |
| `packages/doctor/tests/doctor.test.ts` | `unit` ✅ |
| `packages/scheduler/tests/dispatch-edge.test.ts` | `unit` ✅ |
| `packages/shared/tests/smoke.test.ts` | `unit` ✅ |
| `packages/memory-store/tests/memory-state-machine.test.ts` | `unit` ✅ |
| `packages/memory/tests/InMemoryMemoryStore.test.ts` | `unit` ✅ |

### 2.2 未标记 @ci 的文件（标签缺失 → 默认 unit）

| 文件 | 首行 |
|------|------|
| `packages/scheduler/tests/smoke.test.ts` | `/**` JSDoc 注释块 |
| `packages/scheduler/tests/e2e.test.ts` | `/**` JSDoc 注释块 |
| `packages/memory-store/tests/e2e.test.ts` | `/**` JSDoc 注释块 |
| `packages/skill-kit/tests/core.test.ts` | `/**` JSDoc 注释块 |
| `packages/fsm-compiler/tests/compiler.test.ts` | 待确认 |
| `packages/plugin-runner/tests/plugin.test.ts` | 待确认 |

> ⚠️ **警告**：CI 脚本会输出"@ci 标签缺失"告警（渐进式推行，不断路），但建议补齐。`smoke.test.ts` 类文件应加 `// @ci: unit` 首行，防止误标记。

### 2.3 按标签分组的文件数（估算）

| @ci 标签 | 估算文件数 | CI 执行 |
|---------|-----------|---------|
| `unit` | ~150+ | ✅ 必跑 |
| `verify` | ~3-5 | ✅ 必跑 |
| `contract` | ~8-10 | ✅ 必跑 |
| `llm` | ~2 | ❌ 跳过 |
| `integration` | ~5 | ❌ 跳过 |
| `e2e` | ~8 | ❌ 跳过 |
| `manual` | ~3 | ❌ 跳过 |
| **无标签** | ~10-15 | ⚠️ 默认 unit |

---

## 三、编译配置就绪度

### 3.1 根 tsconfig.json

✅ 正确配置为 **project references** 模式，引用 27 个子包：
```
packages: memory, config, shared, notification, parser, pattern-extractor,
          tools, llm, testing, engine, cli, telemetry, fsm-compiler,
          prompt-kit, doctor, tui, governance, scheduler, platform,
          memory-store, consistency, resilience, skill-kit, logging,
          context-manager, plugin-runner
projects: pm-legacy
```

### 3.2 tsconfig.base.json

✅ 核心编译选项完整：
- `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- `strict: true`, `noUncheckedIndexedAccess: true`
- `composite: true`, `incremental: true`（增量编译支持）
- `declaration: true`, `declarationMap: true`

### 3.3 vitest 配置

✅ `vitest.workspace.ts` 存在，表明 workspace 模式已配置。
✅ 引擎包有多个 tsconfig 入口（`tsconfig.src.json`），支持 src-only 编译。

---

## 四、CI 门禁执行可行性评估

### 4.1 类型检查（阶段 1/4）

```
npx tsc --noEmit -p tsconfig.json
```

**评估**：✅ 可行。27 个子包以 project references 组织，`--noEmit` 需全量类型检查。引擎包最大（58+ 文件），但单次 `tsc --noEmit` 在 Node 24 + incremental 下应可完成。

**风险**：跨包接口变更（如 shared→多个消费方）可能导致连锁类型错误。CI 脚本的 `--force` 策略在此处无体现——但脚本使用了 `-p tsconfig.json`（根 references），会触发全量检查。

### 4.2 测试执行（阶段 3/4）

```
按包串行 vitest run --pool=threads
引擎包强制单线程（>40文件→ maxThreads=1）
```

**评估**：✅ 合理的 OOM 防护策略。按包串行 + 引擎单线程 = 内存可控。

**注意**：vitest 2.1.9 + Node 24 的 workspace 模式已知有启动问题，CI 脚本已绕过（按包串行而非 workspace 聚合）。

### 4.3 已知 CI 门禁内置检查器

@cortex/doctor 包已实现三个内置检查器：
1. **package-json** — 检查 `name`、`scripts.build`、`type: "module"` 等必填字段
2. **positioning-doc** — 检查 `PACKAGE_POSITIONING.md` 存在性
3. **test-header** — 检查测试文件首行 `// @ci:` 标注

---

## 五、审查结论

| 维度 | 状态 | 说明 |
|------|------|------|
| CI 脚本逻辑 | ✅ | 四阶段合理，OOM 防护到位 |
| @ci 标签覆盖 | ⚠️ 大部分覆盖 | 核心包（engine/config/shared）已覆盖，~10-15 个文件无首行标签 |
| 编译配置 | ✅ | tsconfig references 完整，base 配置严格 |
| 测试组织 | ✅ | 200 个测试文件，按包分目录 |
| 运行权限 | ❌ 无法执行 | Review Agent 无 run_shell 权限，静态分析确认条件就绪 |

### 5.1 未标记文件的补救建议

以下文件缺少 `// @ci:` 首行，应补齐：

```typescript
// 在文件首行（JSDoc 注释块之前）添加：
// @ci: unit
```

受影响的文件：
- `packages/scheduler/tests/smoke.test.ts`
- `packages/scheduler/tests/e2e.test.ts`
- `packages/memory-store/tests/e2e.test.ts`
- `packages/skill-kit/tests/core.test.ts`
- 其他 `packages/*/tests/` 中以 `/**` 开头的测试文件

### 5.2 一句话总结

> **CI 门禁脚本结构完整、配置就绪。200 个测试文件中核心部分已标记 @ci 标签，缺标签文件约 10-15 个（默认按 unit 处理不断路）。无阻塞性结构问题。实际执行因 run_shell 权限限制无法在当前会话运行——需通过 pnpm ci 命令在终端执行以确认退出码。**
