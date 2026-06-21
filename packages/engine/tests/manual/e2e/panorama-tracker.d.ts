/**
 * PanoramaTracker —— 执行全景记录器
 *
 * 不改 solo-flight.ts 的 S1-S8 流程。只加一层追踪层。
 * 订阅 PipelineObserver 事件 + 拦截 tool 执行回调。
 * 输出结构化 JSON 报告 + 人类可读终端输出。
 */
export interface ToolCallRecord {
    toolName: string;
    params: Record<string, unknown>;
    agentType: string;
    nodeId: string;
    startTime: number;
    endTime: number;
    success: boolean;
    durationMs: number;
}
export interface NodeTrace {
    nodeId: string;
    agentType: string;
    nodeType: string;
    status: "pending" | "claimed" | "running" | "done" | "failed";
    claimedAt: number;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    success: boolean;
    output: string;
    error: string;
    toolCalls: ToolCallRecord[];
    replanCount: number;
}
export interface MemoryEventRecord {
    layer: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
    event: string;
    passed: boolean;
    detail: string;
    timestamp: number;
}
export interface FileWriteRecord {
    filePath: string;
    agentType: string;
    claimedSize: number;
    verified: boolean;
    verifiedSize: number;
    success: boolean;
}
export interface PhaseRecord {
    phase: string;
    label: string;
    startTime: number;
    endTime: number;
    durationMs: number;
    detail: string;
}
export interface SkillRecord {
    skillId: string;
    agentType: string;
    action: "referenced" | "produced";
    detail: string;
}
export interface EventCounts {
    node: number;
    governance: number;
    memory: number;
    skill: number;
    tool: number;
    scheduler: number;
    error: number;
    manifold: number;
    rlm: number;
    context: number;
}
export interface PanoramaReport {
    experiment: string;
    startTime: number;
    endTime: number;
    totalDurationMs: number;
    phases: PhaseRecord[];
    nodes: Record<string, NodeTrace>;
    events: EventCounts;
    memory: MemoryEventRecord[];
    files: FileWriteRecord[];
    skills: SkillRecord[];
    verdict: {
        passed: boolean;
        nodePassRate: string;
        compilePass: boolean | null;
        testPass: boolean | null;
        fileVerifyPass: number;
        fileVerifyTotal: number;
    };
    timelinePath: string;
    eventsPath: string;
    summaryPath: string;
}
export declare class PanoramaTracker {
    private options;
    private _startTime;
    readonly traces: Map<string, NodeTrace>;
    readonly toolCalls: ToolCallRecord[];
    readonly memoryEvents: MemoryEventRecord[];
    readonly fileWrites: FileWriteRecord[];
    readonly skills: SkillRecord[];
    readonly phases: PhaseRecord[];
    private _currentToolCall;
    private _eventCounts;
    private _nodeTimers;
    private _log;
    constructor(options?: {
        logToStderr?: boolean;
    });
    phase(phase: string, label: string, detail?: string): PhaseRecord;
    phaseEnd(phase: string): void;
    nodeClaimed(nodeId: string, agentType: string, nodeType: string): void;
    nodeStarted(nodeId: string): void;
    nodeCompleted(nodeId: string, success: boolean, output: string, error: string): void;
    nodeReplanned(nodeId: string): void;
    toolStarted(agentType: string, nodeId: string, toolName: string, params: Record<string, unknown>): void;
    toolEnded(success: boolean): void;
    private _verifyFileWrite;
    onEvent(event: {
        type?: string;
    }): void;
    memoryEvent(layer: MemoryEventRecord["layer"], event: string, passed: boolean, detail: string): void;
    skillReferenced(skillId: string, agentType: string): void;
    skillProduced(skillId: string, agentType: string, detail: string): void;
    printPhase(phase: string, label: string, content: string): void;
    printNodeTrace(node: NodeTrace): void;
    generateReport(outputDir: string, experiment: string): PanoramaReport;
    private _buildSummary;
    printSummary(report: PanoramaReport): void;
}
//# sourceMappingURL=panorama-tracker.d.ts.map