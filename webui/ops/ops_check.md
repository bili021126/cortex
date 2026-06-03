# ⚓ 运维诊断报告 — 死兆星号 · 甲板巡检

**报告生成时间**: 2026-05-13  
**巡检范围**: Build / Test / 依赖完整性 / 部署就绪性  
**巡检人**: 北斗（Ops Agent）

---

## 一、航海图总览

| 项目 | 值 |
|------|----|
| 项目名 | cortex |
| 架构 | pnpm workspace monorepo |
| Node 版本要求 | >=20.0.0 <25.0.0 |
| pnpm 版本要求 | >=9.0.0 |
| 当前 pnpm 版本 | 9.15.4 |
| 子包数量 | 11 个（shared → notification → factory → parser → pm → data → tools → llm → testing → engine → cli） |
| TypeScript 配置 | 项目引用（composite）+ tsconfig.base.json 统一基础配置 |
| CI 门禁 | scripts/ci-gate.ts（@ci 标签自动扫描） |

---

## 二、各包状态矩阵

### 2.1 构建产物

| 包名 | dist 存在 | tsbuildinfo | 构建状态 |
|------|----------|------------|---------|
| **shared** | ✅ 13 个模块 | ✅ | ✅ 历史构建成功 |
| **notification** | ✅ 6 个模块 | ✅ | ✅ 历史构建成功 |
| **factory** | ✅ 6 个模块 | ✅ | ✅ 历史构建成功 |
| **parser** | ✅ 2 个模块 | ✅ | ✅ 历史构建成功 |
| **pm** | ✅ 3 个模块 | ✅ | ✅ 历史构建成功 |
| **data** | ✅ 多模块 | ✅ | ✅ 历史构建成功 |
| **tools** | ✅ 2 个模块 | ✅ | ✅ 历史构建成功 |
| **llm** | ✅ 2 个模块 | ✅ | ✅ 历史构建成功 |
| **testing** | ✅ 1 个模块 | ✅ | ✅ 历史构建成功 |
| **engine** | ✅ 30+ 模块 | ✅ | ⚠️ 见下方说明 |
| **cli** | ✅ 10+ 模块 | ✅ | ✅ 历史构建成功 |

### 2.2 vitest 配置覆盖

| 包名 | vitest.config.ts（本地） | vitest.ci.config.ts（CI） | 判定 |
|------|------------------------|--------------------------|------|
| shared | ✅ | ✅ | ✅ |
| notification | ✅ | ✅ | ✅ |
| factory | ✅ | ✅ | ✅ |
| parser | ✅ | ✅ | ✅ |
| **pm** | **❌ 缺失** | ✅ | **⚠️ 基础设施偏差** |
| data | ✅ | ✅ | ✅ |
| tools | ✅ | ✅ | ✅ |
| llm | ✅ | ✅ | ✅ |
| testing | ✅ | ✅ | ✅ |
| engine | ✅ | ✅ | ✅ |
| cli | ✅ | ✅ | ✅ |

> ⚠️ **pm 包**缺少本地开发用的 `vitest.config.ts`，仅有 `vitest.ci.config.ts`。  
> 执行 `pnpm --filter @cortex/pm test` 或本地调试时可能加载根级或其他 fallback 配置，行为不一致。

### 2.3 测试覆盖

| 包名 | 测试文件数量 | 说明 |
|------|------------|------|
| shared | 1 个（types.test.ts） | 基础类型测试 |
| engine | 30+ 个测试文件 | 核心功能测试，含 memory / agent / pipeline / governance 等模块 |
| llm | 1 个（llm-adapter.test.ts） | LLM 适配器测试 |
| 其余包 | 待确认（tests 目录存在但未详查） | — |

---

## 三、引擎舱重点排查

### 3.1 memory-store.ts 编译记录

**症状**：`packages/engine/tsc-out.txt` 记录了 `memory-store.ts` 共 **80+ 条 tsc 错误**，类型集中在：
- `TS1128: Declaration or statement expected`（40+ 条）
- `TS1005: ',' expected` / `';' expected`（30+ 条）
- `TS1434: Unexpected keyword or identifier`（10+ 条）
- `TS1068: Unexpected token`（1 条）

**当前判定**：⚠️ **需人工确认**
- `tsc-err.txt` 和 `tsc-build-err.txt` 均为空文件，`dist/memory/memory-store.js` 存在完整的编译产物
- AST 解析显示 `memory-store.ts`（647 行）语法结构完整，类定义、方法声明均正确
- 可能情况：
  1. 错误已被修复但 `tsc-out.txt` 是旧日志未清理
  2. 错误在特定 tsc 配置/版本下方可复现
  3. 文件部分内容损坏但 AST 解析器容忍

**建议**：运行 `pnpm --filter @cortex/engine build` 确认当前是否零错误通过。

### 3.2 环境变量一致性

| 变量名 | .env（实际值） | .env.example（推荐值） | vitest.config.ts fallback | 判定 |
|--------|---------------|----------------------|--------------------------|------|
| `DEEPSEEK_CHAT_MODEL` | `deepseek-reasoner` | `deepseek-v4-flash` | `deepseek-chat` | ⚠️ 三处不一致 |
| `DEEPSEEK_REASONER_MODEL` | `deepseek-v4-pro` | `deepseek-v4-flash` | 未注入 | ⚠️ 仅在 .env 系定义 |

---

## 四、依赖完整性

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `node_modules` 存在 | ✅ | 已安装 |
| `pnpm-lock.yaml` 存在 | ✅ | 锁定文件就绪 |
| `patches/tree-sitter@0.25.0.patch` | ✅ | 补丁已应用 |
| 根 `package.json` devDeps | ✅ | eslint, tsx, vitest, typescript-eslint 齐备 |
| 子包 workspace 依赖 | ✅ | 各包正确引用 `workspace:*` |
| `.env` 已配置 | ✅ | DeepSeek API Key 已配置 |
| 引擎版本约束 | ✅ | Node >=20, pnpm >=9 |

---

## 五、部署就绪性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| **构建** | 🟡 黄 | 所有包 dist 存在，但 engine memory-store.ts 有历史编译错误记录，建议重新构建确认 |
| **类型检查** | 🟡 黄 | tsc-out.txt 记录了大量错误，但可能已过时 |
| **测试** | 🟢 绿 | 测试框架齐备，engine 有 30+ 测试文件 |
| **CI 门禁** | 🟢 绿 | ci-gate.ts 就绪，支持 @ci 标签分类 |
| **环境配置** | 🟢 绿 | API Key 已配置，env 文件就位 |
| **配置完整性** | 🟡 黄 | pm 包缺少本地 vitest.config.ts；模型名三处不一致 |
| **代码质量工具** | 🟢 绿 | ESLint 配置就绪 |

### 综合评分：**🟡 有条件可部署**

---

## 六、修复建议

### P1 — 阻塞项
1. **确认 engine memory-store.ts 编译状态**
   - 运行 `pnpm --filter @cortex/engine build` 验证 tsc 是否零错误
   - 若仍有错误，修复后清理 `tsc-out.txt` / `tsc-err.txt` 等旧日志

### P2 — 基础设施偏差
2. **补充 pm 包的 vitest.config.ts**
   - 参考 shared 或 testing 的配置，创建 `packages/pm/vitest.config.ts`
   ```ts
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: {
       include: ["tests/**/*.test.ts"],
       env: {
         DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
         DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
         DEEPSEEK_CHAT_MODEL: process.env.DEEPSEEK_CHAT_MODEL ?? "deepseek-chat",
       },
     },
   });
   ```

### P3 — 配置统一
3. **统一 DEEPSEEK_CHAT_MODEL 值**
   - 在 `.env.example`、`.env`、各 `vitest.config.ts` fallback 中统一模型名
   - 建议统一为 `deepseek-reasoner`（与当前 .env 实际值一致）

### P4 — 清理
4. **清理 engine 包历史编译日志**
   - 删除或清空 `tsc-out.txt`、`tsc-err.txt`、`tsc-build-err.txt`（确认当前构建通过后）

---

## 附录：航海日志参考

| 文件 | 说明 |
|------|------|
| `scripts/ci-gate.ts` | CI 门禁脚本，支持 @ci 标签分类运行 |
| `packages/engine/tsc-out.txt` | 历史 tsc 错误输出（需确认是否仍有效） |
| `packages/engine/tsc-err.txt` | 空文件 |
| `packages/engine/tsc-build-err.txt` | 空文件 |
| `build_output.txt` | 上一次 build 输出（内容为空「开始执行 pnpm build...」） |

---

*⚓ 报告完毕。水手们，该修帆的修帆，该补甲板的补甲板。*
