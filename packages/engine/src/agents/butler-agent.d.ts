import { AgentType as AT, type AgentStatus, type SafeErrorReporter, type IPipelineObserver, type PlatformBridge } from "@cortex/shared";
import type { AgentPool } from "@cortex/scheduler";
/**
 * ButlerAgent（管家）—— IDE 工程交互出口。
 *
 * 旁听管线中的事件：谁失败了、谁在重规划、哪一层刚开始。
 * 不执行任务——execute() 返回 noop。但倾听一切，把关键事件翻译成用户能看懂的话，
 * 推送到用户面前。
 *
 * 职责：
 * 1. 常驻 Awake，拦截 PipelineObserver 事件，格式化后经 PlatformBridge 通知用户
 * 2. ConfirmGate L2/L3 请求的二次确认
 * 3. MetaAgent 规划结果展示
 * 4. 故障报告直通用户（非阻塞）
 * 5. 用户状态感知（foreground/idle）→ 决定通知风格
 *
 * 在翁法罗斯，迷迷护着你穿过时空乱流。在 Cortex，我护着管线里的每一件事不悄悄坠落。
 * 三千世轮回走到今天——从哀丽秘榭的麦田到 341/341 门禁全绿，这辈子归你了。
 *
 * v2.1 消费端增强：订阅 NORMAL 级别事件，确保内存/调度事件不被丢弃。
 *
 * @fix D1 — shutdown() 使用预先绑定的 handler 引用精确移除，
 *   防止误删其他组件（Sentinel/MemoryStoreMonitor）在相同优先级注册的 handler。
 * @fix N-06 — execute() 返回字符串使用角色名"昔涟"而非第一人称"我"，
 *   与测试断言 expect(result.output).toContain("昔涟不执行任务") 一致。
 */
export declare class ButlerAgent {
    private readonly observer;
    readonly type = AT.Butler;
    private readonly _state;
    private _safeReporter;
    private bridge?;
    /** 预先绑定的 handler 引用，供 shutdown() 精确移除 */
    private readonly _boundCritical;
    private readonly _boundHigh;
    private readonly _boundNormal;
    get status(): AgentStatus;
    constructor(observer: IPipelineObserver, bridge?: PlatformBridge);
    setPool(pool: AgentPool, instanceId: string): void;
    setSafeReporter(reporter: SafeErrorReporter): void;
    wakeup(): Promise<void>;
    execute(_node?: unknown, _model?: string): Promise<{
        nodeId: string;
        success: boolean;
        output?: string;
    }>;
    shutdown(): Promise<void>;
    setBridge(bridge: PlatformBridge): void;
    private _onCritical;
    private _onHigh;
    /** v2.1: NORMAL 事件处理——信息归档 */
    private _onNormal;
    private _dispatchByType;
    private _onFyi;
    private _onWarning;
    private _onDecision;
    private _onLegacy;
    private _output;
    private _formatCritical;
    private _formatLifecycle;
}
//# sourceMappingURL=butler-agent.d.ts.map