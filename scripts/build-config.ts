/**
 * build-config.ts — 编译独立 TUI 脚本
 *
 * 用法: npx tsx scripts/build-config.ts
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "scripts", "dist");

const TSC_FLAGS = [
  "--target", "ES2022",
  "--module", "nodenext",
  "--moduleResolution", "nodenext",
  "--esModuleInterop",
  "--skipLibCheck",
];

type BuildTarget = { src: string; dest: string };

const TARGETS: BuildTarget[] = [
  { src: join(ROOT, "scripts", "cortex-cli.ts"), dest: join(ROOT, "cortex-cli.mjs") },
];

for (const t of TARGETS) {
  const basename = t.src.split(/[\\/]/).pop();
  console.log(`[build] ${basename} ...`);

  execSync(
    ["npx tsc", t.src, "--outDir", OUT_DIR, ...TSC_FLAGS].join(" "),
    { cwd: ROOT, stdio: "inherit" },
  );

  // tsc outputs to scripts/dist/<name>.js
  const jsName = basename!.replace(/\.ts$/, ".js");
  const outFile = join(OUT_DIR, jsName);

  if (!existsSync(outFile)) {
    console.error(`[build] 编译失败: ${basename}`);
    process.exit(1);
  }

  copyFileSync(outFile, t.dest);
  console.log(`[build] → ${t.dest.replace(ROOT + "\\", "")}`);
}

console.log("[build] 完成");
