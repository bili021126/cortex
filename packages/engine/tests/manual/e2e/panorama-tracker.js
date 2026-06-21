/**
 * PanoramaTracker —— 执行全景记录器
 *
 * 不改 solo-flight.ts 的 S1-S8 流程。只加一层追踪层。
 * 订阅 PipelineObserver 事件 + 拦截 tool 执行回调。
 * 输出结构化 JSON 报告 + 人类可读终端输出。
 */
import * as fs from "node:fs";
import * as path from "node:path";
// ═══════════════════════════════════════════════
// PanoramaTracker
// ═══════════════════════════════════════════════
export class PanoramaTracker {
    options;
    _startTime = Date.now();
    traces = new Map();
    toolCalls = [];
    memoryEvents = [];
    fileWrites = [];
    skills = [];
    phases = [];
    _currentToolCall = null;
    _eventCounts = { node: 0, governance: 0, memory: 0, skill: 0, tool: 0, scheduler: 0, error: 0, manifold: 0, rlm: 0, context: 0 };
    _nodeTimers = new Map();
    _log;
    constructor(options = {}) {
        this.options = options;
        this._log = options.logToStderr
            ? (msg) => process.stderr.write(msg + "\n")
            : () => { };
    }
    // ── PhaseTracker ──
    phase(phase, label, detail = "") {
        const now = Date.now();
        const prev = this.phases[this.phases.length - 1];
        const rec = {
            phase, label, startTime: now, endTime: 0, durationMs: 0, detail,
        };
        if (prev && prev.endTime === 0) {
            prev.endTime = now;
            prev.durationMs = now - prev.startTime;
        }
        this.phases.push(rec);
        return rec;
    }
    phaseEnd(phase) {
        const now = Date.now();
        const p = this.phases.find(p => p.phase === phase && p.endTime === 0);
        if (p) {
            p.endTime = now;
            p.durationMs = now - p.startTime;
        }
    }
    // ── NodeTracer ──
    nodeClaimed(nodeId, agentType, nodeType) {
        const now = Date.now();
        this._nodeTimers.set(nodeId, { claimed: now, started: 0 });
        if (!this.traces.has(nodeId)) {
            this.traces.set(nodeId, {
                nodeId, agentType, nodeType, status: "claimed",
                claimedAt: now, startedAt: 0, completedAt: 0, durationMs: 0,
                success: false, output: "", error: "", toolCalls: [], replanCount: 0,
            });
        }
        else {
            const t = this.traces.get(nodeId);
            t.status = "claimed";
            t.claimedAt = now;
        }
    }
    nodeStarted(nodeId) {
        const now = Date.now();
        const timer = this._nodeTimers.get(nodeId);
        if (timer)
            timer.started = now;
        const t = this.traces.get(nodeId);
        if (t) {
            t.status = "running";
            t.startedAt = now;
        }
    }
    nodeCompleted(nodeId, success, output, error) {
        const now = Date.now();
        const timer = this._nodeTimers.get(nodeId);
        const duration = timer?.started ? now - timer.started : 0;
        this._nodeTimers.delete(nodeId);
        const t = this.traces.get(nodeId);
        if (t) {
            t.status = success ? "done" : "failed";
            t.completedAt = now;
            t.durationMs = duration;
            t.success = success;
            t.output = output?.slice(0, 200) ?? "";
            t.error = error?.slice(0, 200) ?? "";
        }
    }
    nodeReplanned(nodeId) {
        const t = this.traces.get(nodeId);
        if (t)
            t.replanCount++;
    }
    // ── ToolTracer ──
    toolStarted(agentType, nodeId, toolName, params) {
        this._currentToolCall = { toolName, agentType, nodeId, startTime: Date.now(), endTime: 0, success: false, durationMs: 0, params };
        this._eventCounts.tool++;
    }
    toolEnded(success) {
        const call = this._currentToolCall;
        if (!call)
            return;
        const now = Date.now();
        call.endTime = now;
        call.durationMs = now - call.startTime;
        call.success = success;
        const record = call;
        this.toolCalls.push(record);
        // 文件校验
        if (record.toolName === "write_file" && success) {
            const fp = String(record.params?.file_path ?? "");
            const content = String(record.params?.content ?? record.params?.content_blob ?? "");
            const agentType = this._currentToolCall.agentType ?? "";
            this._currentToolCall = null;
            this._verifyFileWrite(fp, agentType, content);
            return;
        }
        // 追加到节点记录
        const t = this.traces.get(record.nodeId);
        if (t)
            t.toolCalls.push(record);
        this._currentToolCall = null;
    }
    _verifyFileWrite(fp, agentType, content) {
        const claimedSize = Buffer.byteLength(content);
        let success = false, verified = false, verifiedSize = 0;
        try {
            if (fs.existsSync(fp)) {
                verified = true;
                verifiedSize = fs.statSync(fp).size;
                success = true;
            }
        }
        catch { /* fallthrough */ }
        this.fileWrites.push({
            filePath: fp, agentType, claimedSize, verified, verifiedSize, success,
        });
    }
    // ── Event Dashboard ──
    onEvent(event) {
        const t = event.type ?? "";
        if (t.includes("node."))
            this._eventCounts.node++;
        else if (t.includes("governance") || t.includes("constitution") || t.includes("compliance"))
            this._eventCounts.governance++;
        else if (t.includes("memory."))
            this._eventCounts.memory++;
        else if (t.includes("skill."))
            this._eventCounts.skill++;
        else if (t.includes("tool."))
            this._eventCounts.tool++;
        else if (t.includes("scheduler") || t.includes("agent_pool."))
            this._eventCounts.scheduler++;
        else if (t.includes("error.") || t.includes("failed"))
            this._eventCounts.error++;
        else if (t.includes("manifold_gate."))
            this._eventCounts.manifold++;
        else if (t.includes("rlm.") || t.includes("react"))
            this._eventCounts.rlm++;
        else if (t.includes("context."))
            this._eventCounts.context++;
    }
    // ── MemoryGuard ──
    memoryEvent(layer, event, passed, detail) {
        this.memoryEvents.push({ layer, event, passed, detail, timestamp: Date.now() });
    }
    // ── SkillAuditor ──
    skillReferenced(skillId, agentType) {
        this.skills.push({ skillId, agentType, action: "referenced", detail: "" });
    }
    skillProduced(skillId, agentType, detail) {
        this.skills.push({ skillId, agentType, action: "produced", detail });
    }
    // ── 终端可视化输出 ──
    printPhase(phase, label, content) {
        const bar = "═".repeat(label.length + 6);
        console.log(`\n╔${bar}╗`);
        console.log(`║   ${label}   ║`);
        console.log(`╚${bar}╝`);
        console.log(content);
    }
    printNodeTrace(node) {
        const status = node.success ? "✅" : "❌";
        const dur = node.durationMs ? `${(node.durationMs / 1000).toFixed(1)}s` : "—";
        console.log(`  ${status} [${node.agentType}] ${node.nodeId.slice(-16)} ${dur}`);
        for (const tc of node.toolCalls) {
            const dur = (tc.durationMs / 1000).toFixed(1);
            const icon = tc.toolName === "write_file" ? "📁" : tc.toolName === "read_file" ? "📖" : tc.toolName === "run_shell" ? "⚡" : "🔧";
            console.log(`    ${icon} ${tc.toolName}${tc.toolName === "write_file" ? ` → ${String(tc.params?.file_path ?? "").slice(-40)}` : ""} ${dur}s`);
        }
    }
    // ── 报告生成 ──
    generateReport(outputDir, experiment) {
        if (!fs.existsSync(outputDir))
            fs.mkdirSync(outputDir, { recursive: true });
        const endTime = Date.now();
        const totalDuration = endTime - this._startTime;
        const nodeResults = [...this.traces.values()];
        const passed = nodeResults.filter(n => n.success).length;
        const failed = nodeResults.filter(n => !n.success).length;
        const total = nodeResults.length;
        // 写入 timeline
        const timelinePath = path.join(outputDir, "timeline.json");
        fs.writeFileSync(timelinePath, JSON.stringify([...this.traces.values()], null, 2));
        // 写入 events
        const eventsPath = path.join(outputDir, "events.json");
        fs.writeFileSync(eventsPath, JSON.stringify({ eventCounts: this._eventCounts, toolCalls: this.toolCalls.slice(0, 500) }, null, 2));
        const report = {
            experiment,
            startTime: this._startTime,
            endTime,
            totalDurationMs: totalDuration,
            phases: this.phases,
            nodes: Object.fromEntries(this.traces),
            events: this._eventCounts,
            memory: this.memoryEvents,
            files: this.fileWrites,
            skills: this.skills,
            verdict: {
                passed: passed === total && total > 0,
                nodePassRate: total > 0 ? `${passed}/${total}` : "0/0",
                compilePass: null,
                testPass: null,
                fileVerifyPass: this.fileWrites.filter(f => f.success).length,
                fileVerifyTotal: this.fileWrites.length,
            },
            timelinePath,
            eventsPath,
            summaryPath: "",
        };
        // 写入 summary
        const summaryPath = path.join(outputDir, "summary.txt");
        const summary = this._buildSummary(report);
        fs.writeFileSync(summaryPath, summary, "utf-8");
        report.summaryPath = summaryPath;
        return report;
    }
    _buildSummary(report) {
        const lines = ["╔══════════════════ S8 全量汇总 ══════════════════════╗"];
        const nodes = [...this.traces.values()];
        const pass = nodes.filter(n => n.success).length;
        const fail = nodes.filter(n => !n.success).length;
        const types = [...new Set(nodes.map(n => n.agentType))];
        lines.push(`║  节点: ${pass}/${nodes.length} pass | ${(report.totalDurationMs / 1000).toFixed(1)}s | ${types.length}种Agent`);
        const e = report.events;
        lines.push(`║  管道: ${Object.values(e).reduce((a, b) => a + b, 0)}事件 (Node:${e.node} Gov:${e.governance} Mem:${e.memory} Skill:${e.skill} Tool:${e.tool})`);
        lines.push(`║  文件: ${report.files.length}次write_file | ${report.verdict.fileVerifyPass}/${report.verdict.fileVerifyTotal} 落盘校验通过`);
        lines.push(`║  记忆: ${report.memory?.length ?? 0}条 | RLM分解:${e.rlm}`);
        lines.push(`║  API调用: ${this.toolCalls.filter(t => t.toolName === "run_shell").length}次shell | 重规划:${nodes.reduce((s, n) => s + n.replanCount, 0)}次`);
        lines.push(`║  ✅ 综合: ${report.verdict.passed ? "PASS" : "GAPS"}`);
        lines.push("╚════════════════════════════════════════════════════╝");
        return lines.join("\n");
    }
    printSummary(report) {
        console.log("\n" + fs.readFileSync(report.summaryPath, "utf-8"));
    }
}
//# sourceMappingURL=panorama-tracker.js.map