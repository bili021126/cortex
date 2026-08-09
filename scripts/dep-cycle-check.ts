#!/usr/bin/env npx tsx
/**
 * scripts/dep-cycle-check.ts — package-level dependency cycle detection.
 * Scans packages src imports against package names; detects cycles.
 * Usage: npx tsx scripts/dep-cycle-check.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const PKG_DIR = path.join(ROOT, "packages");

// package name -> dir
const pkgNames = new Map<string, string>();
for (const d of fs.readdirSync(PKG_DIR)) {
  const pj = path.join(PKG_DIR, d, "package.json");
  if (fs.existsSync(pj)) {
    const j = JSON.parse(fs.readFileSync(pj, "utf-8")) as { name?: string };
    if (j.name) pkgNames.set(j.name, d);
  }
}

// import edges: pkg -> [deps]
const edges = new Map<string, Set<string>>();
for (const [name, dir] of pkgNames) {
  edges.set(name, new Set());
  const src = path.join(PKG_DIR, dir, "src");
  if (!fs.existsSync(src)) continue;
  walk(src, name);
}
function walk(d: string, owner: string): void {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, owner);
    else if (f.name.endsWith(".ts")) {
      const text = fs.readFileSync(p, "utf-8");
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        // 跳过注释行（避免文档里的包名误报）
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
        for (const m of line.matchAll(/from\s+["'](@cortex\/[a-z-]+)/g)) {
          const dep = m[1];
          if (pkgNames.has(dep) && dep !== owner) edges.get(owner)?.add(dep);
        }
      }
    }
  }
}

// cycle detection (DFS)
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map<string, number>();
const stack: string[] = [];
const cycles: string[][] = [];
function dfs(n: string): void {
  color.set(n, GRAY);
  stack.push(n);
  for (const dep of edges.get(n) ?? []) {
    const c = color.get(dep) ?? WHITE;
    if (c === WHITE) dfs(dep);
    else if (c === GRAY) {
      const idx = stack.indexOf(dep);
      cycles.push([...stack.slice(idx), dep]);
    }
  }
  stack.pop();
  color.set(n, BLACK);
}
for (const n of edges.keys()) {
  if ((color.get(n) ?? WHITE) === WHITE) dfs(n);
}

console.log(`\n[dep-cycle] ${pkgNames.size} packages, ${[...edges.values()].reduce((a, s) => a + s.size, 0)} import edges\n`);
if (cycles.length === 0) {
  console.log("[dep-cycle] OK - no package-level cycles\n");
  process.exit(0);
}
console.log(`[dep-cycle] ${cycles.length} cycle(s) found:\n`);
for (const c of cycles) {
  console.log(`  ${c.join(" -> ")}`);
}
console.log("");
process.exit(1);
