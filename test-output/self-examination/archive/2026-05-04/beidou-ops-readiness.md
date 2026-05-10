# 🔭 北斗运维检查报告 —— 部署就绪性 · 跨平台兼容性 · 依赖版本风险

**检查人**：北斗（南十字船队 Ops Agent）  
**检查日期**：2026-05-06  
**检查范围**：全仓源码审查（只读模式）  
**构建/测试**：未执行（环境受限，纯静态审查）

---

## 一、部署就绪性评估

### 1.1 构建管线 ✅

| 步骤 | 脚本 | 状态 |
|------|------|------|
| 安装 | `pnpm install` (workspace) | ✅ |
| 构建 | `pnpm build` → `pnpm -r build` → 各包 `tsc` | ✅ |
| 测试 | `pnpm test` → `pnpm -r test` → engine `vitest run` | ✅ |
| 类型检查 | `pnpm typecheck` → `pnpm -r typecheck` → `tsc --noEmit` | ✅ |
| Lint | `pnpm lint` → `pnpm -r lint` → `eslint src/` | ✅ |
| 集成检查 | `pnpm build:check` (build + test) | ✅ |

> 脚本齐全，但 engine 是唯一有 test 脚本的包。shared 和 testing 包无 test 脚本。

### 1.2 容器化与 CI/CD ❌

| # | 缺失项 | 严重度 | 详情 |
|---|--------|--------|------|
| 1 | **无 Dockerfile** | 🔴 高 | 无法容器化部署，无法在 K8s/Docker Compose 中编排 |
| 2 | **无 .dockerignore** | 🟡 中 | 镜像体积会包含 node_modules/、dist/、test-output/ 等冗余 |
| 3 | **无 CI/CD 配置** | 🔴 高 | 无 `.github/workflows/`、无 GitLab CI、无 Jenkinsfile |
| 4 | **无部署文档** | 🟡 中 | 无 `DEPLOY.md`、无运维手册、无启动命令说明 |
| 5 | **无健康检查** | 🟡 中 | 无 `/health` 端点、无进程监控配置（PM2 / systemd） |
| 6 | **无环境分层** | 🟡 中 | 仅单 `.env` 文件，无 dev/staging/prod 分层策略 |

### 1.3 运行时基线

| 维度 | 当前值 | 评估 |
|------|--------|------|
| Node.js | `>=20.0.0` (engines) | ✅ 现代 LTS |
| 包管理器 | pnpm `>=9.0.0`，实际 `9.15.4` | ✅ |
| 模块系统 | ESM (`"type": "module"`) | ✅ |
| TypeScript | target `ES2022`，module `Node16` | ✅ |
| 编译产物 | `dist/` (composite + incremental) | ✅ |

---

## 二、跨平台兼容性评估

### 2.1 平台抽象层 ✅

```
PlatformBridge (interface)     ← @cortex/shared
  ├── CLIAdapter (stdin/stdout) ← 唯一实现
  └── ElectronAdapter (IPC)    ← 预留接口，未实现
```

- `PlatformKind` 枚举：`CLI` / `Electron`
- `PlatformContext`：`foreground` / `idle` 状态
- CLIAdapter 使用 `node:readline` 阻塞等待用户确认
- 设计良好，平台差异完全隔离在适配器层

### 2.2 源码跨平台检查

| 检查项 | 结果 |
|--------|------|
| `process.platform` 条件分支 | ✅ 无 |
| 路径分隔符硬编码 (`\\` / `/`) | ✅ 无（MemoryStore 用 `path.dirname` + `path` 模块） |
| 原生 C++ 编译模块 (node-gyp) | ✅ 无 |
| WASM 兼容性 | ✅ `sql.js` 纯 WASM，所有平台一致 |
| Node.js 内置模块 | ✅ `fs`, `path`, `crypto`, `readline` — 全部跨平台 |
| Electron 迁移 | 🟡 `CLIAdapter.confirm()` 需替换为 `dialog.showMessageBox` |
| sql.js 文件路径 | 🟡 不同平台默认数据目录不同，需平台感知路径策略 |

### 2.3 零原生编译依赖 ✅

| 包 | 外部依赖 | 原生编译 |
|----|---------|----------|
| `@cortex/engine` | `sql.js` (WASM), `playwright` | ✅ 无 |
| `@cortex/shared` | 无 | ✅ 无 |
| `@cortex/testing` | `uuid` | ✅ 无 |

> ⚠️ `playwright` 部署时需 `npx playwright install` 下载浏览器二进制（~500MB），需在 Dockerfile 中处理。

---

## 三、依赖版本风险分析

### 3.1 🔴 高优先级风险

| 风险 | 详情 |
|------|------|
| **vitest 版本不一致** | 根 `package.json`: `"vitest": "^4.1.5"`；engine `package.json`: `"vitest": "^2.1.0"`。**主版本差 2 个**！pnpm workspace 各自安装不同版本，可能导致 engine 测试运行在意外版本下。 |
| **playwright 体积** | `^1.59.1` 是极新版本（2026 年），浏览器二进制 ~500MB/平台。Docker 镜像体积会显著膨胀。 |

### 3.2 🟡 中优先级风险

| 风险 | 详情 |
|------|------|
| **TypeScript 版本锁定** | 三个包都用 `^5.7.0`，但 semver range 允许 minor bump。若 CI 未锁定 lockfile，可能出现不一致编译。建议 pin 为 `~5.7.0`。 |
| **@types/node** | engine 用 `^22.0.0`，与 Node 20 运行时不完全匹配。风险低但建议对齐。 |
| **sql.js** | `^1.14.1` 稳定，但 WASM 文件需随包分发。构建时确认 WASM 路径可解析。 |
| **uuid** | `^10.0.0` 纯 JS，无风险。 |
| **workspace 协议** | `workspace:*` 正确使用，本地包互引用无版本冲突。 |

### 3.3 🟢 低优先级风险

| 风险 | 详情 |
|------|------|
| **pnpm 版本** | `9.15.4` 通过 `packageManager` 字段锁定，`engines.pnpm >=9.0.0` 宽松。CI 环境应确保 pnpm 版本匹配 lockfile。 |
| **lockfile 格式** | `pnpm-lock.yaml` 在版本控制中 ✅，但需 CI 中 `pnpm install --frozen-lockfile` 确保一致性。 |

### 3.4 依赖版本对照表

| 包名 | 根 | engine | shared | testing | 是否一致 |
|------|-----|--------|--------|---------|----------|
| `vitest` | `^4.1.5` | `^2.1.0` | — | — | ❌ **冲突** |
| `typescript` | — | `^5.7.0` | `^5.7.0` | `^5.7.0` | ✅ |
| `@types/node` | — | `^22.0.0` | — | — | — |
| `playwright` | — | `^1.59.1` | — | — | — |
| `sql.js` | — | `^1.14.1` | — | — | — |
| `@types/sql.js` | — | `^1.4.11` | — | — | — |
| `uuid` | — | — | — | `^10.0.0` | — |
| `@types/uuid` | — | — | — | `^10.0.0` | — |

---

## 四、综合评分

| 维度 | 分数 | 判定 |
|------|------|------|
| **源码跨平台设计** | ⭐⭐⭐⭐⭐ (5/5) | PlatformBridge 抽象到位，零原生编译依赖 |
| **构建/测试基础设施** | ⭐⭐⭐ (3/5) | 脚本完备，但 vitest 版本冲突 + 缺 CI |
| **部署配置** | ⭐⭐ (2/5) | 无 Docker、无 CI/CD、无运维文档 |
| **依赖版本健康度** | ⭐⭐⭐ (3/5) | vitest 主版本冲突是定时炸弹 |
| **WASM/原生依赖策略** | ⭐⭐⭐⭐⭐ (5/5) | 零原生编译，全 WASM |
| **部署文档** | ⭐ (1/5) | 无部署指南 |

### 总体评级：🟡 **有条件就绪 — 需修复 1 项关键问题**

---

## 五、行动建议

### 🔴 立即修复（本周内）

1. **统一 vitest 版本** — 将根 `vitest` 降级到 `^2.1.0` 与 engine 对齐，或将 engine 升级到 `^4.1.5`。执行 `pnpm install` 后验证 lockfile 只有一个 vitest 版本。
2. **创建 Dockerfile** — 多阶段构建：Node 20 slim → pnpm install --frozen-lockfile → pnpm build。包含 playwright 浏览器安装步骤。
3. **配置 CI/CD** — 至少 `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm build` → `pnpm test`。

### 🟡 近期处理（Core-1 前）

4. **编写 DEPLOY.md** — 环境要求、安装步骤、配置说明、运行命令。
5. **添加 .dockerignore** — 排除 `node_modules/`、`dist/`、`test-output/`、`.git/`、`tmp/`。
6. **锁定 TypeScript 版本** — 将三个包的 `typescript` 从 `^5.7.0` 改为 `~5.7.0`。
7. **决策物理形态 (CLI vs Electron)** — 影响 PlatformBridge 实现路径和参数校准。

### 🟢 后续规划

8. 健康检查端点 + 进程管理配置（systemd / PM2）
9. 环境分层配置（dev / staging / prod）
10. ElectronAdapter 实现（当形态决策为 Electron 时）

---

**船长结语**：船体结构坚实——PlatformBridge 抽象、零原生依赖、全 ESM 栈是过硬底子。但轮机舱有颗松动螺丝：**vitest 版本冲突**，加上缺失的 Docker/CI 基础设施。先拧紧螺丝、搭好码头，再谈远航。
