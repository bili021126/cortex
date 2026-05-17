// ============================================================
// @cortex/shared — DocRegistry 类型定义
//
// @file-overview
// DocRegistry 是文档治理层的核心基础设施——与 MemoryStore 同构，
// 管理治理文档的生命周期（draft → active → archived → deprecated）。
//
// 调用者说"是什么"，DocRegistry 决定"放哪"和"什么状态"。
//
// @design 与 MemoryStore 的对应
// - register()  ← write()    : 创建文档，初始状态 draft，自动决定落盘路径
// - promote()   ← confirmWrite() : draft → active（正史门槛：reviewers 含 "human"）
// - archive()   ← archive()  : active → archived
// - deprecate()              : 任意状态 → deprecated（无 MemoryStore 对应）
// - list()      ← read()/query() : 按 status/type 查询
// ============================================================

/** 文档类型——对应治理层的各种产出 */
export type DocType =
  | "audit"             // 凝光审计报告（doc_audit 节点产出）
  | "consensus"         // 共识清单（圆桌收束产出）
  | "attribution"       // 归因分析报告（归因圆桌产出）
  | "review"            // 审查报告（刻晴/纳西妲审查产出）
  | "self-examination"  // 软审视报告（纳西妲/莫娜架构洞察）
  | "architecture";     // 架构设计文档（纳西妲或人类维护）

/** 文档状态——与记忆四态对齐 */
export type DocStatus =
  | "draft"       // 草稿：Agent 生成或人类编写，未审批
  | "active"      // 正史：已审批，可供引用
  | "archived"    // 已归档：仍可阅读，不建议引用
  | "deprecated"; // 已废弃：内容过时，不应使用

/** 委员会类型 */
export type CommitteeType = "standing" | "ad-hoc";

/** 触发来源——临时委员会的两条触发路径 */
export type TriggerSource = "agent" | "user";

/** DocRegistry.register() 的输入——调用者只需描述文档是什么 */
export interface DocInput {
  /** 文档类型 */
  type: DocType;
  /** 文档标题（人类可读） */
  title: string;
  /** 文档正文 */
  content: string;
  /** 作者（Agent 或人类标识） */
  authors: string[];
  /** 委员会类型（治理产出时填写） */
  committeeType?: CommitteeType;
  /** 触发来源（临时委员会时填写） */
  triggerSource?: TriggerSource;
  /** 适用的宪法版本 */
  constitutionVersion?: string;
}

/** DocRegistry 中已注册的文档条目 */
export interface DocEntry extends DocInput {
  /** 全局唯一 ID，格式: {date}-{type}-{slug} */
  id: string;
  /** 文档状态 */
  status: DocStatus;
  /** 磁盘上的绝对路径或相对路径 */
  filePath: string;
  /** 审批者列表（含 "human" = 正史） */
  reviewedBy: string[];
  /** 注册时间戳 (ms) */
  registeredAt: number;
  /** 晋升正史时间戳 (ms)，null = 未晋升 */
  promotedAt: number | null;
}

/** DocRegistry 的 JSON 索引文件格式 */
export interface DocRegistryIndex {
  formatVersion: 1;
  entries: Record<string, DocEntry>;
}
