// ============================================================
// @cortex/self-examination/run — CLI 入口
// 用法: npx tsx packages/self-examination/src/run.ts [config.json]
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfigFromJson, validateConfig, type ExamConfig } from "./config.js";
import { initPlatform } from "./platform.js";
import { orchestrate } from "./orchestrator.js";
import { generateReport, compareToBaseline, printVerdict } from "./reporter.js";

/** 内置配置映射 */
const BUILTIN_CONFIGS: Record<string, Partial<ExamConfig>> = {
  "verify": {
    id: "verify", name: "快速回归门禁",
    task: "审查当前代码库，检查是否存在编译错误、lint 违规、测试失败、记忆系统不一致",
    agentOverrides: { model: "deepseek-v4-flash", reasoning: "none" },
  },
  "flash-nothink": {
    id: "A-flash-no-think", name: "Flash 非思考基线",
    task: "对全仓进行深度架构审查，覆盖 governance/memory/scheduler 三个核心域",
    memoryDir: ".cortex/exp-a",
    outputDir: "self-exam-output/exp-a",
    agentOverrides: { model: "deepseek-v4-flash", reasoning: "none" },
    metrics: ["exitCode", "api429Count", "apiErrorRate", "reportFalsePositiveRate", "eventEmitCount"],
  },
  "flash-think": {
    id: "B-flash-think", name: "Flash 思考基线",
    task: "对全仓进行深度架构审查，覆盖 governance/memory/scheduler 三个核心域",
    memoryDir: ".cortex/exp-b",
    outputDir: "self-exam-output/exp-b",
    agentOverrides: { model: "deepseek-v4-flash", reasoning: "high" },
    metrics: ["exitCode", "api429Count", "apiErrorRate", "reportFalsePositiveRate", "eventEmitCount"],
  },
  "normal": {
    id: "C-normal", name: "正常路由基线",
    task: "对全仓进行深度架构审查，覆盖 governance/memory/scheduler 三个核心域",
    memoryDir: ".cortex/exp-c",
    outputDir: "self-exam-output/exp-c",
    agentOverrides: null,
    metrics: ["exitCode", "api429Count", "apiErrorRate", "reportFalsePositiveRate", "eventEmitCount"],
  },
};

async function main() {
  const arg = process.argv[2] ?? "verify";
  const root = process.cwd();

  // 从内置映射或 JSON 文件加载配置
  let config: ExamConfig;
  if (BUILTIN_CONFIGS[arg]) {
    config = { ...BUILTIN_CONFIGS.verify, ...BUILTIN_CONFIGS[arg], workspaceRoot: root } as ExamConfig;
  } else if (fs.existsSync(arg)) {
    const json = JSON.parse(fs.readFileSync(arg, "utf-8"));
    config = { ...loadConfigFromJson(json), workspaceRoot: root };
  } else {
    console.error(`未知配置: ${arg}`);
    console.error(`可用内置: ${Object.keys(BUILTIN_CONFIGS).join(", ")}`);
    process.exit(1);
  }

  // 验证
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error("配置错误:");
    for (const e of errors) console.error(`  ❌ ${e}`);
    process.exit(1);
  }

  console.log(`\n🧪 Cortex 自审视: ${config.name} (${config.id})\n`);

  // 运行
  const platform = await initPlatform(config);
  const result = await orchestrate(config, platform);
  const report = generateReport(result);

  // 基线对比
  const baselineDir = path.join(root, "self-exam-output", "baseline");
  const baselinePath = path.join(baselineDir, `${config.id}.json`);
  const comparison = compareToBaseline(report, baselinePath);

  // 保存为新基线
  if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(report, null, 2));

  // 输出
  printVerdict(report, comparison);
  process.exit(result.exitCode);
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
