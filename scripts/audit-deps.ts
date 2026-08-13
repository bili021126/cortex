/**
 * scripts/audit-deps.ts — 依赖漏洞审计（F2）
 *
 * 背景：默认 registry（npmmirror 镜像）无 audit 端点，pnpm audit 直接失败。
 * 本脚本强制使用官方 registry 执行审计，输出漏洞摘要并以退出码暴露结果：
 *   - 无漏洞        → exit 0
 *   - 有漏洞        → exit 1（打印漏洞清单与修复建议）
 *
 * 用法：
 *   npx tsx scripts/audit-deps.ts          # 全量审计
 *   npx tsx scripts/audit-deps.ts --prod   # 仅生产依赖
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const prodOnly = args.includes("--prod");

/** 从 pnpm audit 的文本输出中提取漏洞统计行 */
function summarize(output: string): void {
  const summary = output.match(/(\d+) vulnerabilities found/);
  const severity = output.match(/Severity:\s*(.+)/);
  console.log(summary ? `\n${summary[0]}` : "\n未找到漏洞统计（可能无漏洞）");
  if (severity) console.log(`严重度分布: ${severity[1]}`);

  // 提取漏洞条目（pnpm 输出为表格块：标题行 + Package/Patched 行）——逐块解析
  const blocks = output.split(/┌──+/).slice(1);
  for (const block of blocks.slice(0, 12)) {
    const title = block.match(/critical|high|moderate|low/g);
    const pkg = block.match(/Package\s+([\w@/-]+)/);
    const patched = block.match(/Patched versions\s+([^\n]+)/);
    if (title && pkg) {
      console.log(`  [${title[0]}] ${pkg[1]}${patched ? ` (修复: ${patched[1].trim()})` : ""}`);
    }
  }
}

try {
  // Windows 下 .cmd 直 spawn 会 EINVAL——execSync 走 shell（pnpm 在 PATH 中）
  const output = execSync(
    `pnpm audit --registry=https://registry.npmjs.org${prodOnly ? " --prod" : ""}`,
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  console.log(output);
  if (/No known vulnerabilities found/.test(output)) {
    console.log("✅ 依赖漏洞审计通过（0 漏洞）");
    process.exit(0);
  }
  console.log("❌ 依赖漏洞审计未通过——见上方漏洞清单");
  process.exit(1);
} catch (err) {
  const e = err as { stdout?: string; stderr?: string; status?: number };
  const output = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  if (/vulnerabilities found/.test(output)) {
    summarize(output);
    console.log("❌ 依赖漏洞审计未通过——见上方漏洞清单");
    process.exit(1);
  }
  console.error("❌ 依赖审计执行失败：", e.status, (e.stderr ?? e.stdout ?? "").slice(0, 800));
  process.exit(2);
}
