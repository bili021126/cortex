import type { Agent, IMemoryStore, IPipelineObserver } from "@cortex/shared";
import { ButlerAgent } from "../agents/butler-agent.js";
import type { IScheduler, IAgentPool, ITaskBoard, ConfirmGate } from "@cortex/scheduler";
import type { CLIAdapter } from "@cortex/platform";
import type { MetaAgent } from "../core/meta-agent.js";
import type { StrategistAgent } from "../agents/strategist-agent.js";
import type { SkillRegistry } from "@cortex/skill-kit";
import type { ConsistencyLayer } from "@cortex/consistency";
import type { BootstrapResult } from "./factory/index.js";
import type { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
import type { TaskRouter } from "../core/task-router.js";
import type { EnvironmentAwareRouter } from "../core/environment-aware-router.js";
import type { SentinelSignalFilter } from "../core/sentinel-signal-filter.js";
import type { GovernanceEventEmitter } from "../core/governance-events.js";
import type { DecisionGateBridge } from "../core/decision-gate-bridge.js";
import type { NotificationRuntime } from "../core/notification-runtime.js";
export interface BootstrapEngineResult {
    scheduler: IScheduler;
    pool: IAgentPool;
    observer: IPipelineObserver;
    board: ITaskBoard;
    gate: ConfirmGate;
    cliAdapter: CLIAdapter;
    memory: IMemoryStore | undefined;
    metaAgent: MetaAgent;
    butler: ButlerAgent;
    strategists: Map<string, StrategistAgent>;
    skillRegistry: SkillRegistry;
    config: BootstrapResult;
    agents: Map<string, Agent>;
    consistencyLayer?: ConsistencyLayer;
    /** LifecycleManager —— 管理非插件 ILifecycle 组件的生命周期 */
    lifecycleManager?: LifecycleManager;
    /** Core-2: TaskRouter —— 统一策略+模型路由 */
    taskRouter?: TaskRouter;
    /** Core-2: EnvironmentAwareRouter —— 环境感知模型降级 */
    envRouter?: EnvironmentAwareRouter;
    /** Core-2: SentinelSignalFilter —— 哨兵信号分层 */
    sentinelFilter?: SentinelSignalFilter;
    /** Core-2: GovernanceEventEmitter —— 治理事件发射器 */
    governanceEmitter?: GovernanceEventEmitter;
    /** Core-2: DecisionGateBridge —— DECISION_REQUIRED → ConfirmGate 桥接 */
    decisionBridge?: DecisionGateBridge;
    /** Core-2: NotificationRuntime —— PipelineObserver → NotificationPipe 桥接 */
    notificationRuntime?: NotificationRuntime;
    /** 优雅关闭——逆序释放所有引擎资源 */
    shutdown(): Promise<void>;
}
export interface AssembleInput {
    scheduler: IScheduler;
    pool: IAgentPool;
    observer: IPipelineObserver;
    board: ITaskBoard;
    gate: ConfirmGate;
    cliAdapter: CLIAdapter;
    memory: IMemoryStore | undefined;
    metaAgent: MetaAgent;
    strategists: Map<string, StrategistAgent>;
    skillRegistry: SkillRegistry;
    config: BootstrapResult;
    agents: Map<string, Agent>;
    consistencyLayer?: ConsistencyLayer;
}
export declare function assemble(input: AssembleInput): BootstrapEngineResult;
//# sourceMappingURL=assemble.d.ts.map