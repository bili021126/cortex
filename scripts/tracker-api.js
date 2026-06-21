#!/usr/bin/env npx tsx
/* eslint-disable no-console */
/**
 * tracker-api.ts — Cortex API Key 长期追踪与入侵检测
 *
 * 持久化每日用量统计，累积 token 消耗，异常检测。
 * 数据存储: .cortex/logs/api-tracker.json（自动维护）
 * 审计来源: .cortex/logs/api-calls.jsonl
 *
 * 用法:
 *   npx tsx scripts/tracker-api.ts                 # 今日报告
 *   npx tsx scripts/tracker-api.ts --days 7        # 近 7 天趋势
 *   npx tsx scripts/tracker-api.ts --daemon 300    # 守护模式（每 300 秒检查）
 *   npx tsx scripts/tracker-api.ts --summary       # 累计总览
 *   npx tsx scripts/tracker-api.ts --export csv    # 导出日表 CSV
 *   npx tsx scripts/tracker-api.ts --reset         # 重置数据库
 */
import * as fs from "node:fs";
import * as path from "node:path";
// ── 路径 ──────────────────────────────────────────────────
const AUDIT_LOG = path.resolve(process.cwd(), ".cortex", "logs", "api-calls.jsonl");
const DB_PATH = path.resolve(process.cwd(), ".cortex", "logs", "api-tracker.json");
// ── Key 指纹映射 ──────────────────────────────────────────
const KEY_LABELS = {
// 运行一次后，复制 monitor-api.ts --inspect-keys 输出到此
};
// ── 定价（元/百万 tokens，缓存未命中）─────────────────
// 参考: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// deepseek-chat/deepseek-reasoner 已弃用，均为 v4-flash 别名
const PRICING = {
    "deepseek-v4-flash": { input: 1, output: 2 },
    "deepseek-chat": { input: 1, output: 2 }, // 弃用别名
    "deepseek-reasoner": { input: 1, output: 2 }, // 弃用别名（v4-flash 思考模式）
    "deepseek-v4-pro": { input: 3, output: 6 }, // 原价 1/4 后
};
const DEFAULT_PRICING = { input: 1, output: 2 };
// ── 数据库读写 ────────────────────────────────────────────
function loadDB() {
    if (fs.existsSync(DB_PATH)) {
        try {
            return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
        }
        catch {
            console.warn("⚠️ tracker DB 损坏，重建中...");
        }
    }
    return { version: 1, updatedAt: "", lastAuditCursor: 0, keys: {} };
}
function saveDB(db) {
    db.updatedAt = new Date().toISOString();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
function ensureKey(db, fingerprint) {
    if (!db.keys[fingerprint]) {
        db.keys[fingerprint] = {
            label: KEY_LABELS[fingerprint] ?? `key-${fingerprint.slice(0, 8)}`,
            fingerprint,
            days: {},
            cumulative: { calls: 0, errors: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, firstSeen: "", lastSeen: "" },
        };
    }
    return db.keys[fingerprint];
}
function ensureDay(kr, date) {
    if (!kr.days[date]) {
        kr.days[date] = {
            date,
            calls: 0,
            errors: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            avgDurationMs: 0,
            models: [],
            hourlyDistribution: new Array(24).fill(0),
            reqIds: [],
        };
    }
    return kr.days[date];
}
// ── 审计日志增量处理 ──────────────────────────────────────
function ingestAuditLog(db) {
    if (!fs.existsSync(AUDIT_LOG))
        return { processed: 0, newEntries: 0 };
    const raw = fs.readFileSync(AUDIT_LOG, "utf-8").trim();
    if (!raw)
        return { processed: 0, newEntries: 0 };
    const lines = raw.split("\n");
    let processed = 0;
    for (let i = db.lastAuditCursor; i < lines.length; i++) {
        try {
            const e = JSON.parse(lines[i]);
            const date = e.ts.slice(0, 10);
            const hour = new Date(e.ts).getHours();
            const kr = ensureKey(db, e.key ?? "unknown");
            const day = ensureDay(kr, date);
            day.calls++;
            day.promptTokens += e.prompt_tokens ?? 0;
            day.completionTokens += e.completion_tokens ?? 0;
            day.totalTokens += e.total_tokens ?? 0;
            day.avgDurationMs = ((day.avgDurationMs * (day.calls - 1)) + (e.duration_ms ?? 0)) / day.calls;
            day.hourlyDistribution[hour] = (day.hourlyDistribution[hour] ?? 0) + 1;
            if (e.model && !day.models.includes(e.model))
                day.models.push(e.model);
            if (e.req_id && day.reqIds.length < 10)
                day.reqIds.push(e.req_id);
            if (e.status >= 400 || e.error)
                day.errors++;
            kr.cumulative.calls++;
            kr.cumulative.promptTokens += e.prompt_tokens ?? 0;
            kr.cumulative.completionTokens += e.completion_tokens ?? 0;
            kr.cumulative.totalTokens += e.total_tokens ?? 0;
            if (e.status >= 400 || e.error)
                kr.cumulative.errors++;
            if (!kr.cumulative.firstSeen || e.ts < kr.cumulative.firstSeen)
                kr.cumulative.firstSeen = e.ts;
            if (!kr.cumulative.lastSeen || e.ts > kr.cumulative.lastSeen)
                kr.cumulative.lastSeen = e.ts;
            processed++;
        }
        catch {
            // 跳过损坏行
        }
    }
    const newEntries = lines.length - db.lastAuditCursor;
    db.lastAuditCursor = lines.length;
    return { processed, newEntries };
}
// ── 基线计算 ──────────────────────────────────────────────
function computeBaseline(kr) {
    const dates = Object.keys(kr.days).sort();
    if (dates.length < 3)
        return;
    // 取最近 7 天（不含今天）
    const recent = dates.slice(-8, -1);
    if (recent.length === 0)
        return;
    const callsArr = recent.map((d) => kr.days[d].calls);
    const tokensArr = recent.map((d) => kr.days[d].totalTokens);
    const avgCalls = callsArr.reduce((a, b) => a + b, 0) / recent.length;
    const avgTokens = tokensArr.reduce((a, b) => a + b, 0) / recent.length;
    const variance = callsArr.reduce((s, c) => s + (c - avgCalls) ** 2, 0) / recent.length;
    kr.baseline = {
        avgDailyCalls: Math.round(avgCalls * 100) / 100,
        avgDailyTokens: Math.round(avgTokens),
        stdDevCalls: Math.round(Math.sqrt(variance) * 100) / 100,
    };
}
function detectAnomalies(db, today) {
    const alerts = [];
    for (const kr of Object.values(db.keys)) {
        const label = kr.label;
        const todayDay = kr.days[today];
        if (!todayDay || !kr.baseline)
            continue;
        // 1. 调用量激增（>3x 基线 + 超出 2σ）
        if (kr.baseline.avgDailyCalls > 0) {
            const threshold = Math.max(kr.baseline.avgDailyCalls * 3, kr.baseline.avgDailyCalls + kr.baseline.stdDevCalls * 3);
            if (todayDay.calls > threshold && todayDay.calls > 10) {
                alerts.push({
                    severity: "critical",
                    message: `${label}: 今日调用 ${todayDay.calls} 次，远超基线 ${kr.baseline.avgDailyCalls.toFixed(1)}±${kr.baseline.stdDevCalls.toFixed(1)} (3σ阈值 ${threshold.toFixed(0)})`,
                });
            }
        }
        // 2. Token 消耗激增
        if (kr.baseline.avgDailyTokens > 0 && todayDay.totalTokens > kr.baseline.avgDailyTokens * 5 && todayDay.totalTokens > 10000) {
            alerts.push({
                severity: "warning",
                message: `${label}: 今日 token ${todayDay.totalTokens.toLocaleString()}，基线 ${kr.baseline.avgDailyTokens.toLocaleString()}（>5x）`,
            });
        }
        // 3. 今日有错误
        if (todayDay.errors > 0) {
            const errRate = ((todayDay.errors / todayDay.calls) * 100).toFixed(1);
            if (parseFloat(errRate) > 20) {
                alerts.push({
                    severity: "warning",
                    message: `${label}: 今日错误率 ${errRate}%（${todayDay.errors}/${todayDay.calls}）`,
                });
            }
        }
        // 4. 凌晨异常活跃
        const nightCalls = todayDay.hourlyDistribution.slice(2, 6).reduce((a, b) => a + b, 0);
        if (nightCalls > 5 && nightCalls > todayDay.calls * 0.3) {
            alerts.push({
                severity: "info",
                message: `${label}: 凌晨 2-6 点 ${nightCalls} 次调用（占 ${((nightCalls / todayDay.calls) * 100).toFixed(0)}%）`,
            });
        }
    }
    return alerts;
}
// ── 成本估算 ──────────────────────────────────────────────
function estimateCost(kr) {
    let totalCost = 0;
    const byModel = {};
    for (const day of Object.values(kr.days)) {
        const price = PRICING[day.models[0]] ?? DEFAULT_PRICING;
        const key = day.models[0] ?? "unknown";
        if (!byModel[key])
            byModel[key] = { calls: 0, cost: 0 };
        const cost = (day.promptTokens / 1_000_000) * price.input + (day.completionTokens / 1_000_000) * price.output;
        totalCost += cost;
        byModel[key].calls += day.calls;
        byModel[key].cost += cost;
    }
    return { totalCost, byModel };
}
// ── 输出 ──────────────────────────────────────────────────
function printTodayReport(db, alerts, today) {
    console.log(`\n╔══════════════════════════════════════════════════════╗`);
    console.log(`║     Cortex API Key 长期追踪 —— ${today}         ║`);
    console.log(`╚══════════════════════════════════════════════════════╝\n`);
    if (alerts.length > 0) {
        console.log("🚨 异常告警:");
        for (const a of alerts) {
            const icon = a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "🔵";
            console.log(`   ${icon} [${a.severity}] ${a.message}`);
        }
        console.log();
    }
    // ── 今日统计 ──
    console.log("📊 今日 API 调用统计:");
    console.log("─".repeat(105));
    const header = `${"Key".padEnd(18)} ${"调用".padStart(5)} ${"错误".padStart(4)} ${"Token".padStart(12)} ${"耗时".padStart(8)} ${"模型"}`;
    console.log(header);
    console.log("─".repeat(105));
    let grandTotalCalls = 0;
    let grandTotalTokens = 0;
    for (const kr of Object.values(db.keys)) {
        const day = kr.days[today];
        if (!day)
            continue;
        grandTotalCalls += day.calls;
        grandTotalTokens += day.totalTokens;
        const avgMs = day.calls > 0 ? `${Math.round(day.avgDurationMs)}ms` : "-";
        const tokenStr = day.totalTokens > 1000
            ? `${(day.totalTokens / 1000).toFixed(1)}k`
            : String(day.totalTokens);
        console.log(`${kr.label.padEnd(18)} ${String(day.calls).padStart(5)} ${String(day.errors).padStart(4)} ${tokenStr.padStart(12)} ${avgMs.padStart(8)} ${day.models.join(", ")}`);
    }
    console.log("─".repeat(105));
    console.log(`${"合计".padEnd(18)} ${String(grandTotalCalls).padStart(5)} ${"-".padStart(4)} ${(grandTotalTokens > 1000 ? `${(grandTotalTokens / 1000).toFixed(1)}k` : String(grandTotalTokens)).padStart(12)}`);
    console.log();
    // ── 今日每小时分布 ──
    const hourlyTotal = new Array(24).fill(0);
    for (const kr of Object.values(db.keys)) {
        const day = kr.days[today];
        if (!day)
            continue;
        for (let h = 0; h < 24; h++) {
            hourlyTotal[h] += day.hourlyDistribution[h] ?? 0;
        }
    }
    const maxH = Math.max(...hourlyTotal, 1);
    if (maxH > 0) {
        console.log("📈 今日每小时调用分布:");
        for (let h = 0; h < 24; h++) {
            const bars = Math.round((hourlyTotal[h] / maxH) * 30);
            const bar = "█".repeat(bars) + "░".repeat(30 - bars);
            const label = String(h).padStart(2, "0") + ":00";
            console.log(`   ${label}  ${bar} ${String(hourlyTotal[h]).padStart(3)}`);
        }
        console.log();
    }
}
function printSummary(db) {
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║              Cortex API Key 累计总览                        ║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
    console.log("─".repeat(115));
    console.log(`${"Key".padEnd(18)} ${"总调用".padStart(7)} ${"总错误".padStart(6)} ${"总Token".padStart(12)} ${"活跃天数".padStart(6)} ${"估费(元)".padStart(10)} ${"首次→最后"}`);
    console.log("─".repeat(115));
    for (const kr of Object.values(db.keys)) {
        const cost = estimateCost(kr);
        const activeDays = Object.keys(kr.days).length;
        const tokenStr = kr.cumulative.totalTokens > 1_000_000
            ? `${(kr.cumulative.totalTokens / 1_000_000).toFixed(2)}M`
            : kr.cumulative.totalTokens > 1_000
                ? `${(kr.cumulative.totalTokens / 1_000).toFixed(1)}k`
                : String(kr.cumulative.totalTokens);
        const first = kr.cumulative.firstSeen.slice(0, 10);
        const last = kr.cumulative.lastSeen.slice(0, 10);
        console.log(`${kr.label.padEnd(18)} ${String(kr.cumulative.calls).padStart(7)} ${String(kr.cumulative.errors).padStart(6)} ${tokenStr.padStart(12)} ${String(activeDays).padStart(6)} ${cost.totalCost.toFixed(4).padStart(10)} ${first}→${last}`);
    }
    console.log("─".repeat(115));
    console.log();
}
function printTrend(db, days) {
    const allDates = new Set();
    for (const kr of Object.values(db.keys)) {
        for (const d of Object.keys(kr.days))
            allDates.add(d);
    }
    const dates = [...allDates].sort().slice(-days);
    console.log(`\n📈 近 ${dates.length} 天趋势:\n`);
    console.log(`${"日期".padEnd(12)} ${"总调用".padStart(6)} ${"总Token".padStart(12)}`);
    console.log("─".repeat(35));
    for (const date of dates) {
        let totalCalls = 0;
        let totalTokens = 0;
        for (const kr of Object.values(db.keys)) {
            const day = kr.days[date];
            if (day) {
                totalCalls += day.calls;
                totalTokens += day.totalTokens;
            }
        }
        const tokenStr = totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens);
        console.log(`${date.padEnd(12)} ${String(totalCalls).padStart(6)} ${tokenStr.padStart(12)}`);
    }
    console.log("─".repeat(35));
    console.log();
}
function exportCsv(db) {
    const csvPath = path.resolve(process.cwd(), ".cortex", "logs", "api-tracker.csv");
    const rows = ["date,key,calls,errors,prompt_tokens,completion_tokens,total_tokens,models"];
    for (const kr of Object.values(db.keys)) {
        for (const day of Object.values(kr.days).sort((a, b) => a.date.localeCompare(b.date))) {
            rows.push([
                day.date,
                kr.label,
                day.calls,
                day.errors,
                day.promptTokens,
                day.completionTokens,
                day.totalTokens,
                `"${day.models.join(";")}"`,
            ].join(","));
        }
    }
    fs.writeFileSync(csvPath, rows.join("\n"), "utf-8");
    console.log(`✅ 已导出 ${rows.length - 1} 天数据 → ${csvPath}`);
}
// ── 主入口 ──────────────────────────────────────────────────
function main() {
    const args = process.argv.slice(2);
    if (args.includes("--reset")) {
        if (fs.existsSync(DB_PATH)) {
            const backup = DB_PATH.replace(".json", `.backup-${Date.now()}.json`);
            fs.renameSync(DB_PATH, backup);
            console.log(`📦 旧数据已备份: ${path.basename(backup)}`);
        }
        console.log("✅ 数据库已重置");
        return;
    }
    // ── 守护模式 ──
    if (args.includes("--daemon")) {
        const idx = args.indexOf("--daemon");
        const interval = parseInt(args[idx + 1]) || 300;
        console.log(`🟢 守护模式启动（每 ${interval}s 检查一次，Ctrl+C 退出）\n`);
        const tick = () => {
            const db = loadDB();
            const { processed } = ingestAuditLog(db);
            if (processed > 0) {
                const today = todayStr();
                for (const kr of Object.values(db.keys))
                    computeBaseline(kr);
                saveDB(db);
                const alerts = detectAnomalies(db, today);
                if (alerts.length > 0) {
                    console.log(`\n🚨 [${new Date().toLocaleTimeString()}] 发现 ${alerts.length} 条告警:`);
                    for (const a of alerts)
                        console.log(`   ${a.severity === "critical" ? "🔴" : "🟡"} ${a.message}`);
                }
                else {
                    process.stdout.write(`\r✅ [${new Date().toLocaleTimeString()}] 正常 —— 已处理 ${processed} 条新记录`);
                }
            }
        };
        tick();
        setInterval(tick, interval * 1000);
        return;
    }
    // ── 单次分析 ──
    const db = loadDB();
    const { processed } = ingestAuditLog(db);
    // 计算所有 key 基线
    for (const kr of Object.values(db.keys))
        computeBaseline(kr);
    saveDB(db);
    if (args.includes("--summary")) {
        printSummary(db);
        return;
    }
    if (args.includes("--export")) {
        exportCsv(db);
        return;
    }
    const daysIdx = args.indexOf("--days");
    const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 1 : 1;
    if (days > 1) {
        printTrend(db, days);
        return;
    }
    const today = todayStr();
    const alerts = detectAnomalies(db, today);
    printTodayReport(db, alerts, today);
    console.log(`📝 本次处理 ${processed} 条新审计记录`);
    console.log(`💡 运行 --days 7 查看趋势 | --summary 查看累计 | --daemon 300 守护模式\n`);
}
main();
//# sourceMappingURL=tracker-api.js.map