#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * monitor-api.ts — Cortex API 密钥调用监控
 *
 * 读取 .cortex/logs/api-calls.jsonl 审计日志，输出：
 *   1. 按 Key 汇总（调用次数/错误率/平均耗时）
 *   2. 按小时分布的调用热力图
 *   3. 近期错误详情（最近 20 条）
 *   4. 异常告警（凌晨调用、错误激增、单 key 调用量异常）
 *
 * 用法:
 *   npx tsx scripts/monitor-api.ts              # 默认分析最近 24h
 *   npx tsx scripts/monitor-api.ts --hours 72   # 最近 72h
 *   npx tsx scripts/monitor-api.ts --live       # 持续监控（tail -f 模式）
 *   npx tsx scripts/monitor-api.ts --export csv # 导出 CSV
 *
 * 前提：Cortex CLI 运行时自动启用审计日志（CORTEX_API_AUDIT≠0）
 */
import * as fs from "node:fs";
import * as path from "node:path";
// ── 配置 ──────────────────────────────────────────
const LOG_PATH = path.resolve(process.cwd(), ".cortex", "logs", "api-calls.jsonl");
/** Key 指纹 → 可读名称映射（从 sha256 前 12 位映射） */
const KEY_MAP = {
// 运行一次后，配合 --inspect-keys 查看指纹，在此配置映射
// "a1b2c3d4e5f6": "昔涟-CLI",
// "123456789abc": "Chat池",
// "fedcba987654": "Reasoner",
};
// ── 数据加载 ──────────────────────────────────────
function loadEntries(hours) {
    if (!fs.existsSync(LOG_PATH)) {
        console.log(`📭 审计日志不存在: ${LOG_PATH}`);
        console.log("   启动 Cortex CLI 后会自动生成。");
        process.exit(0);
    }
    const raw = fs.readFileSync(LOG_PATH, "utf-8").trim();
    if (!raw) {
        console.log("📭 审计日志为空。");
        process.exit(0);
    }
    const cutoff = Date.now() - hours * 3600 * 1000;
    const entries = [];
    for (const line of raw.split("\n")) {
        try {
            const entry = JSON.parse(line);
            if (new Date(entry.ts).getTime() >= cutoff) {
                entries.push(entry);
            }
        }
        catch {
            // 跳过损坏行
        }
    }
    return entries;
}
// ── 分析 ──────────────────────────────────────────
function analyze(entries) {
    if (entries.length === 0) {
        return { keyStats: [], hourly: [], recentErrors: [], alerts: [] };
    }
    // ── 按 Key 分组 ──
    const keyMap = new Map();
    for (const e of entries) {
        const arr = keyMap.get(e.key) ?? [];
        arr.push(e);
        keyMap.set(e.key, arr);
    }
    const keyStats = [];
    for (const [key, arr] of keyMap) {
        const errors = arr.filter((e) => e.status >= 400 || e.error);
        const models = [...new Set(arr.map((e) => e.model))].sort();
        const durations = arr.filter((e) => e.duration_ms > 0).map((e) => e.duration_ms);
        const avgDuration = durations.length > 0
            ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(0)
            : "N/A";
        keyStats.push({
            key,
            label: KEY_MAP[key] ?? `未知(${key})`,
            calls: arr.length,
            errors: errors.length,
            errorRate: arr.length > 0 ? `${((errors.length / arr.length) * 100).toFixed(1)}%` : "0%",
            avgDurationMs: avgDuration,
            models,
            firstCall: arr[0].ts,
            lastCall: arr[arr.length - 1].ts,
        });
    }
    keyStats.sort((a, b) => b.calls - a.calls);
    // ── 按小时分布 ──
    const hourlyMap = new Map();
    for (const e of entries) {
        const hour = e.ts.slice(0, 13) + ":00";
        const b = hourlyMap.get(hour) ?? { calls: 0, errors: 0 };
        b.calls++;
        if (e.status >= 400 || e.error)
            b.errors++;
        hourlyMap.set(hour, b);
    }
    const hourly = [];
    for (const [hour, b] of hourlyMap) {
        hourly.push({ hour, ...b });
    }
    hourly.sort((a, b) => a.hour.localeCompare(b.hour));
    // ── 近期错误 ──
    const recentErrors = entries
        .filter((e) => e.status >= 400 || e.error)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 20);
    // ── 异常检测 ──
    const alerts = [];
    // 1. 凌晨异常（02:00-06:00）
    const nightCalls = entries.filter((e) => {
        const h = new Date(e.ts).getHours();
        return h >= 2 && h < 6;
    });
    if (nightCalls.length > 0) {
        const nightKeys = [...new Set(nightCalls.map((e) => e.key))];
        alerts.push(`🌙 凌晨 2-6 点有 ${nightCalls.length} 次调用（Key: ${nightKeys.map((k) => KEY_MAP[k] ?? k).join(", ")}）`);
    }
    // 2. 错误率 > 30%
    for (const ks of keyStats) {
        const errRate = parseFloat(ks.errorRate);
        if (errRate > 30 && ks.calls >= 5) {
            alerts.push(`🚨 ${ks.label} 错误率 ${ks.errorRate}（${ks.errors}/${ks.calls}）`);
        }
    }
    // 3. 单 Key 调用量异常（超过总调用 80%）
    if (keyStats.length >= 2 && keyStats[0].calls > entries.length * 0.8 && entries.length > 20) {
        alerts.push(`⚡ ${keyStats[0].label} 占总量 ${((keyStats[0].calls / entries.length) * 100).toFixed(0)}%，可能存在异常集中调用`);
    }
    return { keyStats, hourly, recentErrors, alerts };
}
// ── 输出 ──────────────────────────────────────────
function printReport({ keyStats, hourly, recentErrors, alerts }, hours) {
    const totalCalls = keyStats.reduce((s, k) => s + k.calls, 0);
    const totalErrors = keyStats.reduce((s, k) => s + k.errors, 0);
    console.log(`\n╔══════════════════════════════════════════════╗`);
    console.log(`║   Cortex API 调用监控 —— 最近 ${hours}h          ║`);
    console.log(`╠══════════════════════════════════════════════╣`);
    console.log(`║   总调用: ${String(totalCalls).padEnd(6)}  总错误: ${String(totalErrors).padEnd(6)}       ║`);
    console.log(`╚══════════════════════════════════════════════╝\n`);
    // ── 异常告警 ──
    if (alerts.length > 0) {
        console.log("⚠️  异常告警:");
        for (const a of alerts)
            console.log(`   ${a}`);
        console.log();
    }
    // ── Key 统计表 ──
    console.log("📊 Key 调用统计:");
    console.log("─".repeat(90));
    console.log(`${"Key".padEnd(20)} ${"调用".padStart(6)} ${"错误".padStart(5)} ${"错误率".padStart(7)} ${"平均耗时".padStart(9)} ${"模型"}`);
    console.log("─".repeat(90));
    for (const ks of keyStats) {
        console.log(`${ks.label.padEnd(20)} ${String(ks.calls).padStart(6)} ${String(ks.errors).padStart(5)} ${ks.errorRate.padStart(7)} ${(ks.avgDurationMs + "ms").padStart(9)} ${ks.models.join(", ")}`);
    }
    console.log("─".repeat(90));
    // ── 每小时调用分布 ──
    if (hourly.length > 0) {
        console.log("\n📈 每小时调用分布:");
        const maxCalls = Math.max(...hourly.map((h) => h.calls), 1);
        const barWidth = 30;
        for (const h of hourly) {
            const bars = Math.round((h.calls / maxCalls) * barWidth);
            const errMark = h.errors > 0 ? ` ⚠${h.errors}` : "";
            console.log(`   ${h.hour}  ${"█".repeat(bars)}${"░".repeat(barWidth - bars)} ${String(h.calls).padStart(4)}${errMark}`);
        }
    }
    // ── 最近错误 ──
    if (recentErrors.length > 0) {
        console.log(`\n❌ 最近 ${recentErrors.length} 条错误:`);
        console.log("─".repeat(100));
        for (const e of recentErrors) {
            const label = KEY_MAP[e.key] ?? e.key;
            console.log(`   ${e.ts.slice(0, 19)}  ${label.padEnd(18)} ${String(e.status).padStart(4)}  ${(e.error ?? "无详情").slice(0, 60)}`);
        }
        console.log("─".repeat(100));
    }
    console.log();
}
function exportCsv(entries) {
    const csvPath = path.resolve(process.cwd(), ".cortex", "logs", "api-calls.csv");
    const header = "ts,key,model,status,duration_ms,messages_count,tool_count,stream,error";
    const rows = entries.map((e) => [
        e.ts,
        e.key,
        e.model,
        e.status,
        e.duration_ms,
        e.messages_count,
        e.tool_count,
        e.stream ? "1" : "0",
        (e.error ?? "").replace(/"/g, '""'),
    ].join(","));
    fs.writeFileSync(csvPath, [header, ...rows].join("\n"), "utf-8");
    console.log(`✅ 已导出 ${entries.length} 条记录 → ${csvPath}`);
}
function inspectKeys(entries) {
    const keyMap = new Map();
    for (const e of entries) {
        const info = keyMap.get(e.key) ?? { count: 0, models: [], lastSeen: "" };
        info.count++;
        if (!info.models.includes(e.model))
            info.models.push(e.model);
        if (e.ts > info.lastSeen)
            info.lastSeen = e.ts;
        keyMap.set(e.key, info);
    }
    console.log("\n🔑 检测到的 Key 指纹（请配置到脚本顶部 KEY_MAP）:\n");
    for (const [fingerprint, info] of keyMap) {
        console.log(`   "${fingerprint}": "",  // ${info.count} 次调用, 模型: ${info.models.join("/")}, 最近: ${info.lastSeen.slice(0, 19)}`);
    }
    console.log();
}
// ── Live 模式 ──
function liveMode() {
    console.log("🟢 实时监控模式（Ctrl+C 退出）...\n");
    let lastLineCount = 0;
    const tick = () => {
        try {
            if (!fs.existsSync(LOG_PATH))
                return;
            const raw = fs.readFileSync(LOG_PATH, "utf-8").trim();
            if (!raw)
                return;
            const lines = raw.split("\n");
            if (lines.length <= lastLineCount)
                return;
            // 只输出新增行（精确行数追踪）
            const newLines = lines.slice(lastLineCount);
            for (const line of newLines) {
                try {
                    const e = JSON.parse(line);
                    const label = KEY_MAP[e.key] ?? e.key;
                    const statusIcon = e.error || e.status >= 400 ? "❌" : e.status >= 200 && e.status < 300 ? "✅" : "⚠️";
                    console.log(`${e.ts.slice(11, 19)} ${statusIcon} ${label.padEnd(18)} ${e.model.padEnd(22)} ${String(e.duration_ms).padStart(5)}ms  msgs:${e.messages_count}`);
                }
                catch {
                    // skip
                }
            }
            lastLineCount = lines.length;
        }
        catch {
            // 文件可能被轮转
        }
    };
    setInterval(tick, 2000);
    tick();
}
// ── 主入口 ──────────────────────────────────────────
function main() {
    const args = process.argv.slice(2);
    if (args.includes("--live") || args.includes("-l")) {
        liveMode();
        return;
    }
    if (args.includes("--inspect-keys")) {
        const entries = loadEntries(24 * 365); // 全部
        inspectKeys(entries);
        return;
    }
    const exportCsvMode = args.includes("--export");
    const hoursIdx = args.indexOf("--hours");
    const hours = hoursIdx >= 0 ? parseInt(args[hoursIdx + 1]) || 24 : 24;
    const entries = loadEntries(hours);
    if (exportCsvMode) {
        exportCsv(entries);
        return;
    }
    const report = analyze(entries);
    printReport(report, hours);
}
main();
//# sourceMappingURL=monitor-api.js.map