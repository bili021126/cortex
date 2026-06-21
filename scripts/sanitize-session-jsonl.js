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
import * as fs from "node:fs";
import * as path from "node:path";
const CONVERSATION_HISTORY_DIR = path.resolve(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".qoder/cache/projects/cortex-d945f0ba/conversation-history");
function isImageUrlBlock(block) {
    return block.type === "image_url";
}
function sanitizeLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return { result: null, reason: "empty" };
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return { result: trimmed, reason: "unparseable" };
    }
    const content = parsed?.message?.content;
    if (!Array.isArray(content))
        return { result: trimmed, reason: "no_content_array" };
    const hasImage = content.some(isImageUrlBlock);
    if (!hasImage)
        return { result: trimmed, reason: "ok" };
    const filtered = content.filter((b) => !isImageUrlBlock);
    if (filtered.length === 0) {
        return { result: null, reason: "all_image_stripped" };
    }
    parsed.message.content = filtered;
    return { result: JSON.stringify(parsed), reason: "image_removed" };
}
function processFile(filePath, dryRun) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/);
    let imageRemoved = 0;
    let emptyRemoved = 0;
    const sanitized = [];
    for (const line of lines) {
        const { result, reason } = sanitizeLine(line);
        if (result === null) {
            if (reason === "empty")
                emptyRemoved++;
            else if (reason === "all_image_stripped")
                imageRemoved++;
            continue;
        }
        if (reason === "image_removed")
            imageRemoved++;
        sanitized.push(result);
    }
    const totalRemoved = emptyRemoved + imageRemoved;
    if (totalRemoved > 0 && !dryRun) {
        fs.writeFileSync(filePath, sanitized.join("\n") + "\n", "utf-8");
    }
    return { imageRemoved, emptyRemoved, lines: sanitized.length };
}
function main() {
    const dryRun = process.argv.includes("--dry-run");
    if (!fs.existsSync(CONVERSATION_HISTORY_DIR)) {
        console.error(`目录不存在: ${CONVERSATION_HISTORY_DIR}`);
        process.exit(1);
    }
    const entries = fs.readdirSync(CONVERSATION_HISTORY_DIR, { withFileTypes: true });
    let totalRemoved = 0;
    let totalFiles = 0;
    let affectedFiles = 0;
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const jsonlPath = path.join(CONVERSATION_HISTORY_DIR, entry.name, `${entry.name}.jsonl`);
        if (!fs.existsSync(jsonlPath))
            continue;
        totalFiles++;
        const { imageRemoved, emptyRemoved, lines } = processFile(jsonlPath, dryRun);
        if (imageRemoved > 0) {
            affectedFiles++;
            totalRemoved += imageRemoved;
            console.log(`[${dryRun ? "DRY-RUN" : "FIXED"}] ${entry.name}.jsonl — 移除 ${imageRemoved} 行 image_url${emptyRemoved > 0 ? `，清理 ${emptyRemoved} 行空行` : ""}，剩余 ${lines} 行`);
        }
        else {
            console.log(`[OK] ${entry.name}.jsonl — 无 image_url 污染${emptyRemoved > 0 ? `（清理 ${emptyRemoved} 行空行）` : ""}`);
        }
    }
    console.log(`\n${dryRun ? "🔍 预检" : "✅ 修复"}完成: ${totalFiles} 文件, ${affectedFiles} 受影响, 移除 ${totalRemoved} 行`);
}
main();
//# sourceMappingURL=sanitize-session-jsonl.js.map