# 测试框架配置验证表

| 验证项目 | 文件路径 | 关键字段/内容 | 结果 |
|:---------|:---------|:--------------|:----:|
| **CI 配置** | `.github/workflows/ci.yml` | 触发条件：push/PR → main/master；运行环境：ubuntu-latest, Node 24, pnpm；主门禁：`pnpm tsx scripts/ci-gate.ts`；含 workspace 链接诊断、config 构建诊断、tsc 编译范围诊断步骤 | ✅ |
| **vitest workspace 引用数** | `vitest.workspace.ts` | 引用 **26** 个包的 `vitest.config.ts`（config, shared, memory, memory-store, consistency, governance, platform, scheduler, doctor, logging, fsm-compiler, llm, notification, parser, pattern-extractor, plugin-runner, prompt-kit, resilience, skill-kit, telemetry, testing, tools, tui, context-manager, engine, cli） | ⚠️ 声称 27，实际 26 |
| **引擎 vitest.config.ts 完整性** | `packages/engine/vitest.config.ts` | ✅ `include: ["tests/**/*.test.ts"]`；✅ `exclude`（3 个 e2e mock 测试排除）；✅ `env`（DEEPSEEK_API_KEY/BASE_URL/CHAT_MODEL）；✅ `coverage`（v8 provider, text+html reporter, include src 排除 index.ts） | ✅ 完整 |
| **子包 vitest.config.ts 存在性** | `packages/shared/vitest.config.ts` | 存在；结构：`resolveAlias(__dirname)` + `include: ["tests/**/*.test.ts"]` + `env` 三段式 | ✅ 存在 |
| **子包 vitest.config.ts 存在性** | `packages/cli/vitest.config.ts` | 存在；结构：`resolveAlias(__dirname)` + `include: ["tests/**/*.test.ts"]` | ✅ 存在 |
| **子包 vitest.config.ts 存在性** | `packages/config/vitest.config.ts` | 存在；结构：`resolveAlias(__dirname)` + `include: ["tests/**/*.test.ts"]` | ✅ 存在 |
| **磁盘 vitest.config.ts 存量** | `packages/*/vitest.config.ts` | glob 扫描共 **26 个** vitest.config.ts，与 workspace 引用数一致 | ✅ 一致 |
| **公共基座配置** | `packages/vitest.ci.base.ts` | 导出 `resolveAlias()`（为 ALL_PKGS 25 个包生成 `@cortex/*` → `src/index.ts` alias）、`withBase()`（mergeConfig 合并基座）、以及 `ALL_PKGS` 常量列表 | ✅ 存在 |
| **CI 门禁脚本引用** | `.github/workflows/ci.yml` | 最终调用 `pnpm tsx scripts/ci-gate.ts`（非直接 vitest 调用） | ✅ 已确认 |

## 已知未修复项补充验证

| 验证项目 | 文件路径 | 验证方法 | 结果 |
|:---------|:---------|:---------|:----:|
| **幽灵包 `packages/md-to-html`** | `packages/md-to-html` | `file_info` 确认目录不存在；全仓 grep 无任何引用 | ✅ 已确认不存在——零引用幽灵包 |
| **欠导出 `modification-record.ts`** | `packages/shared/src/index.ts` | 第 19 行 `export * from "./modification-record.js";` | ✅ 已正确 barrel export——非欠导出 |
| **tools 测试 cwd 假设问题** | `packages/tools/tests/configuration-drift.test.ts` | 测试文件使用 `PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..")` 显式路径；`collectDependencies()` 无参数调用仅在 workspace root 上下文中运行 | ✅ 已通过显式路径规避——默认 `cwd()` 调用仅在 vitest workspace root 上下文中执行，风险可控 |
| **配置漂移 5 项** | `packages/tools/src/configuration-drift.ts` | 运行 `configuration-drift.ts --json` → `status: "clean"`；所有 `@cortex/*` 内部依赖统一使用 `workspace:*`；外部依赖（typescript/eslint/vitest/@types/node）跨包版本一致 | ✅ 零漂移——`check-config-drift.ts` 的 CHECKS 数组为空（Phase 5 尚待填充） |

## 差异说明

| 差异项 | 期望值 | 实际值 | 判定 |
|:-------|:-------|:-------|:----:|
| vitest.workspace.ts 引用包数 | 27 | 26 | ⚠️ 偏差 -1（需核实 task 声称的原始计数来源） |

## 结论

- 测试框架配置整体完整：CI 配置、workspace 配置、引擎配置（含 coverage）、子包配置均验证通过
- 所有 26 个包的 vitest.config.ts 存在于磁盘，与 workspace 引用一致
- 公共基座 `vitest.ci.base.ts` 提供跨包 alias 解析和合并函数，符合「配置驱动+集中管理」的设计原则
- ⚠️ workspace 引用数实为 26 而非 27，需确认 task 描述的原始计数是否有误或是否有包已移除
