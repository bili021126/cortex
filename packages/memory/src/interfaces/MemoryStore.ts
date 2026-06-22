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
import type { IMemoryStore as SharedIMemoryStore } from "@cortex/shared";

/**
 * IMemoryStore（扩展 @cortex/shared）
 *
 * 修正：此前 memory 包定义了完全独立的 IMemoryStore，与 shared 同步漂移。
 * 现在通过 extends 声明继承关系，memory 专属方法追加在下方。
 */
export interface IMemoryStore extends SharedIMemoryStore {
  /** 存储是否已初始化 */
  readonly isReady: boolean;

  /**
   * 按 ID 获取记忆条目的只读快照。
   */
  get(id: string): Promise<MemoryEntry | undefined>;
}
