/**
 * skill-persister.ts —— SkillRegistry ↔ MemoryStore 双向持久化桥。
 *
 * 技能沉淀闭环的核心基建：
 *   1. persistSkillsToMemory():   SkillRegistry → MemoryStore (MemoryType.Skill)
 *   2. loadSkillsFromMemory():    MemoryStore → SkillTemplate[] → SkillRegistry.registerAll()
 *   3. scanOutputFilesForSkills(): 扫描已产出文件（pattern/design/review），
 *      从 Markdown 提取技能模板（文件回溯扫描）。
 *
 * @since 技能沉淀机制 Core-2
 */

import type { MemoryStore } from "../memory/memory-store.js";
import type { SkillTemplate, Tag } from "@cortex/shared";
import { MemoryType, MemorySubType, AgentType } from "@cortex/shared";
import { extractSkillsFromOutput } from "./skill-extractor.js";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 1. 写入：SkillRegistry → MemoryStore ─────────────

/**
 * 将 SkillRegistry 中的所有技能模板持久化到 MemoryStore。
 * 每个模板作为一条 MemoryType.Skill 记忆写入。
 *
 * @returns 成功持久化的技能数量。
 */
export function persistSkillsToMemory(
  skills: SkillTemplate[],
  memory: MemoryStore,
): number {
  let count = 0;

  for (const skill of skills) {
    try {
      const memId = memory.writePending({
        memoryType: MemoryType.Skill,
        subType: MemorySubType.Fact,
        content: skill as unknown as Record<string, unknown>,
        summary: `[技能沉淀] ${skill.agentType}:${skill.name} — ${skill.trigger}`,
        agentType: skill.agentType,
        creatorId: "skill-persister",
        weight: 5,
        metadata: {
          skillId: skill.id,
          triggerTags: skill.triggerTags,
          status: skill.status,
        },
      });
      memory.commitMemory(memId);
      count++;
    } catch (e) {
      console.warn(
        `[skill-persister] 写入技能失败: ${skill.agentType}:${skill.name}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return count;
}

// ─── 2. 读取：MemoryStore → SkillTemplate[] ─────────────

/**
 * 从 MemoryStore 加载所有 Skill 类型的记忆，转换为 SkillTemplate 数组。
 * 用于在系统启动时恢复 SkillRegistry 的注册状态。
 *
 * @returns 从 MemoryStore 恢复的技能模板列表。
 */
export function loadSkillsFromMemory(memory: MemoryStore): SkillTemplate[] {
  const skillTemplates: SkillTemplate[] = [];

  try {
    const entries = memory.read({
      memoryTypes: [MemoryType.Skill],
      queryMode: "csa",
      limit: 100,
      trackAccess: false,
    });

    for (const entry of entries) {
      if (entry.memoryType !== MemoryType.Skill) continue;
      if (entry.state !== "ACTIVE") continue;

      const content = entry.content;
      if (!content || typeof content !== "object") continue;

      const skill = content as unknown as SkillTemplate;
      if (!skill?.id || !skill?.name || !skill?.triggerTags || !Array.isArray(skill.steps)) continue;

      skillTemplates.push(skill);
    }
  } catch (e) {
    console.warn(
      "[skill-persister] 从 MemoryStore 加载技能失败",
      e instanceof Error ? e.message : String(e),
    );
  }

  return skillTemplates;
}

// ─── 3. 文件扫描：输出文件 → 技能模板 ─────────────

const SCAN_PATTERNS: { glob: string; agentType: AgentType }[] = [
  { glob: "**/pattern*.md", agentType: AgentType.Loop },
  { glob: "**/design*.md", agentType: AgentType.Analysis },
  { glob: "**/review*.md", agentType: AgentType.Review },
  { glob: "**/audit*.md", agentType: AgentType.DocGovern },
  { glob: "**/architecture*.md", agentType: AgentType.Analysis },
];

/**
 * 扫描工作区中的已产出 Markdown 文件，从中提取技能模板。
 * 用于文件回溯——当技能未显式注册时，从历史产出中反向发现。
 *
 * @param workspaceDir 工作区根目录
 * @returns 发现的技能模板列表（去重）。
 */
export function scanOutputFilesForSkills(workspaceDir: string): SkillTemplate[] {
  const allSkills: SkillTemplate[] = [];
  const seenIds = new Set<string>();

  for (const { glob, agentType } of SCAN_PATTERNS) {
    const matches = findFiles(workspaceDir, glob);
    for (const filePath of matches) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const skills = extractSkillsFromMarkdown(content, agentType, filePath);
        for (const skill of skills) {
          if (!seenIds.has(skill.id)) {
            seenIds.add(skill.id);
            allSkills.push(skill);
          }
        }
      } catch (e) {
        console.warn(
          `[skill-persister] 扫描文件失败: ${filePath}`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return allSkills;
}

/**
 * 递归查找匹配 glob 模式的文件。
 * 简单实现：遍历目录树，文件名匹配。
 */
function findFiles(root: string, glob: string): string[] {
  const results: string[] = [];
  const pattern = glob.replace("**/", "");

  function walk(dir: string, depth: number) {
    if (depth > 5) return; // 深度限制
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (
          matchFileName(entry.name, pattern) &&
          matchFileName(fullPath, glob)
        ) {
          results.push(fullPath);
        }
      }
    } catch (e) {
      console.warn(
        `[skill-persister] 遍历目录失败: ${dir}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  walk(root, 0);
  return results;
}

/**
 * 简单文件名 glob 匹配。
 * 支持 pattern*.md 形式。
 */
function matchFileName(fileName: string, pattern: string): boolean {
  // 简单 glob: pattern*.md 匹配 pattern-anything.md
  if (pattern.endsWith("*.md")) {
    const prefix = pattern.slice(0, -4); // "pattern*"
    if (prefix.endsWith("*")) {
      return fileName.includes(prefix.slice(0, -1));
    }
    return fileName.startsWith(prefix.slice(0, -1));
  }
  return fileName.includes(pattern);
}

/**
 * 从 Markdown 内容中提取技能模板。
 * 策略优先级：
 *   1. JSON 块提取（SkillTemplate 格式）
 *   2. P0-P9 章节提取
 *   3. "模式 N" 章节提取
 *   4. 兜底：基于文件名生成默认模板
 */
function extractSkillsFromMarkdown(
  content: string,
  agentType: AgentType,
  filePath: string,
): SkillTemplate[] {
  if (!content || content.trim().length === 0) return [];

  // 策略 1：JSON 块提取（SkillTemplate 格式）
  const { skills, diagnostics } = extractSkillsFromOutput(content);
  if (skills.length > 0) return skills;

  // 策略 2：P0-P9 章节提取
  const pnSections = extractPNSections(content, agentType);
  if (pnSections.length > 0) return pnSections;

  // 策略 3："模式 N" 章节提取
  const patterns = extractPatternSections(content, agentType);
  if (patterns.length > 0) return patterns;

  // 策略 4：兜底——基于文件名生成一个默认模板
  const fileName = path.basename(filePath, ".md");
  const firstLine = content.split("\n")[0]?.replace(/^#+\s*/, "") ?? fileName;
  const timestamp = Date.now();

  return [
    {
      id: `${fileName}-${timestamp}`,
      agentType,
      name: `[文件扫描] ${firstLine.slice(0, 50)}`,
      triggerTags: ["research", "analysis"] as Tag[],
      trigger: `检测到文件: ${fileName}`,
      steps: [`阅读并理解文件: ${filePath}`],
      expectedOutput: "理解设计意图后执行",
      status: "trial",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "file-scanner",
      createdAt: timestamp,
    },
  ];
}

/**
 * 从 Markdown 中提取 "## P{N} — 名称" 格式的章节。
 * 这些是设计文档中的优先级模式描述。
 */
function extractPNSections(content: string, agentType: AgentType): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();

  // 匹配 "## P0 — 名称 (English Name)" 或 "## P9 — 名称"
  const sectionRegex = /(?:^|\n)#{2}\s*P(\d+)\s*[—\-–]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const pNumber = match[1];
    const fullName = match[2].trim();
    const name = fullName.replace(/\s*\(.*?\)\s*/, "").trim();
    const sectionStart = match.index + match[0].length;

    // 找下一个章节或到文件末尾
    const nextSection = content.slice(sectionStart).search(/\n#{2,}\s/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取 triggerTags
    const tagsMatch = sectionContent.match(/标签[：:]\s*(.+)/);
    const triggerTags: Tag[] = tagsMatch
      ? (tagsMatch[1].split(/[，,、\s]+/).filter(Boolean) as Tag[])
      : ([] as unknown as Tag[]);

    // 提取 trigger
    const triggerMatch = sectionContent.match(/触发条件[：:]\s*(.+)/);
    const trigger = triggerMatch
      ? triggerMatch[1].trim()
      : `P${pNumber}:${agentType}`;

    // 提取 steps（从"步骤"或"做法"段落）
    const recipeMatch = sectionContent.match(/步骤[：:]\s*([\s\S]*?)(?=\n#{2,}|\n---|\n$)/);
    let steps: string[] = [];
    if (recipeMatch) {
      const recipeContent = recipeMatch[0];
      const stepLines = recipeContent.match(/^\d+[.、]\s*(.+)$/gm);
      if (stepLines) {
        const stepParts = stepLines.map((s) => s.replace(/^\d+[.、]\s*/, "").trim());
        steps = stepParts.filter(Boolean);
      }
    }

    if (steps.length === 0) {
      steps = ["分析相关代码模式", "遵循已建立的架构约定"];
    }

    // 提取条件作为预期输出
    const conditionMatch = sectionContent.match(/条件[：:]\s*([\s\S]*?)(?=\n#{2,}|\n---|\n$)/);
    const conditions = conditionMatch
      ? conditionMatch[1].split("\n").map((s) => s.trim()).filter(Boolean).join("; ")
      : "";

    const expectedOutput = conditions || `P${pNumber}: ${name}`;

    // 生成技能名
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `P${pNumber}-${skillName}-${timestamp}`;

    patterns.push({
      id,
      agentType,
      name: `P${pNumber}: ${name}`,
      triggerTags,
      trigger,
      steps,
      expectedOutput,
      status: "trial" as const,
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "file-scanner-pattern",
      createdAt: timestamp,
    });
  }

  return patterns;
}

/**
 * 从 Markdown 中提取 "## 模式 N：名称" 格式的章节。
 * 这些是审查文档中的模式描述。
 */
function extractPatternSections(content: string, agentType: AgentType): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();

  // 匹配 "## 模式 N：名称" 或 "## 模式 N: 名称"
  const sectionRegex = /(?:^|\n)#{2}\s*模式\s*(\d+)\s*[：:]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const patternNumber = match[1];
    const name = match[2].trim();
    const sectionStart = match.index + match[0].length;

    // 找下一个章节或到文件末尾
    const nextSection = content.slice(sectionStart).search(/\n#{2,}\s/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取 triggerTags
    const tagsMatch = sectionContent.match(/标签[：:]\s*(.+)/);
    const triggerTags: Tag[] = tagsMatch
      ? (tagsMatch[1].split(/[，,、\s]+/).filter(Boolean) as Tag[])
      : ([] as unknown as Tag[]);

    // 提取 trigger
    const triggerMatch = sectionContent.match(/触发条件[：:]\s*(.+)/);
    const trigger = triggerMatch
      ? triggerMatch[1].trim()
      : `模式${patternNumber}:${agentType}`;

    // 提取步骤
    const stepLines =
      sectionContent.match(/步骤[：:]\s*([\s\S]*?)(?=\n#{2,}|\n---|\n$)/) ||
      sectionContent.match(/做法[：:]\s*([\s\S]*?)(?=\n#{2,}|\n---|\n$)/) ||
      sectionContent.match(/流程[：:]\s*([\s\S]*?)(?=\n#{2,}|\n---|\n$)/);

    const steps: string[] = stepLines
      ? stepLines[1].split("\n").map((s) => s.trim()).filter(Boolean)
      : ["参考文档中的模式描述"];

    // 提取预期输出
    const outputMatch = sectionContent.match(/预期输出[：:]\s*(.+)/);
    const expectedOutput = outputMatch
      ? outputMatch[1].trim()
      : `模式${patternNumber}: ${name}`;

    // 生成技能名
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `pattern-${patternNumber}-${skillName}-${timestamp}`;

    patterns.push({
      id,
      agentType,
      name: `模式${patternNumber}: ${name}`,
      triggerTags,
      trigger,
      steps,
      expectedOutput,
      status: "trial" as const,
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "file-scanner-pattern",
      createdAt: timestamp,
    });
  }

  return patterns;
}
