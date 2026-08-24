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
# 启动 CLI（昔涟对话模式——需 daemon 或 CORTEX_ENABLE_CLI=1）
pnpm cortex

# 或直接运行编译产物
node packages/cli/dist/main.js
```

### 桌面端（Cyrene）

```bash
# 开发模式（构建 main + 启动 Vite + Electron 双窗：桌宠窗 + 聊天窗）
pnpm --filter @cortex/desktop dev

# 生产构建
pnpm --filter @cortex/desktop build

# 启动（需 daemon 先行：pnpm daemon）
pnpm --filter @cortex/desktop start
```

桌面端依赖本地 daemon（`packages/server`，端口 3210）提供 engine 能力——聊天流式、记忆、任务、设置均通过 daemon REST/WS 接通；无 daemon 时 UI 保持静态回退。桌宠为 Live2D（Cubism 4），支持点击穿透与托盘常驻。

### CI 门禁

```bash
npx tsx scripts/ci-gate.ts   # 标准门禁（pnpm ci 被 pnpm 内置命令占用，勿用）
npx tsx scripts/ci-gate.ts --all   # 全量门禁（含耗时测试）
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
| `pnpm cortex` | 启动 CLI 对话（昔涟，经 daemon） | `pnpm cortex` |
| `pnpm cortex doctor` | 健康诊断 | `pnpm cortex doctor` |
| `pnpm daemon` | 启动 daemon（engine 唯一宿主，REST+WS :3210） | `pnpm daemon` |

## 配置体系

| 文件 | 用途 |
|------|------|
| `packages/config/src/data/agents.json`（@deprecated） | 旧 Agent 注册表（16 Agent——新定义走 agent-manifests） |
| `packages/config/src/data/agent-manifests.json` | Agent 唯一真相源（18 条目，含双 strategist） |
| `packages/config/src/data/cognition.json` | 认知配置（激活矩阵 + 注意力策略） |
| `packages/config/src/data/models.json` | 模型注册（deepseek-v4-flash / pro 能力声明） |
| `packages/config/src/data/*.json` | 其余配置域（共 18 域） |
| `cortex-docs.json` | 文档治理注册表 |
| `prompts/` | 16 个角色人格资产 |
| `skills/` | 26 个技能模板 JSON |
| `.env` | 环境变量（API Key 等） |

## 常见问题

**Q: `pnpm cortex` 启动后没反应？**
A: CLI 已冻结（daemon 唯一宿主）——先启动 `pnpm daemon`；临时启用 CLI 入口需 `CORTEX_ENABLE_CLI=1`。

**Q: 桌面端聊天无响应？**
A: 确认 daemon 已启动（`pnpm daemon`），且 `.env` 配置了 `DEEPSEEK_API_KEY`。

**Q: `pnpm build` 报错？**
A: 运行 `pnpm install` 确认依赖已安装，再试 `pnpm build`。

**Q: 如何查看所有可用命令？**
A: 查看 `package.json` 的 `scripts` 字段，或运行 `pnpm run`。
