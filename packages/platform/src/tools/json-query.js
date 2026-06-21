// ============================================================
// @cortex/engine/platform/tools/json-query —— json_query 工具
//
// 使用 JSONPath 语法查询 JSON 文件。支持：
//   $.store.books[*].title         — 路径导航
//   $.store.books[?(@.price<10)]   — 条件过滤
//   $.store.book[-1]               — 末尾元素
//
// 无外部依赖——手写微型 JSONPath 解析器。
//
// @core v3 —— Tool 接口统一：export createTool(ctx): Tool
// ============================================================
import { ToolCategory, ReversibilityLevel as RL } from "@cortex/shared";
import { LocalTool } from "../local-tool.js";
export function createTool(ctx) {
    return new LocalTool("json_query", ToolCategory.Read, "Query a JSON file using JSONPath syntax (e.g. '$.store.books[*].title', '$.foo.bar[?(@.baz>5)]', '$.items[-1]'). Returns the matched value(s).", {
        type: "object",
        properties: {
            file_path: {
                type: "string",
                description: "Absolute path to the JSON file to query",
            },
            query: {
                type: "string",
                description: "JSONPath expression starting with '$' (e.g. '$.agents.*.id', '$.items[0].name')",
            },
        },
        required: ["file_path", "query"],
    }, RL.L0, async (params) => {
        const filePath = ctx.resolvePath(params.file_path);
        const query = params.query;
        try {
            const content = await ctx.fs.readFile(filePath);
            const data = JSON.parse(content);
            const results = jsonPath(data, query);
            if (results.length === 0) {
                return {
                    success: true,
                    output: JSON.stringify({ query, matches: [], count: 0 }, null, 2),
                };
            }
            return {
                success: true,
                output: JSON.stringify({
                    query,
                    count: results.length,
                    matches: results.length === 1 ? results[0] : results,
                }, null, 2).slice(0, 20_000),
            };
        }
        catch (e) {
            return { success: false, error: `json_query 失败: ${String(e)}` };
        }
    });
}
// ── 微型 JSONPath 引擎 ──────────────────────────────
function jsonPath(root, query) {
    if (!query.startsWith("$")) {
        throw new Error(`JSONPath 必须以 '$' 开头: "${query}"`);
    }
    const segments = parseSegments(query.slice(1)); // 去掉开头的 $
    let current = [root];
    for (const seg of segments) {
        current = applySegment(current, seg);
    }
    return current;
}
function parseSegments(path) {
    const segments = [];
    let i = 0;
    while (i < path.length) {
        // 递归下降: ..
        if (path[i] === "." && path[i + 1] === ".") {
            segments.push({ type: "recursive" });
            i += 2;
            // 跳过后续的 .
            if (path[i] === ".")
                i++;
            continue;
        }
        // 点号分隔
        if (path[i] === ".") {
            i++;
            continue;
        }
        // 括号索引 / 过滤
        if (path[i] === "[") {
            i++; // skip [
            let bracket = "";
            let depth = 1;
            while (i < path.length && depth > 0) {
                if (path[i] === "[")
                    depth++;
                if (path[i] === "]")
                    depth--;
                if (depth > 0)
                    bracket += path[i];
                i++;
            }
            // i now points past ]
            if (bracket === "*") {
                segments.push({ type: "wildcard" });
            }
            else if (/^-?\d+$/.test(bracket.trim())) {
                segments.push({ type: "index", index: parseInt(bracket.trim(), 10) });
            }
            else if (/^(-?\d+)?:(-?\d+)?(:-?\d+)?$/.test(bracket.trim())) {
                const parts = bracket.split(":").map((p) => (p ? parseInt(p, 10) : undefined));
                segments.push({
                    type: "slice",
                    start: parts[0],
                    end: parts[1],
                    step: parts[2],
                });
            }
            else if (bracket.startsWith("?(") && bracket.endsWith(")")) {
                segments.push({ type: "filter", filter: bracket.slice(2, -1) });
            }
            else {
                // 字符串键 (单引号或双引号)
                const key = bracket.replace(/^['"]|['"]$/g, "");
                segments.push({ type: "key", key });
            }
            continue;
        }
        // 普通键名
        let key = "";
        while (i < path.length && path[i] !== "." && path[i] !== "[") {
            key += path[i];
            i++;
        }
        if (key) {
            segments.push({ type: "key", key });
        }
    }
    return segments;
}
function applySegment(current, seg) {
    const results = [];
    for (const item of current) {
        switch (seg.type) {
            case "key": {
                const key = seg.key;
                if (key !== undefined && item && typeof item === "object" && key in item) {
                    results.push(item[key]);
                }
                break;
            }
            case "index": {
                const idxRaw = seg.index;
                if (idxRaw !== undefined) {
                    const arr = item;
                    if (Array.isArray(arr)) {
                        const idx = idxRaw < 0 ? arr.length + idxRaw : idxRaw;
                        if (idx >= 0 && idx < arr.length) {
                            results.push(arr[idx]);
                        }
                    }
                }
                break;
            }
            case "wildcard": {
                if (Array.isArray(item)) {
                    results.push(...item);
                }
                else if (item && typeof item === "object") {
                    results.push(...Object.values(item));
                }
                break;
            }
            case "slice": {
                if (Array.isArray(item)) {
                    const arr = item;
                    const len = arr.length;
                    const start = seg.start ?? 0;
                    const realStart = start < 0 ? Math.max(0, len + start) : Math.min(len, start);
                    const end = seg.end ?? len;
                    const realEnd = end < 0 ? Math.max(0, len + end) : Math.min(len, end);
                    const step = seg.step ?? 1;
                    for (let j = realStart; step > 0 ? j < realEnd : j > realEnd; j += step) {
                        if (j >= 0 && j < len)
                            results.push(arr[j]);
                    }
                }
                break;
            }
            case "filter": {
                const filter = seg.filter;
                if (filter !== undefined && Array.isArray(item)) {
                    for (const elem of item) {
                        if (evaluateFilter(elem, filter)) {
                            results.push(elem);
                        }
                    }
                }
                break;
            }
            case "recursive": {
                results.push(item);
                collectRecursive(item, results);
                break;
            }
        }
    }
    return results;
}
/** 简易过滤器：支持 @.key op value，op ∈ {==, !=, <, >, <=, >=, =~} */
function evaluateFilter(obj, expr) {
    const match = expr.trim().match(/^@\.(\w+)\s*(==|!=|<=|>=|<|>|=~)\s*(.+)$/);
    if (!match)
        return true; // 无法解析 → 通过
    const [, key, op, valStr] = match;
    if (!obj || typeof obj !== "object")
        return false;
    const actual = obj[key];
    const expected = parseFilterValue(valStr.trim());
    switch (op) {
        case "==": return actual == expected;
        case "!=": return actual != expected;
        case "<": return Number(actual) < Number(expected);
        case ">": return Number(actual) > Number(expected);
        case "<=": return Number(actual) <= Number(expected);
        case ">=": return Number(actual) >= Number(expected);
        case "=~": {
            try {
                return new RegExp(String(expected)).test(String(actual));
            }
            catch {
                return false;
            }
        }
        default: return true;
    }
}
function parseFilterValue(s) {
    s = s.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        return s.slice(1, -1);
    }
    if (s === "true")
        return true;
    if (s === "false")
        return false;
    if (s === "null")
        return null;
    if (/^-?\d+(\.\d+)?$/.test(s))
        return parseFloat(s);
    return s;
}
function collectRecursive(node, into) {
    if (Array.isArray(node)) {
        for (const item of node) {
            into.push(item);
            collectRecursive(item, into);
        }
    }
    else if (node && typeof node === "object") {
        for (const v of Object.values(node)) {
            into.push(v);
            collectRecursive(v, into);
        }
    }
}
//# sourceMappingURL=json-query.js.map