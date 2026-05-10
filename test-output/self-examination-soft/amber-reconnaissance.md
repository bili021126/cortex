# 🗺️ 安柏侦察报告 —— 全项目扫描

> 侦察员：安柏（西风骑士团侦察骑士）
> 侦察范围：`packages/` · `docs/` · 项目根目录
> 侦察时间：2026-05-10
> 命令依据：`read_file` / `search_code` / `Get-ChildItem` 直接输出

---

## 1. 📁 目录树异常

### 1.1 ⚠️ 空目录：`packages/engine/src/__tests__/`

| 属性 | 值 |
|------|-----|
| 绝对路径 | `D:\cortex\packages\engine\src\__tests__\` |
| 内容 | **空**（`Get-ChildItem -Force` 返回空） |
| 对比 | `packages/shared/src/__tests__/` 有正常文件 `types.test.ts` (4,264B) |

**来源**: `Get-ChildItem D:\cortex\packages\engine\src\__tests__ -Force` 返回无结果项。

### 1.2 ⚠️ 残留目录 `tmp/`（.gitignore 已声明但文件仍存磁盘）

| 文件 | 大小 |
|------|------|
| `D:\cortex\tmp\memory_diff.txt` | 728 B |
| `D:\cortex\tmp\review_diff.txt` | 0 B |
| `D:\cortex\tmp\staged_meta.txt` | 18,778 B |
| `D:\cortex\tmp\staged_shared.txt` | 55,282 B |
| `D:\cortex\tmp\unstaged_meta.txt` | 31,928 B |
| `D:\cortex\tmp\unstaged_shared.txt` | 76,100 B |
| **合计** | **~182 KB** |

**来源**: `Get-ChildItem D:\cortex\tmp -File`。

### 1.3 ℹ️ `packages/engine/src/__tests__/` vs `packages/shared/src/__tests__/`

- `shared/src/__tests__/types.test.ts` — 4,264B，正常
- `engine/src/__tests__/` — 空目录，无文件

---

## 2. 🗑️ 临时文件残留

### 2.1 ❌ `D:\cortex\test-tmp.txt` — 55,292 B

| 属性 | 值 |
|------|-----|
| 绝对路径 | `D:\cortex\test-tmp.txt` |
| 大小 | **55,292 B** (~55 KB) |
| 最后写入 | 2026-05-10 22:25 |
| .gitignore 覆盖 | **否** |
| 内容特征 | 二进制混杂文本，为 `vitest run` 的 stdout/stderr 混合输出日志 |

**来源**: `Get-ChildItem -File` 返回 Length=55292；`read_file` 解码显示 vitest 测试输出。

### 2.2 ❌ `D:\cortex\packages\engine\test-tmp.txt` — 2 B

| 属性 | 值 |
|------|-----|
| 绝对路径 | `D:\cortex\packages\engine\test-tmp.txt` |
| 大小 | **2 B** |
| .gitignore 覆盖 | **否** |
| 内容 | 纯文本 `ok` |

**来源**: `Get-ChildItem` 返回 Length=2；`read_file` 返回 "ok"。

### 2.3 ℹ️ `tmp/` 目录文件（已在 §1.2 列出）

.gitignore 已声明 `tmp/`，但文件仍残留在磁盘上。

---

## 3. 📦 文件膨胀区

### 3.1 文档膨胀

| 文件 | 大小 | 备注 |
|------|------|------|
| `D:\cortex\docs\meso-lite\Cortex Meso 阶段——概念设计落地产出文档.md` | **192,773 B** | ~193 KB，最大文档 |
| `D:\cortex\docs\Cortex 概念顶层设计 v1.1-已废弃.md` | **100,626 B** | ~101 KB，**已废弃** |
| `D:\cortex\docs\Cortex 概念顶层设计 v2.5.md` | 24,573 B | |
| `D:\cortex\docs\meso-lite\议题三-功能的抽象与具体设计.md` | 37,447 B | |
| `D:\cortex\docs\meso-lite\议题五-项目演进阶段与执行策略.md` | 37,467 B | |
| `D:\cortex\docs\meso-lite\议题七-全系统横向关切设计细则.md` | 32,577 B | |

**来源**: `Get-ChildItem D:\cortex\docs -Recurse -File`。

### 3.2 源码膨胀（Top 5）

| 文件 | 大小 |
|------|------|
| `D:\cortex\packages\engine\src\memory-store.ts` | **33,094 B** |
| `D:\cortex\packages\engine\src\scheduler.ts` | **24,010 B** |
| `D:\cortex\packages\engine\src\meta-agent.ts` | **17,726 B** |
| `D:\cortex\packages\engine\src\llm-adapter.ts` | **17,387 B** |
| `D:\cortex\packages\engine\src\toolkit.ts` | **14,301 B** |

**来源**: `Get-ChildItem D:\cortex\packages\engine\src\ -Filter "*.ts" -Recurse | Sort Length`。

### 3.3 运行时产物膨胀（磁盘占用）

| 位置 | 总大小 | 说明 |
|------|--------|------|
| `D:\cortex\.cortex\` | **~1.4 MB** | LLM 缓存 + SQLite DB 文件 |
| `D:\cortex\packages\engine\.cortex\` | **~1.2 MB** | LLM 缓存 + 多数据库文件 |
| `D:\cortex\tmp\` | **~182 KB** | 临时 staging 文件 |

**来源**: `Get-ChildItem` 递归汇总。

---

## 4. 🛡️ .gitignore 完整性审计

审计基准：`D:\cortex\.gitignore`（199 B，仅此一份，子包无独立 .gitignore）

### 4.1 ❌ 未覆盖的目录/文件

| 路径 | 类型 | 风险 |
|------|------|------|
| `test-output/` | 目录 | ⚠️ **高** — 含大量自我审查产出报告 |
| `webui/` | 目录 | ⚠️ **中** — 含 `calculator.js`(25B), `test.html`(5.3KB) |
| `doc-govern/`（根目录） | 目录 | ⚠️ **中** — 含 `committee_sessions.json`(43KB) |
| `packages/engine/doc-govern/` | 目录 | ⚠️ **低** — 含 `committee_sessions.json`(1.5KB) |
| `test-tmp.txt`（根目录） | 文件 | ⚠️ **高** — 55KB 测试日志 |
| `packages/engine/test-tmp.txt` | 文件 | ⚠️ **低** — 2B 标记文件 |

**来源**: `.gitignore` 内容逐行对比 `Get-ChildItem -File -Directory` 结果。

### 4.2 ✅ 已覆盖的项

| 模式 | 匹配路径 | 状态 |
|------|----------|------|
| `node_modules/` | 根 + 各包 | ✅ |
| `dist/` | 根 + `packages/*/dist/` | ✅ |
| `*.tsbuildinfo` | `packages/*/tsconfig.tsbuildinfo` | ✅ |
| `.cortex/` | 根 + `packages/engine/.cortex/` | ✅ |
| `tmp/` | 根 `tmp/` | ✅（文件仍存磁盘但 git 忽略） |
| `.env` / `*.env` | `.env` / `.env.example` | ✅ |

### 4.3 ⚠️ 边界情况：`packages/shared/dist/__tests__/`

`packages/shared/dist/__tests__/types.test.js` + `.d.ts` + `.js.map` + `.d.ts.map` 也被构建产出。
虽然 `dist/` 被 .gitignore 覆盖，但测试文件被构建到 dist 中，属于不必要的构建产物膨胀。

**来源**: `Get-ChildItem D:\cortex\packages\shared\dist -Recurse -File`。

---

## 5. 🧩 被遗忘的导出模块

### 5.1 ❌ `browser-agent.ts` — 完全孤立

| 属性 | 值 |
|------|-----|
| 绝对路径 | `D:\cortex\packages\engine\src\browser-agent.ts` |
| 大小 | 8,327 B（186 行） |
| 导出类 | `BrowserAgent` (extends `BaseAgent`) |
| 是否被 `packages/engine/src/index.ts` 导出 | **❌ 否** |
| 是否被其他源码 import | **❌ 否**（`search_code("browser-agent")` 仅匹配旧报告文件） |

**来源**: 
- `read_file` 确认 index.ts 的 export 列表不含 `browser-agent`
- `search_code("from.*browser-agent")` 返回无匹配
- `search_code("browser-agent")` 仅匹配 `test-output/` 下的历史报告

### 5.2 ℹ️ `base-agent.ts` — 内部依赖但未公开导出

| 属性 | 值 |
|------|-----|
| 绝对路径 | `D:\cortex\packages\engine\src\base-agent.ts` |
| 大小 | 8,259 B |
| 导出类 | `BaseAgent` |
| 是否被 index.ts 导出 | **否**（合理，属于抽象基类不公开） |
| 被内部引用 | ✅ 被 8 个 Agent 文件 import |

**结论**：`base-agent.ts` 不公开导出是合理的架构设计，非异常。

### 5.3 对比：index.ts 导出覆盖度

| src 文件 | 是否在 index.ts 导出 |
|----------|---------------------|
| `code-agent.ts` | ✅ |
| `review-agent.ts` | ✅ |
| `analysis-agent.ts` | ✅ |
| `ops-agent.ts` | ✅ |
| `loop-agent.ts` | ✅ |
| `doc-govern-agent.ts` | ✅ |
| `butler-agent.ts` | ✅ |
| `inspector-agent.ts` | ✅ |
| `meta-agent.ts` | ✅ |
| `scheduler.ts` | ✅ |
| `task-board.ts` | ✅ |
| `agent-pool.ts` | ✅ |
| `confirm-gate.ts` | ✅ |
| `pipeline-observer.ts` | ✅ |
| `file-lock-manager.ts` | ✅ |
| `toolkit.ts` | ✅ |
| `llm-adapter.ts` | ✅ |
| `cli-adapter.ts` | ✅ |
| `memory-store.ts` | ✅ |
| `react-helper.ts` | ✅（仅 `runReActLoop`） |
| **`browser-agent.ts`** | **❌ 未导出** |
| `base-agent.ts` | 未导出（合理） |

**来源**: `read_file("packages/engine/src/index.ts")` 逐行对照 `Get-ChildItem` 的 src 文件列表。

---

## 6. 🔍 附：编译 & 测试事实

### 6.1 `tsc --noEmit` 失败

命令输出显示 tsc 打印了帮助信息（exit 1），**未实际执行编译检查**。
原因推测：当前工作目录下无可用的 `tsconfig.json`（根目录仅有 `tsconfig.base.json`，子包 `tsconfig.json` 在 `packages/*/` 下）。

### 6.2 `tsx test/calculator.test.ts` 失败

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\cortex\test\calculator.test.ts'
```

文件 `test/calculator.test.ts` **不存在**。测试命令指向了不存在的文件路径。

---

## 7. 📋 发现汇总

| # | 类别 | 严重度 | 简述 |
|---|------|--------|------|
| 1 | 目录树异常 | 🟡 低 | `packages/engine/src/__tests__/` 为空目录 |
| 2 | 临时文件残留 | 🔴 高 | `D:\cortex\test-tmp.txt`（55KB）未被 gitignore 覆盖 |
| 3 | 临时文件残留 | 🟡 中 | `D:\cortex\packages\engine\test-tmp.txt`（2B）未被 gitignore 覆盖 |
| 4 | 临时文件残留 | 🟢 信息 | `tmp/` 目录 6 文件（182KB）存磁盘，但 git 已忽略 |
| 5 | 文件膨胀 | 🟢 信息 | `memory-store.ts`（33KB）/ `scheduler.ts`（24KB）为最大源文件 |
| 6 | 文件膨胀 | 🟢 信息 | `docs/meso-lite/` 综合产出文档 193KB，含已废弃文档 101KB |
| 7 | .gitignore 缺失 | 🔴 高 | `test-output/` 未被 .gitignore 覆盖 |
| 8 | .gitignore 缺失 | 🟡 中 | `webui/` 未被 .gitignore 覆盖 |
| 9 | .gitignore 缺失 | 🟡 中 | `doc-govern/`（根目录）未被 .gitignore 覆盖 |
| 10 | 被遗忘的导出 | 🔴 高 | `browser-agent.ts`（8.3KB）存在于 src 但未被 index.ts 导出，且无任何源码引用 |

**侦察完毕。以上每条结论均可追溯至具体的 `read_file` / `search_code` / `Get-ChildItem` 调用输出。**
