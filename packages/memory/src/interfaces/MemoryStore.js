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
export {};
//# sourceMappingURL=MemoryStore.js.map