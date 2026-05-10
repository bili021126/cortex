# 📋 Cortex 部署就绪性与跨平台兼容性评估

**评估者**：北斗（南十字船队）  
**评估日期**：2026-05-06  
**阶段基线**：Meso-Lite 实施完成，过渡阶段进行中

---

## 一、部署就绪性评估

### 1.1 运行时基线 ✅

| 维度 | 当前状态 | 评估 |
|------|---------|------|
| **运行时** | Node.js ≥20, pnpm ≥9 | ✅ 标准现代环境 |
| **包管理器** | pnpm workspace monorepo | ✅ 成熟方案 |
| **模块系统** | ESM (`"type": "module"`) | ✅ 符合 Node.js 生态趋势 |
| **编译构建** | TypeScript `tsc` → `dist/` | ✅ 标准流程 |
| **TypeScript** | `target: ES2022`, `module: Node16` | ✅ 现代对齐 |

### 1.2 构建与测试管线

| 步骤 | 脚本 | 存在性 |
|------|------|--------|
| 构建 | `pnpm -r build` | ✅ |
| 测试 | `pnpm -r test` (vitest) | ✅ |
| 类型检查 | `pnpm -r typecheck` | ✅ |
| Lint | `pnpm -r lint` (eslint) | ✅ |
| 集成检查 | `pnpm build:check` (build + test) | ✅ |

### 1.3 依赖分析——零原生编译依赖 ✅

| 包 | 外部依赖 | 平台兼容性 |
|----|---------|-----------|
| `@cortex/engine` | `sql.js` (WASM) + `playwright` | ✅ sql.js 纯 WASM 跨平台；playwright 需额外安装浏览器 |
| `@cortex/shared` | 无 | ✅ 纯类型/枚举定义 |
| `@cortex/testing` | `uuid` | ✅ 纯 JS |

> ⚠️ **注意**：`playwright` 在部署时需要执行 `npx playwright install` 下载浏览器二进制。在无 GUI 的服务器环境（如 CI、Docker）可安装 headless 版本，属已知操作。

### 1.4 ⚠️ 部署就绪性缺口

| # | 缺失项 | 严重度 | 说明 |
|---|--------|--------|------|
| 1 | ❌ **无 Dockerfile** | 🔴 高 | 无法容器化部署；缺少 `.dockerignore` |
| 2 | ❌ **无 CI/CD 配置** | 🔴 高 | 无 GitHub Actions / GitLab CI / Jenkins 等流水线定义 |
| 3 | ❌ **无部署文档** | 🟡 中 | 无 `DEPLOY.md`、无运维手册、无启动脚本 |
| 4 | ❌ **无健康检查/监控** | 🟡 中 | 无 `/health` 端点、无进程管理（PM2 / systemd）配置 |
| 5 | ❌ **无环境管理** | 🟡 中 | 仅 `.env` 文件，无环境分层（dev/staging/prod）策略 |
| 6 | ❌ **无配置版本管理** | 🟢 低 | `pnpm-lock.yaml` 在 git 中，但构建产物 `dist/` 未版本化 |

### 1.5 过渡阶段未完成项

根据 `docs/meso-lite/过渡阶段-交付与验收.md`，以下退出标准尚待验证：

| 待完成项 | 状态 | 影响 |
|---------|------|------|
| 3.4 500 Mock 任务压力测试 | ⬜ 未完成 | 影响 Scheduler 回归验证 |
| 4.2 50 次确认验证 | ⬜ 未完成 | ConfirmCoordinator 独立化 |
| 6.2 交融 Committee 验证 | ⬜ 未完成 | 交融机制正确性 |
| 8.1 已有测试回归 | ⬜ 未完成 | 回归验证 |
| 8.2 真实 LLM 冒烟 | ⬜ 未完成 | 端到端验证 |
| P4 物理形态决策 (CLI vs Electron) | ⬜ 未决策 | 影响多个参数校准 |

---

## 二、跨平台兼容性评估

### 2.1 平台抽象层架构 ✅

```
PlatformBridge (interface)        ← @cortex/shared
  ├── CLIAdapter (stdin/stdout)   ← 当前唯一实现
  └── ElectronAdapter (IPC)       ← 预留，未实现
```

通过 `PlatformBridge` 接口和 `PlatformKind` 枚举隔离了平台差异，设计是健康的。

### 2.2 操作系统兼容性

| 检查项 | 结果 |
|--------|------|
| `process.platform` 条件代码 | ✅ 无 |
| 路径分隔符硬编码 | ✅ 无（使用 `path` 模块或文件操作工具） |
| 原生编译模块 (node-gyp) | ✅ 无 |
| WASM 兼容性 (sql.js) | ✅ 所有现代 Node.js 均支持 |
| CLI stdin/stdout 适配 | ✅ 跨平台终端兼容 |

### 2.3 Electron 迁移兼容性

| 组件 | 当前实现 | Electron 迁移影响 |
|------|---------|-----------------|
| `CLIAdapter.confirm()` | readline stdin 阻塞 | → 需要替换为 `dialog.showMessageBox` |
| `CLIAdapter.notify()` | process.stdout | → 替换为 Notification API |
| `CLIAdapter.getPlatformContext()` | 固定返回 CLI | → 动态检测窗口状态 |
| MemoryStore (sql.js) | WASM 文件持久化 | ✅ 可复用，路径需调整为 app 沙箱目录 |
| FileLockManager | `Map<string, Promise<void>>` | ✅ 纯内存，无影响 |
| EventBus (InMemoryTransport) | 内存环形缓冲 | ✅ 纯内存，无影响 |

### 2.4 已知跨平台风险

| # | 风险 | 等级 | 说明 |
|---|------|------|------|
| 1 | **playwright 浏览器依赖** | 🟡 中 | macOS/Linux/Windows 各需独立浏览器二进制，增加部署体积 |
| 2 | **sql.js 文件路径持久化** | 🟢 低 | 不同平台默认数据目录不同，需要平台感知的路径策略 |
| 3 | **物理形态未决** | 🟡 中 | Core-1 须决定 CLI 还是 Electron——影响心跳阈值、超时窗口、确认延迟等参数校准（详见 `议题七附录.9`） |
| 4 | **CLI 形态限制** | 🟡 中 | 30天衰减回退、冷启动观察期等时间维度功能在 CLI 形态下无法连续执行 |

---

## 三、综合评分

| 维度 | 分数 | 判定 |
|------|------|------|
| **源码跨平台设计** | ⭐⭐⭐⭐⭐ (5/5) | PlatformBridge 抽象到位，无原生编译依赖 |
| **构建/测试基础设施** | ⭐⭐⭐⭐ (4/5) | 脚本完备，缺 CI 自动触发 |
| **部署配置** | ⭐⭐ (2/5) | 无 Docker、无 CI/CD、无运维文档 |
| **部署文档** | ⭐ (1/5) | 无部署指南 |
| **WASM/原生依赖策略** | ⭐⭐⭐⭐⭐ (5/5) | 零原生编译依赖，全 WASM |
| **过渡阶段完成度** | ⭐⭐⭐ (3/5) | 代码实现完成，压测与最终验证待补齐 |

### 总体评级：🟡 **有条件就绪**

---

## 四、建议行动清单

### 🔴 高优先级（部署前必做）

1. **创建 Dockerfile** — 多阶段构建，锁定 Node.js 20 slim 基础镜像，包含 playwright 浏览器安装
2. **配置 CI/CD 流水线** — GitHub Actions：`pnpm install` → `pnpm build` → `pnpm test` → `pnpm typecheck`
3. **完成过渡阶段待办项** — 3.4/4.2/6.2/8.1/8.2 的验证、压力测试与回归
4. **决策物理形态** — CLI 还是 Electron？影响 Core 阶段所有时间相关参数的校准基线

### 🟡 中优先级（Core-1 阶段规划）

5. **编写 `DEPLOY.md`** — 环境要求、安装步骤、配置说明、运行方式、常见问题
6. **实现 `ElectronAdapter`** — 当形态决策为 Electron 时，完成 PlatformBridge 的 Electron 实现
7. **添加环境层配置文件** — 区分 development / staging / production

### 🟢 低优先级

8. **添加健康检查端点** — 进程存活 + 组件状态（MemoryStore / EventBus / LLM Adapter）
9. **添加进程管理配置** — systemd unit 或 PM2 ecosystem 文件
10. **添加 `.dockerignore`** — 排除 `node_modules/`、`dist/`、`test-output/`、`.git/`

---

**评估结论**：Cortex 在**跨平台设计上优秀**——零原生编译依赖、PlatformBridge 抽象坚实、纯 TypeScript/ESM 栈。但在**部署就绪性上有明显缺口**——无容器化、无 CI/CD、无运维文档。建议在进入 Core-1 之前至少完成 Dockerfile + CI 配置两项高优先事项，否则任何环境迁移都需要人工介入，与项目的工程化目标矛盾。
