/**
 * formatters/index.ts — 输出格式器注册表
 *
 * 提供三种输出格式的统一接口：纯文本（text）、JSON（json）、彩色（color）。
 * 按 CLI 设计文档 §6 输出格式实现。
 */
import { TextFormatter } from "./text-formatter.js";
import { JsonFormatter } from "./json-formatter.js";
import { ColorFormatter } from "./color-formatter.js";
const formatters = {
    text: new TextFormatter(),
    json: new JsonFormatter(),
    color: new ColorFormatter(),
};
export function getFormatter(format) {
    return formatters[format];
}
export function detectDefaultFormat() {
    // 自动检测：TTY 终端用彩色，否则纯文本（管道友好）
    if (process.stdout.isTTY) {
        return "color";
    }
    return "text";
}
//# sourceMappingURL=index.js.map