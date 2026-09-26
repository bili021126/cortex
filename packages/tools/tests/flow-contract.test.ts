// @ci: contract
// ============================================================
// @cortex/tools — 架构流契约门禁
//
// 强制四条不变量，让「五流六层」与 L0–L4 两张图接上：
//   1. 路径真实     —— 每条声明的路径存在，且落在已登记包内
//   2. 包全覆盖     —— 每个 workspace 包被至少一条流认领（双向，无幽灵包）
//   3. 模块全归类   —— 未认领的 src 顶层子目录 === knownUnassigned（双向）
//   4. 词汇闭合     —— layer / principles 必须在名单内
//
// 这是 docs/core/Cortex-架构映射-五流六层七原则.md 的可执行落地：
//   该文档自称「每个节点标注文件、函数和行号」，但 2026-09-26 实测其 45 条
//   文件引用中 12 条已搬家、2 条已消失、1 条行号越界；且只覆盖 16/28 包。
//   本门禁把「流 ↔ 代码」的对应关系从散文搬进数据文件并钉死，
//   使代码重构后坐标系不再静默漂移。
// ============================================================

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  findProjectRoot,
  collectPackages,
  CORTEX_LAYER_CONTRACT,
  loadFlowMap,
  detectMissingPaths,
  detectPackageCoverage,
  collectUnassignedModules,
  detectVocabularyViolations,
} from "../src/index.js";

// ── 扫描真实仓库（一次性，供各断言共享） ──
const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const workspacePkgIds = collectPackages(projectRoot)
  .filter((p) => !p.isRoot)
  .map((p) => p.id);
const flowMap = loadFlowMap(projectRoot);

describe("架构流契约 — 路径真实", () => {
  it("每条声明的目录/文件都存在，且落在已登记包内", () => {
    const problems = detectMissingPaths(projectRoot, flowMap);
    expect(problems, `路径问题:\n  ${problems.join("\n  ")}`).toEqual([]);
  });
});

describe("架构流契约 — 包全覆盖（双向）", () => {
  it("每个 workspace 包都被至少一条流认领", () => {
    const { unclaimed } = detectPackageCoverage(workspacePkgIds, flowMap);
    expect(
      unclaimed,
      `以下包未被任何流认领（请在 architecture-flows.json 归类）: ${unclaimed.join(", ")}`,
    ).toEqual([]);
  });

  it("没有流认领不存在的包（防陈旧条目）", () => {
    const { phantom } = detectPackageCoverage(workspacePkgIds, flowMap);
    expect(phantom, `以下认领条目对应包已不存在: ${phantom.join(", ")}`).toEqual([]);
  });

  it("认领的包与分层契约的包集合一致", () => {
    const covered = detectPackageCoverage(workspacePkgIds, flowMap);
    expect(covered.unclaimed).toHaveLength(0);
    expect(covered.phantom).toHaveLength(0);
    // 两张坐标系的包集合必须同为一个
    expect([...workspacePkgIds].sort()).toEqual(Object.keys(CORTEX_LAYER_CONTRACT).sort());
  });
});

describe("架构流契约 — 模块全归类（双向）", () => {
  it("未被任何流认领的 src 顶层子目录，必须与 knownUnassigned 完全相等", () => {
    const actual = collectUnassignedModules(projectRoot, flowMap);
    const declared = [...flowMap.knownUnassigned].sort();
    expect(
      actual,
      `归类漂移——新增模块须在 architecture-flows.json 归类，或显式登记进 knownUnassigned。\n` +
        `  实际未归类: ${actual.join(", ") || "(无)"}\n` +
        `  声明未归类: ${declared.join(", ") || "(无)"}`,
    ).toEqual(declared);
  });
});

describe("架构流契约 — 词汇闭合", () => {
  it("layer 必须在 layers 名单内，principles 必须在 principles 名单内", () => {
    const problems = detectVocabularyViolations(flowMap);
    expect(problems, `词汇问题:\n  ${problems.join("\n  ")}`).toEqual([]);
  });

  it("六层与七原则数量正确", () => {
    expect(flowMap.layers).toHaveLength(6);
    expect(flowMap.principles).toHaveLength(7);
    expect(flowMap.flows).toHaveLength(6);
  });

  it("原则五（统一可观测）是唯一被全部六层引用的原则", () => {
    const counts = new Map<string, number>();
    for (const f of flowMap.flows) {
      for (const p of f.principles) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    // 与 docs/core/Cortex-架构映射-五流六层七原则.md §0.1「原则五是全流约束」一致
    expect(counts.get("统一可观测")).toBe(flowMap.flows.length);
  });
});
