// @ci: contract
// ============================================================
// @cortex/tools — 依赖分层契约门禁
//
// 扫描真实 workspace，强制三条不变量：
//   1. 契约完整性 — 每个 workspace 包都在 CORTEX_LAYER_CONTRACT 登记，
//      且契约无指向不存在包的陈旧条目（双向对齐）
//   2. 严格 DAG   — 依赖图无循环
//   3. 分层单向   — 无「低层依赖高层」违规
//
// 这是 PACKAGE_POSITIONING.md 边界原则 §1/§4 的可执行落地。
// 任何新增包 / 新增跨包依赖若破坏分层，此门禁即刻阻断。
// ============================================================

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  findProjectRoot,
  collectPackages,
  collectDeps,
  buildEdges,
  detectCycles,
  detectLayerViolations,
  CORTEX_LAYER_CONTRACT,
} from "../src/index.js";

// ── 扫描真实仓库（一次性，供各断言共享） ──
const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const allPkgs = collectPackages(projectRoot);
const workspacePkgs = allPkgs.filter((p) => !p.isRoot);
const deps = collectDeps(projectRoot, allPkgs);
// includeDev=false：分层约束仅针对运行时依赖（devDep 走独立版本漂移检测）
const edges = buildEdges(allPkgs, deps, false);

describe("依赖分层契约 — 完整性", () => {
  it("每个 workspace 包都在契约中登记", () => {
    const unregistered = workspacePkgs
      .map((p) => p.id)
      .filter((id) => CORTEX_LAYER_CONTRACT[id] === undefined);
    expect(
      unregistered,
      `未登记的包（请在 layer-contract.ts 补充层级）: ${unregistered.join(", ")}`,
    ).toEqual([]);
  });

  it("契约无指向不存在包的陈旧条目", () => {
    const actualIds = new Set(workspacePkgs.map((p) => p.id));
    const stale = Object.keys(CORTEX_LAYER_CONTRACT).filter(
      (id) => !actualIds.has(id),
    );
    expect(
      stale,
      `契约中的陈旧条目（对应包已不存在）: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("契约恰好覆盖 29 个包", () => {
    expect(workspacePkgs.length).toBe(29);
    expect(Object.keys(CORTEX_LAYER_CONTRACT).length).toBe(29);
  });
});

describe("依赖分层契约 — 严格 DAG", () => {
  it("依赖图无循环", () => {
    const cycles = detectCycles(edges);
    const rendered = cycles.map((c) => c.path.join(" → "));
    expect(rendered, `检测到循环依赖: ${rendered.join(" | ")}`).toEqual([]);
  });
});

describe("依赖分层契约 — 单向分层", () => {
  it("无「低层依赖高层」违规", () => {
    const violations = detectLayerViolations(edges, CORTEX_LAYER_CONTRACT);
    const rendered = violations.map(
      (v) => `${v.from}(L${v.fromLayer}) → ${v.to}(L${v.toLayer})`,
    );
    expect(
      rendered,
      `检测到分层违规（低层反向依赖高层）:\n  ${rendered.join("\n  ")}`,
    ).toEqual([]);
  });
});
