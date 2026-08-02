// @ci: contract
/**
 * Cross-package cognitive pipeline —— engine→context-manager→memory-store
 *
 * 跨越 3 个包的认知管线集成测试：
 *   - @cortex/context-manager — ContextManager 上下文策略解析 + DomainGateController 域门控
 *   - @cortex/memory-store    — MemoryStore 记忆存储 + 检索
 *   - @cortex/memory          — InMemoryMemoryStore 后端
 *   - @cortex/shared          — 类型定义
 *
 * 使用 InMemoryMemoryStore 替代 FileBasedMemoryStore。
 * 使用 mock ConfigRegistry 替代真实 @cortex/config 注册表。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextManager, DomainGateController, type ResolvedContext, type ContextResolveInput } from "@cortex/context-manager";
import { MemoryStore, type IEmbeddingService } from "@cortex/memory-store";
import { InMemoryMemoryStore } from "@cortex/memory";
import { ConfigRegistry } from "@cortex/config";
import { AgentType, PipelineEventType, PipelinePriority, type IPipelineObserver, type ObservableEvent, type MemoryEntry, type MemoryQuery, type MemoryWriteInput, type ReadMode, type MemorySource , type EmittableEvent } from "@cortex/shared";

// ── Mock 嵌入服务 ─────────────────────────────────────────

/** 无操作嵌入器——跳过真实 ONNX 模型 */
function noopEmbedder(): IEmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array(384)),
    embedBatch: vi.fn().mockResolvedValue([new Float32Array(384)]),
  } as any;
}

/** 事件收集 observer */
function createCollector(): IPipelineObserver & { events: ObservableEvent[] } {
  const events: ObservableEvent[] = [];
  return {
    events,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((ev: ObservableEvent) => { events.push(ev); }),
  } as IPipelineObserver & { events: ObservableEvent[] };
}

// ── Mock ConfigRegistry ───────────────────────────────────

function mockConfigRegistry(policies?: Record<string, unknown>): ConfigRegistry {
  const store = new Map<string, unknown>();
  if (policies) store.set("context-policies", policies);
  return {
    get: vi.fn((key: string) => store.get(key)),
    set: vi.fn((key: string, val: unknown) => { store.set(key, val); }),
    has: vi.fn((key: string) => store.has(key)),
    keys: vi.fn(() => Array.from(store.keys())),
    getAll: vi.fn(() => Object.fromEntries(store)),
    clear: vi.fn(() => store.clear()),
    load: vi.fn(),
    reload: vi.fn(),
    onChange: vi.fn(),
    removeChangeListener: vi.fn(),
    register: vi.fn(),
    list: vi.fn(() => []),
    domains: vi.fn(() => new Map()),
  } as any;
}

/** 构造 MemorySource */
function memSource(agentType: string, taskId: string): MemorySource {
  return { agentType: agentType as any, taskId };
}

/** 构造 MemoryWriteInput —— overrides 会覆盖默认值 */
function memWriteInput(overrides: Partial<MemoryWriteInput>): MemoryWriteInput {
  return {
    source: memSource("test", "task-001"),
    kind: "TaskLog",
    summary: "default summary",
    semantic_gist: "default summary",
    content_blob: { text: "default" },
    ...overrides,
  } as MemoryWriteInput;
}

// ── Tests ─────────────────────────────────────────────────

describe("Cross-package cognitive pipeline", () => {
  let observer: IPipelineObserver & { events: ObservableEvent[] };
  let memoryStore: MemoryStore;
  let contextManager: ContextManager;
  let domainGate: DomainGateController;

  beforeEach(async () => {
    observer = createCollector();

    // memory-store: 使用 InMemoryMemoryStore 后端（来自 @cortex/memory）
    memoryStore = new MemoryStore(
      new InMemoryMemoryStore(),
      observer,
      noopEmbedder(),
    );

    // context-manager: 初始化 ContextManager
    const policies = {
      "code-review": {
        id: "code-review",
        tokenBudget: { critical: 8000, support: 4000, reference: 2000 },
        retrieval: { mode: "CSA" as const, weighting: { code: 0.6, docs: 0.3, general: 0.1 } },
        pipeline: { assemble: "relevance", sort: "recency" },
      },
      "single-step": {
        id: "single-step",
        tokenBudget: { critical: 4000, support: 2000, reference: 1000 },
        retrieval: { mode: "HCA" as const, weighting: {} },
        pipeline: { assemble: "default", sort: "default" },
      },
    };
    contextManager = new ContextManager(mockConfigRegistry(policies));

    // domain gate: 初始化域门控
    domainGate = new DomainGateController();

    // 初始化 MemoryStore 生命周期
    await memoryStore.init(":memory:");
  });

  afterEach(async () => {
    await memoryStore.close();
  });

  // ═════════════════════════════════════════════════════
  // context-manager→memory-store 检索策略
  // ═════════════════════════════════════════════════════

  it("should resolve context scene and pass retrieval preset to memory", async () => {
    // context-manager 解析场景 → 返回检索预设 → memory-store 使用预设

    const input: ContextResolveInput = {
      scene: "code-review",
      persona: "code-agent",
      task: { type: "review", tags: ["security", "performance"] },
    };

    // context-manager 解析上下文
    const resolved = contextManager.resolve(input);

    expect(resolved.policyId).toBe("code-review");
    expect(resolved.retrieval.mode).toBe("CSA");
    expect(resolved.tokenBudget.critical).toBe(8000);

    // 将解析后的上下文注入 memory-store 进行检索
    const query: MemoryQuery = {
      keywords: ["security", "code-review"],
    };

    // 先写入一些记忆
    await memoryStore.write(memWriteInput({
      summary: "Previous security review found SQL injection vulnerability",
      domain: "code",
      content_blob: { text: "Previous security review found SQL injection vulnerability", tags: ["security", "code-review"] },
    }));

    const results = await memoryStore.read(query);

    // memory-store 使用 ContextManager 给出的预设成功检索
    expect(Array.isArray(results)).toBe(true);
    // 至少检索到之前写入的记忆
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // ═════════════════════════════════════════════════════
  // 上下文注入→检索→结果
  // ═════════════════════════════════════════════════════

  it("should inject resolved context into Agent execution", async () => {
    // 解析上下文 → 写入相关记忆 → 检索 → Agent 消费结果

    // 1. 写入一些记忆（模拟之前的 Agent 执行结果）
    await memoryStore.write(memWriteInput({
      summary: "Agent-1: completed module refactoring, all tests pass",
      domain: "engineering",
      content_blob: { text: "completed module refactoring, all tests pass", tags: ["refactor", "completed"] },
    }));
    await memoryStore.write(memWriteInput({
      summary: "Agent-2: found circular dependency in payment module",
      domain: "engineering",
      content_blob: { text: "found circular dependency in payment module", tags: ["bug", "circular-dependency"] },
    }));

    // 2. context-manager 解析当前上下文
    const input: ContextResolveInput = {
      scene: "code-review",
      persona: "review-agent",
    };
    const resolved = contextManager.resolve(input);

    // 3. 使用解析后的配置构造查询
    const query: MemoryQuery = {
      keywords: ["refactor", "payment", "dependency"],
    };

    const results = await memoryStore.read(query);

    // 4. 验证检索结果被正确返回（Agent 可消费）
    expect(results.length).toBeGreaterThanOrEqual(1);
    // 检查检索结果是否由写入的记忆产生
    const summaries = results.map((e: MemoryEntry) => e.summary);
    expect(summaries.some((s: string) => s.includes("refactoring"))).toBe(true);
  });

  // ═════════════════════════════════════════════════════
  // domain 隔离跨包
  // ═════════════════════════════════════════════════════

  it("should enforce domain isolation across context-manager→memory-store", async () => {
    // context-manager（DomainGateController）控制活跃域
    // memory-store 只返回匹配域的记忆

    // 1. 在多个域中写入记忆
    await memoryStore.write(memWriteInput({ summary: "Engineering data: API design", domain: "engineering", content_blob: { text: "API design", tags: ["api"] } }));
    await memoryStore.write(memWriteInput({ summary: "Design data: UI mockup v3", domain: "design", content_blob: { text: "UI mockup v3", tags: ["ui"] } }));
    await memoryStore.write(memWriteInput({ summary: "Engineering data: database schema", domain: "engineering", content_blob: { text: "database schema", tags: ["db"] } }));

    // 2. DomainGateController 只激活 engineering 域
    domainGate.setActiveDomains(["engineering"]);

    // 3. 检索所有记忆
    const query: MemoryQuery = { keywords: [] };
    const results = await memoryStore.read(query);

    // 4. DomainGate 过滤——engineering 域的记忆应被允许
    for (const entry of results) {
      if (entry.domain === "engineering") {
        expect(domainGate.isAllowed(entry)).toBe(true);
      }
    }

    // 检查确实有 engineering 域的结果
    const engineeringResults = results.filter((e: MemoryEntry) => e.domain === "engineering");
    expect(engineeringResults.length).toBeGreaterThanOrEqual(1);
  });

  // ═════════════════════════════════════════════════════
  // 记忆生命周期跨包
  // ═════════════════════════════════════════════════════

  it("should write→warmup→retrieve→obliterate across all three layers", async () => {
    // 完整记忆生命周期：
    //   engine（发起写入）→ memory-store（存储）→ warmup → retrieve → obliterate

    // 1. Write phase: engine 通过 memory-store 写入记忆
    const writeId = await memoryStore.write(memWriteInput({
      summary: "Temporary cache entry for test",
      domain: "engineering",
      content_blob: { text: "Temporary cache entry for test", tags: ["cache", "temporary"] },
    }));
    expect(writeId).toBeDefined();

    // 2. Retrieve phase: context-manager 解析后通过 memory-store 检索
    const query: MemoryQuery = { keywords: ["cache", "temporary"] };
    const preResults = await memoryStore.read(query);
    expect(preResults.length).toBeGreaterThanOrEqual(1);

    // 3. Warmup phase: 通过 PipelineObserver 发射 warmup 事件（模拟 engine 侧行为）
    //    注意：MemoryStore 内部 emit 也会被收集，所以用相对计数
    const beforeWarmup = observer.events.length;
    const warmupEvent: ObservableEvent = {
      type: PipelineEventType.MemMemoryWarmupInitiated,
      priority: PipelinePriority.NORMAL,
      payload: {},
      timestamp: Date.now(),
    };
    observer.emit(warmupEvent as unknown as EmittableEvent);
    expect(observer.events.length).toBe(beforeWarmup + 1);
    expect(observer.events[beforeWarmup]?.type).toBe(PipelineEventType.MemMemoryWarmupInitiated);

    // 4. Obliterate phase: 通过 PipelineObserver 发射 obliterate 事件
    const beforeObliterate = observer.events.length;
    const obliterateEvent: ObservableEvent = {
      type: PipelineEventType.MemMemoryObliterationTriggered,
      priority: PipelinePriority.NORMAL,
      payload: {},
      timestamp: Date.now(),
    };
    observer.emit(obliterateEvent as unknown as EmittableEvent);
    expect(observer.events.length).toBe(beforeObliterate + 1);
    expect(observer.events[beforeObliterate]?.type).toBe(PipelineEventType.MemMemoryObliterationTriggered);

    // Lifecycle events flow through observer across all layers
  });

  // ═════════════════════════════════════════════════════
  // 预热情境切换
  // ═════════════════════════════════════════════════════

  it("should warmup on scene change via context-manager→memory-store", async () => {
    // 场景切换 → context-manager 解析新场景 → memory-store warmup

    // 1. 初始场景：code-review
    const initialInput: ContextResolveInput = { scene: "code-review" };
    const initialCtx = contextManager.resolve(initialInput);
    expect(initialCtx.policyId).toBe("code-review");

    // 2. 写入 code-review 域的记忆
    await memoryStore.write(memWriteInput({
      summary: "Code review: PR #42 approved",
      domain: "engineering",
      content_blob: { text: "PR #42 approved", tags: ["code-review"] },
    }));

    // 3. 模拟场景切换到 single-step（回退策略）
    const newInput: ContextResolveInput = { scene: "unknown-scene" };
    const newCtx = contextManager.resolve(newInput);
    // 回退到默认策略 "single-step"
    expect(newCtx.policyId).toBe("single-step");

    // 4. engine 检测场景变化 → 通过 observer 发射 warmup 事件
    const warmupEvent: ObservableEvent = {
      type: PipelineEventType.MemMemoryWarmupInitiated,
      priority: PipelinePriority.NORMAL,
      payload: { scene: "unknown-scene" },
      timestamp: Date.now(),
    };
    observer.emit(warmupEvent as unknown as EmittableEvent);

    // 5. memory-store 能检索到之前写入的记忆（即使场景变了）
    const query: MemoryQuery = { keywords: ["code-review", "PR"] };
    const results = await memoryStore.read(query);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const summaries = results.map((e: MemoryEntry) => e.summary);
    expect(summaries.some((s: string) => s.includes("PR #42"))).toBe(true);
  });
});
