/**
 * 测试文件: MemoryStore 写路径后端失败回滚测试
 *
 * 测试范围:
 * - write() 后端失败回滚：backend.write() 失败时内存中无残留
 * - link() 后端失败回滚：backend.link() 失败时 link 回滚
 * - cas() 后端失败回滚：backend.cas() 失败时 state 不变
 * - obliterate() 后端失败回滚：backend.obliterate() 失败时 state 不变
 * - close() 后拒绝写入（幂等关闭）
 *
 * @since v3.0.0 — 适配器委托 @cortex/memory 后端
 */
export {};
//# sourceMappingURL=memory-store-write-rollback.test.d.ts.map