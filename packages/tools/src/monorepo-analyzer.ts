#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * ═══ Monorepo Analyzer ═══
 *
 * 单文件 TypeScript 脚本，用 `npx tsx tools/monorepo-analyzer.ts` 运行。
 *
 * 功能：
 *   1️⃣ 依赖图     — 展示 packages/* 之间的 workspace 依赖关系（邻接表 + 文本图）
 *   2️⃣ 循环依赖   — DFS 检测包级别循环依赖
 *   3️⃣ 版本漂移   — 检测同名依赖在不同包中版本不一致
 *
 * 参数：
 *   --json          输出 JSON 格式（默认 text 人类可读）
 *   --output <path> 输出到文件（可选）
 *   --ignore <dep>  忽略指定依赖的漂移检测（可重复）
 *   --include-dev   循环依赖检测包含 devDependencies
 *   --verbose       显示所有依赖详情（含单出现依赖）
 *
 * 退出码：
 *   0  干净
 *   1  检测到漂移 或 循环依赖
 *   2  异常（文件读取失败、JSON 解析错误等）
 *
 * 原位于 .cortex/archive/e2e-outputs/.../closed-loop-test/tools/monorepo-analyzer.ts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { cwd, argv } from 'node:process';
import { fileURLToPath } from 'node:url';

/* ════════════════════════════════════════════════════════════════════════════
 * 类型定义
 * ════════════════════════════════════════════════════════════════════════════ */

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface PkgInfo {
  id: string;
  name: string;
  version: string;
  filePath: string;
  relPath: string;
  isRoot: boolean;
  layer: number;
}

interface DepEntry {
  depName: string;
  pkgId: string;
  pkgName: string;
  filePath: string;
  section: 'dependencies' | 'devDependencies' | 'peerDependencies';
  version: string;
  isWorkspaceStar: boolean;
  isWorkspaceProtocol: boolean;
  isOpenVersion: boolean;
}

interface DriftItem {
  dependency: string;
  occurrences: number;
  versions: Record<string, string>;
  recommended: string;
  reason: string;
}

export interface Edge {
  from: string;
  to: string;
  type: 'dependencies' | 'devDependencies' | 'peerDependencies';
}

export interface CycleInfo {
  path: string[];
  packages: string[];
}

export interface AnalyzerMeta {
  scannedAt: string;
  filesScanned: number;
  dependenciesChecked: number;
  status: 'clean' | 'drift' | 'cycle' | 'cycle+drift' | 'error';
  projectRoot: string;
}

export interface AnalyzerOutput {
  meta: AnalyzerMeta;
  packages: PkgInfo[];
  dependencyGraph: {
    edges: Edge[];
    adjacency: Record<string, string[]>;
    dot: string;
    mermaid: string;
  };
  layers: string[][];
  drifts: DriftItem[];
  allDeps: Record<string, Record<string, string>>;
  cycles: CycleInfo[];
  hasCycles: boolean;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 工具函数
 * ════════════════════════════════════════════════════════════════════════════ */

function semverScore(v: string): number {
  const cleaned = v.replace(/^[\^~>=<]/, '');
  const parts = cleaned.split('.').map((s) => parseInt(s, 10) || 0);
  return parts[0]! * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

function isWorkspaceStar(v: string): boolean {
  return v.trim() === 'workspace:*';
}

function isWorkspaceProtocol(v: string): boolean {
  return v.trim().startsWith('workspace:');
}

function isOpenVersion(v: string): boolean {
  const t = v.trim();
  return t === '*' || t === 'latest';
}

function isCortexInternal(name: string): boolean {
  return name.startsWith('@cortex/');
}

function nameToId(name: string): string {
  const m = name.match(/@[^/]+\/(.+)/);
  return m ? m[1]! : name;
}

function nowISO(): string {
  return new Date().toISOString();
}

function cjkWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u4e00-\u9fff\u3000-\u30ff\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

function padDisplay(s: string, target: number): string {
  const current = cjkWidth(s);
  const diff = target - current;
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

/* ════════════════════════════════════════════════════════════════════════════
 * 核心逻辑
 * ════════════════════════════════════════════════════════════════════════════ */

export function findProjectRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'packages'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve('.');
}

function getSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => {
      try { return statSync(join(dir, f)).isDirectory(); }
      catch { return false; }
    });
  } catch {
    return [];
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function collectPackages(projectRoot: string): PkgInfo[] {
  const packages: PkgInfo[] = [];

  const rootPkgPath = join(projectRoot, 'package.json');
  const rootPkg = readJson<PackageJson>(rootPkgPath);
  if (rootPkg) {
    packages.push({
      id: 'root',
      name: rootPkg.name || '(root)',
      version: rootPkg.version || '0.0.0',
      filePath: rootPkgPath,
      relPath: 'package.json',
      isRoot: true,
      layer: -1,
    });
  }

  const packagesDir = join(projectRoot, 'packages');
  if (!existsSync(packagesDir)) return packages;

  const subdirs = getSubdirs(packagesDir);
  for (const entry of subdirs) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    const pkg = readJson<PackageJson>(pkgPath);
    if (!pkg) continue;

    packages.push({
      id: entry,
      name: pkg.name || `@cortex/${entry}`,
      version: pkg.version || '0.0.0',
      filePath: pkgPath,
      relPath: `packages/${entry}/package.json`,
      isRoot: false,
      layer: -1,
    });
  }

  return packages;
}

export function collectDeps(projectRoot: string, packages: PkgInfo[]): DepEntry[] {
  const entries: DepEntry[] = [];
  const sections = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

  for (const pkg of packages) {
    const json = readJson<PackageJson>(pkg.filePath);
    if (!json) continue;

    for (const section of sections) {
      const deps = json[section];
      if (!deps) continue;

      for (const [depName, versionRaw] of Object.entries(deps)) {
        const version = versionRaw.trim();
        entries.push({
          depName,
          pkgId: pkg.id,
          pkgName: pkg.name,
          filePath: pkg.relPath,
          section,
          version,
          isWorkspaceStar: isWorkspaceStar(version),
          isWorkspaceProtocol: isWorkspaceProtocol(version),
          isOpenVersion: isOpenVersion(version),
        });
      }
    }
  }

  return entries;
}

export function buildEdges(packages: PkgInfo[], deps: DepEntry[], includeDev: boolean): Edge[] {
  const edges: Edge[] = [];

  for (const dep of deps) {
    if (!isCortexInternal(dep.depName)) continue;

    const targetId = nameToId(dep.depName);
    const targetPkg = packages.find((p) => p.id === targetId);
    if (!targetPkg) continue;

    if (dep.section === 'devDependencies' && !includeDev) continue;

    edges.push({
      from: dep.pkgId,
      to: targetId,
      type: dep.section,
    });
  }

  return edges;
}

/**
 * 检测包级别的循环依赖（DFS 回边检测）。
 *
 * 局限性：简单 DFS 递归栈检测只能发现从当前遍历顺序可达的回边。
 * 某些拓扑结构（如多个不同入度的环汇聚到同一节点）下可能遗漏部分循环。
 * 对于需要完整循环清单的场景（如 CI 门禁），建议使用 Johnson's algorithm
 * 或 Tarjan's SCC 算法替代。
 */
export function detectCycles(edges: Edge[]): CycleInfo[] {
  const adj: Record<string, string[]> = {};
  for (const edge of edges) {
    if (!adj[edge.from]) adj[edge.from] = [];
    if (!adj[edge.to]) adj[edge.to] = [];
    if (!adj[edge.from]!.includes(edge.to)) adj[edge.from]!.push(edge.to);
  }

  const cycles: CycleInfo[] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function normalizePath(p: string[]): string[] {
    if (p.length <= 1) return [...p, p[0]!];
    let minIdx = 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i]! < p[minIdx]!) minIdx = i;
    }
    const rotated = [...p.slice(minIdx), ...p.slice(0, minIdx)];
    rotated.push(rotated[0]!);
    return rotated;
  }

  function dfs(node: string) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = adj[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recStack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = path.slice(cycleStart);
          const normalized = normalizePath(cycle);
          const isDuplicate = cycles.some(
            (c) => c.path.length === normalized.length &&
                   c.path.every((v, i) => v === normalized[i]),
          );
          if (!isDuplicate) {
            cycles.push({
              path: normalized,
              packages: [...new Set(normalized)],
            });
          }
        }
      }
    }

    path.pop();
    recStack.delete(node);
  }

  const allNodes = Object.keys(adj);
  for (const node of allNodes) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

export function detectDrifts(deps: DepEntry[], ignoreList: string[], verbose: boolean): { drifts: DriftItem[]; allDeps: Record<string, Record<string, string>> } {
  const groups: Record<string, DepEntry[]> = {};
  const allDeps: Record<string, Record<string, string>> = {};

  for (const dep of deps) {
    if (dep.isWorkspaceStar && isCortexInternal(dep.depName)) continue;

    if (!groups[dep.depName]) groups[dep.depName] = [];
    groups[dep.depName]!.push(dep);

    if (!allDeps[dep.depName]) allDeps[dep.depName] = {};
    allDeps[dep.depName]![dep.pkgId] = dep.version;
  }

  const drifts: DriftItem[] = [];

  for (const [depName, entries] of Object.entries(groups)) {
    if (ignoreList.includes(depName)) continue;
    if (entries.length <= 1 && !verbose) continue;

    const nonStarVersions = entries
      .filter((e) => !e.isWorkspaceStar)
      .map((e) => e.version);
    const uniqueNonStar = [...new Set(nonStarVersions)];

    const hasDrift = entries.length > 1 && uniqueNonStar.length > 1;
    if (!hasDrift) continue;

    const versions: Record<string, string> = {};
    for (const e of entries) {
      versions[e.pkgId] = e.version;
    }

    const recommended = recommendVersion(entries);

    drifts.push({
      dependency: depName,
      occurrences: entries.length,
      versions,
      recommended: recommended.version,
      reason: recommended.reason,
    });
  }

  drifts.sort((a, b) => a.dependency.localeCompare(b.dependency));

  return { drifts, allDeps };
}

function recommendVersion(entries: DepEntry[]): { version: string; reason: string } {
  const versions = entries
    .filter((e) => !e.isWorkspaceStar)
    .map((e) => e.version);

  if (versions.length === 0) {
    return { version: 'workspace:*', reason: '仅 workspace:* 出现' };
  }

  const counts = new Map<string, number>();
  for (const v of versions) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return semverScore(b[0]) - semverScore(a[0]);
  });

  const bestVersion = sorted[0]![0];
  const bestCount = sorted[0]![1];
  const total = versions.length;

  if (bestCount > 1 && bestCount > total / 2) {
    return { version: bestVersion, reason: `多数派版本（${bestCount}/${total}）` };
  }
  if (bestCount === 1 && sorted.length > 1) {
    return { version: bestVersion, reason: '最高版本' };
  }
  const rootEntry = entries.find((e) => e.pkgId === 'root');
  if (rootEntry && !rootEntry.isWorkspaceStar) {
    return { version: rootEntry.version, reason: '根版本优先' };
  }

  return { version: bestVersion, reason: '自动选择' };
}

export function generateDot(packages: PkgInfo[], edges: Edge[], cycles: CycleInfo[]): string {
  const lines: string[] = [];
  lines.push('digraph monorepo {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded, fontname=monospace];');
  lines.push('  edge [fontname=monospace, fontsize=10];');
  lines.push('');

  const cyclePkgs = new Set(cycles.flatMap((c) => c.packages));
  for (const pkg of packages) {
    if (pkg.isRoot) continue;
    const color = cyclePkgs.has(pkg.id) ? 'coral' : 'lightblue';
    const style = cyclePkgs.has(pkg.id) ? 'filled,bold' : 'filled';
    lines.push(`  "${pkg.id}" [label="${pkg.id}\\n${pkg.version}", fillcolor=${color}, style="${style}"];`);
  }
  lines.push('');

  for (const edge of edges) {
    const style = edge.type === 'devDependencies' ? 'dashed' : 'solid';
    const color = edge.type === 'devDependencies' ? '#888' : '#333';
    lines.push(`  "${edge.from}" -> "${edge.to}" [style=${style}, color=${color}];`);
  }

  if (cycles.length > 0) {
    lines.push('');
    lines.push('  // ⚠️ 循环依赖路径');
    for (const cycle of cycles) {
      const pathStr = cycle.path.join('" -> "');
      lines.push(`  edge [color=red, penwidth=2, style=bold];`);
      lines.push(`  "${pathStr}";`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * 动态计算分层：layer = max(被依赖者 layer) + 1，叶子节点（无内部依赖）layer=0。
 *
 * 当依赖图存在循环时，循环中的节点会被赋予同一层级（打断递归），
 * 从而避免栈溢出。循环层级的节点会标注在返回的 `cyclesInLayers` 中。
 *
 * @returns {{ layers, pkgLayers }} — layers 按层分组，pkgLayers 为各包的层号映射
 */
export function computeLayers(
  packages: PkgInfo[],
  edges: Edge[],
): { layers: string[][]; pkgLayers: Map<string, number> } {
  const pkgIds = new Set(packages.filter((p) => !p.isRoot).map((p) => p.id));

  // 构建邻接：from 依赖 to，即 to 是 from 的前置层
  const depOf: Map<string, string[]> = new Map();
  for (const id of pkgIds) depOf.set(id, []);
  for (const edge of edges) {
    if (pkgIds.has(edge.from) && pkgIds.has(edge.to)) {
      const deps = depOf.get(edge.from);
      if (deps) deps.push(edge.to);
    }
  }

  // 递归计算深度，visiting Set 防止循环依赖导致栈溢出
  const depthCache = new Map<string, number>();
  function getDepth(id: string, visiting: Set<string> = new Set()): number {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;

    // 检测到循环：当前节点已在递归栈中 → 打断，赋予 depth 0
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);

    const deps = depOf.get(id) ?? [];
    if (deps.length === 0) {
      visiting.delete(id);
      depthCache.set(id, 0);
      return 0;
    }

    let max = 0;
    for (const dep of deps) {
      const d = getDepth(dep, visiting) + 1;
      if (d > max) max = d;
    }

    visiting.delete(id);
    depthCache.set(id, max);
    return max;
  }

  // 计算各包的层号，返回 Map 而非原地修改 PkgInfo
  const pkgLayers = new Map<string, number>();
  for (const pkg of packages) {
    if (pkg.isRoot) continue;
    pkgLayers.set(pkg.id, getDepth(pkg.id));
  }

  // 同步写回 PkgInfo.layer（保持向后兼容，供调用方用 pkg.layer 属性）
  for (const [id, layer] of pkgLayers) {
    const pkg = packages.find((p) => p.id === id);
    if (pkg) pkg.layer = layer;
  }

  // 按层分组
  const maxLayer = Math.max(...pkgLayers.values(), 0);
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const pkg of packages) {
    if (pkg.isRoot) continue;
    layers[pkgLayers.get(pkg.id) ?? 0]!.push(pkg.id);
  }

  return { layers, pkgLayers };
}

/** 生成 Mermaid flowchart（适合 GitHub/GitLab Markdown 渲染） */
export function generateMermaid(packages: PkgInfo[], edges: Edge[], cycles: CycleInfo[]): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('graph TD');

  const cyclePkgs = new Set(cycles.flatMap((c) => c.packages));
  for (const pkg of packages) {
    if (pkg.isRoot) continue;
    const label = cyclePkgs.has(pkg.id) ? `${pkg.id}⚠️` : pkg.id;
    lines.push(`  ${pkg.id}["${label}"]`);
  }
  lines.push('');

  for (const edge of edges) {
    const arrow = edge.type === 'devDependencies' ? '-.->|dev|' : '-->';
    lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
  }

  lines.push('```');
  return lines.join('\n');
}

/* ════════════════════════════════════════════════════════════════════════════
 * 输出格式化
 * ════════════════════════════════════════════════════════════════════════════ */

function formatText(output: AnalyzerOutput, _verbose: boolean): string {
  const lines: string[] = [];
  const W = '─'.repeat(58);

  lines.push('');
  lines.push('  ═══ Monorepo Analyzer 报告 ═══');
  lines.push(`  扫描时间: ${output.meta.scannedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`);
  lines.push(`  扫描文件: ${output.meta.filesScanned} 个`);
  lines.push(`  检查依赖: ${output.meta.dependenciesChecked} 项（去重）`);
  lines.push(`  项目路径: ${output.meta.projectRoot}`);
  lines.push(`  ${W}`);
  lines.push('');

  lines.push('  ─── 1. 包清单（按依赖层级）───');
  const nonRoot = output.packages.filter((p) => !p.isRoot);
  if (nonRoot.length > 0) {
    const h = '  包名                   版本      层级  路径';
    lines.push(h);
    lines.push('  ' + '─'.repeat(cjkWidth(h)));
    // 按层级排序
    const sorted = [...nonRoot].sort((a, b) => a.layer - b.layer || a.name.localeCompare(b.name));
    for (const pkg of sorted) {
      const name = padDisplay(pkg.name, 24);
      const ver = pkg.version.padEnd(9);
      const layer = `L${pkg.layer}`.padEnd(5);
      lines.push(`  ${name} ${ver} ${layer} ${pkg.relPath}`);
    }
  }
  lines.push('');

  lines.push('  ─── 2. 依赖图（内部 workspace 依赖）───');
  const edges = output.dependencyGraph.edges;
  if (edges.length === 0) {
    lines.push('  （无内部 workspace 依赖）');
  } else {
    const fromGroups: Record<string, Edge[]> = {};
    for (const edge of edges) {
      if (!fromGroups[edge.from]) fromGroups[edge.from] = [];
      fromGroups[edge.from]!.push(edge);
    }

    const pkgMap = new Map(output.packages.map((p) => [p.id, p]));
    const sortedFrom = Object.keys(fromGroups).sort((a, b) => {
      const la = pkgMap.get(a)?.layer ?? 99;
      const lb = pkgMap.get(b)?.layer ?? 99;
      return la - lb;
    });

    for (const from of sortedFrom) {
      const edgeList = fromGroups[from]!;
      const targets = edgeList.map((e) => {
        const suffix = e.type === 'devDependencies' ? '[dev]' : '';
        const cycleMark = output.cycles.some((c) => c.packages.includes(e.from) && c.packages.includes(e.to))
          ? ' ⚠️' : '';
        return `${e.to}${suffix}${cycleMark}`;
      });
      lines.push(`  ${from}  →  ${targets.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('  ─── 3. 循环依赖检测 ───');
  if (output.cycles.length === 0) {
    lines.push('  ✅ 未发现循环依赖');
  } else {
    for (let i = 0; i < output.cycles.length; i++) {
      const cycle = output.cycles[i]!;
      lines.push(`  ❌ 循环 #${i + 1}: ${cycle.path.join(' → ')}`);
      lines.push(`     涉及包: ${cycle.packages.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('  ─── 4. 版本漂移检测 ───');
  if (output.drifts.length === 0) {
    lines.push('  ✅ 未发现版本漂移（所有同名依赖版本一致）');
  } else {
    lines.push(`  ❌ 发现 ${output.drifts.length} 处版本漂移:\n`);
    for (let i = 0; i < output.drifts.length; i++) {
      const d = output.drifts[i]!;
      lines.push(`  ${i + 1}. ${d.dependency}（出现 ${d.occurrences} 次）`);
      for (const [pkgId, ver] of Object.entries(d.versions)) {
        const marker = ver !== d.recommended ? '  ← 偏移' : '';
        lines.push(`     ${padDisplay(pkgId, 12)} ${ver}${marker}`);
      }
      lines.push(`     → 建议统一为 ${d.recommended}（${d.reason}）`);
      lines.push('');
    }
  }

  const W2 = '─'.repeat(58);
  const statusIcon = output.meta.status === 'clean' ? '✅' : '❌';
  lines.push(`  ${W2}`);
  lines.push(`  总体状态: ${statusIcon} ${output.meta.status}`);
  if (output.cycles.length > 0) {
    lines.push(`  循环依赖: ${output.cycles.length} 处`);
  }
  if (output.drifts.length > 0) {
    lines.push(`  版本漂移: ${output.drifts.length} 处`);
  }
  lines.push(`  ${W2}`);
  lines.push('');

  return lines.join('\n');
}

function formatJSON(output: AnalyzerOutput): string {
  return JSON.stringify(output, null, 2);
}

/* ════════════════════════════════════════════════════════════════════════════
 * CLI 入口
 * ════════════════════════════════════════════════════════════════════════════ */

function main(): number {
  const args = argv.slice(2);
  const useJSON = args.includes('--json');
  const verbose = args.includes('--verbose');
  const includeDev = args.includes('--include-dev');
  const useMermaid = args.includes('--mermaid');

  // --project-path / -p：分析目标项目路径
  const pathIdx = args.indexOf('--project-path');
  const shortIdx = args.indexOf('-p');
  const explicitPath = (pathIdx !== -1 && pathIdx + 1 < args.length)
    ? args[pathIdx + 1]
    : (shortIdx !== -1 && shortIdx + 1 < args.length)
      ? args[shortIdx + 1]
      : undefined;

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 && outputIdx + 1 < args.length
    ? args[outputIdx + 1]
    : undefined;

  const ignoreIdx = args.indexOf('--ignore');
  const ignoreList: string[] = [];
  if (ignoreIdx !== -1) {
    for (let i = ignoreIdx + 1; i < args.length; i++) {
      if (args[i]!.startsWith('-')) break;
      ignoreList.push(args[i]!);
    }
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  ═══ Monorepo Analyzer ═══

  用法:
    npx tsx packages/tools/src/monorepo-analyzer.ts [选项]
    npx tsx packages/tools/src/monorepo-analyzer.ts --project-path /path/to/other-repo

  选项:
    --project-path, -p <path>  目标项目路径（默认自动检测当前目录）
    --json                     输出 JSON 格式（默认 text）
    --mermaid                  输出 Mermaid 依赖图（适合 GitHub/GitLab Markdown）
    --output <path>            输出到文件
    --ignore <dep>             忽略指定依赖的漂移检测（可重复）
    --include-dev              循环依赖检测包含 devDependencies
    --verbose                  显示所有依赖详情
    --help, -h                 显示此帮助

  示例:
    npx tsx packages/tools/src/monorepo-analyzer.ts                       # 分析自身
    npx tsx packages/tools/src/monorepo-analyzer.ts -p ../other-monorepo  # 分析其他项目
    npx tsx packages/tools/src/monorepo-analyzer.ts --mermaid --json       # JSON + Mermaid

  退出码:
    0  干净
    1  检测到漂移或循环依赖
    2  异常
`);
    return 0;
  }

  try {
    const projectRoot = explicitPath
      ? resolve(explicitPath)
      : findProjectRoot(cwd());

    // 显式传入路径时验证有效性
    if (explicitPath) {
      if (!existsSync(projectRoot)) {
        console.error(`💥 指定路径不存在: ${explicitPath}`);
        return 2;
      }
      const hasWorkspace = existsSync(join(projectRoot, 'pnpm-workspace.yaml'));
      const hasPackages = existsSync(join(projectRoot, 'packages'));
      if (!hasWorkspace && !hasPackages) {
        console.error(`💥 指定路径不是有效的 monorepo（缺少 pnpm-workspace.yaml 或 packages/ 目录）: ${explicitPath}`);
        return 2;
      }
    }

    console.error(`🔍 分析项目: ${projectRoot}`);

    const packages = collectPackages(projectRoot);
    if (packages.length <= 1) {
      console.error('💥 未找到 packages/ 下的子包');
      return 2;
    }

    const allDeps = collectDeps(projectRoot, packages);
    const edges = buildEdges(packages, allDeps, includeDev);

    const adj: Record<string, string[]> = {};
    for (const edge of edges) {
      if (!adj[edge.from]) adj[edge.from] = [];
      if (!adj[edge.to]) adj[edge.to] = [];
      if (!adj[edge.from]!.includes(edge.to)) adj[edge.from]!.push(edge.to);
    }

    const cycles = detectCycles(edges);
    const { drifts, allDeps: depSnapshot } = detectDrifts(allDeps, ignoreList, verbose);

    // 动态计算分层
    const { layers } = computeLayers(packages, edges);

    const dot = generateDot(packages, edges, cycles);
    const mermaid = generateMermaid(packages, edges, cycles);

    const uniqueDepCount = new Set(
      allDeps
        .filter((d) => !(d.isWorkspaceStar && isCortexInternal(d.depName)))
        .map((d) => d.depName),
    ).size;

    let status: AnalyzerMeta['status'] = 'clean';
    if (cycles.length > 0 && drifts.length > 0) {
      status = 'cycle+drift';
    } else if (cycles.length > 0) {
      status = 'cycle';
    } else if (drifts.length > 0) {
      status = 'drift';
    }

    const output: AnalyzerOutput = {
      meta: {
        scannedAt: nowISO(),
        filesScanned: packages.length,
        dependenciesChecked: uniqueDepCount,
        status,
        projectRoot,
      },
      packages,
      dependencyGraph: { edges, adjacency: adj, dot, mermaid },
      layers,
      drifts,
      allDeps: depSnapshot,
      cycles,
      hasCycles: cycles.length > 0,
    };

    const formatted = useJSON ? formatJSON(output) : formatText(output, verbose);

    if (outputPath) {
      const absPath = resolve(projectRoot, outputPath);
      const dir = dirname(absPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(absPath, formatted, 'utf-8');
      console.log(`📝 报告已写入: ${absPath}`);
    } else {
      console.log(formatted);
      // --mermaid：附赠 Mermaid 依赖图（可直接复制到 Markdown）
      if (useMermaid && !useJSON) {
        console.log('\n' + '='.repeat(60));
        console.log('MERMAID DEPENDENCY GRAPH');
        console.log('='.repeat(60));
        console.log(output.dependencyGraph.mermaid);
      }
    }

    const hasIssue = status !== 'clean';
    return hasIssue ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (useJSON) {
      const errorOutput: AnalyzerOutput = {
        meta: { scannedAt: nowISO(), filesScanned: 0, dependenciesChecked: 0, status: 'error', projectRoot: cwd() },
        packages: [],
        dependencyGraph: { edges: [], adjacency: {}, dot: '', mermaid: '' },
        layers: [],
        drifts: [],
        allDeps: {},
        cycles: [],
        hasCycles: false,
      };
      console.log(formatJSON(errorOutput));
    } else {
      console.error('💥 扫描异常:', message);
    }
    return 2;
  }
}

/**
 * 检测当前模块是否作为 CLI 入口被直接运行。
 * 使用 import.meta.url 与 process.argv[1] 的绝对路径比较，
 * 兼容 tsx 等运行时下扩展名差异。
 */
function isCliEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  const thisFile = fileURLToPath(import.meta.url);
  const resolvedEntry = resolve(entryArg);
  if (thisFile === resolvedEntry) return true;
  const stripExt = (p: string) => p.replace(/\.(ts|js|mjs)$/, '');
  if (stripExt(thisFile) === stripExt(resolvedEntry)) return true;
  return false;
}

// 仅在直接运行时执行 CLI（而非作为库导入时）
if (isCliEntry()) {
  process.exit(main());
}
