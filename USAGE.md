# Cortex — 使用指南

> 快速上手 Cortex 自治理 AI Agent 运行时。

---

## 前置要求

| 工具 | 最低版本 | 验证 |
|------|---------|------|
| Node.js | >= 20.0.0 | `node --version` |
| pnpm | >= 9.0.0 | `pnpm --version` |

## 安装

```bash
# 1. 克隆仓库
git clone <repo-url>
cd cortex

# 2. 安装依赖
pnpm install

# 3. 编译所有包
pnpm build
```

## 环境配置

在项目根目录创建 `.env` 文件：

```env
# LLM API Key（必需）
DEEPSEEK_API_KEY=sk-your-key-here

# 昔涟专用 Key（可选，默认复用 DEEPSEEK_API_KEY）
DEEPSEEK_CYRENE_KEY=sk-your-cyrene-key

# 搜索（可选）
BING_API_KEY=your-bing-key
```

## 启动方式

### CLI 交互模式

```bash
# 启动 CLI（昔涟对话模式）
pnpm cli

# 或直接运行编译产物
node packages/cli/dist/main.js
```

### CI 门禁

```bash
pnpm ci          # 标准门禁（构建 + 类型检查 + 测试 + Lint）
pnpm ci:all      # 全量门禁（含耗时测试）
pnpm self-exam   # 软约束自审视
```

### 开发工作流

```bash
# 单包开发（以 engine 为例）
pnpm --filter @cortex/engine dev

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
pnpm test:workspace   # 全工作区测试
```

## CLI 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `pnpm cli` | 启动 CLI 对话（昔涟） | `pnpm cli` |
| `pnpm cortex` | 直接运行编译产物 | `pnpm cortex` |
| `node packages/cli/dist/main.js doctor` | 健康诊断 | `pnpm cortex doctor` |

## 配置体系

| 文件 | 用途 |
|------|------|
| `cortex-agents.json` | Agent 注册表——14 种 Agent 的完整声明 |
| `cortex-cognition.json` | 认知配置——激活矩阵 + 注意力策略 |
| `cortex-docs.json` | 文档治理注册表 |
| `packages/config/src/data/*.json` | 各配置域的拆分 JSON 文件 |
| `.env` | 环境变量（API Key 等） |

## 常见问题

**Q: `pnpm cli` 启动后没反应？**
A: 确保 `.env` 中配置了 `DEEPSEEK_API_KEY`。

**Q: `pnpm build` 报错？**
A: 运行 `pnpm install` 确认依赖已安装，再试 `pnpm build`。

**Q: 如何查看所有可用命令？**
A: 查看 `package.json` 的 `scripts` 字段，或运行 `pnpm run`。
