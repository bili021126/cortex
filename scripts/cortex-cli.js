#!/usr/bin/env node
/**
 * cortex-cli.ts — Cortex 独立控制台 TUI
 *
 * 单文件、零依赖、纯 Node.js 内置模块。
 * 编译后可直接用 `node cortex-cli.mjs` 运行。
 *
 * 用法:
 *   node cortex-cli.mjs                # 完整控制台
 *   node cortex-cli.mjs --mode setup   # 直接进入配置管理
 *   node cortex-cli.mjs --dir /path/to/project
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawn, execSync } from "node:child_process";
// ═══════════════════════════════════════════════════════════
// 配置目录解析
// ═══════════════════════════════════════════════════════════
function resolveConfigDir() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--dir" || args[i] === "-d") && i + 1 < args.length) {
            return path.resolve(args[i + 1]);
        }
        if (args[i].startsWith("--dir=")) {
            return path.resolve(args[i].slice(6));
        }
    }
    return process.cwd();
}
const ROOT = resolveConfigDir();
// ═══════════════════════════════════════════════════════════
// TUI 框架
// ═══════════════════════════════════════════════════════════
const BOX_W = 66;
function boxTop() {
    return "\u250c" + "\u2500".repeat(BOX_W) + "\u2510";
}
function boxBot() {
    return "\u2514" + "\u2500".repeat(BOX_W) + "\u2518";
}
function cwidth(s) {
    return [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
}
function boxPrint(lines) {
    console.log(boxTop());
    for (const line of lines) {
        const pad = Math.max(0, BOX_W - cwidth(line));
        console.log("\u2502 " + line + " ".repeat(pad) + " \u2502");
    }
    console.log(boxBot());
}
function clear() {
    process.stdout.write("\x1b[2J\x1b[0f");
}
function showMenu(title, items) {
    const lines = ["", "  \u25b6  " + title, ""];
    for (const item of items) {
        const hint = item.hint ? "  " + item.hint : "";
        lines.push(`    [${item.key}]  ${item.label}${hint}`);
    }
    lines.push("");
    if (!items.some((i) => i.key === "0")) {
        lines.push("    [0]  返回上级");
    }
    boxPrint(lines);
}
function ask(rl, prompt) {
    return new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
}
async function pressAnyKey(rl) {
    await ask(rl, "\n  \u23ce 按回车继续...");
}
async function askWithDefault(rl, prompt, def) {
    const a = await ask(rl, `${prompt} [${def}]: `);
    return a === "" ? def : a;
}
async function askNumber(rl, prompt, def) {
    const a = await ask(rl, `${prompt} [${def}]: `);
    if (a === "")
        return def;
    const n = Number(a);
    return isNaN(n) ? def : n;
}
// ═══════════════════════════════════════════════════════════
// JSON 读写
// ═══════════════════════════════════════════════════════════
function loadJson(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch {
        return null;
    }
}
function saveJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
// ═══════════════════════════════════════════════════════════
// 委托执行（调用 cortex CLI）
// ═══════════════════════════════════════════════════════════
/** cortex CLI 编译入口（优先） */
const CORTEX_MAIN_JS = path.join(ROOT, "packages", "cli", "dist", "main.js");
/** 兜底：使用 pnpm exec cortex（需要 pnpm 可用） */
const CORTEX_FALLBACK = ["pnpm", "exec", "cortex"];
function delegate(rl, cmd, ...args) {
    return new Promise((resolve) => {
        clear();
        const label = cmd + (args.length ? " " + args.join(" ") : "");
        console.log(`  \u25b6 正在执行: cortex ${label}\n`);
        // 暂停 TUI readline，避免与子进程争抢 stdin
        rl?.pause();
        // 优先直调编译产物，免全局安装
        let spawnCmd;
        let spawnArgs = [];
        if (fs.existsSync(CORTEX_MAIN_JS)) {
            spawnCmd = "node";
            spawnArgs = [CORTEX_MAIN_JS, cmd, ...args];
        }
        else {
            // 回退：pnpm exec cortex
            spawnCmd = CORTEX_FALLBACK[0];
            spawnArgs = [...CORTEX_FALLBACK.slice(1), cmd, ...args];
        }
        const child = spawn(spawnCmd, spawnArgs, {
            cwd: ROOT,
            stdio: "inherit",
        });
        child.on("close", () => {
            rl?.resume();
            resolve();
        });
        child.on("error", () => {
            console.log(`  \u2717 未找到 cortex 命令。请先执行: pnpm build`);
            rl?.resume();
            resolve();
        });
    });
}
async function delegateWithArgs(rl, cmd, hint) {
    clear();
    const raw = await ask(rl, `  ${hint} > `);
    if (raw === "" || raw === "0")
        return;
    await delegate(rl, cmd, ...raw.split(/\s+/));
    await pressAnyKey(rl);
}
// ═══════════════════════════════════════════════════════════
// 屏幕: 版本信息
// ═══════════════════════════════════════════════════════════
async function screenVersion(rl) {
    clear();
    const pkg = loadJson(path.join(ROOT, "package.json"));
    const ver = pkg?.version ?? "?";
    const lines = [
        "",
        "  \u25b6 Cortex CLI 独立控制台",
        "",
        `    版本:      v${ver}`,
        `    Node.js:   ${process.version}`,
        `    平台:      ${process.platform} ${process.arch}`,
        `    项目目录:  ${ROOT}`,
        "",
        "    零依赖 · 纯 Node.js 内置模块",
        "    源码: scripts/cortex-cli.ts",
        "    编译: node cortex-cli.mjs",
        "",
    ];
    boxPrint(lines);
    await pressAnyKey(rl);
}
// ═══════════════════════════════════════════════════════════
// 屏幕: 项目侦察（内置轻量版）
// ═══════════════════════════════════════════════════════════
async function screenInspect(rl) {
    clear();
    const lines = ["", "  \u25b6 项目侦察", ""];
    // 配置文件状态
    const agentsCfg = loadJson(path.join(ROOT, "cortex-agents.json"));
    const cognitionCfg = loadJson(path.join(ROOT, "cortex-cognition.json"));
    const docsCfg = loadJson(path.join(ROOT, "cortex-docs.json"));
    lines.push("  \u2500\u2500 配置文件 \u2500\u2500");
    lines.push(`    cortex-agents.json     ${agentsCfg ? "\u2713 存在" : "\u2717 缺失"}`);
    lines.push(`    cortex-cognition.json  ${cognitionCfg ? "\u2713 存在" : "\u2717 缺失"}`);
    lines.push(`    cortex-docs.json       ${docsCfg ? "\u2713 存在" : "\u2717 缺失"}`);
    lines.push(`    .env                   ${fs.existsSync(path.join(ROOT, ".env")) ? "\u2713 存在" : "\u2717 缺失"}`);
    // Agent 统计
    if (agentsCfg) {
        const agentCount = Object.keys(agentsCfg.agents ?? {}).length;
        const activeCount = cognitionCfg
            ? cognitionCfg.activationMatrix.filter((e) => e.active).length
            : "?";
        lines.push("");
        lines.push("  \u2500\u2500 Agent \u2500\u2500");
        lines.push(`    注册 Agent:  ${agentCount}`);
        lines.push(`    激活 Agent:  ${activeCount}`);
    }
    // 包目录
    lines.push("");
    lines.push("  \u2500\u2500 目录 \u2500\u2500");
    const dirs = ["packages", "docs", "scripts", "skills", "webui"];
    for (const d of dirs) {
        const full = path.join(ROOT, d);
        const exist = fs.existsSync(full) && fs.statSync(full).isDirectory();
        lines.push(`    ${exist ? "\u2713" : "\u2717"} ${d}/`);
    }
    // .cortex
    const cortexDir = path.join(ROOT, ".cortex");
    if (fs.existsSync(cortexDir)) {
        try {
            const files = fs.readdirSync(cortexDir);
            const dbFiles = files.filter((f) => f.startsWith("memory") && f.endsWith(".db"));
            lines.push("");
            lines.push("  \u2500\u2500 .cortex/ \u2500\u2500");
            lines.push(`    记忆库:      ${dbFiles.length} 个`);
        }
        catch { /* ignore */ }
    }
    boxPrint(lines);
    await pressAnyKey(rl);
}
// ═══════════════════════════════════════════════════════════
// 屏幕: 文档工具（内置轻量版）
// ═══════════════════════════════════════════════════════════
async function screenDoc(rl) {
    const docsCfg = loadJson(path.join(ROOT, "cortex-docs.json"));
    clear();
    const lines = ["", "  \u25b6 文档工具", ""];
    if (docsCfg) {
        lines.push(`    宪法: ${docsCfg.constitutionPath}`);
        lines.push("");
        lines.push("  \u2500\u2500 文档注册表 \u2500\u2500");
        for (const entry of docsCfg.docRegistry) {
            const canon = entry.canonical ? "\u2605" : " ";
            const exists = fs.existsSync(path.join(ROOT, entry.path));
            const status = exists ? "\u2713" : "\u2717";
            const short = entry.path.length > 30 ? "..." + entry.path.slice(-28) : entry.path;
            lines.push(`    ${canon} ${status} [${entry.type}] v${entry.version}  ${short}`);
        }
    }
    else {
        lines.push("    cortex-docs.json 不存在");
    }
    lines.push("");
    lines.push("    [C]  Markdown \u2192 HTML 转换 (cortex doc convert)");
    lines.push("    [L]  列出 docs/ 目录");
    lines.push("");
    boxPrint(lines);
    const choice = await ask(rl, "  \u25b6 请选择 > ");
    if (choice === "C" || choice === "c") {
        await delegateWithArgs(rl, "doc", "convert <输入.md> [-o 输出.html]");
    }
    else if (choice === "L" || choice === "l") {
        clear();
        try {
            const docsDir = path.join(ROOT, "docs");
            if (fs.existsSync(docsDir)) {
                const walk = (dir, prefix) => {
                    const result = [];
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const e of entries) {
                        if (e.name.startsWith("."))
                            continue;
                        if (e.isDirectory()) {
                            result.push(`${prefix}\u251c\u2500\u2500 ${e.name}/`);
                            result.push(...walk(path.join(dir, e.name), prefix + "\u2502   "));
                        }
                        else {
                            result.push(`${prefix}\u251c\u2500\u2500 ${e.name}`);
                        }
                    }
                    return result;
                };
                console.log(`  \u25b6 docs/ 目录结构\n`);
                console.log("  docs/");
                for (const line of walk(docsDir, "  ")) {
                    console.log(line);
                }
            }
        }
        catch { /* ignore */ }
        await pressAnyKey(rl);
    }
}
const AGENTS_PATH = path.join(ROOT, "cortex-agents.json");
const COGNITION_PATH = path.join(ROOT, "cortex-cognition.json");
const DOCS_PATH = path.join(ROOT, "cortex-docs.json");
let gAgents = null;
let gCognition = null;
let gDocs = null;
async function askArray(rl, prompt, current) {
    console.log(`\n  ${prompt}\uff08\u5f53\u524d: ${current.join(", ") || "(\u7a7a)"}\uff09`);
    console.log("  \u8f93\u5165\u65b0\u6570\u7ec4\u5143\u7d20\uff0c\u9017\u53f7\u5206\u9694\uff08\u76f4\u63a5\u56de\u8f66\u4fdd\u6301\u4e0d\u53d8\uff09:");
    const answer = await ask(rl, "  > ");
    if (answer === "")
        return current;
    return answer.split(",").map((s) => s.trim()).filter(Boolean);
}
async function editAgent(rl, agent) {
    clear();
    const result = { ...agent };
    function render() {
        boxPrint([
            "",
            `  \u25b6 \u7f16\u8f91 Agent: ${result.id} (${result.type})`,
            "",
            `    \u89d2\u8272: ${result.role}`,
            "",
            "  \u53ef\u7f16\u8f91\u5b57\u6bb5:",
            `    [1] model        = ${result.model}`,
            `    [2] key          = ${result.key}`,
            `    [3] maxInstances = ${result.maxInstances}`,
            `    [4] tags         = ${result.tags.join(", ") || "(\u7a7a)"}`,
            `    [5] toolPermissions = ${result.toolPermissions?.join(", ") || "(\u7a7a)"}`,
            `    [6] memoryQueryStrategy = ${result.memoryQueryStrategy ?? "(\u672a\u8bbe\u7f6e)"}`,
            `    [7] \u67e5\u770b systemPrompt`,
            "",
            "    [8] \u4fdd\u5b58\u5e76\u8fd4\u56de",
            "    [0] \u653e\u5f03\u4fee\u6539",
            "",
        ]);
    }
    render();
    while (true) {
        const c = await ask(rl, "  > ");
        switch (c) {
            case "1":
                result.model = await askWithDefault(rl, "  model", result.model);
                break;
            case "2":
                result.key = await askWithDefault(rl, "  key", result.key);
                break;
            case "3":
                result.maxInstances = await askNumber(rl, "  maxInstances", result.maxInstances);
                break;
            case "4":
                result.tags = await askArray(rl, "tags", result.tags);
                break;
            case "5":
                result.toolPermissions = await askArray(rl, "toolPermissions", result.toolPermissions);
                break;
            case "6":
                result.memoryQueryStrategy = await askWithDefault(rl, "  memoryQueryStrategy (\u7559\u7a7a\u6e05\u9664)", result.memoryQueryStrategy ?? "");
                if (result.memoryQueryStrategy === "")
                    delete result.memoryQueryStrategy;
                break;
            case "7": {
                clear();
                boxPrint(["", `  \u25b6 systemPrompt for ${agent.id}`, ""]);
                const spLines = result.systemPrompt.split("\n");
                for (let i = 0; i < Math.min(spLines.length, 15); i++) {
                    const t = spLines[i].length > BOX_W - 4 ? spLines[i].slice(0, BOX_W - 7) + "..." : spLines[i];
                    console.log(`  ${t}`);
                }
                if (spLines.length > 15)
                    console.log(`  ... (\u5171 ${spLines.length} \u884c\uff0c\u6b64\u5904\u4ec5\u663e\u793a\u524d 15 \u884c)`);
                await pressAnyKey(rl);
                clear();
                render();
                break;
            }
            case "8": {
                const cf = await askWithDefault(rl, "  \u786e\u8ba4\u4fdd\u5b58?", "y");
                if (cf.toLowerCase() === "y" || cf.toLowerCase() === "yes")
                    return result;
                break;
            }
            case "0": return agent;
            default: console.log("  \u65e0\u6548\u9009\u62e9");
        }
    }
}
async function screenAgentsConfig(rl) {
    if (!gAgents)
        return;
    const agents = { ...gAgents.agents };
    const ids = Object.keys(agents);
    while (true) {
        clear();
        showMenu("cortex-agents.json", [
            { key: "1", label: "\u67e5\u770b/\u7f16\u8f91 Agent", hint: `(${ids.length}\u4f4d)` },
            { key: "2", label: "\u67e5\u770b\u4e8b\u4ef6\u8def\u7531\u8868" },
            { key: "3", label: "\u67e5\u770b\u59d4\u5458\u4f1a\u89c4\u5219" },
            { key: "4", label: "\u67e5\u770b\u5706\u684c\u6a21\u677f" },
            { key: "5", label: "\u67e5\u770b\u641c\u7d22\u63d0\u4f9b\u5546" },
            { key: "S", label: "\u4fdd\u5b58\u5e76\u8fd4\u56de" },
        ]);
        const c = await ask(rl, "  > ");
        switch (c) {
            case "1": {
                clear();
                const items = ids.map((id, i) => ({ key: String(i + 1), label: `${id} (${agents[id].type}) \u2014 ${agents[id].role}` }));
                showMenu("\u9009\u62e9 Agent \u7f16\u8f91", items);
                const ac = await ask(rl, "  > ");
                const idx = Number(ac);
                if (idx >= 1 && idx <= ids.length) {
                    agents[ids[idx - 1]] = await editAgent(rl, agents[ids[idx - 1]]);
                }
                break;
            }
            case "2": {
                clear();
                const lines = ["", "  \u25b6 \u4e8b\u4ef6\u8def\u7531\u8868", ""];
                for (const [ev, rt] of Object.entries(gAgents.eventRouting.routeTable)) {
                    const urg = rt.channel === "urgent" ? "!!" : rt.channel === "important" ? "! " : "  ";
                    const ack = rt.ackRequired ? " ACK" : "";
                    lines.push(`    ${urg} ${ev.padEnd(40)} ${rt.channel}${ack}`);
                }
                boxPrint(lines);
                await pressAnyKey(rl);
                break;
            }
            case "3": {
                clear();
                const lines = ["", "  \u25b6 \u59d4\u5458\u4f1a\u89c4\u5219", ""];
                for (const r of gAgents.eventRouting.committeeRules) {
                    lines.push(`    [${r.id}]`);
                    lines.push(`      \u89e6\u53d1: ${r.triggerEvent}  |  \u7d27\u6025: ${r.urgent ? "\u662f" : "\u5426"}`);
                    lines.push(`      \u6210\u5458: ${r.members.join(", ")}`);
                    lines.push("");
                }
                boxPrint(lines);
                await pressAnyKey(rl);
                break;
            }
            case "4": {
                clear();
                const lines = ["", "  \u25b6 \u5706\u684c\u6a21\u677f", ""];
                for (const t of gAgents.roundtableTemplates) {
                    lines.push(`    [${t.name}]  ${t.description}`);
                    lines.push(`      personas: ${t.personas}  rounds: ${t.rounds}`);
                    const ag = t.agents.join(", ");
                    lines.push(`      agents: ${ag.length > 50 ? ag.slice(0, 50) + "..." : ag}`);
                    lines.push("");
                }
                boxPrint(lines);
                await pressAnyKey(rl);
                break;
            }
            case "5": {
                clear();
                const sp = gAgents.searchProviders;
                const lines = [
                    "", "  \u25b6 \u641c\u7d22\u63d0\u4f9b\u5546", "",
                    "  -- \u805a\u5408\u914d\u7f6e --",
                    `    deduplicateBy: ${sp.aggregation.deduplicateBy}`,
                    `    resultTimeout: ${sp.aggregation.resultTimeout}ms`,
                    `    minBackends:   ${sp.aggregation.minBackends}`,
                    "", "  -- \u540e\u7aef\u5217\u8868 --",
                ];
                for (const b of sp.backends) {
                    lines.push(`    [${b.id}] ${b.enabled ? "+ \u542f\u7528" : "- \u7981\u7528"}  cmd=${b.command} ${b.args.join(" ")}`);
                }
                boxPrint(lines);
                await pressAnyKey(rl);
                break;
            }
            case "S":
            case "s": {
                gAgents = { ...gAgents, agents };
                if (saveJson(AGENTS_PATH, gAgents))
                    console.log("\n  OK cortex-agents.json \u5df2\u4fdd\u5b58");
                else
                    console.log("\n  ERR \u4fdd\u5b58\u5931\u8d25");
                await pressAnyKey(rl);
                return;
            }
            case "0": return;
            default: console.log("  \u65e0\u6548\u9009\u62e9");
        }
    }
}
async function screenCognitionConfig(rl) {
    if (!gCognition)
        return;
    const matrix = [...gCognition.activationMatrix];
    const attention = { ...gCognition.attention };
    while (true) {
        clear();
        const lines = ["", "  \u25b6 cortex-cognition.json", "", "  -- \u6fc0\u6d3b\u77e9\u9635 --"];
        for (let i = 0; i < matrix.length; i++) {
            const e = matrix[i];
            lines.push(`    [${String(i + 1).padStart(2)}] ${e.agentType.padEnd(14)} ${e.active ? "+ \u6fc0\u6d3b" : "- \u505c\u7528"}  ${e.orientation}`);
        }
        lines.push("", "  -- \u6ce8\u610f\u529b\u914d\u7f6e --", `    hcaWeight:       ${attention.hcaWeight}`, `    csaWeight:       ${attention.csaWeight}`, `    maxMemoryItems:  ${attention.maxMemoryItems}`, "", "    [T]  \u5207\u6362\u6fc0\u6d3b\u72b6\u6001", "    [A]  \u7f16\u8f91\u6ce8\u610f\u529b\u53c2\u6570", "", "    [S]  \u4fdd\u5b58\u5e76\u8fd4\u56de", "");
        boxPrint(lines);
        const c = await ask(rl, "  > ");
        if (c === "T" || c === "t") {
            const istr = await ask(rl, `  \u8f93\u5165\u7f16\u53f7 (1-${matrix.length}): `);
            const idx = Number(istr);
            if (idx >= 1 && idx <= matrix.length) {
                matrix[idx - 1] = { ...matrix[idx - 1], active: !matrix[idx - 1].active };
                console.log(`  OK ${matrix[idx - 1].agentType}.active \u2192 ${matrix[idx - 1].active}`);
                await pressAnyKey(rl);
            }
        }
        else if (c === "A" || c === "a") {
            attention.hcaWeight = await askNumber(rl, "  hcaWeight (0-1)", attention.hcaWeight);
            attention.csaWeight = await askNumber(rl, "  csaWeight (0-1)", attention.csaWeight);
            attention.maxMemoryItems = await askNumber(rl, "  maxMemoryItems", attention.maxMemoryItems);
        }
        else if (c === "S" || c === "s") {
            gCognition = { activationMatrix: matrix, attention };
            if (saveJson(COGNITION_PATH, gCognition))
                console.log("\n  OK cortex-cognition.json \u5df2\u4fdd\u5b58");
            else
                console.log("\n  ERR \u4fdd\u5b58\u5931\u8d25");
            await pressAnyKey(rl);
            return;
        }
        else if (c === "0") {
            return;
        }
    }
}
async function screenDocsConfig(rl) {
    if (!gDocs)
        return;
    let conPath = gDocs.constitutionPath;
    const registry = [...gDocs.docRegistry];
    while (true) {
        clear();
        const lines = ["", "  \u25b6 cortex-docs.json", "", "  -- \u5baa\u6cd5\u8def\u5f84 --", `    ${conPath}`, "", "  -- \u6587\u6863\u6ce8\u518c\u8868 --"];
        for (let i = 0; i < registry.length; i++) {
            const e = registry[i];
            const can = e.canonical ? "\u2605" : " ";
            const short = e.path.length > 28 ? "..." + e.path.slice(-28) : e.path;
            lines.push(`    [${String(i + 1).padStart(2)}] ${can} ${e.type.padEnd(14)} v${e.version.padEnd(8)} ${short}`);
        }
        lines.push("", "    [E]  \u7f16\u8f91\u5baa\u6cd5\u8def\u5f84", "    [T]  \u5207\u6362 canonical \u72b6\u6001", "", "    [S]  \u4fdd\u5b58\u5e76\u8fd4\u56de", "");
        boxPrint(lines);
        const c = await ask(rl, "  > ");
        if (c === "E" || c === "e") {
            conPath = await askWithDefault(rl, "  constitutionPath", conPath);
        }
        else if (c === "T" || c === "t") {
            const istr = await ask(rl, `  \u8f93\u5165\u7f16\u53f7 (1-${registry.length}): `);
            const idx = Number(istr);
            if (idx >= 1 && idx <= registry.length) {
                registry[idx - 1] = { ...registry[idx - 1], canonical: !registry[idx - 1].canonical };
                console.log(`  OK canonical \u2192 ${registry[idx - 1].canonical}`);
                await pressAnyKey(rl);
            }
        }
        else if (c === "S" || c === "s") {
            gDocs = { constitutionPath: conPath, docRegistry: registry };
            if (saveJson(DOCS_PATH, gDocs))
                console.log("\n  OK cortex-docs.json \u5df2\u4fdd\u5b58");
            else
                console.log("\n  ERR \u4fdd\u5b58\u5931\u8d25");
            await pressAnyKey(rl);
            return;
        }
        else if (c === "0") {
            return;
        }
    }
}
async function screenSetup(rl) {
    while (true) {
        clear();
        const items = [];
        if (gAgents)
            items.push({ key: "1", label: "cortex-agents.json", hint: `(${Object.keys(gAgents.agents).length} Agent)` });
        if (gCognition) {
            const act = gCognition.activationMatrix.filter((e) => e.active).length;
            items.push({ key: "2", label: "cortex-cognition.json", hint: `(${act}/${gCognition.activationMatrix.length} \u6fc0\u6d3b)` });
        }
        if (gDocs)
            items.push({ key: "3", label: "cortex-docs.json", hint: `(${gDocs.docRegistry.length} \u6761\u6ce8\u518c)` });
        showMenu("\u914d\u7f6e\u7ba1\u7406\u4e2d\u5fc3", items);
        const c = await ask(rl, "  > ");
        switch (c) {
            case "1":
                if (gAgents)
                    await screenAgentsConfig(rl);
                break;
            case "2":
                if (gCognition)
                    await screenCognitionConfig(rl);
                break;
            case "3":
                if (gDocs)
                    await screenDocsConfig(rl);
                break;
            case "0": return;
            default: console.log("  \u65e0\u6548\u9009\u62e9");
        }
    }
}
// ═══════════════════════════════════════════════════════════
// 主菜单
// ═══════════════════════════════════════════════════════════
async function mainMenu(rl) {
    // 预加载配置
    gAgents = loadJson(AGENTS_PATH);
    gCognition = loadJson(COGNITION_PATH);
    gDocs = loadJson(DOCS_PATH);
    const COMMANDS = [
        { key: "1", label: "\u5355\u6b21\u6267\u884c", hint: "cortex run <file>", builtin: false, cmd: "run" },
        { key: "2", label: "Agent \u7ba1\u7406", hint: "cortex agent list | spawn | destroy", builtin: false, cmd: "agent" },
        { key: "3", label: "\u4efb\u52a1\u7ba1\u7406", hint: "cortex task submit | list | cancel", builtin: false, cmd: "task" },
        { key: "4", label: "\u8bb0\u5fc6\u7cfb\u7edf", hint: "cortex memory search | inspect", builtin: false, cmd: "memory" },
        { key: "5", label: "\u914d\u7f6e\u7ba1\u7406\u4e2d\u5fc3", hint: "Agents / Cognition / Docs", builtin: true },
        { key: "6", label: "\u6587\u6863\u5de5\u5177", hint: "\u6d4f\u89c8\u3001\u8f6c\u6362", builtin: true },
        { key: "7", label: "\u9879\u76ee\u4fa6\u5bdf", hint: "\u914d\u7f6e\u3001\u76ee\u5f55\u3001\u8bb0\u5fc6\u5e93", builtin: true },
        { key: "8", label: "\u8c03\u5ea6\u7cfb\u7edf", hint: "cortex schedule", builtin: false, cmd: "schedule" },
        { key: "9", label: "\u5706\u684c\u8fa9\u8bba", hint: "cortex roundtable", builtin: false, cmd: "roundtable" },
        { key: "A", label: "\u786e\u8ba4\u95e8", hint: "cortex confirm", builtin: false, cmd: "confirm" },
        { key: "R", label: "REPL \u4ea4\u4e92\u6a21\u5f0f", hint: "cortex repl", builtin: false, cmd: "repl" },
        { key: "V", label: "\u7248\u672c\u4fe1\u606f", hint: "", builtin: true },
    ];
    while (true) {
        clear();
        const items = COMMANDS.map((c) => ({
            key: c.key,
            label: c.label,
            hint: c.hint ? `  \u2500 ${c.hint}` : undefined,
        }));
        showMenu("Cortex \u63a7\u5236\u53f0", items);
        const choice = await ask(rl, "  > ");
        const cmd = COMMANDS.find((c) => c.key === choice.toUpperCase());
        if (!cmd) {
            if (choice === "0") {
                clear();
                boxPrint(["", "  \u25b6 Cortex \u63a7\u5236\u53f0\u5df2\u5173\u95ed", "", "    \u518d\u6b21\u89c1\uff0c\u62d3\u8352\u8005\u3002", ""]);
                return;
            }
            console.log("  \u65e0\u6548\u9009\u62e9");
            continue;
        }
        if (cmd.builtin) {
            switch (cmd.key) {
                case "5":
                    await screenSetup(rl);
                    break;
                case "6":
                    await screenDoc(rl);
                    break;
                case "7":
                    await screenInspect(rl);
                    break;
                case "V":
                    await screenVersion(rl);
                    break;
            }
        }
        else {
            // 委托到 cortex CLI
            await delegateWithArgs(rl, cmd.cmd, `cortex ${cmd.cmd}` + (cmd.key === "1" ? " <file>" : ""));
        }
    }
}
// ═══════════════════════════════════════════════════════════
// 入口
// ═══════════════════════════════════════════════════════════
async function main() {
    try {
        execSync("chcp 65001", { stdio: "pipe" });
    }
    catch { /* non-Windows */ }
    // 解析 --mode
    let runMode = "full";
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--mode" && i + 1 < args.length) {
            if (args[i + 1] === "setup")
                runMode = "setup";
            break;
        }
        if (args[i].startsWith("--mode=")) {
            if (args[i].slice(7) === "setup")
                runMode = "setup";
            break;
        }
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        if (runMode === "setup") {
            // 预加载配置
            gAgents = loadJson(AGENTS_PATH);
            gCognition = loadJson(COGNITION_PATH);
            gDocs = loadJson(DOCS_PATH);
            await screenSetup(rl);
        }
        else {
            await mainMenu(rl);
        }
        process.exit(0);
    }
    catch (err) {
        console.error("FATAL:", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    finally {
        rl.close();
    }
}
main();
//# sourceMappingURL=cortex-cli.js.map