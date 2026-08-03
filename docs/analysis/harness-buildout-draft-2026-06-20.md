# Cortex Harness 补全方案（草稿 v0.1）

> 2026-06-20 · 状态：**草案，未批准，不动手**
> 目标：按最严格 harness 标准，补足 Cortex 的评测/验证基础设施差距

---

## 1. 背景

Cortex 的验证现状：**门禁能保证"代码是好的"，保证不了"Agent 是好的"**。
- 五段门禁（tsc/eslint/混沌校验/vitest/pre-commit）——✅ 有实效（CI 三连失败全是它拦的）
- 测试 3844 个（25 包）——✅ 规模在
- **评测（能力基线/回归基准/golden 集/指标体系）——❌ 零**
- **端到端真实闭环——❌ 缺**（迭代遗留 e2e 已删，无替代）
- R10 评审结论"无评测支架"、三大结构性风险"记不住/测不出/存不久"——**"测不出"即本方案**

## 2. 现状盘点（调研结论）

### 已有资产（可复用/可扩展）

| 资产 | 位置 | 状态 |
|---|---|---|
| 五段门禁 | `scripts/ci-gate.ts` | ✅ 运行中，无 bench 接入 |
| **bench-gate（性能回归门禁）** | `scripts/bench-gate.ts` | ⚠️ **存在但未接入 ci-gate；bench-memory-pipeline.test.ts 已无 BENCH_METRIC 输出——设施可能已断** |
| 手动 e2e 脚本 ×15 | `packages/engine/tests/manual/e2e/` | ✅ 带 `@e2e/@covers/@cost/@overlap` 元数据——**评测任务的雏形** |
| 遥测指标收集 | `@cortex/telemetry` | ✅ 指标管道基建 |
| 压力工具 | `scripts/amendment-stress.ts`、`confirmgate-stress.ts` | ✅ 单点压力验证 |
| 测试模型定死 | vitest 配置 | ✅ flash 固定（可复现性基础） |

### 缺失清单（差距地图）

- **P0 评测层**：任务型能力基线、golden 集、回归基准、指标体系——全部为零
- **P1 门禁强化**：评测门禁（能力退化检测）、端到端真实闭环、运行时故障注入、bench-gate 修复+接入
- **P2 基础设施**：全包测试类型检查（20+ 包）、评测轨迹回放、依赖漏洞扫描、随机性控制

## 3. 方案设计

### 3.1 评测层（P0）——`@eval` 评测框架

**核心思路：复用 ci-gate 的标签发现模式（`@ci`）与 bench-gate 的基线模式（BENCH_METRIC），扩展为评测体系。**

#### 3.1.1 评测任务定义格式

新建 `tests/eval/` 目录（或 `packages/engine/tests/eval/`），评测任务 = **带 `@eval` 标签的 vitest 测试文件**：

```
// @eval: memory-recall
// @eval-category: memory
// @eval-cost: ~0.2元（真实 LLM）
// @eval-golden: tests/eval/golden/memory-recall.json
```

**评测 = 单元测试框架（vitest 已有）+ 真实 LLM（定死 flash）+ golden 对比（新）**——不造新测试框架，复用 vitest 的执行能力。

#### 3.1.2 评测指标输出协议

复用 bench-gate 的 `BENCH_METRIC:<name>=<value>` 模式，扩展为两类：

```
EVAL_SCORE:<metric>=<0-1 分数>      # 能力分数（golden 对比后）
EVAL_METRIC:<metric>=<原始值>       # 过程指标（召回率/工具正确率/成本/延迟）
```

#### 3.1.3 golden 集

- 位置：`tests/eval/golden/*.json`（人工标注的期望输出——**用户/昔涟标注**）
- 格式：`{ id, task, input, expected: { 关键断言点 } }`
- 判定：**非全等对比**（LLM 输出不可全等）——**断言点抽取**（关键子串/结构/语义阈值——余弦相似度或关键词命中）

#### 3.1.4 评测基线（eval-baseline.json）

扩展 bench-baseline 模式：`scripts/eval-baseline.json`（每项指标的固化基线 + 退化阈值）

#### 3.1.5 eval-runner（scripts/eval-gate.ts）

对标 bench-gate：
- 发现 `@eval` 标签测试 → 串行跑（真实 LLM 串行防并发成本）
- 解析 EVAL_SCORE/EVAL_METRIC → 与基线对比 → 退化超阈值失败
- `--update-baseline` 固化新基线（人工确认）
- **不接入日常 ci-gate**（成本）——**独立门禁**：`pnpm eval`（人工/发版前触发）+ CI 的**定时/发版 job**

#### 3.1.6 指标体系（首期 6 项）

| 类别 | 指标 | 来源 |
|---|---|---|
| 记忆 | 检索召回率（golden 命中） | eval 对比 |
| 记忆 | 去重正确率 | eval 对比 |
| 计划 | 任务分解正确率（节点结构匹配） | eval 对比 |
| 工具 | 工具调用正确率（参数/选择） | eval 对比 |
| 成本 | 每任务 token 消耗 | telemetry/EVAL_METRIC |
| 延迟 | 端到端耗时 | EVAL_METRIC |

### 3.2 门禁强化层（P1）

#### 3.2.1 bench-gate 修复 + 接入
- 修复 bench-memory-pipeline.test.ts 的 BENCH_METRIC 输出（设施已断）
- ci-gate 增加"性能回归"段（bench-gate 全量接入门禁——**当前未接**）

#### 3.2.2 端到端真实闭环（1 个核心链路）
- 新建 1 个 `@eval` 端到端任务（替代已删 golden-path 的核心：write→load→wake→plan→dispatch→execute→verify）
- 真实 LLM + 真实工具（write_file 到临时沙箱）

#### 3.2.3 运行时故障注入
- 现有 critical-fixes 是静态校验——扩展为**运行时故障注入**（mock LLM 挂/工具抛错/索引损坏场景的自动化注入测试）
- 位置：`tests/fault-injection/`（vitest + mock 层）

### 3.3 基础设施层（P2）

| 项 | 方案 |
|---|---|
| 全包测试类型检查 | 补 20+ 包的 tsconfig.test.json（cli 模板）——分批 |
| 评测轨迹回放 | eval 时落盘 `{input, steps, output}` JSONL——失败可回放 |
| 依赖漏洞扫描 | `pnpm audit` 接入 ci-gate |
| 随机性控制 | eval 固定 temperature=0 + 3 次采样取中位数 |

## 4. 实施路径

| 阶段 | 交付物 | 依赖 |
|---|---|---|
| **P0-1**（评测骨架） | eval 目录 + 任务定义格式 + eval-gate.ts + 首期 6 指标中 4 项 | 无 |
| **P0-2**（golden 集） | 首期 8-10 个 golden 任务（人工标注） | P0-1 |
| **P0-3**（基线固化） | eval-baseline.json 首次固化 | P0-2 |
| **P1-1**（bench 修复） | bench-memory-pipeline 恢复 + ci-gate 接入 | 无 |
| **P1-2**（端到端） | 1 个真实闭环 eval 任务 | P0-1 |
| **P1-3**（故障注入） | fault-injection 目录 + 首期 5 个场景 | 无 |
| **P2**（基础设施） | 类型检查分批 + pnpm audit + 轨迹回放 | 并行 |

## 5. 风险与依赖

- **成本**：真实 LLM 评测有成本——需控制任务规模（首期 ≤10 任务）与频率（不接日常门禁）
- **波动**：LLM 输出非确定——golden 判定用断言点+多采样，不用全等
- **bench 已断**：P1-1 前 bench-gate 是死设施——修复优先级高于扩展
- **依赖**：`@eval` 标签发现机制复用 ci-gate 的 `@ci` 解析（已有代码可提取）

# 6. 待决问题（需开拓者决策）

1. **评测目录归属**：`tests/eval/`（根级）还是 `packages/engine/tests/eval/`（引擎级）？
2. **golden 标注人**：由开拓者标注核心任务，还是昔涟初拟后开拓者审？
3. **评测频率**：发版前手动？还是 CI 定时 job（如每周）？
4. **首期范围**：6 项指标全做，还是先做记忆域 2 项（召回/去重）验证框架？
5. **bench-gate 接入**：性能门禁进日常 ci-gate（可能拖慢），还是与 eval 一样独立触发？

## 7. 联网调研深化（2026-06-20 补充）

> 对标：arxiv 2604.14228（Claude Code 设计空间）/ SWE-bench / tau-bench / tau2-bench pass^k / LLM-as-Judge（G-Eval·DAG·QAG）/ deepeval CI 回归模式

### 7.1 评测判定方法论（golden 对比的三级判定）

主流评测判定不是单一方式——是**按任务性质分层的三级判定**：

| 级 | 判定方式 | 适用 | 代表 |
|---|---|---|---|
| L1 确定性断言 | 结构/状态/测试套件对比 | 任务有确定终态 | SWE-bench（跑测试套件）、tau-bench（检查 DB 状态） |
| L2 语义阈值 | 余弦相似度/关键词命中/断言点 | 输出自由文本但有关键要素 | 语义检索评测 |
| L3 LLM-as-Judge | rubric 评分（G-Eval）/ 成对比较 / DAG 硬规则分支 | 开放任务、质量主观 | deepeval/confident-ai |

**Cortex 方案更新（3.1.3 golden 对比）**：原方案只写了 L2（断言点）——**补充 L1（工具调用终态/记忆库状态断言——tau-bench 模式）+ L3（rubric 评分——G-Eval 模式）**。首期记忆域任务用 L1+L2（记忆库状态可断言），任务分解/工具正确率用 L2，开放对话质量用 L3。

### 7.2 pass^k 指标（多次运行可靠性）

- tau2-bench 的 **pass^k**：agent 在 k 次独立运行中全部成功的比例——**衡量可靠性而非单次能力**
- **Cortex 方案更新（3.1.6 指标）**：补 `pass@3`（3 次运行全成功比例）到指标体系——LLM 非确定下，可靠性指标比单次分数更真实

### 7.3 内部 eval 优先原则

- 实证：某 agent 外部基准 89% SWE-bench 但内部 eval 仅 38%——**外部基准≠产品能力**
- **原则**：评测任务集应以**内部真实任务**为主（Cortex 的实际工作流），外部基准只作参考基线——**方案更新**：golden 集首期从 Cortex 真实场景提取（记忆写入/检索/任务分解），不抄通用基准

### 7.4 观测-评测缺口（论文 12.1）

- Claude Code 论文指出：**静默失败只能靠评测发现**——可观测性告诉你"发生了什么"，评测告诉你"是否该发生"
- **Cortex 的 R11 教训吻合**：静默全丢/静默 no-op 都是"可观测到但无评测基线"的失败——**评测是静默失败的最终防线**

### 7.5 Cortex 的 taxonomy 定位（论文 13.1）

| 类别 | 代表 | 特征 |
|---|---|---|
| Inline completion | Copilot | 编辑器插件 |
| Chat-integrated | Cursor | IDE 耦合 |
| **Agentic CLI** | **Claude Code/Codex CLI/Aider——Cortex 属此类** | 工具循环 |
| Fully autonomous | Devin | 沙箱+规划 |

**含义**：Cortex 的评测框架应参考 **Agentic CLI 类**的评测方式（工具调用正确性/文件系统终态/多步任务完成率），而非 IDE 类或纯对话类。

### 7.6 LLM-as-Judge 可靠性实践（deepeval）

- 显式 `evaluation_steps`（rubric 分步）——标准模糊是噪音主因
- 硬规则用 DAG 分支（不靠 judge 自由裁量）
- **judge 与人工标注交叉验证**（简单 pass/fail 标注即可起步）
- 生产评测用单答案+显式 rubric；模型对比用成对比较
- **Cortex 方案更新**：L3 判定用 flash 跑 rubric（复用测试模型），首期不引入独立 judge 模型

### 7.7 方案增量汇总

| 原方案 | 深化后 |
|---|---|
| golden 对比（断言点 L2） | **三级判定 L1+L2+L3** |
| 6 项指标 | **+ pass@3 可靠性指标** |
| golden 任务来源待定 | **内部真实任务优先（Cortex 场景提取）** |
| eval 触发频率待定 | **发版/定时 job（论文佐证 operational harness 是刻意投入）** |

## 8. 深推决策（2026-06-20——决策完备版）

### 8.1 五个待决问题的拍板（基于调研证据）

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | 评测目录归属 | **`packages/engine/tests/eval/`**（引擎包内） | 评测任务主要测引擎链路（记忆/调度/执行）；引擎包 vitest 配置/tsconfig.test 已就绪；跨包（memory-store/governance）经依赖引用可达——根级目录无测试基础设施，需额外配置 |
| 2 | golden 标注人 | **昔涟初拟 + 开拓者审**（关键断言点由开拓者确认） | 任务描述/输入可由我起草（熟悉代码），但"什么算答对"的断言点是产品语义——开拓者拍板 |
| 3 | 评测频率 | **发版前手动 + CI 每周定时 job** | 真实 LLM 有成本（首期 ≤10 任务）；周频能抓退化（回归基准价值）；发版前手动是硬门（R11 教训：静默失败靠评测防线） |
| 4 | 首期范围 | **记忆域 2 项先行**（召回率/去重正确率——L1+L2 判定） | 验证框架成本最低（记忆库状态可断言，L1 为主）；6 项全做会拖长首期；框架验证后再扩 |
| 5 | bench-gate 接入 | **独立触发**（与 eval 一致——不接日常 ci-gate） | 性能基准在 CI 环境波动大（抖动→误报）；独立触发保留人工确认时机 |

### 8.2 P0-1 开工清单（决策完备——批准即可执行）

**目录结构：**
```
packages/engine/tests/eval/
├── tasks/               # 评测任务（vitest + @eval 标签）
│   └── memory-recall.test.ts
├── golden/              # golden 断言数据（人工标注）
│   └── memory-recall.json
├── utils/
│   └── eval-utils.ts     # 共享：LLM 适配器/沙箱/指标输出
└── README.md            # 评测使用说明
```

**任务文件格式（首期 memory-recall）：**
```ts
// @eval: memory-recall
// @eval-category: memory
// @eval-cost: ~0.2元
// @eval-golden: golden/memory-recall.json
import { describe, it, expect } from "vitest";
import { evalBootstrap, emitEvalScore, emitEvalMetric } from "./utils/eval-utils.js";

describe("@eval memory-recall", () => {
  it("写入 5 条→检索 3 个查询→golden 断言", async () => {
    const { engine } = await evalBootstrap();
    // ... 写入 5 条记忆（真实 LLM 萃取）
    // ... 3 个查询
    // L1 断言：记忆库状态（条目存在/去重后数量）
    // L2 断言：检索结果命中 golden 关键词
    emitEvalScore("memory.recall.hit", 0.83);
    emitEvalMetric("memory.recall.tokens", 1200);
  });
});
```

**eval-gate.ts（scripts/）——复用 bench-gate 模式：**
- 发现 `@eval` 标签测试（vitest `--testNamePattern` 或文件扫描）
- 串行执行（真实 LLM 防并发成本）
- 解析 `EVAL_SCORE:<name>=<value>` / `EVAL_METRIC:<name>=<value>`
- 与 `scripts/eval-baseline.json` 对比（退化阈值默认 15%）
- `--update-baseline` 固化 / `--json` 输出 / `--pass-k 3`（多次运行可靠性）

**eval-utils.ts 接口：**
```ts
export function evalBootstrap(): Promise<{ engine: Engine; root: string }>;
// 真实 LLM（flash 定死）+ 临时沙箱目录（隔离）
export function emitEvalScore(name: string, value: number): void;  // 0-1
// 输出 EVAL_SCORE:name=value 行（bench-gate 同款协议）
export function emitEvalMetric(name: string, value: number): void; // 原始值
// 输出 EVAL_METRIC:name=value 行
export function loadGolden(id: string): GoldenTask;               // golden JSON
```

**golden JSON 格式：**
```json
{
  "id": "memory-recall",
  "inputs": ["查询 1", "查询 2", "查询 3"],
  "expected": {
    "hitKeywords": ["关键词A", "关键词B"],   // L2 断言点
    "state": { "entries": 5, "deduped": 3 }  // L1 状态断言
  }
}
```

### 8.3 P0-2/P0-3 顺序（golden 集与基线固化）

1. P0-1 先落地框架 + memory-recall 1 个任务（验证管道）
2. P0-2 扩到 3-5 个任务（召回/去重/任务分解）——golden 由开拓者审
3. P0-3 首次跑通后 `--update-baseline` 固化基线（人工确认分数合理）
4. 之后每次改动跑 `pnpm eval`——退化即红

### 8.4 与 R11-23 的联动

评测的"记忆状态断言"（L1）**天然覆盖 R11-23 的跨存储完整性**——golden 任务可断言 ragId 悬空数=0——评测框架落地后，R11-23 的清扫器验证有了自动检查点。

---
*深推完成——批准后按 P0-1 开工清单执行。*
