/**
 * sanitaize-session-jsonl.ts
 *
 * 修复 IDE 会话缓存（.jsonl）中 "type":"image_url" 内容块导致的序列化不兼容问题。
 *
 * 问题：Qoder IDE 的 Rust 反序列化器仅定义了 text 变体，
 *       遇到 image_url 变体会 panic，导致整场会话无法加载。
 *
 * 策略：扫描每行 JSON，检测 content 数组中 type 为 image_url 的块，
 *       将其移除；若移除后 content 为空，整行丢弃。
 *
 * 用法：npx tsx scripts/sanitize-session-jsonl.ts [--dry-run]
 */
export {};
//# sourceMappingURL=sanitize-session-jsonl.d.ts.map