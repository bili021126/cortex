// ============================================================
// @cortex/memory — IMemoryStore 只读接口
//
// 定义记忆存储的核心只读接口。所有实现（内存、文件、SQLite 等）
// 均实现此接口，通过构造函数注入依赖。
//
// @interface-segregation ISP 原则
//   IMemoryStore 只包含只读操作（get/read/peek/has/getLinks 等），
//   写入操作由 IMutableMemoryStore 或 TransactionalMemoryStore 扩展。
//
// @readonly-priority 所有公开方法返回只读快照防止外部篡改。
// ============================================================

import type {
  MemoryEntry,
  MemoryQuery,
  MemoryLink,
  ReadMode,
} from "@cortex/shared";

// ── 只读记忆存储接口 ─────────────────────────

/**
 * IMemoryStore —— 只读记忆存储接口。
 *
 * 提供记忆的只读访问能力，包括按 ID 查询、按条件检索、
 * 关联链路遍历和存在性检查。实现类应通过构造函数接收
 * 存储后端、嵌入服务等依赖。
 *
 * @remarks
 * 此接口严格遵循接口隔离原则，仅包含读取操作。写入、修改、
 * 删除操作定义在具体的实现类或扩展接口中。
 *
 * @example
 * ```typescript
 * class InMemoryMemoryStore implements IMemoryStore {
 *   constructor() { /* 构造函数注入 * / }
 *
 *   async get(id: string): Promise<MemoryEntry | undefined> { ... }
 *   async read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]> { ... }
 *   has(id: string): boolean { ... }
 * }
 * ```
 */
export interface IMemoryStore {
  // ── 基础属性 ──

  /** 存储是否已初始化 */
  readonly isReady: boolean;

  /** 当前记忆条目数量 */
  readonly size: number;

  /** 存储是否具有持久化能力 */
  readonly isPersisted: boolean;

  /** 当前运行会话标识 */
  readonly sessionId?: string;

  // ── 单条目读取 ──

  /**
   * 按 ID 获取记忆条目的只读快照。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 记忆条目的只读副本，若不存在则返回 undefined
   */
  get(id: string): Promise<MemoryEntry | undefined>;

  /**
   * 按 ID 获取记忆条目的内部引用（不创建副本）。
   * 调用方不应修改返回的对象。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 记忆条目的内部只读引用，若不存在则返回 undefined
   */
  peek(id: string): Readonly<MemoryEntry> | undefined;

  /**
   * 检查指定 ID 的记忆条目是否存在。
   *
   * @param id - 记忆条目的唯一标识
   * @returns 是否存在该条目
   */
  has(id: string): boolean;

  // ── 查询检索 ──

  /**
   * 按查询条件检索记忆条目。
   *
   * @param query - 检索条件（关键词、时间范围、类别等）
   * @param mode - 检索模式：HCA（广度浅读，不追踪热度）或 CSA（深度窄读，追踪热度）
   * @returns 匹配的记忆条目数组
   */
  read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;

  // ── 关联链路 ──

  /**
   * 获取指定记忆条目的所有关联链路。
   *
   * @param sourceId - 记忆条目的唯一标识
   * @returns 关联链路数组
   */
  getLinks(sourceId: string): MemoryLink[];

  // ── 会话查询 ──

  /**
   * 按会话 ID 查询该会话的所有记忆条目。
   *
   * @param sessionId - 会话标识
   * @returns 该会话的记忆条目数组
   */
  getBySession(sessionId: string): MemoryEntry[];

  // ── 待定记忆 ──

  /**
   * 获取所有两阶段提交中处于 Pending 状态的记忆条目。
   *
   * @returns Pending 记忆条目数组
   */
  getPending(): MemoryEntry[];

  /**
   * 检查是否存在 Pending 状态的记忆条目。
   *
   * @returns 是否存在 Pending 条目
   */
  hasPending(): boolean;

  // ── 生命周期 ──

  /**
   * 初始化存储后端。
   *
   * @param dbPath - 数据库路径或连接字符串
   */
  init(dbPath: string): Promise<void>;

  /**
   * 开始新会话。
   * 生成或接受 sessionId，后续 write() 自动注入。
   *
   * @param externalId - 可选的外部传入 sessionId
   * @returns 当前会话 ID
   */
  beginSession(externalId?: string): string;

  /**
   * 终结当前会话。
   * 按 sessionId 批量归档 Active 记忆、湮灭 Pending 记忆。
   *
   * @returns 受影响的记忆条目数量
   */
  endSession(): Promise<number>;

  /**
   * 刷新所有挂起的写入到持久化层。
   */
  flush(): Promise<void>;

  /**
   * 关闭存储后端，释放所有资源。
   */
  close(): Promise<void>;
}
