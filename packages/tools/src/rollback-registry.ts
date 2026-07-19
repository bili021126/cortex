/**
 * rollback-registry.ts — Tool 层回滚注册表
 *
 * 全局弱引用 Map 记录 write_file 创建的文件路径。
 * 执行失败时通过 rollback(taskId) 自动清理已创建文件。
 *
 * @design
 *   1. registry 以 taskId 为键，记录该 task 创建的所有文件路径
 *   2. rollback 时按 FILO 顺序删除（后创建的先删——模拟栈回溯）
 *   3. 删除失败不阻塞——写 stderr 后继续清理剩余文件
 *   4. clear 仅清理跟踪记录，不删文件（全链路成功时调用）
 *
 * @usage
 *   import { toolRollbackRegistry } from '@cortex/tools';
 *   toolRollbackRegistry.trackCreate(taskId, filePath);
 *   const deleted = toolRollbackRegistry.rollback(taskId);
 *   toolRollbackRegistry.clear(taskId);
 */

import * as fs from "node:fs";

export class ToolRollbackRegistry {
  /** taskId → 该 task 创建的文件路径列表（插入有序） */
  private _createdFiles: Map<string, string[]> = new Map();
  /** taskId → 该 task 记录的 shell 副作用列表（仅遥测，不自动恢复） */
  private _sideEffects: Map<string, string[]> = new Map();

  /**
   * 记录 write_file 创建的文件。
   * @param taskId 任务 ID（通常为 node.id）
   * @param filePath 已成功创建的文件绝对路径
   */
  trackCreate(taskId: string, filePath: string): void {
    if (!this._createdFiles.has(taskId)) {
      this._createdFiles.set(taskId, []);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const files = this._createdFiles.get(taskId)!;
    // 去重保护——同一文件被重复 write 不重复记录
    if (!files.includes(filePath)) {
      files.push(filePath);
    }
  }

  /**
   * 记录 run_shell 的副作用（仅作遥测记录，不自动恢复）。
   * @param taskId 任务 ID
   * @param sideEffect 副作用描述（如执行的命令摘要）
   */
  trackShell(taskId: string, sideEffect: string): void {
    if (!this._sideEffects.has(taskId)) {
      this._sideEffects.set(taskId, []);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this._sideEffects.get(taskId)!.push(sideEffect);
  }

  /**
   * 回滚指定 task 的所有已创建文件。
   * 按 FILO 顺序删除（后创建的先删），单文件删除失败不阻塞整体流程。
   *
   * @param taskId 任务 ID
   * @returns 成功删除的文件路径列表
   */
  rollback(taskId: string): string[] {
    const files = this._createdFiles.get(taskId);
    if (!files || files.length === 0) return [];

    const deleted: string[] = [];
    // FILO: 后创建的先删
    for (let i = files.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const fp = files[i]!;
      try {
        if (fs.existsSync(fp)) {
          fs.rmSync(fp, { force: true });
          deleted.push(fp);
        }
      } catch (err) {
        // 删除失败不阻塞——写遥测后继续
        console.error(`[ToolRollbackRegistry] rollback 删除失败: ${fp} — ${String(err)}`);
      }
    }
    // 回滚后清理跟踪记录
    this._createdFiles.delete(taskId);
    this._sideEffects.delete(taskId);
    return deleted;
  }

  /**
   * 清除指定 task 的跟踪记录（不删除文件）。
   * 全链路成功时调用。
   */
  clear(taskId: string): void {
    this._createdFiles.delete(taskId);
    this._sideEffects.delete(taskId);
  }

  /**
   * 获取指定 task 已跟踪的文件列表（只读快照）。
   */
  getTrackedFiles(taskId: string): readonly string[] {
    return this._createdFiles.get(taskId) ?? [];
  }

  /**
   * 获取指定 task 已记录的副作用列表（只读快照）。
   */
  getTrackedShells(taskId: string): readonly string[] {
    return this._sideEffects.get(taskId) ?? [];
  }

  /**
   * 当前跟踪中的 task 数量（用于遥测/调试）。
   */
  get size(): number {
    return this._createdFiles.size;
  }

  /**
   * 清空所有跟踪记录（不删除文件——引擎 shutdown 时调用）。
   */
  reset(): void {
    this._createdFiles.clear();
    this._sideEffects.clear();
  }
}

/** 全局单例——引擎内所有组件共用同一个注册表 */
export const toolRollbackRegistry = new ToolRollbackRegistry();
