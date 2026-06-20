// ============================================================
// @cortex/skill-kit —— SkillRegistry ↔ MemoryStore 双向持久化桥
//
// @file-overview
// 技能沉淀闭环的核心基建。原位于 @cortex/engine/components/skill-persister.ts，
// 横向解耦后迁入 @cortex/skill-kit。
// ============================================================

import type { MemoryStore } from "@cortex/memory-store";
import { AgentType, LinkType, type SkillKind, type SkillTemplate, type Tag } from "@cortex/shared";
import type { SearchResult } from "@cortex/platform";
import { MarkdownPatternExtractor, type PatternDefinition } from "@cortex/pattern-extractor";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 0. 技能结晶为知识 ────────────────────────────

export interface KnowledgeMetadata {
  skillId: string;
  triggerTags: Tag[];
  version: number;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: number;
  evidenceIds: string[];
  adoptionCount: number;
}

export interface CrystallizeOptions {
  verifiedBy?: string;
  evidenceIds?: string[];
}

export interface CrystallizeResult {
  memId: string;
  isUpdate: boolean;
  version: number;
  verified: boolean;
}

export async function crystallizeSkillToKnowledge(
  skill: SkillTemplate,
  memory: MemoryStore,
  opts?: CrystallizeOptions,
): Promise<CrystallizeResult | null> {
  try {
    const existing = await memory.read({
      kind: "Insight",
      metadataFilter: { skillId: skill.id },
      limit: 1,
    }, "CSA");

    let version = 1;
    let existingEvidenceIds: string[] = [];

    if (existing.length > 0) {
      const oldEntry = existing[0];
      version = ((oldEntry.content_blob?.version as number) ?? 1) + 1;
      existingEvidenceIds = (oldEntry.content_blob?.evidenceIds as string[]) ?? [];
      memory.cas(oldEntry.id, "Active", "Archived");
    }

    const evidenceIds = [...existingEvidenceIds];
    if (opts?.evidenceIds) {
      for (const eid of opts.evidenceIds) {
        if (!evidenceIds.includes(eid)) evidenceIds.push(eid);
      }
    }

    const verified = opts?.verifiedBy != null;

    const summaryPrefix = verified ? "[已验证技能知识]" : "[未验证技能知识]";
    const memId = memory.writePending({
      source: { agentType: AgentType.Loop, taskId: "" },
      kind: "Insight",
      content_blob: {
        skillId: skill.id, name: skill.name, trigger: skill.trigger,
        steps: skill.steps, expectedOutput: skill.expectedOutput,
        triggerTags: skill.triggerTags, kind: skill.kind,
        version, verified, verifiedBy: opts?.verifiedBy,
        verifiedAt: opts?.verifiedBy ? Date.now() : undefined,
        evidenceIds, weight: skill.weight,
      },
      summary: `${summaryPrefix} [${skill.kind}] ${skill.name} — ${skill.trigger}`,
      semantic_gist: `[${skill.kind}] ${skill.name} — ${skill.trigger}`.slice(0, 200),
      weight: verified ? 5 : 3,
      content_hash: "",
    });
    memory.commitMemory(memId);

    if (opts?.evidenceIds) {
      for (const eid of opts.evidenceIds) {
        try { memory.link(memId, eid, LinkType.DerivedFrom); } catch { /* link best-effort */ }
      }
    }

    return { memId, isUpdate: existing.length > 0, version, verified };
  } catch (e) {
    console.error(`[skill-persister] 技能结晶为知识失败: [${skill.kind}] ${skill.name}`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export type ExternalSearcher = (query: string, maxResults: number) => Promise<SearchResult[]>;

export interface VerifyOptions {
  externalSearch?: ExternalSearcher;
}

export interface VerifyResult {
  verified: boolean;
  evidenceIds: string[];
  externalResults?: SearchResult[];
  report: string;
}

export async function searchExternalEvidence(
  skill: SkillTemplate,
  searcher: ExternalSearcher,
): Promise<SearchResult[]> {
  const query = `${skill.name} ${skill.trigger} ${skill.triggerTags?.join(" ") ?? ""}`.trim();
  if (!query) return [];
  try { return await searcher(query, 5); } catch { return []; }
}

export async function verifySkillKnowledge(
  skill: SkillTemplate,
  memory: MemoryStore,
  verifier: string,
  opts?: VerifyOptions,
): Promise<VerifyResult> {
  const episodes = await memory.read({
    kind: "TaskLog",
    metadataFilter: { skillId: skill.id },
    limit: 10,
  }, "CSA");

  const evidenceIds = episodes.map((e) => e.id);

  let externalResults: SearchResult[] | undefined;
  if (opts?.externalSearch) {
    try { externalResults = await searchExternalEvidence(skill, opts.externalSearch); } catch { /* best-effort */ }
  }

  const verified = episodes.length >= 1;
  let report: string;
  if (verified) {
    report = `知识通过事实认证 (${verifier}): ${episodes.length} 条情景记忆佐证。` +
      episodes.map((e) => `\n  - ${e.summary.slice(0, 120)}`).join("");
    if (externalResults && externalResults.length > 0) {
      report += `\n外部佐证 (web_search): ${externalResults.length} 条。` +
        externalResults.slice(0, 3).map((r) => `\n  - [${r.title}](${r.url})`).join("");
    }
  } else {
    report = `知识未通过事实认证 (${verifier}): 缺少情景记忆佐证。` +
      `技能 ${skill.name} 虽权重 ${skill.weight}，但无情景记忆可追溯。`;
    if (externalResults && externalResults.length > 0) {
      report += `\n提示: web_search 找到 ${externalResults.length} 条外部结果，可辅助人工审核。` +
        externalResults.slice(0, 3).map((r) => `\n  - [${r.title}](${r.url})`).join("");
    }
  }

  return { verified, evidenceIds, externalResults, report };
}

// ─── 1. 写入：SkillRegistry → MemoryStore ─────────────

export function persistSkillsToMemory(skills: SkillTemplate[], memory: MemoryStore): number {
  let count = 0;
  for (const skill of skills) {
    try {
      const memId = memory.writePending({
        source: { agentType: AgentType.Loop, taskId: "" },
        kind: "Skill",
        content_blob: skill as unknown as Record<string, unknown>,
        summary: `[技能沉淀] [${skill.kind}] ${skill.name} — ${skill.trigger}`,
        semantic_gist: `[${skill.kind}] ${skill.name} — ${skill.trigger}`.slice(0, 200),
        weight: 5,
        content_hash: "",
      });
      memory.commitMemory(memId);
      count++;
    } catch (e) {
      console.error(`[skill-persister] 写入技能失败: [${skill.kind}] ${skill.name}`, e instanceof Error ? e.message : String(e));
    }
  }
  return count;
}

// ─── 2. 读取：MemoryStore → SkillTemplate[] ───────────

export async function loadSkillsFromMemory(memory: MemoryStore): Promise<SkillTemplate[]> {
  const skillTemplates: SkillTemplate[] = [];
  try {
    const entries = await memory.read({ kind: "Skill", limit: 100 }, "CSA");
    for (const entry of entries) {
      if (entry.kind !== "Skill" || entry.semantic_state !== "Active") continue;
      const content = entry.content_blob;
      if (!content || typeof content !== "object") continue;
      const skill = content as unknown as SkillTemplate;
      if (!skill?.id || !skill?.name || !skill?.triggerTags || !Array.isArray(skill.steps)) continue;
      skillTemplates.push(skill);
    }
  } catch (e) {
    console.error("[skill-persister] 从 MemoryStore 加载技能失败", e instanceof Error ? e.message : String(e));
  }
  return skillTemplates;
}

// ─── 3. 文件回溯扫描 ────────────────────────────────────

const SCAN_PATTERNS: { glob: string; kind: SkillKind }[] = [
  { glob: "**/pattern*.md", kind: "workflow" },
  { glob: "**/design*.md", kind: "thought" },
  { glob: "**/review*.md", kind: "action" },
  { glob: "**/audit*.md", kind: "thought" },
  { glob: "**/architecture*.md", kind: "thought" },
];

export function scanOutputFilesForSkills(workspaceDir: string): SkillTemplate[] {
  const allSkills: SkillTemplate[] = [];
  const seenIds = new Set<string>();
  for (const { glob, kind } of SCAN_PATTERNS) {
    const matches = findFiles(workspaceDir, glob);
    for (const filePath of matches) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const skills = extractSkillsFromMarkdown(content, kind, filePath);
        for (const skill of skills) {
          if (!seenIds.has(skill.id)) { seenIds.add(skill.id); allSkills.push(skill); }
        }
      } catch (e) {
        console.error(`[skill-persister] 扫描文件失败: ${filePath}`, e instanceof Error ? e.message : String(e));
      }
    }
  }
  return allSkills;
}

function findFiles(root: string, glob: string): string[] {
  const results: string[] = [];
  const pattern = glob.replace("**/", "");
  function walk(dir: string, depth: number) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fullPath, depth + 1); }
        else if (entry.name.endsWith(".md") && matchFileName(entry.name, pattern)) { results.push(fullPath); }
      }
    } catch (e) {
      console.error(`[skill-persister] 遍历目录失败: ${dir}`, e instanceof Error ? e.message : String(e));
    }
  }
  walk(root, 0);
  return results;
}

function matchFileName(fileName: string, pattern: string): boolean {
  if (pattern.endsWith("*.md")) {
    const prefix = pattern.slice(0, -4);
    if (prefix.endsWith("*")) return fileName.includes(prefix.slice(0, -1));
    return fileName.startsWith(prefix.slice(0, -1));
  }
  return fileName.includes(pattern);
}

// ─── 5. Markdown 技能提取 ──

const markdownExtractor = new MarkdownPatternExtractor({
  strategyJsonBlock: true, strategyP0P9Format: true, strategyPatternParagraph: true,
  strategyFallbackFullFile: false, headingLevels: [2, 3], minConfidence: 0.3,
  minStepsForP0P9: 2, enableMerge: true, maxCandidates: 50,
});

function patternDefinitionToSkillTemplate(p: PatternDefinition, kind: SkillKind): SkillTemplate {
  const triggerMatch = p.description.match(/trigger:\s*(.+)/);
  const trigger = triggerMatch ? triggerMatch[1].trim() : "";
  return {
    id: p.id, kind, name: p.name, triggerTags: p.tags as Tag[], trigger,
    steps: p.body.rules, expectedOutput: p.body.examples?.[0]?.code ?? "",
    status: "trial", weight: p.weight, feedbackHistory: [],
    discoveredBy: "markdown-extractor", createdAt: p.extractedAt,
  };
}

function extractSkillsFromMarkdown(content: string, kind: SkillKind, filePath: string): SkillTemplate[] {
  if (!content || content.trim().length === 0) return [];
  const result = markdownExtractor.extract(content);
  if (result.success && result.patterns.length > 0) {
    const skills = result.patterns.map((p) => patternDefinitionToSkillTemplate(p, kind));
    const valid = skills.filter((s) => s.name.length > 0 && s.steps.length > 0);
    if (valid.length > 0) return valid;
  }
  const fileName = path.basename(filePath, ".md");
  const firstLine = content.split("\n")[0]?.replace(/^#+\s*/, "") ?? fileName;
  const timestamp = Date.now();
  return [{
    id: `${fileName}-${timestamp}`, kind,
    name: `从文件提取: ${firstLine.slice(0, 50)}`,
    triggerTags: ["research", "analysis"] as Tag[],
    trigger: `文件: ${fileName}`,
    steps: [`参考该设计文档: ${filePath}`],
    expectedOutput: "理解设计意图后执行",
    status: "trial" as const, weight: 0, feedbackHistory: [],
    discoveredBy: "file-scanner", createdAt: timestamp,
  }];
}

// ─── 6. 旧版提取函数（保留兼容）─────────────────

function _extractPNSections(content: string, kind: SkillKind): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();
  const sectionRegex = /(?:^|\n)#{2}\s*P(\d+)\s*[—\-–]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    const pNumber = match[1];
    const fullName = match[2].trim();
    const name = fullName.replace(/\(.*?\)/g, "").trim();
    const sectionStart = match.index + match[0].length;
    const nextSection = content.slice(sectionStart).search(/(?:^|\n)#{2}\s*P\d+\s*[—\-–]/);
    const sectionContent = nextSection === -1 ? content.slice(sectionStart) : content.slice(sectionStart, sectionStart + nextSection);
    const tagsMatch = sectionContent.match(/Tags?[：:]\s*(.+)/);
    const triggerTags: Tag[] = tagsMatch ? (tagsMatch[1].split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) as Tag[]) : ([] as unknown as Tag[]);
    const triggerMatch = sectionContent.match(/Trigger[：:]\s*(.+)/);
    const trigger = triggerMatch ? triggerMatch[1].trim() : `P${pNumber}:${kind}`;
    const recipeMatch = sectionContent.match(/Recipe[：:]\s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/);
    let steps: string[] = [];
    if (recipeMatch) {
      const recipeContent = recipeMatch[0];
      const stepLines = recipeContent.match(/[-*]\s*(.+)/g);
      if (stepLines) steps = stepLines.map((s: string) => s.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    }
    if (steps.length === 0) steps = ["分析相关代码模式", "遵循已建立的架构约定"];
    const conditionMatch = sectionContent.match(/Condition[：:]\s*([\s\S]*?)(?:\n(?:#{1,3}|\n)|$)/);
    const conditions = conditionMatch ? conditionMatch[1].split("\n").map((c: string) => c.trim()).filter(Boolean).join("; ") : "";
    const expectedOutput = conditions || `P${pNumber}:${name}`;
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `p${pNumber}-${skillName}-${timestamp}`;
    patterns.push({ id, kind, name: `P${pNumber}:${name}`, triggerTags, trigger, steps, expectedOutput, status: "trial" as const, weight: 0, feedbackHistory: [], discoveredBy: "file-scanner-pattern", createdAt: timestamp });
  }
  return patterns;
}

function _extractPatternSections(content: string, kind: SkillKind): SkillTemplate[] {
  const patterns: SkillTemplate[] = [];
  const timestamp = Date.now();
  const sectionRegex = /(?:^|\n)#{2}\s*模式\s*(\d+)\s*[：:]\s*(.+?)(?:\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(content)) !== null) {
    const patternNumber = match[1];
    const name = match[2].trim();
    const sectionStart = match.index + match[0].length;
    const nextSection = content.slice(sectionStart).search(/(?:^|\n)#{2}\s*模式\s*\d+\s*[：:]/);
    const sectionContent = nextSection === -1 ? content.slice(sectionStart) : content.slice(sectionStart, sectionStart + nextSection);
    const tagsMatch = sectionContent.match(/Tags?[：:]\s*(.+)/);
    const triggerTags2: Tag[] = tagsMatch ? (tagsMatch[1].split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean) as Tag[]) : ([] as unknown as Tag[]);
    const triggerMatch2 = sectionContent.match(/Trigger[：:]s*(.+)/);
    const trigger2 = triggerMatch2 ? triggerMatch2[1].trim() : `模式${patternNumber}:${kind}`;
    const stepLines2 = sectionContent.match(/[-*]\s*(.+)/g)
      ?.map((s: string) => s.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    const steps2: string[] = stepLines2
      ? stepLines2.map((s: string) => s.replace(/^-\s*/, "").trim()).filter(Boolean)
      : ["参考文档中的模式描述"];
    const outputMatch = sectionContent.match(/输出[：:]\s*(.+)/);
    const expectedOutput = outputMatch ? outputMatch[1].trim() : `模式${patternNumber}: ${name}`;
    const skillName = name.replace(/\s+/g, "-").toLowerCase();
    const id = `pattern-${patternNumber}-${skillName}-${timestamp}`;
    patterns.push({ id, kind, name: `模式${patternNumber}:${name}`, triggerTags: triggerTags2, trigger: trigger2, steps: steps2, expectedOutput, status: "trial" as const, weight: 0, feedbackHistory: [], discoveredBy: "file-scanner-pattern", createdAt: timestamp });
  }
  return patterns;
}
