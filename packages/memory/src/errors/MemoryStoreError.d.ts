/**
 * 记忆存储错误码枚举。
 * 每个错误码对应一种可程序化处理的错误场景。
 */
export declare enum MemoryStoreErrorCode {
    /** 存储实例未注册 */
    StoreNotFound = "STORE_NOT_FOUND",
    /** 存储实例重复注册 */
    StoreAlreadyExists = "STORE_ALREADY_EXISTS",
    /** 记忆条目未找到 */
    MemoryNotFound = "MEMORY_NOT_FOUND",
    /** 记忆写入输入校验失败 */
    MemoryValidation = "MEMORY_VALIDATION",
    /** 事务操作失败 */
    TransactionFailed = "TRANSACTION_FAILED",
    /** 持久化后端 IO 错误 */
    PersistenceFailed = "PERSISTENCE_FAILED",
    /** 存储未初始化 */
    StoreNotInitialized = "STORE_NOT_INITIALIZED",
    /** 操作被取消或因状态不允许 */
    OperationNotAllowed = "OPERATION_NOT_ALLOWED"
}
/**
 * MemoryStoreError —— 记忆存储系统的统一错误类型。
 *
 * 使用 `code` 字段区分错误类别，避免依赖 `instanceof` 链式判断。
 *
 * @example
 * ```typescript
 * throw new MemoryStoreError(
 *   MemoryStoreErrorCode.MemoryNotFound,
 *   `Memory entry not found: ${id}`,
 * );
 * ```
 */
export declare class MemoryStoreError extends Error {
    /** 错误码，用于程序化错误处理 */
    readonly code: MemoryStoreErrorCode;
    /** 可选的上下文信息（如失败的操作名称、相关 ID） */
    readonly context?: Record<string, unknown>;
    constructor(code: MemoryStoreErrorCode, message: string, context?: Record<string, unknown>);
    /**
     * 获取适合日志的格式化错误信息。
     */
    toLogString(): string;
}
/**
 * 记忆条目未找到时抛出的错误。
 */
export declare class MemoryNotFoundError extends MemoryStoreError {
    constructor(memoryId: string, context?: Record<string, unknown>);
}
/**
 * 存储实例未注册时抛出的错误。
 */
export declare class StoreNotFoundError extends MemoryStoreError {
    constructor(storeName: string);
}
/**
 * 存储实例重复注册时抛出的错误。
 */
export declare class StoreAlreadyExistsError extends MemoryStoreError {
    constructor(storeName: string);
}
/**
 * 记忆写入输入校验失败时抛出的错误。
 */
export declare class MemoryValidationError extends MemoryStoreError {
    /** 校验失败的字段列表 */
    readonly fields: string[];
    constructor(fields: string[], message?: string, context?: Record<string, unknown>);
}
/**
 * 事务操作失败时抛出的错误。
 */
export declare class TransactionError extends MemoryStoreError {
    /** 事务 ID */
    readonly transactionId?: string;
    constructor(message: string, transactionId?: string, context?: Record<string, unknown>);
}
/**
 * 持久化后端 IO 错误。
 */
export declare class PersistenceError extends MemoryStoreError {
    /** 底层原始错误 */
    readonly cause?: Error;
    constructor(message: string, cause?: Error, context?: Record<string, unknown>);
}
//# sourceMappingURL=MemoryStoreError.d.ts.map