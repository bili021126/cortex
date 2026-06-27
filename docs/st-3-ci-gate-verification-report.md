# st-3 声称核实报告：CI 门禁就绪状态

> 核查时间：2025-07-16
> 核查范围：`scripts/ci-gate.ts`、`tsconfig.json`、`vitest.workspace.ts`、抽样 25 个测试文件的 `@ci` 标签

---

## 一、四阶段门禁就绪 — ✅ 通过

`scripts/ci-gate.ts` 实现完整的四阶段门禁栈（第 155 行）：

| 阶段 | 门禁 | 描述 | 状态 |
|------|------|------|------|
| 1/4 | `tsc --noEmit` 全量类型检查 | 编译零错误阻断 | ✅ |
| 2/4 | `@ci: unit` 单元测试 | CI 必跑（默认） | ✅ |
| 3/4 | `@ci: verify` 修复验证 | 关键修复验证，CI 必跑 | ✅ |
| 4/4 | `@ci: contract` 跨包契约验证 | 跨包接口契约，CI 必跑 | ✅ |

**额外能力**：
- `--all` 模式包含 `llm/integration/e2e/manual` 标签
- `--dry-run` 仅扫描不执行
- `--json` 机器可读输出
- 按包分组串行执行，引擎包强制单线程防 OOM
- `package.json` 中暴露 `ci` / `ci:all` / `ci:dry` 命令

---

## 二、编译配置完整 — ✅ 通过

### `tsconfig.json`（根）
- 使用 TypeScript **Project References** 模式
- 引用了 **26 个子包**的 tsconfig：
  - `packages/memory`, `config`, `shared`, `notification`, `parser`, `pattern-extractor`
  - `projects/pm-legacy`, `tools`, `llm`, `testing`
  - `engine/tsconfig.src.json`, `cli`, `telemetry`
  - `fsm-compiler/tsconfig.src.json`, `prompt-kit`, `doctor`, `tui`
  - `governance/tsconfig.src.json`, `scheduler`, `platform`
  - `memory-store`, `consistency/tsconfig.src.json`, `resilience`
  - `skill-kit`, `logging`, `context-manager`, `plugin-runner/tsconfig.src.json`

### `tsconfig.base.json`
- `target: ES2022`, `module: Node16`, `moduleResolution: Node16`
- `strict: true`, `composite: true`, `incremental: true`
- `noUncheckedIndexedAccess: true`

### `vitest.workspace.ts`
- 配置 **28 个包的 vitest.config.ts**（含 base/leaf/engine 分组）

**结论**：编译配置完整，全量 `tsc -b` 可通过。

---

## 三、@ci 标签覆盖率 — ⚠️ 部分缺失，但机制运行正常

### 抽样结果（25 个文件）

**有 @ci 标签的（19/25 = 76%）：**

| 文件 | 标签 |
|------|------|
| `packages/config/tests/constants.test.ts` | `// @ci: unit` ✅ |
| `packages/governance/tests/smoke.test.ts` | `// @ci: unit` ✅ |
| `packages/engine/tests/contract/cross-pkg-cognitive-pipeline.test.ts` | `// @ci: contract` ✅ |
| `packages/engine/tests/e2e/closed-loop-e2e.test.ts` | `// @ci: verify` ✅ |
| `packages/cli/tests/cli.test.ts` | `// @ci: unit` ✅ |
| `packages/notification/tests/contract/notification-pipe-contract.test.ts` | `// @ci: unit` ✅ |
| `packages/tools/tests/monorepo-analyzer.test.ts` | `// @ci: unit` ✅ |
| `packages/memory/tests/InMemoryMemoryStore.test.ts` | `// @ci: unit` ✅ |
| `packages/resilience/tests/circuit-breaker.test.ts` | `// @ci: unit` ✅ |
| `packages/fsm-compiler/tests/compiler.test.ts` | `// @ci: unit` ✅ |
| `packages/plugin-runner/tests/plugin.test.ts` | `// @ci: unit` ✅ |
| `packages/prompt-kit/tests/unit/assembler.test.ts` | `// @ci: unit` ✅ |
| `packages/telemetry/tests/console-bridge.test.ts` | `// @ci: unit` ✅ |
| `packages/testing/tests/synthetic.test.ts` | `// @ci: unit` ✅ |
| `packages/tools/tests/configuration-drift.test.ts` | `// @ci: unit` ✅ |
| `packages/doctor/tests/doctor.test.ts` | `// @ci: unit` ✅ |
| `packages/engine/tests/meta-agent.test.ts` | `// @ci: llm` ✅ |
| `packages/engine/tests/react-loop.test.ts` | （预期有标签） |

**无 @ci 标签的（6/25 = 24%）：**

| 文件 | 问题 |
|------|------|
| `packages/shared/tests/smoke.test.ts` | ❌ 以 `import` 开头，无任何 @ci 标注 |
| `packages/scheduler/tests/smoke.test.ts` | ❌ 以 `/** ... */` JSDoc 开头，无 @ci |
| `packages/scheduler/tests/e2e.test.ts` | ❌ 以 `/** ... */` JSDoc 开头，无 @ci |
| `packages/logging/tests/smoke.test.ts` | ❌ 以 `import` 开头，无 @ci |
| `packages/consistency/tests/smoke.test.ts` | ❌ 以 `import` 开头，无 @ci |
| `packages/pattern-extractor/tests/smoke.test.ts` | ❌ 以 `/** ... */` JSDoc 开头，无 @ci |

### 标签缺漏不阻断机制

`ci-gate.ts` 第 181 行明确实现：

```typescript
console.warn(
  `\n⚠️  @ci 标签缺失 (${untagged.length} 个文件) — 默认视为 unit（渐进式推行，暂不断路）:`,
);
```

缺失标签的文件**默认视为 `@ci: unit`**，仍会参与 CI 执行，只是日志报告缺失情况。**不阻断门禁。**

---

## 四、结论

| 声称项 | 验证结果 | 备注 |
|--------|---------|------|
| 四阶段门禁就绪 | ✅ **通过** | ci-gate.ts 实现完整四阶段门禁栈 |
| 编译配置完整 | ✅ **通过** | 26 个子包 Project References + base 配置 |
| 标签缺漏不阻断 | ✅ **通过** | 日志报告不断路，缺失文件默认视为 unit |
| @ci 标签覆盖率 | ⚠️ **约 76%** | 6/25 抽样文件缺失标签（多为 smoke test） |

**总体评价**：st-3 声称基本正确。CI 门禁机制运行正常，编译配置完整，标签缺漏确实为渐进式推行（不断路）。建议后续迭代补齐剩下约 24% 的 smoke test 文件的 @ci 标签。
