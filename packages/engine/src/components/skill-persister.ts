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
    } catch {
      // 单条写入失败不阻塞整体
    }
  }

  return count;
}

// ─── 2. 读取：MemoryStore → SkillTemplate[] ──────────

/**
 * 从 MemoryStore 加载已沉淀的技能模板。
 * 查询所有 MemoryType.Skill + state=Active 的记忆。
 *
 * @returns 反序列化后的技能模板数组。
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

      // 基本合法性校验
      if (!skill.id || !skill.agentType || !skill.name || !skill.triggerTags || !Array.isArray(skill.steps)) {
        continue;
      }

      skillTemplates.push(skill);
    }
  } catch {
    // 查询失败返回空数组（MemoryStore 可能未初始化）
  }

  return skillTemplates;
}

// ─── 3. 文件回溯扫描 ─────────────────────────────────

/** 扫描配置：哪些 glob 对应哪种 AgentType */
const SCAN_PATTERNS: { glob: string; agentType: AgentType }[] = [
  { glob: "**/pattern*.md", agentType: AgentType.Loop },
  { glob: "**/design*.md", agentType: AgentType.Analysis },
  { glob: "**/review*.md", agentType: AgentType.Review },
  { glob: "**/audit*.md", agentType: AgentType.DocGovern },
  { glob: "**/architecture*.md", agentType: AgentType.Analysis },
];

/**
 * 扫描工作区下已产出的分析/设计/审查/模式文件，从中提取技能模板。
 * 文件回溯扫描——弥补"上次执行时 LoopAgent 没被调度"的空窗期。
 *
 * @param workspaceDir 工作区根目录
 * @returns 提取到的技能模板数组
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
      } catch {
        // 单个文件读取失败不影响其他
      }
    }
  }

  return allSkills;
}

// ─── 内部：文件查找 ─────────────────────────────────

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
        } else if (entry.name.endsWith(".md") && matchFileName(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    } catch {
      // 权限错误忽略
    }
  }

  walk(root, 0);
  return results;
}

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

// ─── 内部：Markdown 技能提取 ────────────────────────

/**
 * 从 Markdown 内容中非结构化提取技能模板。
 *
 * 策略：
 *   1. 优先查找 JSON 块（SkillTemplate 格式）
 *   2. "## PN — 名称" 格式（莫娜模式提炼输出：P0-P9 带 tags/trigger/配方）
 *   3. "## 模式 N：名称" 格式段落
 *   4. 最终回退：整个文件内容作为单一参考技能
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

  // 策略 2：P0-P9 格式提取（莫娜 pattern.md 产出）
  const pnSections = extractPNSections(content, agentType);
  if (pnSections.length > 0) return pnSections;

  // 策略 3：模式段落提取
  const patterns = extractPatternSections(content, agentType);
  if (patterns.length > 0) return patterns;

  // 策略 4：回退——整个文件作为一个参考技能
  const fileName = path.basename(filePath, ".md");
  const firstLine = content.split("\n")[0]?.replace(/^#+\s*/, "") ?? fileName;
  const timestamp = Date.now();

  return [{
    id: `skill-file-${fileName}-${timestamp}`,
    agentType,
    name: `参考: ${firstLine.slice(0, 50)}`,
    triggerTags: ["research", "analysis"] as Tag[],
    trigger: `当需要参考 ${fileName} 文档时查询`,
    steps: [`阅读文件: ${filePath}`],
    expectedOutput: "理解设计意图后执行",
    status: "trial",
    adoptionCount: 0,
    rejectionCount: 0,
    discoveredBy: "file-scanner",
    createdAt: timestamp,
  }];
}

/**
 * 从 Markdown 正文提取 "## PN — 名称" 格式模式段落。
 * 这是莫娜（LoopAgent）pattern.md 产出的标准格式：
 *
 *   ## P0 — 两层管线架构 (Two-Layer Pipeline)
 *   **tags**: `parsing`, `architecture`, ...
 *   **trigger**: 任何需要...
 *   ### 观察
 *   ...
 *   ### 配方
 *   步骤 1: ...
 *   步骤 2: ...
 *   ### 适用条件 / ### 关键约束
 *   ...
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
    // 去除末尾的英文名括号: "两层管线架构 (Two-Layer Pipeline)" → "两层管线架构"
    const name = fullName.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const sectionStart = match.index + match[0].length;

    // 提取到下一个 ## 标题或文件末尾的内容
    const nextSection = content.slice(sectionStart).search(/\n#{2}\s/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取 tags: **tags**: `tag1`, `tag2`, ...
    const tagsMatch = sectionContent.match(/\*\*tags\*\*\s*[：:]\s*(.+?)(?:\n|$)/);
    const triggerTags: Tag[] = tagsMatch
      ? tagsMatch[1]
          .replace(/`/g, "")
          .split(",")
          .map((t) => t.trim() as Tag)
          .filter(Boolean)
      : [agentType.toLowerCase() as Tag];

    // 提取 trigger: **trigger**: ...
    const triggerMatch = sectionContent.match(/\*\*trigger\*\*\s*[：:]\s*(.+?)(?:\n|$)/);
    const trigger = triggerMatch
      ? triggerMatch[1].trim()
      : `当匹配标签 ${agentType} 时触发`;

    // 提取步骤：从 "### 配方" 段落中提取编号步骤
    const recipeMatch = sectionContent.match(/###\s*配方[\s\S]*?(?=\n###|\n##|$)/);
    let steps: string[] = [];
    if (recipeMatch) {
      const recipeContent = recipeMatch[0];
      // 提取 "步骤 N: ..." 格式
      const stepLines = recipeContent.match(/步骤\s*\d+[：:]/g);
      if (stepLines) {
        // 按步骤号分割
        const stepParts = recipeContent.split(/步骤\s*\d+[：:]/).slice(1);
        steps = stepParts.map((s) => {
          // 取第一行作为步骤描述
          const firstLine = s.split("\n")[0]?.trim() ?? "";
          return firstLine.replace(/^\s*\d+\.\s*/, "").trim();
        }).filter((s) => s.length > 0);
      }
    }
    if (steps.length === 0) {
      steps = ["分析相关代码模式", "遵循已建立的架构约定"];
    }

    // 提取适用条件作为 expectedOutput 的补充
    const conditionMatch = sectionContent.match(/###\s*(?:适用条件|关键约束)[\s\S]*?(?=\n###|\n##|$)/);
    const conditions = conditionMatch
      ? conditionMatch[0]
          .split("\n")
          .filter((l) => l.startsWith("-"))
          .map((l) => l.replace(/^-\s*/, "").trim())
          .join("; ")
      : "";

    const expectedOutput = conditions || `应用 ${name} 模式完成实现`;

    // 生成 skill id
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `skill-p${pNumber}-${skillName}-${timestamp}`;

    patterns.push({
      id,
      agentType,
      name: `P${pNumber}: ${name}`,
      triggerTags,
      trigger,
      steps,
      expectedOutput,
      status: "trial",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "mona-pattern-scan",
      createdAt: timestamp,
    });
  }

  return patterns;
}

/**
 * 从 Markdown 正文提取 "## 模式 N：名称" 格式段落。
 */
function extractPatternSections(content: string, agentType: AgentType): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();

  // 匹配 "### 模式 N：XXX" 或 "## 模式 N：XXX"
  const sectionRegex = /(?:^|\n)#{2,3}\s*模式\s*\d+\s*[：:]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const name = match[1].trim();
    const sectionStart = match.index + match[0].length;

    // 提取到下一个同级标题或文件末尾的内容
    const nextSection = content.slice(sectionStart).search(/\n#{2,3}\s/);
    const sectionContent = nextSection === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionStart + nextSection);

    // 提取触发条件
    const triggerMatch = sectionContent.match(/(?:触发条件|适用场景)[：:]\s*(.+?)(?:\n|$)/);
    const trigger = triggerMatch ? triggerMatch[1].trim() : `当匹配标签 ${agentType} 时触发`;

    // 提取标签
    const tagsMatch = sectionContent.match(/tags\s*[=：:]\s*\[(.+?)\]/);
    const triggerTags: Tag[] = tagsMatch
      ? tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, "")) as Tag[]
      : [agentType.toLowerCase() as Tag];

    // 提取步骤
    const stepsMatch = sectionContent.match(/(?:步骤序列|steps)[：:]\s*\n((?:\s*\d+\..+\n?)+)/);
    let steps: string[];
    if (stepsMatch) {
      steps = stepsMatch[1]
        .split("\n")
        .map((s) => s.replace(/^\s*\d+\.\s*/, "").trim())
        .filter(Boolean);
    } else {
      steps = ["分析相关代码模式", "遵循已建立的架构约定"];
    }

    // 提取预期产出
    const outputMatch = sectionContent.match(/(?:预期产出|expectedOutput)[：:]\s*(.+?)(?:\n|$)/);
    const expectedOutput = outputMatch ? outputMatch[1].trim() : "";

    patterns.push({
      id: `skill-pattern-${name.replace(/\s+/g, "-").toLowerCase()}-${timestamp}`,
      agentType,
      name,
      triggerTags,
      trigger,
      steps,
      expectedOutput,
      status: "trial",
      adoptionCount: 0,
      rejectionCount: 0,
      discoveredBy: "file-scanner",
      createdAt: timestamp,
    });
  }

  return patterns;
}
