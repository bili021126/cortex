// ============================================================
// @cortex/shared —— Cortex 类型中枢（Public API Surface）
//
// 【域分组 barrel export】
//   按业务语义分组而非文件来源。一个源文件的导出可能分布在
//   多个域中，但每个导出符号始终只属于一个域。
//
// 【Public API 契约】
//   所有外部消费者应从 @cortex/shared 导入，禁止子路径导入。
//   新增域分组需同步更新 DOMAINS.md。
//
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
// ============================================================

// ── Agent 域 ──
export {
  AgentType,
  AgentStatus,
  AgentContext,
} from "./agent-enums.js";

export {
  TAG_VOCABULARY,
  AGENT_TAGS,
  AGENT_CHINESE_ROLE,
  CHINESE_NAME_TO_TYPE,
  AGENT_TOOL_PERMISSIONS,
  AGENT_DISPLAY,
  AGENT_DISPLAY_BY_TYPE,
  AGENT_DISPLAY_FALLBACK,
  CHAT_AGENT_ALIASES,
  AGENT_TYPE_TO_DIR,
  AGENT_ALIAS_TO_TYPE,
  getAgentTags,
  getTagVocabulary,
  setAgentTags,
  setAgentToolPermissions,
  setAgentRegistry,
  getAgentToolPermissions,
  resolveAgentPermissions,
  buildChineseRoleMap,
} from "./agent-registry.js";
export type {
  Tag,
  AgentDisplayInfo,
  AgentDisplayEntry,
  AgentDefinition,
} from "./agent-registry.js";

export type {
  SkillKind,
  SkillTemplate,
  FeedbackEntry,
} from "./agent-skill-types.js";

export type {
  AgentConfig,
  MemoryAware,
  Executable,
  AgentPoolLike,
  Agent,
  AgentCapability,
} from "./agent-protocols.js";


// ── Task 域 ──
export type {
  DensityLevel,
  RetrievalScene,
  PersonaId,
  DensityAnnotated,
  EdgeType,
  SubTask,
  DecomposeResult,
  TaskNode,
  NodeResult,
  ImpactScope,
  ReplanResult,
  ExecutionReport,
} from "./task.js";

// ── Memory 域 ──
export {
  LinkType,
  MEMORY_VALID_TRANSITIONS,
} from "./memory.js";
export type {
  MemoryKind,
  SemanticState,
  ReadMode,
  MemorySource,
  MemoryEntry,
  MemoryWriteInput,
  MemoryLink,
  MemoryQuery,
  IMemoryStore,
  MaintainReport,
} from "./memory.js";

// ── Toolkit 域 ──
// 注：工具枚举值（ToolCategory/ReversibilityLevel/TrustLevel 及
// toReversibilityClass/toolNameToRiskDomain/RiskDomain）已单源化至
// @cortex/config（vocabularies/tool-enums.ts），不再从 shared 导出。
export type {
  ToolDefinition,
  ToolInvocation,
  ToolResult,
  ToolHandler,
  Tool,
  ConfirmationRequest,
  ConfirmationResponse,
  IConfirmGate,
  TrustEntry,
  TrustScore,
  ITrustModel,
} from "./toolkit.js";

// ── Event 域 ──
export {
  PipelineEventType,
  PipelinePriority,
} from "./infra.js";
export type {
  EventPayloadMap,
  GovernanceEventPayload,
  ObservableEvent,
  EmittableEvent,
  PipelineHandler,
  EmitMeta,
  IPipelineObserver,
} from "./infra.js";

// ── Infra 域 ──
export type {
  SafeErrorContext,
  SafeErrorReporter,
  InvariantViolation,
  InvariantReporter,
  HandlerErrorContext,
  HandlerErrorReporter,
  LlmMessage,
  LlmToolCall,
  LlmResponse,
  LlmUsage,
  ToolDef,
  LlmAdapterConfig,
  ReasoningEffort,
  ModelCapabilities,
  ChatOptions,
  ICortexLifecycle,
  ICortexChat,
  ICortexTask,
  ICortexMemory,
  ICortexComponents,
  ICortexApi,
  Disposable,
} from "./infra.js";
export type { StrictNonEmptyArray } from "./infra.js";

export type {
  ICommandDispatcher,
  ICommandContext,
  ICommandResult,
} from "./command-dispatcher.js";

// ── Platform 域 ──
export {
  PlatformKind,
} from "./cli-adapter.js";
export type {
  PlatformContext,
  PlatformBridge,
} from "./cli-adapter.js";

export type {
  DirectoryEntry,
  IFileSystemAdapter,
} from "./fs-adapter.js";

export type {
  ITuiEngineBridge,
  IMetaAgent,
} from "./tui-bridge.js";

// ── Lifecycle 域 ──
export {
  LifecyclePhase,
  BaseLifecycle,
} from "./lifecycle.js";
export type {
  ILifecycle,
} from "./lifecycle.js";

// ── Governance 域 ──
export type {
  DocType,
  DocStatus,
  CommitteeType,
  TriggerSource,
  DocInput,
  DocEntry,
  DocRegistryIndex,
} from "./doc-registry.js";

export type {
  AmendmentProposal,
  AmendmentImpact,
  AmendmentSource,
  AmendmentStatus,
  JudgmentVerdict,
  JudgmentResult,
  JudgmentCheck,
  AmendmentApplyResult,
} from "./amendment.js";

export type {
  SerializedSkillRegistry,
} from "./skill-registry.js";

// ── Context 域 ──
export type {
  ConversationMode,
  ConversationPolicy,
  RetrievalPolicy,
  SortMode,
  SortPolicy,
  AssembleTier,
  AssemblePolicy,
  TokenBudget,
  PipelinePolicy,
  ContextPolicy,
} from "./context-policy.js";

// ── File 域 ──
export {
  LockType,
} from "./file-lock-manager.js";
export type {
  IFileLockManager,
  LockEntry,
  FileLockManagerConfig,
} from "./file-lock-manager.js";

// ── Utility 域 ──
export {
  generateId,
  shortId,
} from "./id-utils.js";

export { clamp } from "./math-utils.js";

export {
  extractJsonBlock,
} from "./json-utils.js";

export {
  IndexedRegistry,
} from "./indexed-registry.js";
export type {
  IndexDefinition,
} from "./indexed-registry.js";

export type {
  FactAnchor,
  ModificationRecordItem,
  ModificationSession,
  ModificationRecordV1,
} from "./modification-record.js";

export type {
  ToolCallRecord,
  NodeTrace,
  MemoryEventRecord,
  FileWriteRecord,
  PhaseRecord,
  SkillRecord,
  EventCounts,
  PanoramaSnapshot,
} from "./panorama-types.js";

// ── Scheduler 契约 ──
export type {
  ITaskBoard,
  ISchedulerAgentPool,
  IAgentPool,
  IScheduler,
  IStrategistAgent,
} from "./scheduler-contracts.js";

// ── LLM Service 契约 ──
export type {
  ILlmServiceMessage,
  ILlmServiceResponse,
  ILlmService,
} from "./llm-service.js";

// ── Intent 契约 ──
export type { IntentClarification } from "./intent-clarification.js";
// ============================================================
// @cortex/shared —— Cortex 类型中枢（Public API Surface）
//
// 【Public API】
//   本文件导出的所有类型/枚举/常量为跨包公开契约。
//   所有外部消费者应从 @cortex/shared 导入，非子路径。
//
// 【领域分桶】
//   按包依赖方向分组：agent / task / memory / infra / fs-adapter / toolkit
//   消费者按需只导入需要的桶。
// - toolkit.ts/infra.ts/cli-adapter.ts/file-lock-manager.ts/skill-registry.ts:
//   工具/基础设施/CLI/文件锁/技能注册的辅助类型
// - fs-adapter.ts: 文件系统适配器接口（纳西妲增强建议：解耦 Toolkit 与 Node.js API）
//
// @governance 久岐忍 P1-3：外部端点缺少统一契约文档 → 已闭合
// ============================================================

// @backward-compat Core-2: 通配符 re-export 已在 Core-3 移除。消费方已全部改用具名导入。
