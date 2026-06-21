// ============================================================
// @cortex/memory — MemoryStoreError 错误类型
//
// 本模块定义记忆存储系统的统一错误类型，采用 discriminated union
// 窄化错误分类，避免使用泛化 Error 或 any 类型。
//
// @module-error 错误分层
//   MemoryStoreError         — 基础错误（所有记忆错误的父类）
//     ├── StoreNotFoundError — 存储实例未注册
//     ├── StoreAlreadyExistsError — 存储实例重复注册
//     ├── MemoryNotFoundError — 记忆条目未找到（get/delete/archive 等）
//     ├── MemoryValidationError — 记忆写入输入校验失败
//     ├── TransactionError  — 事务操作失败（commit/rollback）
//     └── PersistenceError  — 持久化后端 IO 错误
// ============================================================
/**
 * 记忆存储错误码枚举。
 * 每个错误码对应一种可程序化处理的错误场景。
 */
export var MemoryStoreErrorCode;
(function (MemoryStoreErrorCode) {
    /** 存储实例未注册 */
    MemoryStoreErrorCode["StoreNotFound"] = "STORE_NOT_FOUND";
    /** 存储实例重复注册 */
    MemoryStoreErrorCode["StoreAlreadyExists"] = "STORE_ALREADY_EXISTS";
    /** 记忆条目未找到 */
    MemoryStoreErrorCode["MemoryNotFound"] = "MEMORY_NOT_FOUND";
    /** 记忆写入输入校验失败 */
    MemoryStoreErrorCode["MemoryValidation"] = "MEMORY_VALIDATION";
    /** 事务操作失败 */
    MemoryStoreErrorCode["TransactionFailed"] = "TRANSACTION_FAILED";
    /** 持久化后端 IO 错误 */
    MemoryStoreErrorCode["PersistenceFailed"] = "PERSISTENCE_FAILED";
    /** 存储未初始化 */
    MemoryStoreErrorCode["StoreNotInitialized"] = "STORE_NOT_INITIALIZED";
    /** 操作被取消或因状态不允许 */
    MemoryStoreErrorCode["OperationNotAllowed"] = "OPERATION_NOT_ALLOWED";
})(MemoryStoreErrorCode || (MemoryStoreErrorCode = {}));
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
export class MemoryStoreError extends Error {
    /** 错误码，用于程序化错误处理 */
    code;
    /** 可选的上下文信息（如失败的操作名称、相关 ID） */
    context;
    constructor(code, message, context) {
        super(message);
        this.name = "MemoryStoreError";
        this.code = code;
        this.context = context;
        // 确保 instanceof 在 TypeScript 编译目标 < ES2022 时仍正确
        Object.setPrototypeOf(this, MemoryStoreError.prototype);
    }
    /**
     * 获取适合日志的格式化错误信息。
     */
    toLogString() {
        const ctx = this.context ? ` | context=${JSON.stringify(this.context)}` : "";
        return `[${this.code}] ${this.message}${ctx}`;
    }
}
/**
 * 记忆条目未找到时抛出的错误。
 */
export class MemoryNotFoundError extends MemoryStoreError {
    constructor(memoryId, context) {
        super(MemoryStoreErrorCode.MemoryNotFound, `Memory entry not found: ${memoryId}`, { ...context, memoryId });
        this.name = "MemoryNotFoundError";
        Object.setPrototypeOf(this, MemoryNotFoundError.prototype);
    }
}
/**
 * 存储实例未注册时抛出的错误。
 */
export class StoreNotFoundError extends MemoryStoreError {
    constructor(storeName) {
        super(MemoryStoreErrorCode.StoreNotFound, `Memory store not registered: ${storeName}`, { storeName });
        this.name = "StoreNotFoundError";
        Object.setPrototypeOf(this, StoreNotFoundError.prototype);
    }
}
/**
 * 存储实例重复注册时抛出的错误。
 */
export class StoreAlreadyExistsError extends MemoryStoreError {
    constructor(storeName) {
        super(MemoryStoreErrorCode.StoreAlreadyExists, `Memory store already registered: ${storeName}`, { storeName });
        this.name = "StoreAlreadyExistsError";
        Object.setPrototypeOf(this, StoreAlreadyExistsError.prototype);
    }
}
/**
 * 记忆写入输入校验失败时抛出的错误。
 */
export class MemoryValidationError extends MemoryStoreError {
    /** 校验失败的字段列表 */
    fields;
    constructor(fields, message, context) {
        super(MemoryStoreErrorCode.MemoryValidation, message ?? `Validation failed for fields: ${fields.join(", ")}`, { ...context, fields });
        this.name = "MemoryValidationError";
        this.fields = fields;
        Object.setPrototypeOf(this, MemoryValidationError.prototype);
    }
}
/**
 * 事务操作失败时抛出的错误。
 */
export class TransactionError extends MemoryStoreError {
    /** 事务 ID */
    transactionId;
    constructor(message, transactionId, context) {
        super(MemoryStoreErrorCode.TransactionFailed, message, { ...context, transactionId });
        this.name = "TransactionError";
        this.transactionId = transactionId;
        Object.setPrototypeOf(this, TransactionError.prototype);
    }
}
/**
 * 持久化后端 IO 错误。
 */
export class PersistenceError extends MemoryStoreError {
    /** 底层原始错误 */
    cause;
    constructor(message, cause, context) {
        super(MemoryStoreErrorCode.PersistenceFailed, message, { ...context, causeMessage: cause?.message });
        this.name = "PersistenceError";
        this.cause = cause;
        Object.setPrototypeOf(this, PersistenceError.prototype);
    }
}
//# sourceMappingURL=MemoryStoreError.js.map