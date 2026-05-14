/**
 * id.ts — ID 生成工具
 *
 * 使用 crypto.randomUUID 生成 UUID v4。
 * 原位于 .cortex/archive/.../solo-flight/src/utils/id.ts
 * 适配：移除 uuid 依赖，使用内置 crypto
 */

import crypto from 'node:crypto';

/** 生成 UUID v4 作为任务 ID */
export function generateId(): string {
  return crypto.randomUUID();
}
