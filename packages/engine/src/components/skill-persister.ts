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
      console.error(
        `[skill-persister] 写入技能失败: ${skill.agentType}:${skill.name}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return count;
}

// ─── 2. 读取：MemoryStore → SkillTemplate[] ───────────

/**
 * 从 MemoryStore 读取所有 MemoryType.Skill 记忆，反序列化为 SkillTemplate 列表。
 *
 * @returns 反序列化后的技能模板列表（异常时返回空数组）。
 */
export async function loadSkillsFromMemory(memory: MemoryStore): Promise<SkillTemplate[]> {
  const skillTemplates: SkillTemplate[] = [];

  try {
    const entries = await memory.read({
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
    console.error(
      "[skill-persister] 从 MemoryStore 加载技能失败",
      e instanceof Error ? e.message : String(e),
    );
  }

  return skillTemplates;
}

// ─── 3. 文件回溯扫描 ────────────────────────────────────

const SCAN_PATTERNS: { glob: string; agentType: AgentType }[] = [
  { glob: "**/pattern*.md", agentType: AgentType.Loop },
  { glob: "**/design*.md", agentType: AgentType.Analysis },
  { glob: "**/review*.md", agentType: AgentType.Review },
  { glob: "**/audit*.md", agentType: AgentType.DocGovern },
  { glob: "**/architecture*.md", agentType: AgentType.Analysis },
];

/**
 * 扫描已产出文件（pattern/design/review/audit/architecture），
 * 从 Markdown 提取技能模板。
 *
 * @returns 所有扫描到的技能模板（去重）。
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
        console.error(
          `[skill-persister] 扫描文件失败: ${filePath}`,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return allSkills;
}

// ─── 4. 文件查找工具 ────────────────────────────────────

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
          entry.name.endsWith(".md") &&
          matchFileName(entry.name, pattern)
        ) {
          results.push(fullPath);
        }
      }
    } catch (e) {
      console.error(
        `[skill-persister] 遍历目录失败: ${dir}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  walk(root, 0);
  return results;
}

/**
 * 简单 glob 匹配：pattern*.md 匹配 pattern-anything.md
 */
function matchFileName(fileName: string, pattern: string): boolean {
  if (pattern.endsWith("*.md")) {
    const prefix = pattern.slice(0, -4); // "pattern*"
    if (prefix.endsWith("*")) {
      return fileName.includes(prefix.slice(0, -1));
    }
    return fileName.startsWith(prefix.slice(0, -1));
  }
  return fileName.includes(pattern);
}

// ─── 5. Markdown 技能提取 ───────────────────────────────

function extractSkillsFromMarkdown(
  content: string,
  agentType: AgentType,
  filePath: string,
): SkillTemplate[] {
  if (!content || content.trim().length === 0) return [];

  // 策略 1：JSON 块提取（SkillTemplate 格式）
  const { skills, diagnostics } = extractSkillsFromOutput(content);
  if (skills.length > 0) return skills;

  // 策略 2：P0-P9 段落提取
  const pnSections = extractPNSections(content, agentType);
  if (pnSections.length > 0) return pnSections;

  // 策略 3：模式段落提取
  const patterns = extractPatternSections(content, agentType);
  if (patterns.length > 0) return patterns;

  // 策略 4：文件标题兜底
  const fileName = path.basename(filePath, ".md");
  const firstLine =
    content.split("\n")[0]?.replace(/^#+\s*/, "") ?? fileName;
  const timestamp = Date.now();

  return [
    {
      id: `${fileName}-${timestamp}`,
      agentType,
      name: `从文件提取: ${firstLine.slice(0, 50)}`,
      triggerTags: ["research", "analysis"] as Tag[],
      trigger: `文件: ${fileName}`,
      steps: [`参考该设计文档: ${filePath}`],
      expectedOutput: "理解设计意图后执行",
      status: "trial" as const,
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "file-scanner",
      createdAt: timestamp,
    },
  ];
}

/**
 * 从 Markdown 内容中提取 P0-P9 格式的段落，转换为 SkillTemplate。
 * 匹配 "## P0 — 名称 (English Name)" 或 "## P9 — 名称" 格式。
 */
function extractPNSections(content: string, agentType: AgentType): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();

  const sectionRegex = /(?:^|\n)#{2}\s*P(\d+)\s*[—\-–]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const pNumber = match[1];
    const fullName = match[2].trim();
    const name = fullName.replace(/\(.*?\)/g, "").trim();

    const sectionStart = match.index + match[0].length;

    // 查找下一个 section 的位置
    const nextSection = content.slice(sectionStart).search(/(?:^|\n)#{2}\s*P\d+\s*[—\-–]/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取 tags（在 section 内容中查找 "Tags:" 行）
    const tagsMatch = sectionContent.match(/Tags?[：:]\s*(.+)/);
    const triggerTags: Tag[] = tagsMatch
      ? (tagsMatch[1].split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) as Tag[])
      : ([] as unknown as Tag[]);

    // 提取 trigger
    const triggerMatch = sectionContent.match(/Trigger[：:]\s*(.+)/);
    const trigger = triggerMatch
      ? triggerMatch[1].trim()
      : `P${pNumber}:${agentType}`;

    // 提取 steps（查找 "Steps:" 或 "Recipe:" 后的行）
    const recipeMatch = sectionContent.match(/Recipe[：:]\s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/);
    let steps: string[] = [];
    if (recipeMatch) {
      const recipeContent = recipeMatch[0];
      const stepLines = recipeContent.match(/[-*]\s*(.+)/g);
      if (stepLines) {
        const stepParts = stepLines.map((s: string) => s.replace(/^[-*]\s*/, "").trim());
        steps = stepParts.filter(Boolean);
      }
    }

    if (steps.length === 0) {
      steps = ["分析相关代码模式", "遵循已建立的架构约定"];
    }

    // 提取 conditions → expectedOutput
    const conditionMatch = sectionContent.match(/Condition[：:]\s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/);
    const conditions = conditionMatch
      ? conditionMatch[1].split("\n").map((c: string) => c.trim()).filter(Boolean).join("; ")
      : "";
    const expectedOutput = conditions || `P${pNumber}:${name}`;

    // 构造 skillName（用于 id）
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `p${pNumber}-${skillName}-${timestamp}`;

    patterns.push({
      id,
      agentType,
      name: `P${pNumber}:${name}`,
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
 * 从 Markdown 内容中提取"模式 N"格式的段落，转换为 SkillTemplate。
 * 匹配 "## 模式 N：名称" 或 "## 模式 N: 名称" 格式。
 */
function extractPatternSections(content: string, agentType: AgentType): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();

  const sectionRegex = /(?:^|\n)#{2}\s*模式\s*(\d+)\s*[：:]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const patternNumber = match[1];
    const name = match[2].trim();

    const sectionStart = match.index + match[0].length;

    // 查找下一个 section 的位置
    const nextSection = content.slice(sectionStart).search(/(?:^|\n)#{2}\s*模式\s*\d+\s*[：:]/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取 tags
    const tagsMatch = sectionContent.match(/Tags?[：:]\s*(.+)/);
    const triggerTags2: Tag[] = tagsMatch
      ? (tagsMatch[1].split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) as Tag[])
      : ([] as unknown as Tag[]);
    
    // 提取 trigger
    const triggerMatch2 = sectionContent.match(/Trigger[：:]s*(.+)/);
    const trigger2 = triggerMatch2
      ? triggerMatch2[1].trim()
      : `模式${patternNumber}:${agentType}`;
    
    // 提取 steps（多个可能的模式）
    const stepLines2 =
      sectionContent.match(/步骤[：:]s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/)?.[1]
      ?.split("\n").map((s: string) => s.replace(/^\d+[.、]\s*/, "").trim())
      .filter(Boolean)
      ??
      sectionContent.match(/流程[：:]s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/)?.[1]
      ?.split("\n").map((s: string) => s.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      ??
      sectionContent.match(/[-*]\s*(.+)/g)
      ?.map((s: string) => s.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    
    const steps2: string[] = stepLines2
      ? stepLines2.map((s: string) => s.replace(/^-\s*/, "").trim()).filter(Boolean)
      : ["参考文档中的模式描述"];

    // 提取 expected output
    const outputMatch = sectionContent.match(/输出[：:]\s*(.+)/);
    const expectedOutput = outputMatch
      ? outputMatch[1].trim()
      : `模式${patternNumber}: ${name}`;

    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `pattern-${patternNumber}-${skillName}-${timestamp}`;

    patterns.push({
      id,
      agentType,
      name: `模式${patternNumber}:${name}`,
      triggerTags: triggerTags2,
      trigger: trigger2,
      steps: steps2,
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
