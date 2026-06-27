# Typecheck 审查报告

## 一、项目根目录文件清单（关键文件识别）

### CI 脚本
| 文件 | 路径 |
|------|------|
| CI 工作流 | `.github/workflows/ci.yml` |

### 关键配置文件
| 类别 | 文件 |
|------|------|
| 包管理 | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc` |
| TypeScript 编译 | `tsconfig.json`, `tsconfig.base.json` |
| Lint | `eslint.config.mjs` |
| 测试 | `vitest.workspace.ts`, `vitest.workspace.js`, `vitest.workspace.d.ts` |
| 环境 | `.env`, `.env.example` |
| 版本控制 | `.gitignore`, `.gitmodules` |
| 项目核心 | `cortex-agents.json`, `cortex-cognition.json`, `cortex-docs.json` |

### 子包一览（packages/ 共 26 个子包）
```
cli, config, consistency, context-manager, doctor, engine,
fsm-compiler, governance, llm, logging, memory, memory-store,
notification, parser, pattern-extractor, platform, plugin-runner,
prompt-kit, resilience, scheduler, shared, skill-kit,
telemetry, testing, tools, tui
```

---

## 二、typecheck 命令配置分析

### 根级命令（package.json）
```
"typecheck": "pnpm -r typecheck"
```
→ 递归执行所有子包的 typecheck 脚本。

### 子包 typecheck 命令示例
| 包 | 实际命令 |
|------|---------|
| `@cortex/shared` | `tsc`（使用 tsconfig.json） |
| `@cortex/engine` | `tsc -p tsconfig.src.json` |

共 26 个子包，每个都定义了 `typecheck` 脚本 = `tsc`（或 `tsc -p tsconfig.src.json`）。

### TypeScript 编译配置（tsconfig.base.json）
```
target: ES2022
module: Node16
moduleResolution: Node16
strict: true
composite: true
incremental: true
noUncheckedIndexedAccess: true
```

### 根 tsconfig.json 引用（composite build 拓扑）
按编译顺序引用了 27 个 project references，涵盖所有子包。

---

## 三、typecheck 执行结果

**状态：❌ 无法执行**

当前工具集不支持运行 shell 命令（无 `run_shell` 工具）。无法实际执行 `pnpm -r typecheck` 或 `npx tsc --noEmit` 来捕获 stdout/stderr 及退出码。

**建议：**
1. 手动在终端中运行 `pnpm typecheck` 或 `npx tsc -b --noEmit` 来验证
2. 或使用 CI（`.github/workflows/ci.yml`）的 `pnpm tsx scripts/ci-gate.ts` 门禁检查

---

## 四、CI 门禁流程（ci.yml 摘要）

CI 包含 5 个诊断步骤 + 最终门禁：
1. `pnpm install --frozen-lockfile`
2. 诊断 workspace 链接
3. 诊断 config 构建
4. 诊断 tsc 编译范围
5. 运行 `pnpm tsx scripts/ci-gate.ts`
   - 包含构建 + 类型检查 + 单元测试 + Lint
