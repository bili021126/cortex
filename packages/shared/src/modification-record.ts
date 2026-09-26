// ============================================================
// @cortex/shared — ModificationRecord Schema v1
//
// 宪法依据：原则七（系统自我修改的宪法约束）
// 解决第二例问题（幻觉日期）的核心设计：
// 1. 所有时间戳必须有来源标记（sourceTimestamp vs inferredTimestamp）
// 2. 所有文件路径必须有事实锚点（fileHash 在修改前后的值）
// 3. 操作 ID 由系统生成（格式：MOD-{runId}-{seq}），禁止 Agent 推断
// 4. 每条记录必须关联一个 ModificationSession（对应一次 Agent 执行 run）
// ============================================================

// ⚠️ 本模块**零代码消费方**——是一份声明了但被明确延后的设计（2026-09-26 核实，**未修**）
//
// 事实：
//   · 本文件全部导出（ModificationType / ReversibilityClass / FactAnchor /
//     ModificationRecordItem / ModificationSession / ModificationRecordV1）在全仓的
//     出现位置只有三类：**本定义文件内部互相引用**、`shared/src/index.ts` 的导出名单、
//     以及若干份文档（`shared/DOMAINS.md` / `shared/REEXPORT_VERIFICATION.md` /
//     `memory/DESIGN.md`）。**没有任何代码读它。**
//   · `governance/src/consistency/schema-enforcer.ts:13` 明写：
//     「**modification-record 全量 Schema 延后至 Core-2。**」
//     所以这不是被遗忘的死代码，而是**有意的延后**——记录在此是为了让读的人
//     知道它现在不生效，而不是去删它。
//
// 一处需要留意的对口：`config/src/vocabularies/tool-enums.ts:29` 的
// `toReversibilityClass()` 自称是本文件 `ReversibilityClass` 的显式映射，其注释写着
// 「@fix 艾尔海森 P0-1 — 两套枚举描述同一域但无映射，消费方需自己推断」。
// **但它的返回类型是字符串字面量联合 `"reversible" | "irreversible" | "meta"`，
// 不是 `ReversibilityClass` 枚举本身**——而字面量联合在 TS 里不可赋给字符串枚举，
// 消费方要用它仍须 cast。即：那次修复**接上了值，没接上类型**。
// （未改——改它属代码改动，越出本轮边界。见 core-3-design-backlog.md N-28。）

import type { AgentType } from "./agent.js";

/** 修改操作类型枚举 —— 封闭集合，禁止 Agent 自定义 */
export enum ModificationType {
  FileCreated = "file_created",
  FileModified = "file_modified",
  FileDeleted = "file_deleted",
  MemoryWritten = "memory_written",
  BatchRefactor = "batch_refactor",
}

/** 修改操作的可逆性 */
export enum ReversibilityClass {
  /** 可逆（文件内容变更，可通过 git revert 恢复） */
  Reversible = "reversible",
  /** 不可逆（文件删除，需从 git 历史恢复） */
  Irreversible = "irreversible",
  /** 元操作（记忆写入，不影响文件系统） */
  Meta = "meta",
}

/** 事实锚点 —— 每条记录必须至少包含一个来源 */
export interface FactAnchor {
  /** 文件内容 hash (SHA256)，操作前的值 */
  fileHashBefore?: string;
  /** 文件内容 hash (SHA256)，操作后的值 */
  fileHashAfter?: string;
  /** 操作时的 commit hash（HEAD） */
  commitHash?: string;
  /** 操作时的 git diff 摘要 */
  gitDiffSummary?: string;
  /** 时间戳来源类型 */
  timestampSource: 'filesystem_mtime' | 'git_commit_time' | 'system_clock' | 'llm_inferred';
  /** 实际时间戳 */
  timestamp: number;
}

/** 单条修改记录 */
export interface ModificationRecordItem {
  /** 系统生成的唯一 ID，格式: MOD-{runId}-{seq} */
  id: string;
  /** 归属的 run ID */
  runId: string;
  /** 操作类型（枚举） */
  type: ModificationType;
  /** 操作 Agent */
  agentType: AgentType;
  /** 操作描述（Agent 填写，与事实锚点交叉验证） */
  description: string;
  /** 涉及的文件路径（相对于 projectRoot） */
  filePaths: string[];
  /** 事实锚点（至少一个，禁止空数组） */
  factAnchors: FactAnchor[];
  /** 可逆性分类 */
  reversibility: ReversibilityClass;
  /** 关联的记忆 ID（可选） */
  memoryIds?: string[];
  /** Schema 版本（预留向前兼容） */
  schemaVersion: 1;
}

/** 修改会话 —— 对应一次 Agent 执行 run */
export interface ModificationSession {
  /** 会话 ID = run ID */
  sessionId: string;
  /** 起始时间 */
  startedAt: number;
  /** 结束时间 */
  completedAt?: number;
  /** Agent 类型列表 */
  agentTypes: AgentType[];
  /** 项目指纹 */
  projectFingerprint: string;
  /** 起始 commit hash */
  startCommitHash: string;
  /** 结束 commit hash（如果有 commit） */
  endCommitHash?: string;
  /** 会话状态 */
  status: 'active' | 'completed' | 'crashed' | 'rolled_back';
  /** 本次修改的记录 ID 列表 */
  recordIds: string[];
}

/** 完整修改记录文件结构 */
export interface ModificationRecordV1 {
  /** 文件格式版本 */
  formatVersion: 1;
  /** 项目标识 */
  projectFingerprint: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 修改记录列表（按时间升序） */
  records: ModificationRecordItem[];
  /** 会话列表 */
  sessions: ModificationSession[];
  /** 附录：Schema 扩展字段（向前兼容） */
  extensions?: Record<string, unknown>;
}
