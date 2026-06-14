/**
 * id-utils.ts — 统一 ID 生成工具
 *
 * 所有 @cortex/* 包的 ID 生成入口。
 * generateId: 加密安全的 UUID v4（基于 crypto.randomUUID）
 * shortId: 基于时间戳的短唯一标识（用于事务/会话）
 *
 * @since 全系统重构 — 统一 id 生成器
 */

import crypto from "node:crypto";

/** 生成 UUID v4 作为唯一标识符（加密安全） */
export function generateId(): string {
  return crypto.randomUUID();
}

/** 生成简短唯一 ID（用于事务、会话等非安全场景） */
export function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
