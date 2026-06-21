// ============================================================
// @cortex/memory — TransactionalMemoryStore 事务性内存接口
//
// 为多条目原子操作提供事务语义。解决母项目缺失的事务性内存操作
// （M10），在只读 IMemoryStore 基础上扩展写入和事务能力。
//
// @design 分层事务
//   1. 简单单条目操作：write(input) → id
//   2. 批量操作（无事务）：writeMany(inputs) → ids[]
//   3. 事务操作：beginTransaction → writeWithin/linkWithin → commit/rollback
//
// @discriminated-union TransactionStatus 和 TransactionIsolation
//   使用字面量联合类型窄化状态空间。
// ============================================================
export {};
//# sourceMappingURL=TransactionalMemoryStore.js.map