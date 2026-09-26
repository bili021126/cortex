// @layer L0 基础 —— monorepo 架构契约（与 layer-contract 同源，切面正交）
// ============================================================
// @cortex/tools — 架构流契约（可执行真相源）
//
// 与 layer-contract.ts 的分工：
//   layer-contract  ：「这个包在依赖 DAG 的哪一层」——依赖约束，管**能不能依赖**
//   flow-contract   ：「这段代码属于哪条行为流」——行为归属，管**归属哪条流**
// 二者正交，合起来才是完整的功能体系。
//
// 数据源：packages/config/src/data/architecture-flows.json（单一真相源）。
// 本文件只做校验与派生，不复制数据——避免第二份真相。
//
// 四条不变量（由 tests/flow-contract.test.ts 强制）：
//   1. 路径真实     —— 每条 directories 声明的路径必须存在，且落在真实包内
//   2. 包全覆盖     —— 每个 workspace 包至少被一条流认领（双向：不得认领不存在的包）
//   3. 模块全归类   —— 未被任何流认领的 src 顶层子目录必须与 knownUnassigned 完全相等
//   4. 词汇闭合     —— flows[].layer / principles 必须在 layers / principles 名单内
// ============================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORTEX_LAYER_CONTRACT } from "./layer-contract.js";

/** 架构流映射的数据形状（与 @cortex/config 的 ArchitectureFlowsConfig 结构一致；此处为本地镜像以避免 L0 同层新依赖） */
export interface FlowEntry {
  id: string;
  name: string;
  layer: string;
  question: string;
  directories: string[];
  principles: string[];
}

export interface FlowMap {
  flows: FlowEntry[];
  principles: string[];
  layers: string[];
  knownUnassigned: string[];
}

/** 数据文件相对仓库根的路径 */
export const FLOW_MAP_RELATIVE_PATH = "packages/config/src/data/architecture-flows.json";

/** 读取架构流映射数据文件 */
export function loadFlowMap(projectRoot: string): FlowMap {
  const file = join(projectRoot, FLOW_MAP_RELATIVE_PATH);
  const raw = JSON.parse(readFileSync(file, "utf-8")) as FlowMap;
  return raw;
}

/** 路径 → 所属包 id（null = 不在任何包内） */
export function packageOfPath(relPath: string): string | null {
  const m = relPath.replace(/\\/g, "/").match(/^packages\/([\w-]+)(?:\/|$)/);
  return m?.[1] ?? null;
}

/**
 * 校验 1：每条声明的路径必须存在，且落在真实包内。
 * 返回问题清单（空 = 通过）。
 */
export function detectMissingPaths(projectRoot: string, map: FlowMap): string[] {
  const problems: string[] = [];
  for (const flow of map.flows) {
    for (const rel of flow.directories) {
      if (!existsSync(join(projectRoot, rel))) {
        problems.push(`[${flow.id}] 路径不存在: ${rel}`);
        continue;
      }
      const pkg = packageOfPath(rel);
      if (!pkg || CORTEX_LAYER_CONTRACT[pkg] === undefined) {
        problems.push(`[${flow.id}] 路径不属于任何已登记包: ${rel}`);
      }
    }
  }
  return problems;
}

/**
 * 校验 2：包覆盖双向对齐。
 * 返回 { unclaimed, phantom }——
 *   unclaimed：真实包但没有任何流认领
 *   phantom  ：流认领了但并非真实包
 */
export function detectPackageCoverage(
  workspacePkgIds: string[],
  map: FlowMap,
): { unclaimed: string[]; phantom: string[] } {
  const claimed = new Set<string>();
  for (const flow of map.flows) {
    for (const rel of flow.directories) {
      const pkg = packageOfPath(rel);
      if (pkg) claimed.add(pkg);
    }
  }
  const real = new Set(workspacePkgIds);
  return {
    unclaimed: workspacePkgIds.filter((p) => !claimed.has(p)),
    phantom: [...claimed].filter((p) => !real.has(p)),
  };
}

/**
 * 计算未被任何流认领的 src 顶层子目录。
 * 只统计目录——包 src 下的散文件读作包级实现细节，不构成模块边界。
 */
export function collectUnassignedModules(projectRoot: string, map: FlowMap): string[] {
  const claimed = map.flows.flatMap((f) => f.directories).map((d) => d.replace(/\\/g, "/"));
  const isCovered = (rel: string): boolean =>
    claimed.some((c) => rel === c || rel.startsWith(`${c}/`) || c.startsWith(`${rel}/`));

  const out: string[] = [];
  for (const pkg of Object.keys(CORTEX_LAYER_CONTRACT)) {
    const src = join(projectRoot, "packages", pkg, "src");
    if (!existsSync(src) || !statSync(src).isDirectory()) continue;
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `packages/${pkg}/src/${entry.name}`;
      if (!isCovered(rel)) out.push(rel);
    }
  }
  return out.sort();
}

/**
 * 校验 4：词汇闭合。
 * flows[].layer 必须在 layers 内；flows[].principles 必须在 principles 内。
 */
export function detectVocabularyViolations(map: FlowMap): string[] {
  const problems: string[] = [];
  const layers = new Set(map.layers);
  const principles = new Set(map.principles);
  for (const flow of map.flows) {
    if (!layers.has(flow.layer)) {
      problems.push(`[${flow.id}] layer "${flow.layer}" 不在 layers 名单内`);
    }
    for (const p of flow.principles) {
      if (!principles.has(p)) {
        problems.push(`[${flow.id}] principle "${p}" 不在 principles 名单内`);
      }
    }
  }
  return problems;
}
