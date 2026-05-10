# 🔭 文件系统审视报告 — 安柏 (Inspector)

> 侦察日期：2025-07-18  
> 侦察范围：项目根目录全量扫描（排除 `node_modules/`、`dist/`、`*.tsbuildinfo`）  
> 方法：`list_files` + `read_file` + 人工交叉比对

---

## 一、顶层结构一览

```
cortex/
├── .cortex/          [运行时产物，gitignore]
├── .env              [密钥，gitignore]
├── .gitignore
├── doc-govern/       [治理委员会会话记录]
├── docs/             [设计文档]
├── node_modules/     [依赖]
├── package.json      [monorepo 根]
├── packages/         [代码包]
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── test-output/      [审视/测试输出]
├── tmp/              [临时暂存区]
├── tsconfig.base.json
└── webui/            [简易 Web 前端]
```

**观察**：
- 根目录清爽，仅 13 个条目，职责分明。
- `.cortex/` 是 MemoryStore 的 SQLite 数据库落点（`memory.db`、`memory-self-exam.db`、`memory-browser.db` 等），已被 `.gitignore` 排除。
- `tmp/` 含 `staged_*.txt` / `unstaged_*.txt` — 疑似 git diff 暂存快照，非持久资产。
- `webui/` 仅有 `calculator.js` + `test.txt`，是最小化的 Web 测试页。

---

## 二、packages/ — 代码三包结构

### 2.1 packages/shared — 协议层

```
shared/src/
└── index.ts    (约 280 行，单文件)
```

**内容**：所有跨包共享的类型定义与常量 —— `AgentType` 枚举、`Agent` 接口、`TaskNode`、`MemoryEntry`、`MemoryQuery`、工具权限表、确认门接口、平台桥接口、LLM 协议等。

**评估**：
- ✅ 单文件桶导出，零依赖，结构极简。
- ✅ 类型覆盖面全：Agent → TaskBoard → Memory → LLM → Platform，一应俱全。
- ⚠️ 单文件近 300 行，若持续膨胀可考虑拆分为 `types/agent.ts`、`types/memory.ts` 等子模块。

### 2.2 packages/engine — 核心引擎

```
engine/src/  (24 个源文件)
├── index.ts              # 桶导出
├── agent-pool.ts         # Agent 池
├── base-agent.ts         # Agent 基类
├── meta-agent.ts         # 元 Agent（任务规划）
├── butler-agent.ts       # 管家 Agent
├── code-agent.ts         # 代码 Agent
├── review-agent.ts       # 审查 Agent
├── analysis-agent.ts     # 分析 Agent
├── browser-agent.ts      # 浏览器 Agent
├── inspector-agent.ts    # 检查 Agent
├── doc-govern-agent.ts   # 文档治理 Agent
├── loop-agent.ts         # 循环 Agent
├── ops-agent.ts          # 运维 Agent
├── memory-store.ts       # 记忆存储
├── task-board.ts         # 任务板
├── scheduler.ts          # 调度器
├── tool-registry.ts      # 工具注册
├── toolkit.ts            # 工具集
├── file-lock-manager.ts  # 文件锁
├── pipeline-observer.ts  # 流水线观察器
├── confirm-gate.ts       # 确认网关
├── cli-adapter.ts        # CLI 适配器
├── llm-adapter.ts        # LLM 适配器
└── react-helper.ts       # ReAct 循环辅助

engine/tests/
├── 18 个 *.test.ts       # 自动化测试
└── manual/               # 9 个手动 E2E 脚本
```

**评估**：
- ✅ 9 种 Agent 各一文件，命名一致（`{type}-agent.ts`），易于定位。
- ✅ 核心设施（Scheduler、TaskBoard、MemoryStore、Toolkit、ConfirmGate）各一文件，职责不重叠。
- ✅ 测试覆盖 18 个模块，结构完整。
- ⚠️ `string-utils.ts` 在 scan-report 中提到但 `/src` 下未发现——可能在别处或已移除。
- ⚠️ 手动测试 9 个脚本全部位于 `tests/manual/`，但无 README 说明运行方式（需读源码头部注释）。

### 2.3 packages/testing — 测试工具包

```
testing/src/
└── index.ts    (约 120 行)
```

**内容**：`syntheticTaskNode()`、`syntheticTaskTree()`、`generateSyntheticMemories()` 等 Mock 数据生成器。

**评估**：
- ✅ 职责单一：仅提供合成测试数据。
- ⚠️ 依赖 `uuid` 包——是 testing 包唯一的运行时依赖。
- ⚠️ 实际测试文件全部在 `packages/engine/tests/` 下，testing 包本身无测试——自身质量靠 engine 的测试间接验证。

---

## 三、docs/ — 设计文档

### 3.1 docs/core/ — 核心设计 (11 份文档)

| 文档 | 类型 |
|------|------|
| `Cortex 概念顶层设计 v2.0.md` | 现行架构 |
| `Cortex 概念顶层设计 v1.1-已废弃.md` | 历史参考 |
| `Agent标签词汇表-v2.0.md` | 规范 |
| `Core 阶段治理机制概念讨论.md` | 治理设计 |
| `Core-1-第四轮-记忆系统设计反思与工程教训.md` | 复盘 |
| `Core-1-终局反思-实践心得与经验教训.md` | 复盘 |
| `Core-1模型版本锁定决策.md` | 决策记录 |
| `Core-1重构计划与测试策略.md` | 计划 |
| `Meso文档-v2.0宪法修正附录.md` | 宪法修订 |
| `v1.1-关键设计理念保留.md` | 理念传承 |
| `v2.0-治理架构深化讨论.md` | 治理深化 |
| `事件总线宪法定位审查报告-v1.1历史.md` | 历史审查 |
| `功能柱降级修正方案-v1.1历史.md` | 历史修正 |

### 3.2 docs/meso-lite/ — Meso-Lite 阶段 (15 份文档)

涵盖技术选型、项目形态演进、功能抽象、记忆系统、交互协议、横向关切、交付验收、修宪预备等完整工程化议题。

**评估**：
- ✅ 文档层次清晰：core（概念/宪法） → meso-lite（工程落地）。
- ✅ 废弃文档显式标注（`v1.1-已废弃`），不会混淆。
- ✅ 复盘/反思文档充分，有 3 份专门的教训记录。
- ⚠️ `test.html` 置于 `docs/` 根目录而非 `webui/`，与设计文档混放——建议迁移。
- ⚠️ 文档总大小未检查（部分可能超过 500KB 限制），但审视实验的文件限制在此不适用。

---

## 四、隐藏/运行时目录

### 4.1 .cortex/ — Cortex 运行时产物

```
.cortex/
├── conversation-学术研讨会.db
├── e2e-output/
│   └── vitest-report.json
├── memory-browser.db
├── memory-self-exam.db
├── memory.db
└── shared-meeting.db
```

- 5 个 SQLite 数据库，对应不同 MemoryStore 实例或不同运行场景。
- `e2e-output/` 含一个 vitest 报告（与本审视实验的 `.cortex/e2e-output/` 写约束对应）。
- ✅ `.gitignore` 已排除，不会误提交。

### 4.2 test-output/ — 审视/测试输出

```
test-output/
└── self-examination/
    ├── beidou-deploy-readiness.md
    ├── beidou-ops-readiness.md
    ├── deployment-readiness-cross-platform-assessment.md
    └── scan-report.md
```

- 当前 4 份审视报告，来自北斗和跨平台评估。
- 本文件（`amber-filesystem-inspect.md`）将作为第 5 份加入。

### 4.3 tmp/ — 临时暂存

```
tmp/
├── review_diff.txt
├── staged_meta.txt
├── staged_shared.txt
├── unstaged_meta.txt
└── unstaged_shared.txt
```

- 疑似 `git diff --staged/unstaged` 的输出快照。
- ⚠️ 无 `.gitignore` 规则覆盖——可能被误提交。建议加入 `.gitignore` 或清理。

---

## 五、配置文件

| 文件 | 角色 |
|------|------|
| `package.json` | monorepo 根，pnpm workspace，vitest |
| `pnpm-workspace.yaml` | `packages/*` |
| `tsconfig.base.json` | ES2022 + Node16 模块 + strict |
| `.gitignore` | 覆盖 `.env` / `node_modules/` / `dist/` / `.cortex/` |

**评估**：
- ✅ TypeScript strict 模式开启，无妥协。
- ✅ pnpm workspace 配置正确，三包隔离。
- ⚠️ `package.json` 缺少 `"type": "module"`——但 tsconfig 指定了 Node16 模块解析，实际靠 `.js` 扩展名在 import 中驱动 ESM。需确认构建输出一致。
- ⚠️ 无 ESLint/Prettier 配置（`lint` 脚本存在但未在根 `package.json` 中定义具体工具）。

---

## 六、文件系统健康度评估

| 维度 | 评分 | 备注 |
|------|------|------|
| 目录结构 | ⭐⭐⭐⭐⭐ | 三包 + docs + 运行时产物，边界清晰 |
| 命名一致性 | ⭐⭐⭐⭐ | Agent 文件命名统一；文档含版本标注 |
| 配置完整性 | ⭐⭐⭐⭐ | TS strict、pnpm workspace 正确；缺少 linter 配置 |
| 废弃物管理 | ⭐⭐⭐ | `tmp/` 未 gitignore；`docs/test.html` 位置不当 |
| 测试组织 | ⭐⭐⭐⭐ | 18 个自动化 + 9 个手动，覆盖充分但手动测试缺 README |
| 记忆/运行时隔离 | ⭐⭐⭐⭐⭐ | `.cortex/` 正确排除，多 DB 实例隔离 |

---

## 七、发现与建议

1. **`tmp/` 目录风险**：未受 `.gitignore` 保护，可能意外提交 diff 快照。建议添加 `tmp/` 到 `.gitignore` 或建立清理机制。

2. **`docs/test.html` 孤儿**：设计文档目录中混入测试页面。建议移至 `webui/` 或标记用途。

3. **`packages/shared/src/index.ts` 膨胀预警**：近 300 行单文件。若持续增长，建议按领域拆分为 `agent.ts`、`memory.ts`、`task.ts`、`llm.ts`。

4. **`packages/testing` 无自测**：作为测试工具包，自身无测试文件。建议至少添加 `types.test.ts` 验证合成数据生成器的输出形状。

5. **手动测试文档缺口**：`tests/manual/` 下 9 个脚本仅靠文件头注释说明用法，无索引 README。建议添加 `tests/manual/README.md`。

6. **Linter 配置缺失**：根 `package.json` 有 `lint` 脚本但未指定工具（ESLint/Biome）。类型检查有 `typecheck`，代码风格检查缺失。

---

> 🔭 *侦察完成。文件系统整体健康，结构清晰，6 条建议均为可优化项，无阻塞性问题。*
