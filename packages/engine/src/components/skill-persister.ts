/**
 * skill-persister.ts —— SkillRegistry ↔ MemoryStore 双向持久化桥。
 *
 * 技能沉淀闭环的核心基建：
 *   1. persistSkillsToMemory():   SkillRegistry → MemoryStore (kind="Skill")
 *   2. loadSkillsFromMemory():    MemoryStore → SkillTemplate[] → SkillRegistry.registerAll()
 *   3. scanOutputFilesForSkills(): 扫描已产出文件（pattern/design/review），
 *      从 Markdown 提取技能模板（文件回溯扫描）。
 *
 * @since 技能沉淀机制 Core-1
 * @integration v2.6.6 — 机械提取层委托 @cortex/pattern-extractor (MarkdownPatternExtractor)
 */

import type { MemoryStore } from "@cortex/memory-store";
import { AgentType, LinkType, type SkillKind, type SkillTemplate, type Tag } from "@cortex/shared";
import type { SearchResult } from "@cortex/platform";
import { MarkdownPatternExtractor, type PatternDefinition } from "@cortex/pattern-extractor";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 0. 技能结晶为知识 ────────────────────────────

/** Knowledge 条目元数据（写入 metadata 域） */
export interface KnowledgeMetadata {
  skillId: string;
  triggerTags: Tag[];
  /** 版本号：新建=1，每次更新递增 */
  version: number;
  /** 是否已通过事实认证 */
  verified: boolean;
  /** 认证者（如 "analysis-agent"），未认证时为空 */
  verifiedBy?: string;
  /** 认证时间戳 */
  verifiedAt?: number;
  /** 佐证情景记忆 ID 列表 */
  evidenceIds: string[];
  /** 技能采纳次数 */
  adoptionCount: number;
}

/** 结晶选项 */
export interface CrystallizeOptions {
  /** 认证者标识（如 "analysis-agent"），传入即视为已认证 */
  verifiedBy?: string;
  /** 佐证情景记忆 ID 列表 */
  evidenceIds?: string[];
}

/** 结晶结果 */
export interface CrystallizeResult {
  memId: string;
  isUpdate: boolean;
  version: number;
  verified: boolean;
}

/**
 * 将已验证技能结晶为 kind="Knowledge" 记忆。支持幂等更新与版本追踪。
 *
 * 行为：
 *   - 首次结晶（无同名 Knowledge）→ 新建，version=1
 *   - 重复结晶（已有同名 Knowledge）→ 归档旧版，version 递增，合并证据链
 *   - 传入 verifiedBy 即视为已认证（weight=5），否则为未认证（weight=3）
 *
 * @param skill  技能模板
 * @param memory MemoryStore 实例
 * @param opts   可选：认证信息 + 证据链
 * @returns 结晶结果，失败返回 null
 */
export async function crystallizeSkillToKnowledge(
  skill: SkillTemplate,
  memory: MemoryStore,
  opts?: CrystallizeOptions,
): Promise<CrystallizeResult | null> {
  try {
    // 1. 查重：是否已有同名 Active Knowledge
    const existing = await memory.read({
      kind: "Insight",
      metadataFilter: { skillId: skill.id },
      limit: 1,
    }, "CSA");

    let version = 1;
    let existingEvidenceIds: string[] = [];

    if (existing.length > 0) {
      // 2. 已有记录 → 归档旧版本 → 继承版本号 + 证据链
      const oldEntry = existing[0];
      version = ((oldEntry.content_blob?.version as number) ?? 1) + 1;
      existingEvidenceIds = (oldEntry.content_blob?.evidenceIds as string[]) ?? [];
      memory.cas(oldEntry.id, "Active", "Archived");
    }

    // 3. 合并证据链（去重）
    const evidenceIds = [...existingEvidenceIds];
    if (opts?.evidenceIds) {
      for (const eid of opts.evidenceIds) {
        if (!evidenceIds.includes(eid)) evidenceIds.push(eid);
      }
    }

    // 4. 认证状态
    const verified = opts?.verifiedBy != null;

    // 5. 写入新 Knowledge
    const summaryPrefix = verified ? "[已验证技能知识]" : "[未验证技能知识]";
    const memId = memory.writePending({
      source: { agentType: AgentType.Loop, taskId: "" },
      kind: "Insight",
      content_blob: {
        skillId: skill.id,
        name: skill.name,
        trigger: skill.trigger,
        steps: skill.steps,
        expectedOutput: skill.expectedOutput,
        triggerTags: skill.triggerTags,
        kind: skill.kind,
        version,
        verified,
        verifiedBy: opts?.verifiedBy,
        verifiedAt: opts?.verifiedBy ? Date.now() : undefined,
        evidenceIds,
        weight: skill.weight,
      },
      summary: `${summaryPrefix} [${skill.kind}] ${skill.name} — ${skill.trigger}`,
      semantic_gist: `[${skill.kind}] ${skill.name} — ${skill.trigger}`.slice(0, 200),
      weight: verified ? 5 : 3,
      content_hash: "",
    });
    memory.commitMemory(memId);

    // 6. 链接证据链（DerivedFrom）
    if (opts?.evidenceIds) {
      for (const eid of opts.evidenceIds) {
        try { memory.link(memId, eid, LinkType.DerivedFrom); } catch { /* link best-effort */ }
      }
    }

    return { memId, isUpdate: existing.length > 0, version, verified };
  } catch (e) {
    console.error(
      `[skill-persister] 技能结晶为知识失败: [${skill.kind}] ${skill.name}`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * 验证知识条目的事实基础。
 *
 * 当前实现为启发式验证（至少需 1 条情景记忆佐证）。
 * AnalysisAgent（纳西妲）可调用此函数做深度验证：
 *   1. 检索 skillId 关联的 Episodic 记忆
 *   2. 比对技能步骤与实际执行记录
 *   3. 返回 verified + evidenceIds + report
 *
 * @param skill  待验证的技能模板
 * @param memory MemoryStore 实例
 * @param verifier 认证者标识（如 "analysis-agent"）
 * @returns 验证结果
 */
/** 外部搜索器回调签名 */
export type ExternalSearcher = (query: string, maxResults: number) => Promise<SearchResult[]>;

/** 验证选项 */
export interface VerifyOptions {
  /** 外部搜索回调（如 SearchAggregator.search），提供联网事实佐证 */
  externalSearch?: ExternalSearcher;
}

/** 验证结果 */
export interface VerifyResult {
  verified: boolean;
  /** 内部证据：情景记忆 ID 列表 */
  evidenceIds: string[];
  /** 外部证据：web_search 搜索结果 */
  externalResults?: SearchResult[];
  report: string;
}

/**
 * 搜索外部事实证据（基于技能关键信息构造搜索 query，调用外部搜索器）。
 *
 * 搜索策略：使用技能 name + trigger 拼接搜索词，取前 5 条结果。
 * 此函数用于弥补纯内存证据的不足——当技能缺乏情景记忆佐证时，
 * 外部搜索结果可作为事实认证的辅助证据。
 *
 * @param skill      待验证的技能模板
 * @param searcher   外部搜索回调（SearchAggregator.search）
 * @returns 搜索结果列表
 */
export async function searchExternalEvidence(
  skill: SkillTemplate,
  searcher: ExternalSearcher,
): Promise<SearchResult[]> {
  const query = `${skill.name} ${skill.trigger} ${skill.triggerTags?.join(" ") ?? ""}`.trim();
  if (!query) return [];
  try {
    return await searcher(query, 5);
  } catch {
    return [];
  }
}

/**
 * 验证知识条目的事实基础。
 *
 * 两层证据：
 *   1. 内部证据——检索 skillId 关联的 Episodic 记忆（至少 1 条）
 *   2. 外部证据——通过 externalSearch 回调联网搜索（可选）
 *
 * 验证通过条件：内部证据 ≥ 1 条（外部证据辅助但不改变 verdict）。
 * AnalysisAgent（纳西妲）可传入 externalSearch 做深度验证。
 *
 * @param skill    待验证的技能模板
 * @param memory   MemoryStore 实例
 * @param verifier 认证者标识（如 "analysis-agent"）
 * @param opts     可选：外部搜索回调
 * @returns 验证结果
 */
export async function verifySkillKnowledge(
  skill: SkillTemplate,
  memory: MemoryStore,
  verifier: string,
  opts?: VerifyOptions,
): Promise<VerifyResult> {
  // 检索与该技能关联的情景记忆
  const episodes = await memory.read({
    kind: "TaskLog",
    metadataFilter: { skillId: skill.id },
    limit: 10,
  }, "CSA");

  const evidenceIds = episodes.map((e) => e.id);

  // ── 外部证据搜索（并行，失败不阻塞） ──
  let externalResults: SearchResult[] | undefined;
  if (opts?.externalSearch) {
    try {
      externalResults = await searchExternalEvidence(skill, opts.externalSearch);
    } catch {
      // 外部搜索失败不影响内部验证
    }
  }

  // 验证标准：内部证据 ≥ 1 条（外部证据辅助，不改变 verdict）
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

/**
 * 将 SkillRegistry 中的所有技能模板持久化到 MemoryStore。
 * 每个模板作为一条 kind="Skill" 记忆写入。
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
      console.error(
        `[skill-persister] 写入技能失败: [${skill.kind}] ${skill.name}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return count;
}

// ─── 2. 读取：MemoryStore → SkillTemplate[] ───────────

/**
 * 从 MemoryStore 读取所有 kind="Skill" 记忆，反序列化为 SkillTemplate 列表。
 *
 * @returns 反序列化后的技能模板列表（异常时返回空数组）。
 */
export async function loadSkillsFromMemory(memory: MemoryStore): Promise<SkillTemplate[]> {
  const skillTemplates: SkillTemplate[] = [];

  try {
    const entries = await memory.read({
      kind: "Skill",
      limit: 100,
    }, "CSA");

    for (const entry of entries) {
      if (entry.kind !== "Skill") continue;
      if (entry.semantic_state !== "Active") continue;

      const content = entry.content_blob;
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

const SCAN_PATTERNS: { glob: string; kind: SkillKind }[] = [
  { glob: "**/pattern*.md", kind: "workflow" },
  { glob: "**/design*.md", kind: "thought" },
  { glob: "**/review*.md", kind: "action" },
  { glob: "**/audit*.md", kind: "thought" },
  { glob: "**/architecture*.md", kind: "thought" },
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

  for (const { glob, kind } of SCAN_PATTERNS) {
    const matches = findFiles(workspaceDir, glob);
    for (const filePath of matches) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const skills = extractSkillsFromMarkdown(content, kind, filePath);
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

// ─── 5. Markdown 技能提取（v2.6.6 重构——委托 @cortex/pattern-extractor） ──

/** 模块级单例——避免每次调用重新解析选项 */
const markdownExtractor = new MarkdownPatternExtractor({
  strategyJsonBlock: true,
  strategyP0P9Format: true,
  strategyPatternParagraph: true,
  strategyFallbackFullFile: false, // 全文回退由旧逻辑处理
  headingLevels: [2, 3],
  minConfidence: 0.3,
  minStepsForP0P9: 2,
  enableMerge: true,
  maxCandidates: 50,
});

/**
 * 将 PatternDefinition 转换为 SkillTemplate。
 *
 * 这是两层提取架构的桥接函数：
 * - 第 1 层（MarkdownPatternExtractor）输出 PatternDefinition[]
 * - 第 2 层（莫娜语义裁决）消费 SkillTemplate[]
 *
 * 当前桥接为机械映射——字段含义在两层间一致，
 * 未来莫娜可在第 2 层进行语义过滤/重排。
 */
function patternDefinitionToSkillTemplate(
  p: PatternDefinition,
  kind: SkillKind,
): SkillTemplate {
  // 从 description 中提取 trigger 文本
  // description 格式: "[{strategy}] trigger: {triggerText}"
  const triggerMatch = p.description.match(/trigger:\s*(.+)/);
  const trigger = triggerMatch ? triggerMatch[1].trim() : "";

  return {
    id: p.id,
    kind,
    name: p.name,
    triggerTags: p.tags as Tag[],
    trigger,
    steps: p.body.rules,
    expectedOutput: p.body.examples?.[0]?.code ?? "",
    status: "trial",
    weight: p.weight,
    feedbackHistory: [],
    discoveredBy: "markdown-extractor",
    createdAt: p.extractedAt,
  };
}

/**
 * 从 Markdown 内容提取技能模板（v2.6.6 重构版）。
 *
 * 执行流程：
 *   1. MarkdownPatternExtractor（4 策略机械提取 → PatternDefinition[]）
 *   2. 桥接转换（PatternDefinition → SkillTemplate）
 *   3. 若无产出，回退到旧版全文兜底逻辑
 */
function extractSkillsFromMarkdown(
  content: string,
  kind: SkillKind,
  filePath: string,
): SkillTemplate[] {
  if (!content || content.trim().length === 0) return [];

  // 步骤 1：MarkdownPatternExtractor 机械提取
  const result = markdownExtractor.extract(content);

  if (result.success && result.patterns.length > 0) {
    const skills = result.patterns.map((p) =>
      patternDefinitionToSkillTemplate(p, kind),
    );

    // 过滤掉无效技能（无 name 或 无 steps）
    const valid = skills.filter(
      (s) => s.name.length > 0 && s.steps.length > 0,
    );

    if (valid.length > 0) return valid;
  }

  // 步骤 2：无产出 → 旧版全文兜底
  const fileName = path.basename(filePath, ".md");
  const firstLine =
    content.split("\n")[0]?.replace(/^#+\s*/, "") ?? fileName;
  const timestamp = Date.now();

  return [
    {
      id: `${fileName}-${timestamp}`,
      kind,
      name: `从文件提取: ${firstLine.slice(0, 50)}`,
      triggerTags: ["research", "analysis"] as Tag[],
      trigger: `文件: ${fileName}`,
      steps: [`参考该设计文档: ${filePath}`],
      expectedOutput: "理解设计意图后执行",
      status: "trial" as const,
      weight: 0,
      feedbackHistory: [],
      discoveredBy: "file-scanner",
      createdAt: timestamp,
    },
  ];
}

// ─── 6. 旧版提取函数（保留兼容，已不再使用）─────────────────

/**
 * 从 Markdown 内容中提取 P0-P9 格式的段落，转换为 SkillTemplate。
 * 匹配 "## P0 — 名称 (English Name)" 或 "## P9 — 名称" 格式。
 */
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
      : `P${pNumber}:${kind}`;

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
      kind,
      name: `P${pNumber}:${name}`,
      triggerTags,
      trigger,
      steps,
      expectedOutput,
      status: "trial" as const,
      weight: 0,
      feedbackHistory: [],
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
function _extractPatternSections(content: string, kind: SkillKind): SkillTemplate[] {
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
      : `模式${patternNumber}:${kind}`;
    
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
      kind,
      name: `模式${patternNumber}:${name}`,
      triggerTags: triggerTags2,
      trigger: trigger2,
      steps: steps2,
      expectedOutput,
      status: "trial" as const,
      weight: 0,
      feedbackHistory: [],
      discoveredBy: "file-scanner-pattern",
      createdAt: timestamp,
    });
  }

  return patterns;
}
