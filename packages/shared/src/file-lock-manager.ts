// ============================================================
// @cortex/shared — 文件锁域
// ============================================================

export enum LockType {
  Read = "read",
  Write = "write",
}

export interface IFileLockManager {
  acquire(filePath: string, lockType: LockType, ownerId: string): boolean;
  release(filePath: string, ownerId: string): void;
}
