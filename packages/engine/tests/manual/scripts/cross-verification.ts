/**
 * Phase 4.25: 交叉验证 Second-Pass
 *
 * 在 Agent 自由探索产出报告后，由互补专长的另一位 Agent 对报告中的
 * 可验证事实声明做 search_code / read_file 级别的核查。
 *
 * 验证者不做新探索——只确认已有声明是否能在代码库中找到对应证据。
 * 这是解决刻晴 25% 伪阳性率的关键机制：在圆桌共识前把可验证事实和 LLM 推理分开。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskNode } from "@cortex/shared";

// ═══════════════════════════════════════════════
// 配对表：互补专长交叉验证（从 JSON 加载，硬编码回退）
// ═══════════════════════════════════════════════

export interface CrossVerifyPair {
  reporterKey: string;
  reporterName: string;
  reporterEmoji: string;
  verifierKey: string;
  verifierName: string;
  verifierEmoji: string;
  /** 用于在输出目录中匹配报告文件名的模式 */
  reportFilePattern: string;
}

const FALLBACK_PAIRS: CrossVerifyPair[] = [
  { reporterKey: "keqing", reporterName: "刻晴", reporterEmoji: "⚡", verifierKey: "nahida", verifierName: "纳西妲", verifierEmoji: "🌿", reportFilePattern: "keqing-quality-recon" },
  { reporterKey: "albedo", reporterName: "阿贝多", reporterEmoji: "⚗️", verifierKey: "keqing", verifierName: "刻晴", verifierEmoji: "⚡", reportFilePattern: "albedo-deep-review" },
  { reporterKey: "beidou", reporterName: "北斗", reporterEmoji: "⚓", verifierKey: "amber", verifierName: "安柏", verifierEmoji: "🐰", reportFilePattern: "beidou-ops-diagnosis" },
  { reporterKey: "mona", reporterName: "莫娜", reporterEmoji: "🔮", verifierKey: "nahida", verifierName: "纳西妲", verifierEmoji: "🌿", reportFilePattern: "mona-pattern-discovery" },
  { reporterKey: "ningguang", reporterName: "凝光", reporterEmoji: "💎", verifierKey: "alhaitham", verifierName: "艾尔海森", verifierEmoji: "📚", reportFilePattern: "ningguang-governance-audit" },
  { reporterKey: "amber", reporterName: "安柏", reporterEmoji: "🐰", verifierKey: "kuki", verifierName: "久岐忍", verifierEmoji: "😈", reportFilePattern: "amber-reconnaissance" },
  { reporterKey: "kuki", reporterName: "久岐忍", reporterEmoji: "😈", verifierKey: "albedo", verifierName: "阿贝多", verifierEmoji: "⚗️", reportFilePattern: "kuki-api-design" },
  { reporterKey: "alhaitham", reporterName: "艾尔海森", reporterEmoji: "📚", verifierKey: "mona", verifierName: "莫娜", verifierEmoji: "🔮", reportFilePattern: "alhaitham-data-design" },
  { reporterKey: "nahida", reporterName: "纳西妲", reporterEmoji: "🌿", verifierKey: "beidou", verifierName: "北斗", verifierEmoji: "⚓", reportFilePattern: "nahida-architecture-analysis" },
];

/** 从 JSON 配置文件加载交叉验证配对表，解析失败时回退硬编码 */
export function loadCrossVerifyPairs(configDir: string): CrossVerifyPair[] {
  const jsonPath = path.join(configDir, "cross-verification-pairs.json");
  if (!fs.existsSync(jsonPath)) {
    console.log(`   ℹ️ cross-verification-pairs.json 不存在，使用硬编码配对`);
    return FALLBACK_PAIRS;
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    if (data.pairs && Array.isArray(data.pairs) && data.pairs.length >= 9) {
      console.log(`   📋 从 cross-verification-pairs.json 加载 ${data.pairs.length} 对验证配对`);
      return data.pairs as CrossVerifyPair[];
    }
    console.log(`   ⚠️ cross-verification-pairs.json 格式异常，回退硬编码`);
    return FALLBACK_PAIRS;
  } catch (e: any) {
    console.log(`   ⚠️ cross-verification-pairs.json 解析失败: ${e.message}，回退硬编码`);
    return FALLBACK_PAIRS;
  }
}

// ═══════════════════════════════════════════════
// 验证 Agent 接口（最小契约——只需 execute 方法）
// ═══════════════════════════════════════════════

export interface VerifierAgent {
  execute: (node: TaskNode, model: string) => Promise<{ success: boolean; output?: string; error?: string }>;
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════

/**
 * 运行交叉验证。
 *
 * @param outputDir  审视报告输出目录（如 test-output/self-examination-soft/）
 * @param agents     key→Agent 实例的映射，key 与 CROSS_VERIFY_PAIRS 中的 verifierKey 对应
 * @param chatModel  使用的 LLM 模型名
 * @returns 产出的验证文件路径列表
 */
export async function runCrossVerification(
  outputDir: string,
  pairs: CrossVerifyPair[],
  agents: Record<string, VerifierAgent>,
  chatModel: string,
): Promise<string[]> {
  const producedFiles: string[] = [];

  if (!fs.existsSync(outputDir)) {
    console.log("   ⚠️ 输出目录不存在，跳过交叉验证\n");
    return producedFiles;
  }

  const dirFiles = fs.readdirSync(outputDir);

  console.log("   🔍 交叉验证配对:");
  const MAX_REPORT_CHARS = 8000; // 注入给验证者的报告截断上限

  for (const pair of pairs) {
    const verifier = agents[pair.verifierKey];
    if (!verifier) {
      console.log(`      ⚠️ 验证者 ${pair.verifierEmoji}${pair.verifierName} 未就绪，跳过 ${pair.reporterName}`);
      continue;
    }

    // 查找报告文件
    const reportFile = dirFiles.find(
      (f) => f.includes(pair.reportFilePattern) && f.endsWith(".md"),
    );

    if (!reportFile) {
      console.log(`      ⚠️ 未找到 ${pair.reporterEmoji}${pair.reporterName} 的报告 (pattern: ${pair.reportFilePattern})，跳过`);
      continue;
    }

    const reportPath = path.join(outputDir, reportFile);
    let reportContent: string;
    try {
      reportContent = fs.readFileSync(reportPath, "utf-8");
    } catch {
      console.log(`      ⚠️ 读取 ${reportFile} 失败，跳过`);
      continue;
    }

    // 截断报告内容以控制 token 消耗
    const truncated = reportContent.length > MAX_REPORT_CHARS
      ? reportContent.slice(0, MAX_REPORT_CHARS) + `\n\n...(截断，全文 ${reportContent.length} 字符)`
      : reportContent;

    const outputFile = `${pair.verifierKey}-verify-${pair.reporterKey}.md`;
    const outputPath = path.join(outputDir, outputFile);

    const verificationPrompt = [
      `你是${pair.verifierName}。这不是一次新的自由探索——`,
      `你的唯一任务是验证${pair.reporterName}的审视报告中的可验证事实声明。`,
      "",
      "## 验证方法",
      "",
      "逐条阅读报告中的发现。对于每一条包含具体事实的声明：",
      "1. 用 search_code 搜索相关的代码符号或关键词",
      "2. 用 read_file 打开报告声称的文件和行号",
      "3. 对比声明的逻辑与代码的实际行为",
      "",
      "## 判定标准",
      "",
      "- ✅ 已验证：代码存在、逻辑成立、声明属实",
      "- ❌ 不成立：代码不存在、行号错误、逻辑不成立、或与代码实际行为矛盾",
      "- ⚠️ 不确定：信息不足、需要运行时验证、或超出静态分析范围",
      "",
      "## 关键原则",
      "",
      "- **只验证可验证的事实**：代码存在性、行号准确性、状态流转逻辑、函数签名匹配。",
      "- **不验证主观判断**：代码风格、命名偏好、架构哲学——这些不在此轮验证范围内。",
      "- **如果报告声称某文件某行有问题，你必须实际读取那个文件和行号**——不能只看摘要就下判断。",
      "- **如果报告没有给出具体位置，用 search_code 搜索关键词尝试定位**。找不到则标注 ⚠️ 不确定。",
      "- **宁标 ⚠️ 不确定，不标 ❌ 误杀**——如果你不能 100% 确定一个声明是错误的，标 ⚠️。",
      "",
      `## ${pair.reporterEmoji}${pair.reporterName} 的审视报告`,
      "",
      truncated,
      "",
      "---",
      "",
      "## 输出格式",
      "",
      `# 🔍 ${pair.reporterName} 报告交叉验证`,
      "",
      `> 验证者: ${pair.verifierEmoji}${pair.verifierName}`,
      `> 被验证报告: ${reportFile} (${reportContent.length} 字符)`,
      `> 验证方式: search_code + read_file 静态分析`,
      "",
      "| # | 发现摘要 | 声称位置 | 验证结果 | 实际证据 |",
      "|---|----------|----------|----------|----------|",
      "| 1 | ... | file:line | ✅/❌/⚠️ | ... |",
      "",
      "逐条验证完毕后，在表格下方添加一段「验证总结」：",
      "- 总声明数: N",
      "- ✅ 已验证: N",
      "- ❌ 不成立: N",
      "- ⚠️ 不确定: N",
      "- 伪阳性率: ❌ / (✅+❌) （仅计算可判定项，不含 ⚠️）",
    ].join("\n");

    const taskNode: TaskNode = {
      id: `verify-${pair.verifierKey}-${pair.reporterKey}`,
      type: "cross_verification",
      status: "pending",
      tags: ["verification" as const, pair.verifierKey as any],
      needsMultiPerspective: false,
      claimedBy: [],
      payload: verificationPrompt,
      results: [],
      createdAt: Date.now(),
    };

    console.log(`      ${pair.verifierEmoji}${pair.verifierName} → ${pair.reporterEmoji}${pair.reporterName} (${reportFile})`);

    try {
      const result = await verifier.execute(taskNode, chatModel);
      if (result.success && result.output) {
        fs.writeFileSync(outputPath, result.output, "utf-8");
        producedFiles.push(outputFile);
        console.log(`         ✅ → ${outputFile} (${result.output.length} 字符)`);
      } else {
        console.log(`         ⚠️ 未产出有效输出: ${result.error ?? "unknown"}`);
      }
    } catch (e) {
      console.log(`         ❌ 验证失败: ${String(e).slice(0, 150)}`);
    }
  }

  if (producedFiles.length > 0) {
    console.log(`\n   📋 交叉验证完成: ${producedFiles.length}/${pairs.length} 对\n`);
  } else {
    console.log(`   ⚠️ 交叉验证未产出任何文件\n`);
  }

  return producedFiles;
}
