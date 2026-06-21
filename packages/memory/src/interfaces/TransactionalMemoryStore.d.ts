import type { MemoryEntry, MemoryLink, MemoryWriteInput, MemoryQuery, SemanticState, LinkType, ReadMode } from "@cortex/shared";
import type { IMemoryStore } from "./MemoryStore.js";
/**
 * 事务隔离级别。
 *
 * - ReadCommitted: 只能读到已提交的数据（默认）
 * - RepeatableRead: 事务内多次读取结果一致
 * - Serializable: 最强隔离，串行化执行
 */
export type TransactionIsolation = "ReadCommitted" | "RepeatableRead" | "Serializable";
/**
 * 事务状态。
 *
 * - active: 事务已开启，可执行写入操作
 * - committed: 事务已提交，所有操作已持久化
 * - rolledback: 事务已回滚，所有操作已撤销
 * - error: 事务出现错误，无法继续
 */
export type TransactionStatus = "active" | "committed" | "rolledback" | "error";
/**
 * 事务上下文 —— 在 beginTransaction 和 commit/rollback 间传递。
 *
 * 包含事务 ID、状态、时间戳和挂起的操作日志，用于
 * commit 时批量写入和 rollback 时逆向撤销。
 *
 * @example
 * ```typescript
 * const txn = await store.beginTransaction("Serializable");
 * // txn.status === "active"
 * await store.commit(txn);
 * // txn.status === "committed"
 * ```
 */
export interface TransactionContext {
    /** 全局唯一事务 ID */
    readonly id: string;
    /** 事务当前状态 */
    readonly status: TransactionStatus;
    /** 事务开始时间戳（Unix 毫秒） */
    readonly startedAt: number;
    /** 事务隔离级别 */
    readonly isolation: TransactionIsolation;
    /** 事务超时时间戳（Unix 毫秒），超过此时间未 commit 将自动回滚 */
    readonly timeoutAt: number;
    /** 挂起的写入操作列表 */
    readonly pendingWrites: readonly MemoryWriteInput[];
    /** 挂起的关联操作列表 */
    readonly pendingLinks: readonly TransactionLinkOp[];
    /** 用户自定义元数据（如调用链追踪 ID） */
    readonly metadata?: Record<string, unknown>;
}
/**
 * 事务内的关联操作记录。
 */
export interface TransactionLinkOp {
    /** 操作类型 */
    readonly action: "link" | "unlink";
    /** 源记忆 ID */
    readonly sourceId: string;
    /** 目标记忆 ID */
    readonly targetId: string;
    /** 关联类型 */
    readonly linkType: LinkType;
    /** 可选权重 */
    readonly weight?: number;
}
/**
 * 事务操作结果。
 *
 * @typeParam T - 返回数据类型
 */
export interface TransactionResult<T = void> {
    /** 事务是否成功 */
    readonly success: boolean;
    /** 成功时的返回数据 */
    readonly data?: T;
    /** 失败时的错误信息 */
    readonly error?: Error;
    /** 受影响的条目数量 */
    readonly affectedCount: number;
}
/**
 * TransactionalMemoryStore —— 支持事务性内存操作的接口。
 *
 * 在 IMemoryStore 的只读能力基础上，扩展写入和事务能力。
 * 实现此接口的类必须同时实现 IMemoryStore。
 *
 * @remarks
 * 设计目标：
 * 1. 多条目原子写入：writeMany + linkMany 在一个事务中全部成功或全部回滚
 * 2. 事务隔离：默认 ReadCommitted，可提升至 Serializable
 * 3. 回滚安全：commit 失败时自动回滚所有挂起操作
 * 4. 超时保护：超过设定时间未 commit 的事务自动回滚
 *
 * @example
 * ```typescript
 * const store: MemoryStore & TransactionalMemoryStore = new MemoryStore();
 * const txn = await store.beginTransaction("Serializable");
 * try {
 *   const id1 = await store.writeWithin(txn, input1);
 *   const id2 = await store.writeWithin(txn, input2);
 *   store.linkWithin(txn, id1, id2, LinkType.DerivedFrom);
 *   const result = await store.commit(txn);
 * } catch (e) {
 *   await store.rollback(txn);
 * }
 * ```
 */
export interface TransactionalMemoryStore extends IMemoryStore {
    /**
     * 写入一条记忆条目。
     * 如果内容已存在（SHA256 或向量相似），返回已存在的记忆 ID。
     *
     * @param input - 记忆写入输入
     * @returns 新创建（或已存在）的记忆条目 ID
     * @throws {MemoryValidationError} 输入校验失败
     */
    write(input: MemoryWriteInput): Promise<string>;
    /**
     * 按 ID 设置/覆盖一条记忆条目。
     * 区别于 write() —— 不做去重/嵌入/自动注入，纯粹按 ID 写入。
     *
     * @param id - 记忆条目 ID
     * @param entry - 记忆条目数据
     */
    set(id: string, entry: MemoryEntry): Promise<void>;
    /**
     * 按 ID 删除一条记忆条目。
     *
     * @param id - 记忆条目 ID
     * @returns 是否实际删除了条目
     */
    delete(id: string): Promise<boolean>;
    /**
     * 批量写入多条记忆。
     * 无事务语义 —— 部分成功时返回成功的 ID 列表。
     *
     * @param inputs - 记忆写入输入数组
     * @returns 成功写入的记忆 ID 列表
     */
    writeMany(inputs: MemoryWriteInput[]): Promise<string[]>;
    /**
     * 批量建立关联。
     *
     * @param links - 关联操作数组
     * @returns 创建的 MemoryLink 数组（失败项为 null）
     */
    linkMany(links: Array<{
        sourceId: string;
        targetId: string;
        linkType: LinkType;
        weight?: number;
    }>): (MemoryLink | null)[];
    /**
     * 比较并交换语义状态。
     *
     * @param id - 记忆条目 ID
     * @param expected - 期望的当前状态
     * @param newState - 目标新状态
     * @returns 是否成功更新
     */
    cas(id: string, expected: SemanticState, newState: SemanticState): boolean;
    /**
     * 归档指定记忆条目（Active → Archived）。
     *
     * @param id - 记忆条目 ID
     * @returns 是否成功归档
     */
    archive(id: string): boolean;
    /**
     * 湮灭指定记忆条目（任意状态 → Obliterated）。
     *
     * @param id - 记忆条目 ID
     * @returns 是否成功湮灭
     */
    obliterate(id: string): boolean;
    /**
     * 写入一条 Pending 状态的记忆（两阶段提交第一阶段）。
     *
     * @param input - 记忆写入输入
     * @returns 记忆条目 ID
     */
    writePending(input: MemoryWriteInput): string;
    /**
     * 提交一条 Pending 记忆（Pending → Active）。
     *
     * @param memoryId - 记忆条目 ID
     * @returns 是否成功提交
     */
    commitMemory(memoryId: string): boolean;
    /**
     * 回滚一条 Pending 记忆（Pending → Obliterated）。
     *
     * @param memoryId - 记忆条目 ID
     * @returns 是否成功回滚
     */
    rollback(memoryId: string): Promise<boolean>;
    /**
     * 统一取消一条记忆——自动判断状态。
     * 若条目处于 Pending 态（两阶段提交中）→ 从 pendingEntries 移除。
     * 若条目处于 Active 态 → 归档为 Archived。
     * 幂等——条目不存在或已取消时返回 false。
     *
     * @since v2.7 — 语义统一
     */
    cancel(memoryId: string): boolean;
    /**
     * 创建一条关联。
     *
     * @param sourceId - 源记忆 ID
     * @param targetId - 目标记忆 ID
     * @param linkType - 关联类型
     * @returns 创建的 MemoryLink，如果源或目标不存在则返回 null
     */
    link(sourceId: string, targetId: string, linkType: LinkType): MemoryLink | null;
    /**
     * 开启一个新事务。
     *
     * @param isolation - 隔离级别（默认 ReadCommitted）
     * @param metadata - 可选元数据（如调用链追踪 ID）
     * @returns 事务上下文
     * @throws {TransactionError} 如果无法创建新事务
     */
    beginTransaction(isolation?: TransactionIsolation, metadata?: Record<string, unknown>): Promise<TransactionContext>;
    /**
     * 在指定事务内写入一条记忆。
     * commit 前其他事务不可见（取决于隔离级别）。
     *
     * @param txn - 事务上下文
     * @param input - 记忆写入输入
     * @returns 记忆条目 ID
     * @throws {TransactionError} 如果事务已关闭
     */
    writeWithin(txn: TransactionContext, input: MemoryWriteInput): Promise<string>;
    /**
     * 在指定事务内批量写入多条记忆。
     * 所有写入全部成功或全部回滚。
     *
     * @param txn - 事务上下文
     * @param inputs - 记忆写入输入数组
     * @returns 记忆条目 ID 数组
     * @throws {TransactionError} 如果事务已关闭
     */
    writeManyWithin(txn: TransactionContext, inputs: MemoryWriteInput[]): Promise<string[]>;
    /**
     * 在指定事务内建立关联。
     *
     * @param txn - 事务上下文
     * @param sourceId - 源记忆 ID
     * @param targetId - 目标记忆 ID
     * @param linkType - 关联类型
     * @param weight - 可选权重
     * @returns 创建的 MemoryLink
     * @throws {TransactionError} 如果事务已关闭
     */
    linkWithin(txn: TransactionContext, sourceId: string, targetId: string, linkType: LinkType, weight?: number): Promise<MemoryLink | null>;
    /**
     * 在指定事务内批量建立关联。
     *
     * @param txn - 事务上下文
     * @param links - 关联操作数组
     * @returns 创建的 MemoryLink 数组
     */
    linkManyWithin(txn: TransactionContext, links: Array<{
        sourceId: string;
        targetId: string;
        linkType: LinkType;
        weight?: number;
    }>): Promise<(MemoryLink | null)[]>;
    /**
     * 在指定事务内读取记忆（事务隔离的快照读）。
     *
     * @param txn - 事务上下文
     * @param query - 检索条件
     * @param mode - 检索模式
     * @returns 匹配的记忆条目数组
     * @throws {TransactionError} 如果事务已关闭
     */
    readWithin(txn: TransactionContext, query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;
    /**
     * 提交事务 —— 将事务内所有挂起操作原子化写入底层存储。
     *
     * 处理流程：
     *   1. 校验事务状态（必须是 active）
     *   2. 对所有挂起写入执行去重
     *   3. 批量写入存储后端
     *   4. 批量写入关联
     *   5. 标记事务为 committed
     *
     * @param txn - 事务上下文
     * @returns 提交结果（含写入的记忆 ID 列表）
     * @throws {TransactionError} 如果事务已关闭或提交失败
     */
    commit(txn: TransactionContext): Promise<TransactionResult<string[]>>;
    /**
     * 回滚事务 —— 撤销事务内所有挂起操作。
     *
     * 处理流程：
     *   1. 校验事务状态（必须是 active 或 error）
     *   2. 清理挂起数据
     *   3. 标记事务为 rolledback
     *
     * @param txn - 事务上下文
     * @returns 回滚结果
     * @throws {TransactionError} 如果事务已关闭
     */
    rollback(txn: TransactionContext): Promise<TransactionResult<void>>;
    /**
     * 获取当前所有活动（未提交/未回滚）的事务列表。
     *
     * @returns 活动事务上下文数组
     */
    getActiveTransactions(): TransactionContext[];
    /**
     * 设置事务超时时间（毫秒）。
     * 超过超时时间未 commit 的事务将自动回滚。
     *
     * @param ms - 超时毫秒数（0 表示不超时）
     */
    setTransactionTimeout(ms: number): void;
    /**
     * 设置写入前置钩子。
     * 在每次 write() 前调用，可用于修改输入数据。
     *
     * @param hook - 前置钩子函数
     */
    setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void;
    /**
     * 同步获取所有记忆条目的快照数组。
     * 用于维护扫描（maintain）、去重等需要全量遍历的场景。
     *
     * @returns 所有记忆条目的只读快照
     */
    getAllEntries(): MemoryEntry[];
}
//# sourceMappingURL=TransactionalMemoryStore.d.ts.map