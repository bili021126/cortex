import { type MemoryEntry, type MemoryWriteInput, type MemoryQuery, type MemoryLink, type SemanticState, type LinkType, type ReadMode } from "@cortex/shared";
import type { IMemoryStore } from "../interfaces/MemoryStore.js";
import type { TransactionalMemoryStore, TransactionContext, TransactionIsolation, TransactionResult, TransactionLinkOp } from "../interfaces/TransactionalMemoryStore.js";
/**
 * PendingEntry — 两阶段提交中处于 Pending 状态的记忆条目内部记录。
 *
 * 在 writePending() 时创建，commitMemory() 时转为 MemoryEntry，
 * rollback/cancel 时从 _pendingEntries 中移除。
 */
interface PendingEntry {
    /** 用户提交的原始写入输入 */
    input: MemoryWriteInput;
    /** Pending 条目创建时间戳（Unix 毫秒） */
    createdAt: number;
}
/**
 * InternalTransaction — 事务的内部状态记录。
 *
 * 存储于 _transactions Map 中，在 beginTransaction 时创建，
 * commit/rollback 时删除。包含事务的所有挂起操作日志。
 */
interface InternalTransaction {
    /** 全局唯一事务 ID（格式：txn_<shortId>） */
    id: string;
    /** 事务隔离级别 */
    isolation: TransactionIsolation;
    /** 事务当前状态 */
    status: "active" | "committed" | "rolledback" | "error";
    /** 事务开始时间戳（Unix 毫秒） */
    startedAt: number;
    /** 事务超时时间戳（Unix 毫秒） */
    timeoutAt: number;
    /** 挂起的写入操作列表，commit 时批量执行 */
    pendingWrites: MemoryWriteInput[];
    /** 挂起的关联操作列表，commit 时批量执行 */
    pendingLinks: TransactionLinkOp[];
    /** 用户自定义元数据（如调用链追踪 ID） */
    metadata?: Record<string, unknown>;
}
/**
 * MemoryStoreBackend — 存储后端的持久化策略接口。
 *
 * 具体实现（FileBackend 等）通过构造函数注入 AbstractMemoryStore，
 * 负责将内存中的条目和关联同步到持久化介质。
 */
export interface MemoryStoreBackend {
    init(dbPath: string): Promise<void>;
    load(store: AbstractMemoryStore): Promise<void>;
    persist(entry: MemoryEntry): Promise<void>;
    remove(id: string): Promise<void>;
    flushIndex(entries: Map<string, MemoryEntry>): Promise<void>;
    flushLinks(links: Map<string, MemoryLink[]>): Promise<void>;
    flushAll(entries: Map<string, MemoryEntry>, links: Map<string, MemoryLink[]>): Promise<void>;
}
/**
 * AbstractMemoryStore — 记忆存储的抽象基类。
 *
 * 实现 IMemoryStore（只读）和 TransactionalMemoryStore（事务写入）
 * 的全部方法，通过构造函数注入 MemoryStoreBackend 实现持久化策略。
 *
 * 具体子类只需提供后端实例，即可得到完整的记忆存储能力。
 */
export declare abstract class AbstractMemoryStore implements IMemoryStore, TransactionalMemoryStore {
    private readonly _be;
    /** 所有记忆条目的主索引（id → MemoryEntry） */
    protected readonly _entries: Map<string, MemoryEntry>;
    /** 所有关联链路的索引（sourceId → MemoryLink[]） */
    protected readonly _links: Map<string, MemoryLink[]>;
    /** 两阶段提交中处于 Pending 状态的条目（id → PendingEntry） */
    protected readonly _pendingEntries: Map<string, PendingEntry>;
    /** 所有事务的内部状态（id → InternalTransaction） */
    protected readonly _transactions: Map<string, InternalTransaction>;
    /** 事务超时时间（毫秒），默认 30 秒 */
    private _ttmo;
    /** 当前会话 ID */
    private _sid;
    /** 写入前置钩子函数 */
    private _hook;
    /** 存储是否已初始化 */
    private _init;
    constructor(_be: MemoryStoreBackend);
    /**
     * 由后端 load() 调用，将反序列化的条目注入内存索引。
     *
     * @param id - 记忆条目 ID
     * @param e - 反序列化后的记忆条目
     */
    _loadEntry(id: string, e: MemoryEntry): void;
    /**
     * 由后端 load() 调用，将反序列化的关联链路注入内存索引。
     *
     * @param sid - 源记忆 ID
     * @param l - 关联链路数组
     */
    _loadLinks(sid: string, l: MemoryLink[]): void;
    /** 存储是否已初始化并可用。 */
    get isReady(): boolean;
    /** 当前存储中的记忆条目数量。 */
    get size(): number;
    /** 存储是否具有持久化能力（基类默认 false）。 */
    get isPersisted(): boolean;
    /** 当前运行会话的 ID。 */
    get sessionId(): string | undefined;
    /**
     * 按 ID 获取记忆条目的只读快照（深拷贝）。
     *
     * @param id - 记忆条目的唯一标识
     * @returns 记忆条目的深拷贝副本，若不存在则返回 undefined
     */
    get(id: string): Promise<MemoryEntry | undefined>;
    /**
     * 按 ID 获取记忆条目的内部引用（不创建副本）。
     * 调用方不应修改返回的对象。
     *
     * @param id - 记忆条目的唯一标识
     * @returns 记忆条目的内部引用，若不存在则返回 undefined
     */
    peek(id: string): MemoryEntry | undefined;
    /**
     * 检查指定 ID 的记忆条目是否存在。
     *
     * @param id - 记忆条目的唯一标识
     * @returns 是否存在该条目
     */
    has(id: string): boolean;
    /**
     * 同步获取所有记忆条目的快照数组。
     * 用于维护扫描（maintain）、去重等需要全量遍历的场景。
     *
     * @returns 所有记忆条目的数组
     */
    getAllEntries(): MemoryEntry[];
    /**
     * 按查询条件检索记忆条目。
     *
     * 支持按 kind、关键词、时间范围、agentType、metadata 过滤，
     * 可选 BFS 图遍历扩展结果集。结果按 weight 降序、createdAt 降序排列。
     *
     * @param q - 检索条件
     * @param m - 检索模式：CSA 模式下会更新 accessCount 和 lastAccessedAt
     * @returns 匹配的记忆条目深拷贝数组
     */
    read(q: MemoryQuery, m?: ReadMode): Promise<MemoryEntry[]>;
    /**
     * 获取指定源记忆的所有关联链路（深拷贝）。
     *
     * @param sid - 源记忆 ID
     * @returns 关联链路数组的深拷贝
     */
    getLinks(sid: string): MemoryLink[];
    /**
     * 按会话 ID 查询该会话的所有记忆条目（深拷贝）。
     *
     * @param sid - 会话标识
     * @returns 该会话的记忆条目数组
     */
    getBySession(sid: string): MemoryEntry[];
    /**
     * 获取所有处于 Pending 状态的记忆条目。
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
    /**
     * 初始化存储后端。幂等——重复调用不会重新初始化。
     *
     * @param db - 数据库路径或连接字符串
     */
    init(db: string): Promise<void>;
    /**
     * 开始新会话。生成或接受外部传入的 sessionId，
     * 后续 write() 调用会自动注入此 sessionId。
     *
     * @param eid - 可选的外部传入 sessionId
     * @returns 当前会话 ID
     */
    beginSession(eid?: string): string;
    /**
     * 终结当前会话。
     * 将该会话的所有 Active 记忆归档为 Archived，
     * 并移除该会话的所有 Pending 条目。
     *
     * @returns 受影响的条目数量
     */
    endSession(): Promise<number>;
    /**
     * 刷新所有条目和关联到持久化层。
     */
    flush(): Promise<void>;
    /**
     * 关闭存储后端，释放所有资源。
     * 关闭前会尝试将数据刷入持久化层。
     */
    close(): Promise<void>;
    /**
     * 写入一条新的记忆条目。
     * 自动生成 ID、设置时间戳、注入 sessionId，并通过后端持久化。
     *
     * @param i - 记忆写入输入
     * @returns 新创建的记忆条目 ID
     * @throws {MemoryValidationError} 输入校验失败
     */
    write(i: MemoryWriteInput): Promise<string>;
    /**
     * 按 ID 设置/覆盖一条记忆条目（不做校验和钩子处理）。
     *
     * @param id - 记忆条目 ID
     * @param e - 记忆条目数据
     */
    set(id: string, e: MemoryEntry): Promise<void>;
    /**
     * 按 ID 删除一条记忆条目及其所有关联链路。
     *
     * @param id - 记忆条目 ID
     * @returns 是否实际删除了条目
     */
    delete(id: string): Promise<boolean>;
    /**
     * 批量写入多条记忆。
     * 无事务语义——部分成功时返回成功的 ID 列表。
     *
     * @param is - 记忆写入输入数组
     * @returns 成功写入的记忆 ID 列表
     */
    writeMany(is: MemoryWriteInput[]): Promise<string[]>;
    /**
     * 批量建立关联。
     *
     * @param ls - 关联操作数组
     * @returns 创建的 MemoryLink 数组（失败项为 null）
     */
    linkMany(ls: Array<{
        sourceId: string;
        targetId: string;
        linkType: LinkType;
        weight?: number;
    }>): (MemoryLink | null)[];
    /**
     * 比较并交换（CAS）语义状态。
     * 仅当条目当前状态等于 expected 时才更新为 newState。
     *
     * @param id - 记忆条目 ID
     * @param e - 期望的当前状态
     * @param n - 目标新状态
     * @returns 是否成功更新
     */
    cas(id: string, e: SemanticState, n: SemanticState): boolean;
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
     * 条目不会立即对 read() 可见，需 commitMemory() 后激活。
     *
     * @param i - 记忆写入输入
     * @returns Pending 条目 ID（格式：pending_<generatedId>）
     * @throws {MemoryValidationError} 输入校验失败
     */
    writePending(i: MemoryWriteInput): string;
    /**
     * 提交一条 Pending 记忆，将其转为 Active 状态的 MemoryEntry。
     *
     * @param mid - Pending 记忆条目 ID
     * @returns 是否成功提交（条目不存在时返回 false）
     */
    commitMemory(mid: string): boolean;
    /**
     * 回滚操作（重载）。
     * - 传入 string：回滚一条 Pending 记忆
     * - 传入 TransactionContext：回滚一个事务
     */
    rollback(mid: string): Promise<boolean>;
    rollback(t: TransactionContext): Promise<TransactionResult<void>>;
    /**
     * 回滚一条 Pending 记忆（从 _pendingEntries 中移除）。
     *
     * @param mid - Pending 记忆条目 ID
     * @returns 是否成功回滚
     */
    private _rp;
    /**
     * 统一取消一条记忆——自动判断状态。
     * - Pending 态：从 _pendingEntries 移除
     * - Active 态：归档为 Archived
     * - 其他/不存在：返回 false
     *
     * @param mid - 记忆条目 ID
     * @returns 是否成功取消
     */
    cancel(mid: string): boolean;
    /**
     * 创建一条关联链路。
     * 源和目标都必须存在且未被 Obliterated。
     *
     * @param sid - 源记忆 ID
     * @param tid - 目标记忆 ID
     * @param lt - 关联类型
     * @param w - 可选权重（默认 1）
     * @returns 创建的 MemoryLink 深拷贝，若源或目标无效则返回 null
     */
    link(sid: string, tid: string, lt: LinkType, w?: number): MemoryLink | null;
    /**
     * 开启一个新事务。
     *
     * @param iso - 隔离级别（默认 ReadCommitted）
     * @param md - 可选元数据（如调用链追踪 ID）
     * @returns 事务上下文
     */
    beginTransaction(iso?: TransactionIsolation, md?: Record<string, unknown>): Promise<TransactionContext>;
    /**
     * 在指定事务内写入一条记忆。
     * commit 前其他事务不可见（取决于隔离级别）。
     *
     * @param t - 事务上下文
     * @param i - 记忆写入输入
     * @returns 挂起写入的临时 ID
     * @throws {TransactionError} 事务不存在
     */
    writeWithin(t: TransactionContext, i: MemoryWriteInput): Promise<string>;
    /**
     * 在指定事务内批量写入多条记忆。
     *
     * @param t - 事务上下文
     * @param is - 记忆写入输入数组
     * @returns 挂起写入的临时 ID 数组
     * @throws {TransactionError} 事务不存在
     */
    writeManyWithin(t: TransactionContext, is: MemoryWriteInput[]): Promise<string[]>;
    /**
     * 在指定事务内建立关联。
     *
     * @param t - 事务上下文
     * @param sid - 源记忆 ID
     * @param tid - 目标记忆 ID
     * @param lt - 关联类型
     * @param w - 可选权重
     * @returns 挂起关联的临时 MemoryLink
     * @throws {TransactionError} 事务不存在
     */
    linkWithin(t: TransactionContext, sid: string, tid: string, lt: LinkType, w?: number): Promise<{
        id: string;
        sourceId: string;
        targetId: string;
        linkType: LinkType;
        weight: number;
        targetState: SemanticState;
        lastAccessedAt: number;
    }>;
    /**
     * 在指定事务内批量建立关联。
     *
     * @param t - 事务上下文
     * @param ls - 关联操作数组
     * @returns 挂起关联的临时 MemoryLink 数组
     */
    linkManyWithin(t: TransactionContext, ls: Array<{
        sourceId: string;
        targetId: string;
        linkType: LinkType;
        weight?: number;
    }>): Promise<(MemoryLink | null)[]>;
    /**
     * 在指定事务内读取记忆（事务隔离的快照读）。
     * 当前实现委托给 read()。
     *
     * @param t - 事务上下文
     * @param q - 检索条件
     * @param m - 检索模式
     * @returns 匹配的记忆条目数组
     */
    readWithin(t: TransactionContext, q: MemoryQuery, m?: ReadMode): Promise<MemoryEntry[]>;
    /**
     * 提交事务——将事务内所有挂起操作原子化执行。
     *
     * 处理流程：
     *   1. 校验事务状态（必须是 active）
     *   2. 逐个执行挂起的 write 操作
     *   3. 逐个执行挂起的 link 操作
     *   4. 刷新关联链路到持久化层
     *   5. 标记事务为 committed 并从 _transactions 中移除
     *
     * @param t - 事务上下文
     * @returns 提交结果（含写入的记忆 ID 列表）
     * @throws {TransactionError} 事务不存在或状态不是 active
     */
    commit(t: TransactionContext): Promise<TransactionResult<string[]>>;
    /**
     * 回滚事务——撤销事务内所有挂起操作。
     *
     * @param t - 事务上下文
     * @returns 回滚结果
     * @throws {TransactionError} 事务不存在或状态不允许回滚
     */
    private _rt;
    /**
     * 获取当前所有活动（未提交/未回滚）的事务列表。
     * 调用前会自动清理已超时的事务。
     *
     * @returns 活动事务的 TransactionContext 数组
     */
    getActiveTransactions(): TransactionContext[];
    /**
     * 设置事务超时时间（毫秒）。
     * 超过超时时间未 commit 的事务将在下次访问时自动回滚。
     *
     * @param ms - 超时毫秒数
     */
    setTransactionTimeout(ms: number): void;
    /**
     * 设置写入前置钩子。
     * 在每次 write() 前调用，可用于修改/增强输入数据。
     *
     * @param h - 前置钩子函数
     */
    setPreWriteHook(h: (i: MemoryWriteInput) => MemoryWriteInput): void;
    /**
     * _ei — Ensure Initialized.
     * 若存储未初始化则抛出 MemoryStoreError。
     *
     * @throws {MemoryStoreError} StoreNotInitialized
     */
    private _ei;
    /**
     * _vw — Validate Write input.
     * 校验 MemoryWriteInput 的必填字段。
     *
     * @param i - 待校验的写入输入
     * @throws {MemoryValidationError} 缺少必填字段
     */
    private _vw;
    /**
     * _va — Validate Active transaction.
     * 校验事务是否存在、是否处于 active 状态、是否已超时。
     * 超时的事务会被自动标记为 error 并从 _transactions 中移除。
     *
     * @param t - 事务上下文
     * @throws {TransactionError} 事务不存在、非 active 或已超时
     */
    protected _va(t: TransactionContext): void;
    /**
     * _pe — Purge Expired transactions.
     * 清理所有已超时且仍处于 active 状态的事务，将其标记为 rolledback。
     */
    private _pe;
    /**
     * _bp — Build Pending entry.
     * 将 PendingEntry 内部记录转换为 MemoryEntry 格式（带 _pending 标记）。
     *
     * @param id - Pending 条目 ID
     * @param p - PendingEntry 内部记录
     * @returns 带 _pending 标记的 MemoryEntry
     */
    private _bp;
    /**
     * _ah — Apply Hook.
     * 如果设置了 preWriteHook 则通过钩子处理输入，否则原样返回。
     *
     * @param i - 记忆写入输入
     * @returns 经钩子处理后的输入（或原输入）
     */
    private _ah;
    /**
     * _bc — Build Context.
     * 将 InternalTransaction 转换为公开的 TransactionContext。
     * status 为 "error" 时映射为 "rolledback"。
     *
     * @param t - 内部事务记录
     * @returns 公开的事务上下文
     */
    private _bc;
    /**
     * _bfs — Breadth-First Search expansion.
     * 从初始结果集出发，沿关联链路做 BFS 扩展，最多扩展 d 层。
     *
     * @param e - 初始结果集
     * @param d - BFS 最大深度
     * @param m - 可选的最大节点数限制
     * @returns 扩展后的 MemoryEntry 数组
     */
    private _bfs;
}
export {};
//# sourceMappingURL=AbstractMemoryStore.d.ts.map