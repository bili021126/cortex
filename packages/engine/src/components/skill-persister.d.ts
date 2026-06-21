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
import { type SkillTemplate, type Tag } from "@cortex/shared";
import type { SearchResult } from "@cortex/platform";
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
export declare function crystallizeSkillToKnowledge(skill: SkillTemplate, memory: MemoryStore, opts?: CrystallizeOptions): Promise<CrystallizeResult | null>;
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
export declare function searchExternalEvidence(skill: SkillTemplate, searcher: ExternalSearcher): Promise<SearchResult[]>;
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
export declare function verifySkillKnowledge(skill: SkillTemplate, memory: MemoryStore, verifier: string, opts?: VerifyOptions): Promise<VerifyResult>;
/**
 * 将 SkillRegistry 中的所有技能模板持久化到 MemoryStore。
 * 每个模板作为一条 kind="Skill" 记忆写入。
 *
 * @returns 成功持久化的技能数量。
 */
export declare function persistSkillsToMemory(skills: SkillTemplate[], memory: MemoryStore): number;
/**
 * 从 MemoryStore 读取所有 kind="Skill" 记忆，反序列化为 SkillTemplate 列表。
 *
 * @returns 反序列化后的技能模板列表（异常时返回空数组）。
 */
export declare function loadSkillsFromMemory(memory: MemoryStore): Promise<SkillTemplate[]>;
/**
 * 扫描已产出文件（pattern/design/review/audit/architecture），
 * 从 Markdown 提取技能模板。
 *
 * @returns 所有扫描到的技能模板（去重）。
 */
export declare function scanOutputFilesForSkills(workspaceDir: string): SkillTemplate[];
//# sourceMappingURL=skill-persister.d.ts.map