# Cortex 重整化 · 阶段 1「真相复位」归档

> 日期：2026-06-20 ｜ 关联：docs/analysis/refactor-spec-2026-06-20.md §1 ｜ 计划：docs/superpowers/plans/2026-06-20-cortex-refactor-phase1.md

## 基线（阶段 1 开始前）

| 项 | 基线值 | 来源 |
|---|---|---|
| git HEAD | `28f188ac` 审计收敛 P0：AlertEngine 接线 + 门禁描述同步五段 | git log |
| 门禁五段 | `CI_GATE_EXIT=0`（tsc → eslint → critical-fixes → vitest → coverage） | ci-gate 输出 |
| vitest | 3771/3776 通过（13 包 coverage 达标） | 基线记录 |
| v4 零消费审计 | TOTAL_EXPORTS=3906 / DEAD=40 / LEAK=137 / PUB_API_UNCONSUMED=782 | 调研报告 |
| 漂移信号 | 633 条（A 迁移声明 30 条最高价值） | 调研报告 |

阶段 1 起始提交：`cdfa0468`（调研/蓝图/spec/计划四份文档归档，pre-commit 通过：tsc engine + vitest engine 907 通过 + eslint engine）

## 任务进度

- [x] Task 1：基线确认与归档（本文件）
- [x] Task 2：S1-1 shared 三 enum 双源清零（41 消费方改 import，实际 36+）
- [x] Task 3：S1-2 死依赖 4 处删除
- [x] Task 4：S1-3 design-tokens 收编（desktop 接真实消费）
- [x] Task 5：S1-4 @cortex/factory 幽灵注释清除
- [x] Task 6：S1-5 daemon 健康端点真实化 + S1-6 WS 未知命令日志
- [x] Task 7：S1-7 文档同步
- [x] Task 8：S1-8 + S1-9 A 类迁移声明核对表
- [ ] Task 9：守护测试补全 + 全量回归 + 验收归档

## 任务验证记录（逐 commit）

| Task | commit | 验证证据 |
|---|---|---|
| Task 2（S1-1） | `bea7947d` | tsc EXIT=0；vitest shared 112 + engine/platform/scheduler 1263 全过；守护测试 toolkit-single-source.test.ts 5 断言；pre-commit 过 |
| Task 3（S1-2） | `c14e1a77` | doctor/memory/server 三包 tsc EXIT=0；pre-commit 过 |
| Task 4（S1-3） | `041addec` | design-tokens build + renderer TSC=0 + main TSC=0 + `tsc -b packages/desktop` EXIT=0 + desktop lint 0；pre-commit 过 |
| Task 5（S1-4） | `696ce071` | engine tsc EXIT=0；全仓 grep @cortex/factory 源码清零（仅文档类引用留 Task 7 域）；pre-commit 过 |
| Task 6（S1-5/6） | `96445362` | server vitest 20/20（含新守护测试 daemon-health.test.ts 4 断言：真实快照/存在性双向/daemon 段）；server tsc EXIT=0；pre-commit 过 |
| Task 7（S1-7） | `2083ccef` | 三文档 diff 审阅；pre-commit 过 |
| Task 8（S1-8/9） | 见下 commit | 核对表见下节 |

## A 类迁移声明核对表（S1-9，22 条口径）

> 口径：调研附录 12 组条目（pattern-extractor ×3 计 3 条）→ 14 组 + 调研已核对 8 条 = 22 条。逐条核对方式：读代码验证注释声明 vs 实际状态。

| # | 位置 | 注释声明 | 核对结果 |
|---|---|---|---|
| 1 | bootstrap-engine.ts:340 | 模型路由注入 | ✅ 已接线——TaskRouter + EnvironmentAwareRouter → compositeRouter → scheduler 模型路由（§6.2.2a） |
| 2 | degradation-boundary.ts:25/37/43 | bootstrap 注入×3 | ✅ 已接线——bootstrap-engine.ts L268-275 注入全部 4 静态字段（collector/_observer/_audit/_counter），消除零生产者 |
| 3 | loop-strategy-registry.ts:42/44 | setter 注入默认/直接管道 | ⚠️ **假接线**——setDefaultPipeline/setDirectPipeline 全仓无调用方，静态字段恒空数组；策略注册（L107/120/128/136）引用空管道 → **阶段 3 收敛**（接线或删除） |
| 4 | meta-agent.ts:698 | 系统提示迁 config/constants/meta-agent.ts | ✅ 干净迁移——config 单源（buildPlanningSystem/buildPlanningSystemBlank/REPLAN_SYSTEM），engine L11-13 真实 import，L415 消费 |
| 5 | pool-aware.ts:27 | PipelineObserver 由外部注入 | ✅ 已接线——构造注入（L97 `this._observer = observer`） |
| 6 | memory-store/schema.ts:4 | 常量迁 config/constants/memory.ts | ✅ 干净迁移——9 常量全量从 @cortex/config 导入再 re-export，无本地定义残留 |
| 7 | pattern-extractor ×3 | 只读字段由调用方注入 | ✅ 非漂移——设计原则说明（与 DispatchCtx/PipelineCtx 同族），无迁移声明无残留 |
| 8 | platform/toolkit.ts:61 | M6 修复迁 ./tools/search-code.ts | ✅ 已迁——grepFallback 定义于 search-code.ts:83，toolkit 无残留逻辑（仅历史 @fix 注释） |
| 9 | platform/toolkit.ts:99 | 搜索聚合器由 main.ts 注入 | ✅ 已确认（调研 E 类）——setSearchAggregator 被 cli/bootstrap/mcp.ts:102 真实注入 |
| 10 | dispatch-steps/types.ts:16 | 只读配置由 Scheduler 注入 | ✅ 非漂移——DispatchCtx 接口设计说明 |
| 11 | shared/infra.ts:415 | 模型能力声明由注册表注入 | ✅ 非漂移——可选字段，调用方（engine-host resolveModelCaps）真实设置 |
| 12 | cli/tui/query-loop.ts:45 | AGENT_TYPE_TO_DIR 迁 shared | ✅ 干净迁移——shared/agent-registry.ts:267 单源，query-loop L25 真实 import，无本地定义 |

**结论：12 组中 2 组设计说明（非漂移）、2 组已确认、6 组干净已接线、1 组已迁无残留、1 组假接线（loop-strategy-registry → 阶段 3 收敛）。无本阶段必须修复项。**

## S1-8 FIND-002 标记清理

- memory-store.ts:499 `@see FIND-002 — 已核实为误报` → 改写为简洁说明（保留核实结论“无 persistFn 异常回滚路径”，删除编号引用）

## 门禁五段全量回归（Task 9 Step 1）

命令：`npx tsx scripts/ci-gate.ts --coverage` → **CI_GATE_EXIT=0**

| 段 | 结果 |
|---|---|
| 1/5 tsc -b 全量增量编译 | ✅ 类型检查通过 |
| 2/5 eslint packages/**/src | ✅ lint 通过 |
| 3/5 critical-fixes 混沌校验 | ✅ 混沌校验通过 |
| 4/5 vitest 按包串行（unit+verify+contract，250 文件） | ✅ **3778/3783 passed**（25 个 llm/integration/e2e/manual 跳过）；与基线 3771/3776 对比净增测试（新增守护测试 9 个） |
| 5/5 覆盖率阈值 | ✅ 14 包全部达标（engine 70.46%/shared 81.63%/config 78.18% 等） |

> 回归途中抓到真 bug：shared 守护测试路径解析依赖 `process.cwd()`，ci-gate 按包运行时路径拼成 `packages/shared/packages/...` 报 ENOENT（4 测试红）——修复为 `import.meta.url` 基准后全绿（commit `aae30c8b`）。

## v4 零消费审计对比（Task 9 Step 2）

> ⚠️ 口径说明：基线脚本（.tmp-audit-v4.mjs）为临时文件已删且未提交，无法完全复现 3906/40/137/782 的统计口径；重建版（正则近似扫描）数字与基线不可直接对比。以**可验证事实**做聚焦对比：

| 聚焦项 | 基线（2026-06-20 调研） | 现态（重建版审计 + 直接验证） | 判定 |
|---|---|---|---|
| design-tokens 孤儿 | DEAD=40 中含其全部 29 导出（0 消费） | 重建版：dead=0 / unconsumed=0；desktop 真实 import CYRENE_PALETTE + PersonaPalette | ✅ 孤儿消除 |
| shared export * 泄漏 | 调研记录“shared 19 条 export *” | shared/src 全仓 grep `export *` **0 命中** | ✅ LEAK 大头清零 |
| shared 三 enum 值定义 | 三 enum + 2 函数 + 1 type 在 shared | shared/src 无 `export enum/const` 值定义（仅私有字面量 type alias，非导出）；config/vocabularies/tool-enums.ts 唯一源 | ✅ 值域单源 |
| shared 导出面 | 231 导出（调研数据附录） | 三 enum + toReversibilityClass/toolNameToRiskDomain/RiskDomain 6 符号移除；重建版 236（含 type 导出口径差异，仅记录趋势） | ✅ 缩减方向 |
| 重建版全量数字（参考） | 3906/40/137/782（口径不同） | 1991/249/35/312——正则近似，含大量误判（如 cli UI 组件 export 在 dist 消费） | 📝 仅参考 |

## 验收标准逐条证据（spec §1.2）

| # | 验收标准 | 证据 | 状态 |
|---|---|---|---|
| 1 | grep 三 enum 在 shared/src 零命中（值定义）；config 唯一源 | shared/src 无 `export enum/const` 值定义（grep 命中 12 处均为私有字面量 type alias/注释）；tool-enums.ts 完整含 3 enum + RiskDomain + 2 函数；守护测试 toolkit-single-source.test.ts 5 断言 | ✅ |
| 2 | 4 处死依赖删除后 lockfile 通过；doctor/memory/server 源码零 import | commit `c14e1a77`；pnpm install --lockfile-only 通过；三包 tsc EXIT=0 | ✅ |
| 3 | design-tokens 接 desktop 主题（真实 import）或删除 | commit `041addec`：desktop/package.json 加 workspace 依赖，design-spec.ts import CYRENE_PALETTE + satisfies Pick<PersonaPalette>；renderer+main TSC=0 | ✅ |
| 4 | daemon /health 返回真实 snapshot；测试断言非硬编码 | commit `96445362`；daemon-health.test.ts 4 断言（真实 totalDegradations=3/engineReady 存在性双向/daemon 段）；server 20/20 | ✅ |
| 5 | WS 未知命令日志出现于 console-bridge 链路 | daemon.ts default 分支 `console.warn("[daemon] 未知 WS 命令类型: ...")`（S1-6，console-bridge → ErrorReported 链路） | ✅ |
| 6 | 门禁五段全绿；v4 对比归档 | CI_GATE_EXIT=0（3778/3783 + 覆盖率全达标）；聚焦对比见上节 | ✅ |
| 7 | 测试流程归档完成 | 本文件（基线/改动清单/验证记录/守护测试/验收证据/遗留项） | ✅ |

## 遗留项（Task 9 Step 4）

| # | 未闭合项 | 原因 | 阶段 3 计划 |
|---|---|---|---|
| 1 | loop-strategy-registry setter 死代码（setDefaultPipeline/setDirectPipeline 无调用方，静态字段恒空） | 假接线，A 类核对表第 3 条 | 接线（真实注入管道）或删除 setter + 收敛策略注册 |
| 2 | shared 接口契约（ToolDefinition 等）留在 shared，值域在 config | S1-1 分层设计：shared 受 L0 零依赖约束不能 import config；字面量联合双向兼容 | S3-11 迁移完成态扫描器上线后统一机制化 |
| 3 | packages/doctor 在 .gitignore:127 但 14 文件已跟踪 | 历史遗留怪象 | 决策去留（git rm --cached 或移出 ignore） |
| 4 | design-tokens / desktop 测试仍为 0 | 本阶段未涉及测试补齐 | 蓝图阶段 3 第 14 条“0 测试包补测试” |
| 5 | v4 审计基线脚本未归档（.tmp 临时文件） | 临时文件惯例 | 阶段 2 前将重建版脚本沉淀到 scripts/ 并固化口径 |
| 6 | engine/src @layer 覆盖率 24/74 | 阶段 1 仅如实标注 | S3-10 统一标签词表 + 门禁校验 |

## 阶段 1 提交序列

```
28f188ac （基线 HEAD）
cdfa0468 docs: 调研/蓝图/spec/计划归档
bea7947d refactor: shared 三 enum 双源清零
c14e1a77 chore: 删除 4 处死依赖声明
041addec refactor: design-tokens 收编
696ce071 docs: 清除 @cortex/factory 幽灵包注释
96445362 fix: daemon 健康端点接真实快照 + WS 未知命令日志
2083ccef docs: PACKAGE_POSITIONING 修正 + @layer 覆盖率标注 + 蓝图勾选
a238e79c docs: A 类 22 条核对表归档 + FIND-002 清理
aae30c8b fix: 守护测试路径解析（ci-gate 按包运行兼容）
<本提交> docs: 阶段 1 验收归档
```
