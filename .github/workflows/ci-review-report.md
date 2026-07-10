# 🔍 CI 脚本审查报告

**审查人**：刻晴（玉衡星 · Review Agent）
**审查时间**：2025 年
**审查对象**：`.github/workflows/ci.yml`

---

## 一、存在性审查 ✅

| 文件 | 状态 | 说明 |
|------|------|------|
| `.github/workflows/ci.yml` | ✅ 存在 | 唯一 CI 工作流文件 |
| `scripts/ci-gate.ts` | ✅ 存在 | 289 行，门禁核心脚本 |
| `package.json` | ✅ 存在 | 50 行 |
| `pnpm-lock.yaml` | ✅ 存在 | 4055 行，锁文件完整 |
| `packages/shared/tsconfig.json` | ✅ 存在 | 12 行 |

**结论**：CI 脚本存在，关键依赖文件齐全。通过。

---

## 二、YAML 语法审查 ✅

- **顶级结构**：`name` / `on` / `jobs` — 合法
- **缩进**：2 空格统一，无制表符混用
- **多行字符串**：`run: \|` 管道符语法正确
- **字段格式**：`uses:` / `run:` / `with:` / `env:` 格式无误
- **布尔值**：`"true"` 字符串（符合 GitHub Actions 规范，非原生 boolean）

**结论**：YAML 语法正确。通过。

---

## 三、可执行性审查 ⚠️

### 发现项 #1 — Node 版本 24 可用性风险 ⚠️ 中风险

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 24
```

**问题**：Node.js 24 截至审查时间可能尚未正式发布或作为 LTS 版本提供。`actions/setup-node@v4` 可能无法从 `node-versions` 仓库下载到 Node 24 的预构建二进制。

**缓解**：项目设置了 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"` 环境变量来强制 GitHub Actions runner 使用内置的 Node 24。但这依赖于 runner 镜像的更新节奏。

**建议**：
- 短中期：确认 GitHub Actions ubuntu-latest runner 镜像已包含 Node 24
- 长期：当 Node 24 正式 LTS 后移除此环境变量

### 发现项 #2 — pnpm 版本未显式指定 ⚠️ 低风险

```yaml
- uses: pnpm/action-setup@v4
```

**问题**：未通过 `with.version` 指定 pnpm 版本。Action 会从 `package.json` 的 `packageManager` 字段自动检测，但如果自动检测的版本与 lockfile 格式存在不兼容，可能导致 `pnpm install --frozen-lockfile` 失败。

**建议**：在 `with:` 中显式指定 pnpm 版本，例如：
```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 9
```

### 发现项 #3 — 诊断步骤可以考虑清理 🔵 低风险

步骤 5-7 包含大量诊断命令（`ls`, `readlink`, `tsc --traceResolution` 等），它们在正常构建流程中增加了 ~1-2 分钟的额外执行时间和大量日志输出。

**建议**：如果 CI 已稳定运行，考虑移除诊断步骤，或将其移至 `if: ${{ runner.debug == '1' || env.CI_DEBUG == 'true' }}` 条件步骤中。

### 发现项 #4 — 无并发/取消策略 🔵 低风险

未配置 `concurrency` 策略。当同一分支有多次 push 时，前序运行不会自动取消，可能浪费 CI 资源。

**建议**：考虑添加并发控制：
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

---

## 四、安全审查 ✅

| 检查项 | 结果 | 说明 |
|--------|------|------|
| API Key 防护 | ✅ | `DEEPSEEK_API_KEY: ""` 明确置空 |
| 第三方 Action 固定版本 | ✅ | `@v4` 固定版本，而非 `@main` |
| 无 `pull_request_target` 滥用 | ✅ | 使用标准 `pull_request` |
| 无 `GITHUB_TOKEN` 提权 | ✅ | 未设置自定义权限 |

---

## 五、最终结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 文件存在性 | ✅ **通过** | CI 脚本及所有依赖文件齐全 |
| YAML 语法 | ✅ **通过** | 语法结构正确 |
| 可执行性 | ⚠️ **有条件通过** | Node 24 版本存在可用性风险，建议验证 runner 支持情况 |
| 安全性 | ✅ **通过** | 凭据管理符合规范 |
| 可维护性 | 🔵 **建议优化** | 诊断步骤清理 + 并发策略 + pnpm 版本显式化 |

**一句话总结**：CI 能跑，架构诚实，但 Node 24 像是走在悬崖边上跳舞——好看，但摔下去不划算。
