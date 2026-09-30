# Cortex 优化与体检报告

**日期**：2026-09-30
**范围**：每日真门禁体检 + 两处「门禁抓不到」的结构缺陷（G-9 fail-open 钩子 / G-4 缺测试卫生守卫）
**执行主体**：本轮由 QoderWork 本人直接完成（未委派任何子 Agent）

---

## 0 · 摘要

| # | 事项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 真门禁体检 | ✅ **全程绿，无缺陷、无假红** | `ci-gate.ts --json` → `allPassed:true, 4069/4074 passed, 5 skipped, 14 文件未跑` |
| 2 | 文档「4069/4074 全程绿」的声明 | ✅ 本轮**实测属实** | 逐包读数与文档一致（不信任文档，重跑核对） |
| 3 | G-9 `.git/hooks/pre-commit` | ✅ 已由 fail-open 改为 fail-closed | 见 §2 |
| 4 | G-4 测试卫生守卫 | ✅ 新增 + 清掉 2 处 live `passWithNoTests` | 见 §3 |

**本轮没有真实代码缺陷**（门禁全绿），所做的两处改动是清单里**「只记录未实施」的结构性守卫**——它们恰好是绿色门禁本身看不见的那一类（钩子不在门禁流程里；缺失的守卫还没被跑到）。

---

## 1 · 真门禁体检（实测，不采信文档）

`npx tsx scripts/ci-gate.ts --json`（输出重定向后读文件）：

```
🔒 [门禁 1/5] tsc -b 全量增量编译检查...         ✅（packages + scripts）
   [copy-data] src/data → dist/data: 复制 0，未变 18
🔒 [门禁 2/5] eslint packages scripts --max-warnings 0... ✅
🔒 [门禁 3/5] critical-fixes 混沌校验...         ✅
🧪 vitest 按包串行 — unit + verify + contract (283 个文件)
   28/28 包全绿
✅ 门禁通过   Tests: 4069 passed | 5 skipped | 4074 total | 14 个测试文件未运行
{"allPassed":true,"failedStage":null,"total":4074,"passed":4069,"skippedTests":5,"skippedFiles":14}
```

关键判定：

- `allPassed:true`、`failedStage:null` ⇒ **本轮无红**。engine `913/914`、cli `563/567` 的差值是**包内 `it.skip`**，非失败（`allOk` 为真时不可能含 failed）。
- **memory-store 69/69 全过**：本轮未出现「写 N 读 1 / 按 kind 召回塌陷」的 @xenova 离线假红——无需隔离复跑，也**未**动核心记忆算法或测试。
- 文档 `docs/core/core-3-invariants.md` 里那句「真门禁全程绿、4069/4074」——按其自身的告诫（代码锚点系统性过期、结论须实测），我没有直接采信，而是重跑了一遍；**这一次读数恰好吻合**，但不能当成常态。

---

## 2 · G-9 —— 把永远报成功的 pre-commit 改成真的会拦

`.git/hooks/pre-commit` 旧版全文 18 行，四处叠加使其**永不阻断 `git commit`**：

1. `npx tsc … | tail -1` 之后判 `$?` —— 取的是管道尾部 `tail` 的退出码（恒 0），那个 `exit 1` **永不执行**。
2. vitest / eslint 仅 `grep` 输出、**完全不看命令本身退出码**。
3. eslint 用 `--max-warnings 999`（真门禁用 `0`）。
4. 结尾**无条件** `echo "✅ pre-commit passed"` —— 脚本最后一条命令恒成功。

**实测的机制级证据**（本轮跑）：

```
OLD: false | tail -1; echo $?        → 0   （失败被管道吞掉）
NEW: if ! false; then …; fi          → 进入阻断分支（退出路径被走到）
```

**新钩子第一版（fail-closed，三步）与它被抓到的过程**：

我先按 G-9 处方做成三步全 fail-closed——`set -uo pipefail` + 每步 `if ! <命令>; then exit 1; fi`、eslint 改 `--max-warnings 0`、去掉结尾无条件 `✅`、vitest 步骤**排除口径对齐 `@ci` 标签**（运行时扫每个 engine 测试文件前 10 行取标签，只跑 `unit|verify|contract`，其余逐个 `--exclude`，单 fork 串行）。

**这一版第一次真跑就把它自己的价值演了出来**：提交时钩子**拦下了 commit**——engine 的 `bootstrap-integration.test.ts`（`@ci: contract`）报 "1 unhandled error"、engine `911 passed | 1 failed | 1 skipped`。而旧钩子跑同一条命令时从来不判状态、永远放行，所以这个隐患一直被「✅ pre-commit passed」盖着。

追查这个 failed 是不是真缺陷（单文件隔离复跑 ×3 + 默认堆 ×1）：

- 失败原因全是 `FATAL ERROR: … heap out of memory` → `Error: Worker exited unexpectedly`——**是 OOM，不是断言**；该测试头部自述「mock LLM、零 API、逻辑 7/7 全绿」。
- **同一轮、同一条单 fork 命令，全量 `ci-gate` 跑 engine 是 `913/914` 绿的**；把它单独拎出来在提交路径跑，却随机器空闲内存抖动而 OOM。
- 现场 23 个 `node.exe` 全是 MCP/Adobe 的小进程（各 ~40MB，非本次 vitest 残留），不足以解释多 GB 堆溢出——**这是资源敏感型 flake，属清单定义的『OOM 环境假红』**。

**据此定稿（第 4 步『只动与环境无关且确定正确的东西』 + 第 7 步『优先真实 UX/ROI』的取舍）**：

> 把 OOM 敏感的重型 vitest **钉死在每次 commit 上 = 一个会因机器内存抖动误拦正常提交的『狼来了』守卫**——恰是本清单反对的「误导性信号」，其反面（旧版永远放行）和它本身一样坏。

所以**定稿的 pre-commit 只守确定性、与环境无关、且不会 OOM 的两项，且都 fail-closed**：

| 步 | 命令口径 | 本机结果 | 性质 |
|---|---|---|---|
| tsc | `npx tsc -b packages/engine/tsconfig.src.json --force` | exit 0 | 确定性、秒级、不 OOM |
| eslint | `npx eslint packages/engine/src --max-warnings 0` | exit 0 | 确定性、与真门禁同口径 |

- **重型测试套件交回 `scripts/ci-gate.ts`**（按包隔离、大包强制单 fork、失败 `abort` 带 `failedStage`）——它是权威门禁，由治理流程/人显式跑，不进每次 commit 的快路径。
- 结尾那句 `✅ pre-commit passed (tsc + eslint)` 只在两步都真过、脚本自然走到时打印；任一步非零即 `exit 1` 阻断。
- 第一版的「按 `@ci` 标签动态排除」逻辑（实测解析出的 9 个 `--exclude`，含旧钩子按文件名漏掉的 `audit-bootstrap.test.ts` / `trust-model.test.ts` 两个 integration 文件）保留在本报告 §2 与钩子注释里，作为将来若要在非提交路径复用该排除口径的形状。

**顺带查实的一处旧钩子缺陷（保留结论）**：旧版按 9 个**文件名**排除，漏掉了 `audit-bootstrap.test.ts` 与 `trust-model.test.ts`（都是 `@ci: integration`，需要外部服务）——即「替项目跑了一批按它自己的规矩不该在提交路径上跑的东西，然后不检查结果」。按标签扫描的口径可一次性修掉这一点（已在第一版实测解析正确）。

---

## 3 · G-4 —— 「有测试」必须「会被跑到」

**事实复核（实测）**：当前**每个** workspace 包都已同时具备 `tests/` 目录与 `test` 脚本（desktop 那次「37 个测试没脚本被根 `pnpm -r test` 静默跳过」已修）。但**没有东西防止下一个包再漏**，且仍有 **2 个包把 `passWithNoTests` 设成 `true`**（llm / notification）——一旦测试退回零个就静默通过。design-tokens 此前也踩这个坑，已在 09-26 自修（其 config 里「passWithNoTests」只剩注释）。

> 差点踩坑：一开始用 `grep passWithNoTests` 判定，**design-tokens 的注释被当成真配置命中**——正是清单 G-8「统计前必须剥掉注释」那条。改为读实际代码 + 守卫里先剥注释，误报消失。

**新增守卫**：`packages/tools/tests/test-hygiene.test.ts`（`@ci: contract`）。包枚举复用 `collectPackages` / `findProjectRoot`（与 layer-contract、flow-contract 同一「什么算 workspace 包」的单一来源，不再长出第三份表示）。两条断言：

1. **双向**：每个包 `(包内存在 *.test.ts) ⇔ (package.json 有非空 test 脚本)`，两个方向分开报（缺脚本 / 有脚本零测试）。
2. **全称**：任何包的 `vitest.config.*` **不得** `passWithNoTests: true`；匹配前先剥块注释/行注释。

**是否接进门禁**：`ci-gate.ts` 第 4 步会按包跑 `unit|verify|contract`，而 `tools` 包默认在其扫描集内（本轮门禁 `tools — 81/81`），故这条 `@ci: contract` 守卫**天然进默认门禁口径、红了会拦**，无需为此改 `ci-gate.ts`——符合「能不加代码就不加」。

**反向验证（证明它不是空过的绿）**：把守卫的正则逻辑单独喂三种输入——

```
真配置 passWithNoTests: true   → 命中（会报红）
注释里提到 passWithNoTests: true → 剥注释后不命中（不误报）
显式 passWithNoTests: false      → 不命中（允许）
```

**随守卫一起做的清理**：删除 llm / notification 两处的 `passWithNoTests: true`（两包各有 4 / 6 个 `@ci: unit` 测试恒匹配 `include`，删除安全）。复跑：

```
llm          → 37/37 passed   (单 fork)
notification → 86/86 passed   (单 fork)
tools 新守卫 → 2/2 passed
tools 类型   → tsc --noEmit exit 0
```

---

## 4 · 本轮改了什么

| 文件 | 动作 | 入库？ |
|---|---|---|
| `.git/hooks/pre-commit` | fail-open → fail-closed | **否**（`.git/hooks/` 不被 git 跟踪，见 §5） |
| `packages/tools/tests/test-hygiene.test.ts` | 新增 G-4 守卫 | 是 |
| `packages/llm/vitest.config.ts` | 删 `passWithNoTests: true` | 是 |
| `packages/notification/vitest.config.ts` | 删 `passWithNoTests: true` | 是 |
| `docs/analysis/optimization-report-2026-09-30.md` | 本报告 | 是 |

未动：`docs/core/core-3-invariants.md` 里「本轮无缺陷可改」的部分；工作区里那批 cyrene 子 Agent 配置的未提交改动（与本轮无关，保持原样不并入本次提交）。

---

## 5 · 残留 / 待你定

1. **G-9 的修复只活在 `.git/hooks/`，不进版本库**。换一台机器 / 干净检出，钩子就没了。要让它可传播，得把钩子脚本挪进被跟踪的目录（如 `scripts/hooks/`）并用 `core.hooksPath` 或 husky/lefthook 指过去——那是**新增工具链的行为变更**，对个人项目未必划算，故本轮按指令只把当前环境的钩子改对，是否「转正入库」留给你定。
2. **llm 的 config 头注释仍写着「passWithNoTests 允许无测试文件时通过（llm 包当前测试较少）」**，而该设置已删——注释略过期。没顺手改是因为**那段注释整块是编码损坏的乱码**（`本地开?vitest 配置?` 等），改它反而可能引入更坏的乱码；乱码本身是既有问题，登记待办。
3. **G-4 的一条子断言未做**：清单提案里还有「`vitest.config` 的 `include` 必须覆盖 `tests/`」。本轮**没加**，因为个别包（desktop）有 src 就近放的测试，机械判 include 容易假阳性；且任务点名的两条已覆盖。
4. **一个边界提醒**：若将来某个包的测试**全部**标成 `@ci: llm/integration`（被门禁整文件 `--exclude`），又保持 `passWithNoTests` 关闭，则该包在门禁里会「无可跑测试 → vitest 报错 → 红」。本轮删除 passWithNoTests 的两个包都有真实 unit 测试，不触发；这是给未来接线时的注意事项，不是当前缺陷。
