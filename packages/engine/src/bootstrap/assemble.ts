// @layer 规划-执行层
// ============================================================
// @cortex/engine/bootstrap/assemble —— 最终组装 BootstrapResult
// ============================================================

import type { Agent, IMemoryStore, IPipelineObserver, Disposable } from "@cortex/shared";
import { ButlerAgent } from "../agents/butler-agent.js";
import type { IScheduler, IAgentPool, ITaskBoard, ConfirmGate } from "@cortex/scheduler";
import type { CLIAdapter } from "@cortex/platform";
import type { MetaAgent } from "../core/meta-agent.js";
import type { StrategistAgent } from "../agents/strategist-agent.js";
import type { AgentFactoryConfig } from "../execution/agent-factory.js";
import type { SkillRegistry } from "@cortex/skill-kit";
import type { ConsistencyLayer } from "@cortex/governance";
import type { BootstrapResult } from "./factory/index.js";
import type { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
import type { ShutdownOrchestrator } from "../core/shutdown-orchestrator.js";
import type { AuditTrail, MetricCounter, HealthCollector } from "@cortex/telemetry";
import { DegradationBoundary } from "../core/degradation-boundary.js";
// ── Core-2 模块 ──
import type { TaskRouter } from "../execution/task-router.js";
import type { EnvironmentAwareRouter } from "../execution/environment-aware-router.js";
import type { SentinelSignalFilter } from "../planning/sentinel-signal-filter.js";
import type { GovernanceEventEmitter } from "../planning/governance-events.js";
import type { DecisionGateBridge } from "../execution/decision-gate-bridge.js";
import type { NotificationRuntime } from "../planning/notification-runtime.js";
import type { NotificationPipe } from "@cortex/notification";

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
  /** ConfirmGate Agent 工厂配置映射 */
  confirmGateAgents?: Map<string, AgentFactoryConfig>;
  skillRegistry: SkillRegistry;
  config: BootstrapResult;
  agents: Map<string, Agent>;
  consistencyLayer?: ConsistencyLayer;
  /** LifecycleManager —— 管理非插件 ILifecycle 组件的生命周期 */
  lifecycleManager?: LifecycleManager;
  /** ShutdownOrchestrator —— 统一关闭编排 */
  orchestrator?: ShutdownOrchestrator;
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
  /** S2-10: NotificationPipe —— 四通道通知管线（含磁盘持久化），供消费端订阅/应答 */
  notificationPipe?: NotificationPipe;
  /** Phase 0: AuditTrail —— 审计跟踪 */
  auditTrail?: AuditTrail;
  /** Phase 0: MetricCounter —— 内存遥测计数器 */
  metricCounter?: MetricCounter;
  /** Phase 0: HealthCollector —— 降级健康聚合（真实数据源，供健康端点读取） */
  healthCollector?: HealthCollector;
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

export function assemble(input: AssembleInput): BootstrapEngineResult {
  const butler = new ButlerAgent(input.observer);

  const shutdown = async (): Promise<void> => {
    // 逆序释放资源——各组件以 best-effort 关闭，未实现的方法静默跳过
    try { (input.scheduler as unknown as Disposable).stop?.(); } catch (err) { DegradationBoundary.handle(err, 'assemble', 'trace'); }
    try { (input.pool as unknown as Disposable).destroyAll?.(); } catch (err) { DegradationBoundary.handle(err, 'assemble', 'trace'); }
    try { (input.observer as unknown as Disposable).clear?.(); } catch (err) { DegradationBoundary.handle(err, 'assemble', 'trace'); }
    try { await input.memory?.close(); } catch (err) { console.error(`[assemble] memory.close_failed`, err); }
    try { (input.gate as unknown as Disposable).dispose?.(); } catch (err) { console.error(`[assemble] gate.dispose_failed`, err); }
    try { input.cliAdapter.close?.(); } catch (err) { console.error(`[assemble] cliAdapter.close_failed`, err); }
  };

  return {
    scheduler: input.scheduler,
    pool: input.pool,
    observer: input.observer,
    board: input.board,
    gate: input.gate,
    cliAdapter: input.cliAdapter,
    memory: input.memory,
    metaAgent: input.metaAgent,
    butler,
    strategists: input.strategists,
    skillRegistry: input.skillRegistry,
    config: input.config,
    agents: input.agents,
    consistencyLayer: input.consistencyLayer,
    shutdown,
  };
}
