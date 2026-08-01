# Cortex 重整化阶段 1：真相复位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成阶段 1"真相复位"——双源清零、死依赖清理、健康端点真实化、文档同步，为阶段 2 激活空转层铺路。

**Architecture:** 基于已批准 spec（docs/analysis/refactor-spec-2026-06-20.md）§1。核心约束：shared 是 L0 零依赖包（不能 import config）；config 是三 enum 迁入目标（barrel 已导出）；36 个消费方全部依赖 config（platform/scheduler/engine/server 均已有 config 依赖）。

**Tech Stack:** TypeScript monorepo（pnpm workspace）、vitest、ci-gate.ts 五段门禁。

**基线（2026-06-20 已记录，commit 28f188ac）：** 门禁五段 CI_GATE_EXIT=0（vitest 3771/3776、13 包 coverage 达标）；v4 审计 TOTAL=3906 DEAD=40 LEAK=137 PUB_API=782。

---

### Task 1: 基线确认与归档

**Files:**
- Create: `docs/auditing/refactor-phase1-2026-06-20.md`（归档模板初始化）

- [ ] **Step 1: 确认工作区干净**

Run: `git status --short`
Expected: 无未提交改动（或仅 docs/analysis/ 三份新调研文档未追踪——先提交它们）

- [ ] **Step 2: 提交调研资产**

```bash
git add docs/analysis/refactor-drift-survey-2026-06-20.md docs/analysis/refactor-blueprint-2026-06-20.md docs/analysis/refactor-spec-2026-06-20.md
git commit -m "docs: 重整化调研/蓝图/spec 三份文档归档"
```

- [ ] **Step 3: 创建归档文档骨架**

创建 `docs/auditing/refactor-phase1-2026-06-20.md`，含基线段（门禁五段结果引用 28f188ac + v4 数字 3906/40/137/782），后续 Task 逐条勾选。

---

### Task 2: S1-1 shared 三 enum 双源清零（核心任务）

**Files:**
- Modify: `packages/shared/src/toolkit.ts`（删除 L15-54 的 ToolCategory/ReversibilityLevel/TrustLevel enum + L36-46 toReversibilityClass）
- Modify: `packages/shared/src/index.ts`（barrel 移除三 enum + toReversibilityClass 导出）
- Modify: `packages/shared/tests/types.test.ts`（移除对三 enum 的断言——shared 零依赖不能改 import config）
- Modify: 36 个消费方文件的 import（@cortex/shared → @cortex/config，仅三 enum 符号）
- Create: `packages/shared/tests/toolkit-single-source.test.ts`（守护测试）

- [ ] **Step 1: 生成消费方精确清单（脚本）**

创建 `.tmp-migrate-enums.mjs`：扫描所有含三 enum 的 .ts 文件，对 `import { ... } from "@cortex/shared"` 语句做精确拆分——含三 enum 符号的拆出，写入 `import { 符号 } from "@cortex/config";`；同语句其余符号保留 shared。输出：改动文件清单 + 每个文件的旧 import 行 → 新 import 行（供人工 review）。

规则：
- 跳过 `packages/shared/src/toolkit.ts`、`packages/shared/src/index.ts`、`packages/config/**`、`packages/shared/tests/types.test.ts`（单独处理）
- 保留 `type` 修饰符（如 `import type { ToolCategory }` → `import type { ToolCategory } from "@cortex/config"`）
- 若文件已有 `from "@cortex/config"` import 语句 → 合并符号进去（不新增行）

- [ ] **Step 2: 运行脚本并 review 输出**

Run: `node .tmp-migrate-enums.mjs`
Expected: 输出 ~36 个文件的迁移 diff 建议。人工抽查 5 个（mcp-client.ts 多行 import、confirm-gate.ts 双源 import、browser-agent.ts 双源 import）确认拆分正确。

- [ ] **Step 3: 执行迁移（脚本写文件 + 人工修正）**

脚本直接改写文件；对双源 import 文件（browser-agent/react-loop/confirm-gate/full-user-flow.test/scheduler-unit.test——同时 import shared 与 config）逐个人工确认每个符号的实际来源后修正。

- [ ] **Step 4: 删除 shared 定义**

`packages/shared/src/toolkit.ts`：删除 L15-54 三 enum 与 L36-46 toReversibilityClass，同时删除 L71/L127/L158 三处"已迁至 config"注释（迁移完成）；检查 toolkit.ts 剩余代码是否引用这三者（ToolDefinition.category: ToolCategory 等——需改用 config import 或类型保持）。

⚠️ 注意：`ToolDefinition`/`Tool`/`ITrustModel` 等接口仍引用 ToolCategory/ReversibilityLevel/TrustLevel——shared 不能依赖 config。**决策**：这些接口要么一并迁至 config（ToolDefinition 等属工具契约），要么在 shared 保留类型但 enum 值去 config。**推荐**：ToolDefinition/Tool/ConfirmationRequest 等接口一并迁移至 config（与 enum 同属工具契约域），shared/toolkit.ts 仅保留纯类型层无 enum 依赖的剩余部分；若 shared 仍含其他运行时逻辑（V1：BaseLifecycle/IndexedRegistry）则本阶段不动（属阶段 3 边界收敛）。

- [ ] **Step 5: 处理 shared/tests/types.test.ts**

删除其中对 ToolCategory/ReversibilityLevel/TrustLevel 的断言（shared 无法 import config）。

- [ ] **Step 6: 写守护测试**

创建 `packages/shared/tests/toolkit-single-source.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("工具枚举单源约束", () => {
  it("shared/src 不得再定义 ToolCategory/ReversibilityLevel/TrustLevel", () => {
    const toolkit = fs.readFileSync(
      path.join(process.cwd(), "packages/shared/src/toolkit.ts"), "utf8");
    expect(toolkit).not.toMatch(/export (enum|const) (ToolCategory|ReversibilityLevel|TrustLevel)/);
    expect(toolkit).not.toMatch(/export function toReversibilityClass/);
  });
  it("shared/src 不得出现已迁至 config 的残留注释", () => {
    const toolkit = fs.readFileSync(
      path.join(process.cwd(), "packages/shared/src/toolkit.ts"), "utf8");
    expect(toolkit).not.toMatch(/已迁至 @cortex\/config/);
  });
});
```

- [ ] **Step 7: 编译验证**

Run: `pnpm exec tsc -b tsconfig.json`
Expected: EXIT=0（若 shared 接口迁移引发跨包错误，逐文件修正 import）

- [ ] **Step 8: 测试验证**

Run: `pnpm exec vitest run packages/shared packages/config --coverage=false`（或对应包测试命令）
Expected: 全过（含新增守护测试）

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: shared 三 enum 双源清零——迁移至 config 单源（36 消费方改 import）"
```

---

### Task 3: S1-2 死依赖 4 处删除

**Files:**
- Modify: `packages/doctor/package.json`（删 `@cortex/tools`）
- Modify: `packages/memory/package.json`（删 `@cortex/config`）
- Modify: `packages/server/package.json`（删 `@cortex/memory-store`、`@cortex/tools`）

- [ ] **Step 1: 删除 4 处依赖声明**

分别编辑 4 处 package.json，从 dependencies 移除对应条目。

- [ ] **Step 2: 更新 lockfile**

Run: `pnpm install --lockfile-only`
Expected: 成功，无 workspace 报错

- [ ] **Step 3: 验证源码无引用**

Run: 对 doctor/server/memory 三个 src 目录 grep `@cortex/tools|@cortex/memory-store|@cortex/config`（memory 的 config 引用）
Expected: 零命中（memory 之前已确认 src 0 处 import config）

- [ ] **Step 4: 编译验证**

Run: `pnpm exec tsc -b tsconfig.json`
Expected: EXIT=0

- [ ] **Step 5: Commit**

```bash
git add packages/doctor/package.json packages/memory/package.json packages/server/package.json pnpm-lock.yaml
git commit -m "chore: 删除 4 处死依赖声明（doctor→tools、memory→config、server→memory-store、server→tools）"
```

---

### Task 4: S1-3 design-tokens 收编（desktop 接真实消费）

**决策依据：** design-tokens 是昔涟/甘雨/纳西妲主题色权威源（CYRENE_PALETTE/PRESENCE_PALETTES/css-variables 全套 29 导出），desktop/design-spec.ts:209 注释宣称"权威色值在 @cortex/design-tokens CYRENE_PALETTE"但零 import——收编而非删除。

**Files:**
- Modify: `packages/desktop/package.json`（dependencies 加 `@cortex/design-tokens: workspace:*`）
- Modify: `packages/desktop/src/renderer/presence/design-spec.ts`（真实 import CYRENE_PALETTE/PRESENCE_PALETTES 替换本地色值）

- [ ] **Step 1: 读 design-spec.ts 全貌，确定色值替换面**

读 `packages/desktop/src/renderer/presence/design-spec.ts`（227 行）——确认 L196-211 注释附近的色值定义（本地 palette 对象？），列出需要替换的本地定义。

- [ ] **Step 2: desktop 加依赖**

`packages/desktop/package.json` dependencies 添加 `"@cortex/design-tokens": "workspace:*"`。

- [ ] **Step 3: design-spec.ts 接真实 import**

将本地色值定义替换为：
```ts
import { CYRENE_PALETTE, PRESENCE_PALETTES, type PersonaPalette } from "@cortex/design-tokens";
```
删除注释 L196-211 的"权威在 design-tokens"宣称（现在真实引用了），本地色值改从 CYRENE_PALETTE 派生。

- [ ] **Step 4: 编译 + 测试**

Run: `pnpm exec tsc -b packages/desktop` + desktop 包测试
Expected: EXIT=0；design-tokens 包在 v4 审计中从"孤儿"变为"已消费"

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: design-tokens 收编——desktop 接真实消费（CYRENE_PALETTE 落地）"
```

---

### Task 5: S1-4 @cortex/factory 幽灵注释清除

**Files:**
- Modify: `packages/engine/src/bootstrap/factory/bootstrap.ts`（L2、L27 幽灵包声明）

- [ ] **Step 1: 修正文件头注释**

L2 `// @cortex/factory —— Bootstrap 主流` → `// @cortex/engine 内部 Bootstrap 配置流水线（包内模块，非独立包）`
L27 示例 `import { bootstrap } from "@cortex/factory"` → `import { bootstrap } from "../bootstrap/factory/bootstrap.js"`（或真实调用路径）

- [ ] **Step 2: 检查同目录其他文件是否有同类幽灵声明**

`packages/engine/src/bootstrap/factory/` 下所有文件 grep `@cortex/factory`，一并修正。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: 清除 @cortex/factory 幽灵包注释"
```

---

### Task 6: S1-5 daemon 健康端点真实化 + S1-6 WS 未知命令日志

**Files:**
- Modify: `packages/server/src/http/router.ts:144-161`（handleDaemonHealth）
- Modify: `packages/server/src/daemon.ts:327-328`（default 分支）
- Create: `packages/server/tests/daemon-health.test.ts`（守护测试）

- [ ] **Step 1: 写守护测试（先行）**

创建 `packages/server/tests/daemon-health.test.ts`：
```ts
import { describe, it, expect } from "vitest";
// 构造 HttpRouter 实例（注入 fake EngineHost：healthCollector 返回含 degradations 的 snapshot）
// 断言 /api/v1/daemon/health 响应含真实 totalDegradations（非恒 0）与 daemon.engineReady
```

- [ ] **Step 2: handleDaemonHealth 接真实快照**

`router.ts` L144-161 修改为：
```ts
private handleDaemonHealth(res: ServerResponse): void {
  const health = this.engine.healthCollector;
  const snapshot = health?.snapshot() ?? {
    timestamp: Date.now(), totalDegradations: 0, bySource: {},
    byLevel: {}, recentSources: [], degradedSince: null,
  };
  sendJson(res, 200, {
    data: {
      ...snapshot,
      daemon: {
        pid: process.pid,
        uptimeMs: process.uptime() * 1000,
        version: "0.1.0",
        engineReady: this.engine.healthCollector !== undefined,
        activeSessions: this.sessionManager.size,
      },
    },
  });
}
```
（与 handleHealth L127-142 同源；engineReady 用真实存在性判断）

- [ ] **Step 3: WS 未知命令日志**

`daemon.ts` L327-328：
```ts
default:
  console.warn(`[daemon] 未知 WS 命令类型: ${String((cmd as { type?: unknown }).type ?? "(missing)")}`);
  break;
```
（console.warn 经 console-bridge → ErrorReported → 哨兵/通知链路，满足验收"日志出现于 console-bridge 链路"）

- [ ] **Step 4: 测试验证**

Run: `pnpm exec vitest run packages/server --coverage=false`
Expected: 全过（新增守护测试断言健康端点非硬编码）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: daemon 健康端点接真实快照 + WS 未知命令不再静默"
```

---

### Task 7: S1-7 文档同步

**Files:**
- Modify: `PACKAGE_POSITIONING.md`（desktop 依赖列 L83：engine,llm,shared → client,shared；memory-store L66 补 telemetry；llm L53 补 telemetry）
- Modify: `docs/core/Cortex-架构映射-五流六层七原则.md`（@layer 覆盖率如实标注：75 文件中 24 个标注）
- Modify: `docs/analysis/refactor-blueprint-2026-06-20.md`（阶段 1 完成勾选）

- [ ] **Step 1: PACKAGE_POSITIONING.md 三处修正**

desktop 依赖列改 `client, shared`；memory-store 依赖列加 `telemetry`；llm 依赖列加 `telemetry`。

- [ ] **Step 2: 五流六层文档如实标注**

标注现状："engine/src 75 文件仅 24 个含 @layer 标注（治理 9/规划-执行 8/技能-工具 2/交互 1/记忆 1/执行 1），'基础设施'标签 0 命中——阶段 3 S3-10 机制化时补齐"。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: PACKAGE_POSITIONING 依赖列修正 + @layer 覆盖率如实标注"
```

---

### Task 8: S1-8 + S1-9 A 类迁移声明 22 条核对表

**Files:**
- Create: `docs/auditing/refactor-phase1-2026-06-20.md`（追加核对表）
- Modify（视核对结果）：多文件

- [ ] **Step 1: memory-store.ts:499 FIND-002 标记清理**

`packages/memory-store/src/memory-store.ts:499` 的 `@see FIND-002 已核实为误报` 注释删除或改写为简洁说明。

- [ ] **Step 2: A 类 22 条逐条核对**

按 spec 附录清单逐条检查（每条：注释声明 vs 实际状态），输出核对表到归档文档：
- bootstrap-engine.ts:340（模型路由注入——已接线？）
- degradation-boundary.ts:25/37/43（注入完整性）
- loop-strategy-registry.ts:42/44（setter 是否被调——Agent B 已确认 setDefaultPipeline/setDirectPipeline 死代码 → 记录"阶段 3 收敛"）
- meta-agent.ts:698（系统提示已迁移——验证 config/constants/meta-agent.ts 存在且 engine 引用新源）
- pool-aware.ts:27（observer 注入——验证）
- memory-store/schema.ts:4（常量迁 config——验证双源）
- toolkit.ts:61（M6 修复已迁——验证 toolkit 残留）
- query-loop.ts:45（AGENT_TYPE_TO_DIR 已迁——验证双源）
- 其余按清单

- [ ] **Step 3: 核对结果分类处理**

- 已干净迁移 → 标注 ✅
- 假迁移（双源残留）→ 本阶段修正或列入阶段 3 清单
- 设计说明类 → 标注"非漂移"

- [ ] **Step 4: 归档 + Commit**

```bash
git add -A
git commit -m "docs: A 类迁移声明 22 条核对表归档（阶段 1）"
```

---

### Task 9: 守护测试补全 + 全量回归 + 归档闭环

**Files:**
- Create: `docs/auditing/refactor-phase1-2026-06-20.md`（验收证据段）

- [ ] **Step 1: 门禁五段全量回归**

Run: `node scripts/ci-gate.ts --coverage`（或 pnpm 对应脚本）
Expected: CI_GATE_EXIT=0，vitest 全绿，coverage 全达标

- [ ] **Step 2: v4 零消费审计对比**

Run: 复用 v4 审计脚本逻辑（.tmp-audit-v4.mjs 已删除——重建或复用归档版本）
Expected: DEAD 40 下降（design-tokens 收编后不再孤儿）、shared LEAK 下降、三 enum 从 shared 迁移后 PUB_API 变化记录

- [ ] **Step 3: 验收标准逐条勾选**

对照 spec §1.2 七条验收标准，每条附证据（命令输出/测试结果）写入归档文档。

- [ ] **Step 4: 遗留项记录**

未闭合项（如 shared 接口迁 config 的边界收敛——若本阶段未全做）记录原因与阶段 3 计划。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "docs: 阶段 1 验收归档（真相复位完成）"
```

---

## Self-Review 记录

- **Spec 覆盖**：S1-1→Task2、S1-2→Task3、S1-3→Task4、S1-4→Task5、S1-5/6→Task6、S1-7→Task7、S1-8/9→Task8、验收与归档→Task1/9 ✅
- **已知风险**：Task2 Step 4 的 shared 接口迁移范围需要实施时确认（ToolDefinition 等接口若残留会编译失败——已给出决策：一并迁 config）；36 文件机械迁移依赖脚本正确性（Step 2 review 缓解）
- **类型一致性**：守护测试文件路径与 spec §1.3 一致（server/tests/daemon-health.test.ts、shared/tests/toolkit-single-source.test.ts）
