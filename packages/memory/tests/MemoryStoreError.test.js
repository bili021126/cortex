// @ci: unit
// ============================================================
// @cortex/memory —— MemoryStoreError 类型单元测试
//
// 测试 @cortex/memory 的错误类型体系，包括：
// - 错误类的 toLogString() 方法
// - 错误继承链（instanceof）
// - 各错误子类的构造参数
// ============================================================
import { describe, it, expect } from "vitest";
import { MemoryStoreError, MemoryStoreErrorCode, MemoryNotFoundError, StoreNotFoundError, StoreAlreadyExistsError, MemoryValidationError, TransactionError, PersistenceError, } from "@cortex/memory";
describe("MemoryStoreError", () => {
    it("should have correct name", () => {
        const err = new MemoryStoreError(MemoryStoreErrorCode.MemoryNotFound, "test");
        expect(err.name).toBe("MemoryStoreError");
    });
    it("should have correct code", () => {
        const err = new MemoryStoreError(MemoryStoreErrorCode.StoreNotInitialized, "not init");
        expect(err.code).toBe(MemoryStoreErrorCode.StoreNotInitialized);
    });
    it("should include context", () => {
        const err = new MemoryStoreError(MemoryStoreErrorCode.MemoryNotFound, "not found", { memoryId: "abc-123" });
        expect(err.context).toEqual({ memoryId: "abc-123" });
    });
    it("toLogString should format correctly without context", () => {
        const err = new MemoryStoreError(MemoryStoreErrorCode.MemoryNotFound, "Entry not found");
        const log = err.toLogString();
        expect(log).toContain("[MEMORY_NOT_FOUND]");
        expect(log).toContain("Entry not found");
        expect(log).not.toContain("context=");
    });
    it("toLogString should format correctly with context", () => {
        const err = new MemoryStoreError(MemoryStoreErrorCode.MemoryNotFound, "Entry not found", { id: "123" });
        const log = err.toLogString();
        expect(log).toContain("[MEMORY_NOT_FOUND]");
        expect(log).toContain("context=");
        expect(log).toContain('"id"');
    });
});
describe("MemoryNotFoundError", () => {
    it("should have correct name and code", () => {
        const err = new MemoryNotFoundError("mem-001");
        expect(err.name).toBe("MemoryNotFoundError");
        expect(err.code).toBe(MemoryStoreErrorCode.MemoryNotFound);
        expect(err.message).toContain("mem-001");
    });
    it("should be instanceof MemoryStoreError", () => {
        const err = new MemoryNotFoundError("mem-001");
        expect(err).toBeInstanceOf(MemoryStoreError);
    });
});
describe("StoreNotFoundError", () => {
    it("should have correct name and storeName context", () => {
        const err = new StoreNotFoundError("my-store");
        expect(err.name).toBe("StoreNotFoundError");
        expect(err.code).toBe(MemoryStoreErrorCode.StoreNotFound);
        expect(err.message).toContain("my-store");
        expect(err.context?.storeName).toBe("my-store");
    });
});
describe("StoreAlreadyExistsError", () => {
    it("should have correct name and code", () => {
        const err = new StoreAlreadyExistsError("dup-store");
        expect(err.name).toBe("StoreAlreadyExistsError");
        expect(err.code).toBe(MemoryStoreErrorCode.StoreAlreadyExists);
        expect(err.message).toContain("dup-store");
    });
});
describe("MemoryValidationError", () => {
    it("should have correct fields", () => {
        const err = new MemoryValidationError(["source", "kind"]);
        expect(err.name).toBe("MemoryValidationError");
        expect(err.fields).toEqual(["source", "kind"]);
        expect(err.message).toContain("source");
        expect(err.message).toContain("kind");
    });
    it("should accept custom message", () => {
        const err = new MemoryValidationError(["summary"], "Custom validation error", { extra: "info" });
        expect(err.message).toBe("Custom validation error");
        expect(err.context?.extra).toBe("info");
    });
});
describe("TransactionError", () => {
    it("should have transactionId", () => {
        const err = new TransactionError("Commit failed", "txn-001");
        expect(err.name).toBe("TransactionError");
        expect(err.code).toBe(MemoryStoreErrorCode.TransactionFailed);
        expect(err.transactionId).toBe("txn-001");
        expect(err.message).toBe("Commit failed");
    });
    it("should work without transactionId", () => {
        const err = new TransactionError("Generic error");
        expect(err.transactionId).toBeUndefined();
    });
});
describe("PersistenceError", () => {
    it("should wrap cause", () => {
        const cause = new Error("Disk full");
        const err = new PersistenceError("Write failed", cause);
        expect(err.name).toBe("PersistenceError");
        expect(err.code).toBe(MemoryStoreErrorCode.PersistenceFailed);
        expect(err.cause).toBe(cause);
        expect(err.message).toBe("Write failed");
        expect(err.context?.causeMessage).toBe("Disk full");
    });
    it("should work without cause", () => {
        const err = new PersistenceError("Generic IO error");
        expect(err.cause).toBeUndefined();
    });
});
//# sourceMappingURL=MemoryStoreError.test.js.map