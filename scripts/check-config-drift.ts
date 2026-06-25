// ============================================================
// check-config-drift.ts —— Config Drift 检测脚本
//
// 检测 config/data/ 下的 JSON 默认值和源码中的默认值是否一致。
// Phase 5 基础版：CHECKS 数组先为空，后续 Phase 逐步添加检测对。
//
// 用法：
//   npx tsx scripts/check-config-drift.ts
// ============================================================
import { readFile } from "node:fs/promises";

interface DriftCheck {
  /** JSON 文件路径（相对项目根或绝对路径） */
  configFile: string;
  /** JSON 中的 key */
  configKey: string;
  /** 源码文件路径 */
  sourceFile: string;
  /** 源码中的导出名 */
  sourceExport: string;
}

const CHECKS: DriftCheck[] = [
  // Phase 5 试点：先定义空数组，后续 Phase 逐步添加检测对
  // {
  //   configFile: 'config/data/context-policies.json',
  //   configKey: 'chat',
  //   sourceFile: '@cortex/config',
  //   sourceExport: 'PRESET_CONTEXT_POLICIES',
  // },
];

async function checkDrift(): Promise<void> {
  for (const check of CHECKS) {
    const configRaw = await readFile(check.configFile, "utf-8");
    const configVal = JSON.parse(configRaw)[check.configKey];
    const sourceModule = await import(check.sourceFile);
    const sourceVal = sourceModule[check.sourceExport];
    if (JSON.stringify(configVal) !== JSON.stringify(sourceVal)) {
      console.error(
        `DRIFT: ${check.configFile}:${check.configKey} ≠ ${check.sourceFile}:${check.sourceExport}`
      );
      process.exit(1);
    }
  }
  console.log("✅ No config drift detected");
}

void checkDrift();
