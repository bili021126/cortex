// @layer 规划-执行层
// ============================================================
// @cortex/engine — bootstrapEngine() 集成入口（v3.0 插件化）
//
// 原 v2.x 的硬编码装配流水线（createEngineCore / createSpecialAgents /
// createScheduler / initMemoryStore / initConsistencyLayer /
// registerAgents / initSkillSystem）已退化为 PluginLoader.load()。
//
// 流水线（简化）：
//   loadConfig → configAndInject → PluginLoader.load(plugins) → assemble
//
// @refactor v3.0 — 引擎插件化解耦
// ============================================================

import type { AgentManifest, BootstrapResult } from "./factory/index.js";
import { loadConfig, resolveCodingStandards, resolveLlm, injectRegistryFromConfig } from "./load-config.js";
import { enhancePrompts } from "./factory/loaders/agents.loader.js";
import { PromptManager } from "../core/prompt-manager.js";
import { StrategistAgent } from "../agents/strategist-agent.js";
import { ButlerAgent } from "../agents/butler-agent.js";
import { createConfirmGateAgent } from "../agents/confirm-gate-agent.js";
import type { AgentFactoryConfig } from "../execution/agent-factory.js";
// ── Core-2: 新模块 ─────────────────────────────
import { TaskRouter } from "../execution/task-router.js";
import { EnvironmentAwareRouter } from "../execution/environment-aware-router.js";
// bootstrap 层 import planning/ 为装配层正常引用（加载阶段构造引擎容器）
import { SentinelSignalFilter } from "../planning/sentinel-signal-filter.js";
import { GovernanceEventEmitter } from "../planning/governance-events.js";
import { DecisionGateBridge } from "../execution/decision-gate-bridge.js";
import { resilienceFactory } from "../execution/resilience-integration.js";
import { NotificationRuntime } from "../planning/notification-runtime.js";
import { ZeroTokenValidator } from "../execution/zero-token-validator.js";
import { NotificationPipe, NotificationPersistence } from "@cortex/notification";
import type { IModelRouter, PipelineObserver } from "@cortex/scheduler";
// 集中注册：触发全部插件注册至 PluginLoader
import "../plugin/register-all.js";
import { PluginLoader, type EnginePluginLoadConfig } from "@cortex/plugin-runner";
import type { Toolkit } from "@cortex/platform";
import { preloadModel } from "@cortex/memory-store";
import { LoggingPipelineBridge, createLogger, addTransport } from "@cortex/logging";
import type { LlmAdapter } from "@cortex/llm";
import { LlmAdapter as LlmAdapterValue } from "@cortex/llm";
import { WorkerPool } from "../core/worker-pool.js";
import * as os from "node:os";
import * as path from "node:path";
import { PipelineEventType, PipelinePriority, type IFileSystemAdapter, type IMemoryStore, type MemoryEntry, type ObservableEvent, type PipelineHandler, type ReadMode, type TaskNode } from "@cortex/shared";
import { resolveConfigDataDir, ConfigRegistry, registerDefaultDomains, PRESET_ALERT_RULES, isTestEnv, loadConfigDomain, type ConfigFileReader, type EngineConfig } from "@cortex/config";
import { ContextManager } from "@cortex/context-manager";
import { readFileSync, statSync } from "node:fs";
import { initSkillSystem } from "./init-skills.js";
import { LifecycleManager } from "../lifecycle/lifecycle-manager.js";
import { initCyreneMemory } from "./init-memory.js";
import { setJudgeLlmService, setCompressorLlmService, setResolverLlmService } from "@cortex/memory";
import { installConsoleBridge, uninstallConsoleBridge, AuditTrail, MetricCounter, SILENT_THRESHOLD, HealthCollector, alertEngine, telemetryController, TelemetryLevel, setTelemetry, shutdownTelemetry, FileCollector } from "@cortex/telemetry";
import { DegradationBoundary } from "../core/degradation-boundary.js";
import { ShutdownOrchestrator } from "../core/shutdown-orchestrator.js";

// Core-2 Batch1: AgentRegistry 引用——遍历此注册表而非 JSON
import { agentRegistry } from "../registry/agent-registry.js";
export { agentRegistry };

// 插件类型引用
import type { PipelineObserverPlugin } from "../plugin/pipeline-observer.plugin.js";
import type { TaskBoardPlugin } from "../plugin/task-board.plugin.js";
import type { AgentPoolPlugin } from "../plugin/agent-pool.plugin.js";
import type { ConfirmGatePlugin } from "../plugin/confirm-gate.plugin.js";
import type { TrustModelPlugin } from "../plugin/trust-model.plugin.js";
import type { MemoryStorePlugin } from "../plugin/memory-store.plugin.js";
import type { ConsistencyLayerPlugin } from "../plugin/consistency-layer.plugin.js";
import type { MetaAgentPlugin } from "../plugin/meta-agent.plugin.js";
import type { SchedulerPlugin } from "../plugin/scheduler.plugin.js";
import type { ILifecycle } from "@cortex/shared";

// 重导出外部依赖的类型
import type { BootstrapEngineResult } from "./assemble.js";

export type { BootstrapEngineResult };

// §6.0.0c AlertEngine —— 预置规则注入 + 周期检查
//   config 的 PRESET_ALERT_RULES 为声明式（threshold/consecutive），
//   AlertRule 为命令式（condition 回调），此处做声明式 → 命令式适配注入。
//   触发时落 audit.jsonl（degradation 条目）+ observer 发 TeleDegradationThresholdBreached。
// §6.0.0a1 AuditTrail 真实调用点（spec S2-7）
//   config_override：调用方显式传入 engineConfig 覆写默认引擎配置时记录
//   config_violation：配置加载跨字段校验产生的警告（validateCrossField 输出）
function recordBootstrapAudit(
  auditTrail: AuditTrail,
  options: BootstrapEngineOptions,
  config: BootstrapResult,
): void {
  if (options.engineConfig) {
    auditTrail.recordConfigOverride({
      key: "engineConfig",
      source: "bootstrapEngine.options",
      oldValue: "<default>",
      newValue: JSON.stringify(options.engineConfig),
    });
  }
  if (config.warnings.length > 0) {
    auditTrail.recordConfigViolation("cross-field", config.warnings);
  }
}

function setupAlertEngine(auditTrail: AuditTrail, observer: PipelineObserver): NodeJS.Timeout {
  for (const rule of PRESET_ALERT_RULES) {
    alertEngine.addRule({
      metric: rule.metric,
      level: rule.level === "alert" ? TelemetryLevel.ALERT : TelemetryLevel.NOTICE,
      message: rule.message,
      condition: (points) =>
        "consecutive" in rule
          ? points.length >= (rule.consecutive ?? 1)
          : points.some((p) => p.value > rule.threshold),
    });
  }
  return setInterval(() => {
    for (const point of alertEngine.check(telemetryController)) {
      auditTrail.recordDegradation("alert-engine", point.level, point.metric);
      observer.emit({
        type: PipelineEventType.TeleDegradationThresholdBreached,
        priority: PipelinePriority.HIGH,
        payload: {
          timestamp: Date.now(),
          source: `alert:${point.metric}`,
          count: point.value,
          threshold: Number(point.tags.triggeredCount ?? 0),
        },
        timestamp: Date.now(),
        notificationType: "WARNING",
      });
    }
  }, 60_000);
}

export interface BootstrapEngineOptions {
  llms: Map<string, LlmAdapter>;
  toolkit: Toolkit;
  memory?: IMemoryStore;
  dbPath?: string;
  engineConfig?: EngineConfig;
  workspaceRoot?: string;
  filterRead?: (entries: MemoryEntry[], mode: ReadMode) => MemoryEntry[];
  fs?: IFileSystemAdapter;
}

export { resolveLlm };

/**
 * bootstrapEngine —— 从配置文件到运行时引擎的完整启动流水线（v3.0 插件化）。
 *
 * 不再硬编码装配顺序，而是：
 *   1. 加载工厂配置（Agent 定义等）
 *   2. 注册全部插件到 PluginLoader
 *   3. PluginLoader.load() 按拓扑排序加载 → init → postInit → start
 *   4. 取出各插件实例组装 BootstrapEngineResult
 */
export async function bootstrapEngine(
  projectRoot: string,
  options: BootstrapEngineOptions,
): Promise<BootstrapEngineResult> {
  // §1 加载配置
  const config = loadConfig(projectRoot);

  // §1.1 PromptManager —— prompt-kit 编排器接入
  //     同步加载完成后，异步增强 Agent prompt（校验 + 缓存 + 模板渲染）
  //     失败时优雅降级：保留同步加载的原始文本
  const promptManager = new PromptManager(projectRoot);
  try {
    await enhancePrompts(config.agentDefinitions, promptManager);
  } catch (e) {
    // prompt-kit 增强失败不阻断启动——使用同步加载的原始 prompt
    // G1-5: bootstrap 阶段 observer 可能未就绪，console.warn 是故意的——见 G1-5
    console.warn(`[bootstrapEngine] prompt-kit 增强失败，回退到原始 prompt: ${String(e)}`);
  }

  // §1.5 设置 Toolkit 的 workspaceRoot（路径沙箱）
  const wsRoot = options.workspaceRoot ?? projectRoot;
  options.toolkit.setWorkspaceRoot(wsRoot);

  // §1.6 setTelemetry —— 文件遥测默认启用（spec S2-5）
  //   默认落盘 `${workspaceRoot}/.cortex/telemetry.jsonl`；
  //   CORTEX_TELEMETRY_FILE 语义：未设置=默认路径启用；off=禁用文件采集；
  //   其他值=自定义路径。测试环境未显式设置时跳过（防污染仓库，守护测试显式开启）。
  const telemetryFileEnv = process.env.CORTEX_TELEMETRY_FILE;
  const fileTelemetryEnabled = telemetryFileEnv !== "off"
    && (telemetryFileEnv !== undefined || !isTestEnv());
  if (fileTelemetryEnabled) {
    try {
      const telemetryFilePath = telemetryFileEnv
        ? path.resolve(telemetryFileEnv)
        : path.join(wsRoot, ".cortex", "telemetry.jsonl");
      await setTelemetry(new FileCollector(telemetryFilePath));
    } catch (e) {
      process.stderr.write(`[bootstrap] setTelemetry failed（非致命，保留控制台采集）: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  // §2 注入运行时注册表 + 工具元数据
  injectRegistryFromConfig(config.agentDefinitions);
  const codingStandards = resolveCodingStandards(projectRoot);

  // §3 已由 plugin/register-all.js 集中注册完成全部插件注册

  // §4 从 engine-plugins.json 读取插件清单（配置驱动，不再硬编码）
  // E1a：改走 loadConfigDomain（loader 门面 + schema 校验），不再直读文件
  const pluginsDataDir = resolveConfigDataDir();
  const readFileNode: ConfigFileReader = (fp: string) => readFileSync(fp, "utf-8");
  let pluginNames: string[];
  try {
    const loaded = loadConfigDomain<string[]>("enginePlugins", readFileNode, pluginsDataDir);
    pluginNames = loaded ?? [];
  } catch (e) {
    // G1-5: bootstrap 阶段 observer 可能未就绪，console.warn 是故意的——见 G1-5
    console.warn(`[bootstrap] engine-plugins.json 加载失败，使用最小插件集: ${e instanceof Error ? e.message : String(e)}`);
    pluginNames = [];
  }
  const pluginConfig: EnginePluginLoadConfig = {
    plugins: pluginNames,
    engineConfig: options.engineConfig,
    workspaceRoot: wsRoot,
    externals: {
      llms: options.llms,
      toolkit: options.toolkit,
      codingStandards,
      factoryConfig: config,
      dbPath: options.dbPath,
      fs: options.fs,
      memory: options.memory,
    },
    // postInit 钩子：全部插件 init 完成后，执行跨插件织入（Scheduler 注册 Agent）
    onPostInit: async (ctx, plugins) => {
      const schedulerPlugin = plugins.get("scheduler") as SchedulerPlugin | undefined;
      if (schedulerPlugin) {
        await schedulerPlugin.registerAllAgents(ctx);
      }
    },
  };

  // §4.5 Cyrene 记忆层初始化
  const cyreneMemoryPromise = initCyreneMemory().catch((err) => {
    console.warn(`[bootstrap] Cyrene 记忆层初始化失败（非致命）: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  });

  // §5 加载并启动全部插件
  const loader = new PluginLoader();
  const container = await loader.load(pluginConfig);

  // §6 从插件容器中取出组件
  const observer = container.get<PipelineObserverPlugin>("pipelineObserver").getInstance();
  const board = container.get<TaskBoardPlugin>("taskBoard").getInstance();
  const pool = container.get<AgentPoolPlugin>("agentPool").getInstance();
  const gate = container.get<ConfirmGatePlugin>("confirmGate").getInstance();
  const cliAdapter = container.get<ConfirmGatePlugin>("confirmGate").getCliAdapter();
  // 信任模型可选注入——不在插件清单中时静默跳过
  if (container.has("trustModel")) {
    const trustModel = container.get<TrustModelPlugin>("trustModel").getInstance();
    gate.setTrustModel(trustModel);
  }
  const memory = container.get<MemoryStorePlugin>("memoryStore").getInstance();
  const consistencyLayer = container.get<ConsistencyLayerPlugin>("consistencyLayer").getInstance();
  const metaAgent = container.get<MetaAgentPlugin>("metaAgent").getInstance();
  // §6.0a 注入 PromptManager —— MetaAgent 的 planning prompt 走声明式块组装
  metaAgent.setPromptManager(promptManager);
  // §6.0a-1 Phase 3 ContextManager 接线——context-policies 域注册后注入 MetaAgent
  // 接线失败不阻断启动（MetaAgent 保留 tag→策略路由 fallback）
  try {
    const contextRegistry = new ConfigRegistry();
    registerDefaultDomains(contextRegistry);
    metaAgent.setContextManager(new ContextManager(contextRegistry));
  } catch (e) {
    console.warn(`[bootstrap] ContextManager 注入失败（回退 tag→策略路由）: ${String(e)}`);
  }
  const scheduler = container.get<SchedulerPlugin>("scheduler").getInstance();
  const agents = container.get<SchedulerPlugin>("scheduler").getAgents();
  const butler = container.get<SchedulerPlugin>("scheduler").getButler();

  // §6.0 ConsoleBridge —— PipelineObserver 就绪后安装，拦截裸 console
  installConsoleBridge(observer);

  // §6.0b Logging → PipelineObserver 桥接
  //     宪法 §8.1 三档映射：Warn→degraded, Error→degraded, Fatal→fatal
  const _loggingBridge = new LoggingPipelineBridge({
    emit: (event: string) => observer.emit({
      type: PipelineEventType.ErrorReported,
      priority: PipelinePriority.NORMAL,
      payload: { source: "logging-bridge", severity: "warn", error: event },
      timestamp: Date.now(),
      notificationType: "FYI",
    }),
  });
  addTransport(_loggingBridge.createTransport());
  const _bootstrapLogger = createLogger("bootstrap");

  // §6.0.0a Phase 0 遥测基础设施初始化
  const auditTrail = new AuditTrail();
  const metricCounter = new MetricCounter();

  // §6.0.0a1 AuditTrail 真实调用点（spec S2-7）——见 recordBootstrapAudit
  recordBootstrapAudit(auditTrail, options, config);

  // §6.0.0b HealthCollector —— 降级健康聚合
  const healthCollector = new HealthCollector();
  DegradationBoundary.collector = healthCollector;
  // G1-5: bootstrap 阶段 observer 已就绪，注入 DegradationBoundary 使其 handle() 走 observer.emit
  DegradationBoundary._observer = observer;
  // 消除零生产者：降级事件 → audit.jsonl 审计跟踪 + silent 降级 → MetricCounter 计数
  DegradationBoundary._audit = (source, level, errorType) => {
    auditTrail.recordDegradation(source, level, errorType);
  };
  DegradationBoundary._counter = metricCounter;
  metricCounter.startPeriodicFlush(
    60_000, // 每分钟 flush 一次
    (snapshots) => {
      for (const { source, count } of snapshots) {
        if (count >= SILENT_THRESHOLD) {
          observer.emit({
            type: PipelineEventType.TeleDegradationThresholdBreached,
            priority: PipelinePriority.HIGH,
            payload: {
              timestamp: Date.now(),
              source,
              count,
              threshold: SILENT_THRESHOLD,
            },
            timestamp: Date.now(),
            notificationType: "WARNING",
          });
        }
      }
    },
  );

  // §6.0.0c AlertEngine —— 预置规则注入 + 周期检查
  //   config 的 PRESET_ALERT_RULES 为声明式（threshold/consecutive），
  //   AlertRule 为命令式（condition 回调），此处做声明式 → 命令式适配注入。
  //   触发时落 audit.jsonl（degradation 条目）+ observer 发 TeleDegradationThresholdBreached。
  const alertTimer = setupAlertEngine(auditTrail, observer);

  const logger = createLogger("bootstrapEngine");

  // §6.0.1 LifecycleManager —— 拓扑排序关闭（管理 memory/workerPool/container）
  const lifecycleManager = new LifecycleManager(observer);

  // §6.0.2 ShutdownOrchestrator —— 统一关闭编排
  const orchestrator = new ShutdownOrchestrator(observer);

  // ────────────────────────────────────────────────
  // §6.2 Core-2 模块接线——将独立创建的模块接入运行时
  // ────────────────────────────────────────────────

  // §6.2.1 TaskRouter —— 统一策略+模型路由
  // @layer 规划-执行层→规划-执行层：事轴路由组合
  const modelRouter = scheduler.modelRouter;
  const defaultModel = process.env["DEEPSEEK_CHAT_MODEL"] ?? "";
  const taskRouter = modelRouter
    ? new TaskRouter(modelRouter, defaultModel)
    : undefined;

  // §6.2.2 EnvironmentAwareRouter —— 环境感知模型降级
  const envModelPriority = [
    process.env["DEEPSEEK_REASONER_MODEL"] ?? "",
    process.env["DEEPSEEK_CHAT_MODEL"] ?? "",
  ].filter(Boolean);
  // C3 fix: 当所有环境变量为空时回退到硬编码默认模型，避免空优先级列表导致全路由不可用
  if (envModelPriority.length === 0) {
    envModelPriority.push("deepseek-v4-flash");
  }
  const envRouter = new EnvironmentAwareRouter({
    modelPriority: envModelPriority,
    fallbackStrategy: "next-in-priority",
  });

  // §6.2.2a 将 TaskRouter + EnvironmentAwareRouter 组合为调度器模型路由
  //     ExecuteStep/RlmExecuteStep 执行前自动走路由 → 环境感知降级
  // @layer 规划-执行层→规划-执行层：模型路由注入
  if (taskRouter) {
    const compositeRouter: IModelRouter = {
      name: "core-2-composite",
      route: async (node, agentType, _defaultModel) => {
        const decision = await taskRouter.route(node as TaskNode, agentType as string);
        return await envRouter.resolve(decision.model, node as TaskNode);
      },
    };
    scheduler.setModelRouter(compositeRouter);
  }

  // §6.2.3 SentinelSignalFilter —— 哨兵信号分层
  const sentinelFilter = new SentinelSignalFilter({
    deduplicationWindowMs: 5000,
    l3SampleRate: 0.1,
    alertStormThreshold: 10,
  });
  // 订阅 CRITICAL 事件到哨兵，过滤后仅 alert 级别记录遥测
  // @layer 治理层（观察者）→ 治理层：哨兵订阅 CRITICAL 事件
  const sentinelHandler = (event: ObservableEvent): void => {
    const signal = sentinelFilter.filter(event);
    if (signal?.suggestedAction === "alert") {
      void import("@cortex/telemetry").then(({ recordTelemetry }) =>
        recordTelemetry("sentinel.alert", 1, [
          { key: "level", value: signal.level },
          { key: "aggregationKey", value: signal.aggregationKey },
        ]),
      ).catch(err => process.stderr.write(`[bootstrap] sentinel telemetry failed: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  };
  const _registeredHandlers: Array<{ priority: PipelinePriority; handler: PipelineHandler }> = [
    { priority: PipelinePriority.CRITICAL, handler: sentinelHandler },
  ];
  observer.on(PipelinePriority.CRITICAL, sentinelHandler);

  // §6.2.4 NotificationRuntime —— PipelineObserver → NotificationPipe 桥接
  // @layer 治理层→治理层：PipelineObserver → NotificationPipe 桥接
  // S2-10：注入 NotificationPersistence——Urgent/Important 通道磁盘持久化，
  //   重启后未确认通知可恢复（路径约定与 memory-store.plugin 一致）。
  const notificationPipe = new NotificationPipe(
    new NotificationPersistence(`${wsRoot}/.cortex/notifications.db`.replace(/\\/g, "/")),
  );
  // P0-1: 加载事件路由表——factory 已加载 event-routing.json（routeTable key 为 snake_case，
  //       resolve() 对 dotted 事件名取点号最后一段映射，如 "governance.amendment_proposed" → "amendment_proposed"）
  notificationPipe.loadRoutes(config.eventRouting.routeTable);
  const govValidator = new ZeroTokenValidator();
  const notificationRuntime = new NotificationRuntime(observer, notificationPipe, {
    enableTelemetry: true,
    governanceValidator: govValidator,
  });
  notificationRuntime.start();

  // §6.2.5 ResiliencePolicyFactory —— 注册 LLM + 工具韧性策略
  // @role 恢复者——仅执行层调用，注册 llm-call + tool-exec 韧性策略
  resilienceFactory.registerPolicies("llm-call", {
    retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000 },
    circuitBreaker: { threshold: 5, halfOpenAfterMs: 60000 },
    timeout: { timeoutMs: 120000 },
  });
  resilienceFactory.registerPolicies("tool-exec", {
    // R4-C2 fix: maxAttempts=1 防非幂等写操作被重试（write_file/bash 执行两次）
    // 只读操作（L0）失败直接报错，不依赖本层重试
    retry: { maxAttempts: 1, baseDelayMs: 500, maxDelayMs: 5000 },
    circuitBreaker: { threshold: 3, halfOpenAfterMs: 30000 },
    timeout: { timeoutMs: 30000 },
  });
  resilienceFactory.registerPolicies("memory-write", {
    retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000 },
    circuitBreaker: { threshold: 3, halfOpenAfterMs: 30000 },
    timeout: { timeoutMs: 10000 },
  });

  // §6.2.6 GovernanceEventEmitter + DecisionGateBridge
  const governanceEmitter = new GovernanceEventEmitter(observer);
  // @layer 治理层→交互层：权轴桥接
  const decisionBridge = new DecisionGateBridge(observer, gate);
  decisionBridge.start();

  // §6.1 技能系统初始化——不再通过插件，直接在 bootstrap 中装配
  const skillRegistry = await initSkillSystem(
    observer,
    memory,
    metaAgent,
    projectRoot,
  );

  // §7 创建 StrategistAgent（钟离 + 霜凝——Core-2 预留）
  const strategistDefs = config.agentDefinitions.filter((d: AgentManifest) => d.type === "strategist");
  const strategists = new Map<string, StrategistAgent>();
  for (const def of strategistDefs) {
    const agent = new StrategistAgent(
      resolveLlm(options.llms, def.key),
      codingStandards ? def.systemPrompt?.replace(/%%CODING_STANDARDS%%/g, codingStandards) ?? "" : def.systemPrompt ?? "",
    );
    await agent.wakeup();
    strategists.set(def.id, agent);
  }

  // §7.2 创建 ConfirmGate Agent（烟绯）
  const confirmGateDefs = config.agentDefinitions.filter((d: AgentManifest) => d.type === "confirm-gate");
  const confirmGateAgents = new Map<string, AgentFactoryConfig>();
  for (const def of confirmGateDefs) {
    confirmGateAgents.set(def.id, createConfirmGateAgent(def.systemPrompt));
  }

  // §7.1 StrategistAgent 订阅治理事件
  const strategistHandlers: Array<(event: ObservableEvent) => void> = [];
  for (const agent of strategists.values()) {
    const handler = (event: ObservableEvent) => agent.onGovernanceEvent(event);
    observer.on(PipelinePriority.HIGH, handler);
    strategistHandlers.push(handler);
    _registeredHandlers.push({ priority: PipelinePriority.HIGH, handler });
  }

  // §8 确认门接线——Toolkit 需要 ConfirmGate
  options.toolkit.setGate(gate);
  options.toolkit.setObserver(observer);

  // §9 ONNX 模型预热（fire-and-forget）
  preloadModel().catch((err) => {
    observer.emit({
      type: PipelineEventType.MemoryEmbeddingWarmupFailed,
      priority: PipelinePriority.HIGH,
      payload: { error: String(err instanceof Error ? err.message : err) },
      timestamp: Date.now(),
      notificationType: "WARNING",
    });
  });

  // §9.5 WorkerPool —— CPU 密集型操作（JSON 解析）走独立线程
  //        解除对主事件循环的阻塞，防止 Agent 排队超时永不触发
  const workerPool = new WorkerPool({ maxWorkers: Math.max(1, os.cpus().length - 1) });
  LlmAdapterValue.setWorkerPool(workerPool);

  // §9.5.1 注册 ILifecycle 组件
  if (memory && typeof (memory as unknown as ILifecycle).stop === 'function') {
    orchestrator.register("memory", memory as unknown as ILifecycle);
    lifecycleManager.register("memory", memory as unknown as ILifecycle);
  }
  // LifecycleManager 只管理实现了 ILifecycle 的真正组件
  // container / workerPool 不实现 ILifecycle，在 shutdown 中手动关闭
  await lifecycleManager.bootstrap();

  // §9.5.2 等待 Cyrene 记忆层初始化（fire-and-forget 的 await）
  //   RAG 桥接已在 initCyreneMemory() 内完成——manager.deps 指向 ragAddMemory / ragSearchMemoryEntries，
  //   此处仅需 await 确保初始化完成，无需再取用返回的 manager/store。
  await cyreneMemoryPromise;

  // §9.5.3 将主 LLM 适配器注入 Cyrene 三模块（记忆栈 LLM 可插拔化）
  //   resolveLlm(options.llms) 返回第一个适配器（主聊天 LLM），通过 toLlmService()
  //   包装为 ILlmService 契约后注入。注入后 Judge/Compressor/Resolver 走主 LLM 栈，
  //   自动获得熔断/限流/路由/遥测保护。未注入时回退到原 callLLM 行为。
  try {
    const primaryLlm = resolveLlm(options.llms)
    const llmService = primaryLlm.toLlmService()
    setJudgeLlmService(llmService)
    setCompressorLlmService(llmService)
    setResolverLlmService(llmService)
  } catch (e) {
    console.warn(`[bootstrap] Cyrene LLM 服务注入失败（非致命，回退 callLLM）: ${e instanceof Error ? e.message : String(e)}`)
  }

  // §9.6 发射启动完成事件
  observer.emit({
    type: PipelineEventType.ExecLifecyclePhaseChanged,
    priority: PipelinePriority.NORMAL,
    payload: {
      from: "uninitialized",
      to: "running",
      phase: "bootstrap_done",
    },
    timestamp: Date.now(),
    notificationType: "FYI",
  });

  // §10 组装返回
  return {
    scheduler,
    pool,
    observer,
    board,
    gate,
    cliAdapter,
    memory,
    metaAgent,
    butler: butler ?? new ButlerAgent(observer),
    strategists,
    confirmGateAgents,
    skillRegistry,
    config,
    agents,
    consistencyLayer,
    lifecycleManager,
    orchestrator,
    // Core-2 模块
    taskRouter,
    envRouter,
    sentinelFilter,
    governanceEmitter,
    decisionBridge,
    notificationRuntime,
    notificationPipe,
    auditTrail,
    metricCounter,
    healthCollector,
    shutdown: async () => {
      // 先发射关闭开始事件
      observer.emit({
        type: PipelineEventType.ExecLifecyclePhaseChanged,
        priority: PipelinePriority.NORMAL,
        payload: {
          from: "running",
          to: "shutdown",
          phase: "shutdown_start",
        },
        timestamp: Date.now(),
        notificationType: "FYI",
      });
      // 先取消注册的所有 handler，防止长期运行中 handler 累积泄漏
      for (const reg of _registeredHandlers) {
        observer.off(reg.priority, reg.handler);
      }
      // Phase 0 遥测基础设施清理
      metricCounter.stop();
      clearInterval(alertTimer);
      auditTrail.flush();
      // S2-10 补充：停止通知运行时 + 关闭通知持久化连接
      //   NotificationPersistence 持有 .cortex/notifications.db 的 better-sqlite3 句柄，
      //   不关闭则 Windows 下删除工作区目录报 EPERM（memory-persist-restart T4 实测）。
      notificationRuntime.stop();
      notificationPipe.close();
      // MemoryStore 归档——在 shutdown orchestrator close 存储之前先 endSession
      if (memory) {
        try { await memory.endSession(); } catch (err) { logger.error("memory.endSession failed", {}, err instanceof Error ? err : undefined); }
      }
      // ShutdownOrchestrator + LifecycleManager —— 统一关闭
      await orchestrator.shutdown();
      if (memory) {
        try { await memory.close(); } catch (err) { logger.error("memory.close failed", {}, err instanceof Error ? err : undefined); }
      }
      await lifecycleManager.shutdown();
      // WorkerPool —— 终止所有 worker 线程
      workerPool.shutdown();
      // 插件容器关闭（反向顺序 stop 各插件）
      await container.shutdown();
      // 遥测文件采集器 flush 落盘（S2-5——记录在案的 shutdown 时机）
      try {
        await shutdownTelemetry();
      } catch (err) { logger.error("shutdownTelemetry failed", {}, err instanceof Error ? err : undefined); }
      // 最后卸载 ConsoleBridge，恢复原始 console
      uninstallConsoleBridge();
    },
  };
}