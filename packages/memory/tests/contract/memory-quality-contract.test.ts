// @ci: contract
// ============================================================
// @cortex/memory — Cyrene 记忆质量四件套契约测试
//
// 全量图景审计发现：MemoryJudge / MemoryCompressor / MemoryResolver /
// MemoryScheduler 零直接测试覆盖——记忆质量机制无验证（eval 真空）。
// 本文件为四件套提供最小契约：规则过滤、调度周期、LLM 输出规范化。
// 全部使用 mock LLM / mock deps，零 API 费用、零磁盘污染。
// ============================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MemoryJudge,
  setJudgeLlmService,
  setJudgeModelPath,
  MemoryScheduler,
  resolvePayload,
  type ResolverPayload,
  type L1Profile,
  type MemoryCandidate,
  type MemoryJudgeTurn,
  type MemoryConflictResolution,
} from "@cortex/memory/cyrene";
import type { ILlmService } from "@cortex/shared";

// ── Mock LLM Service ─────────────────────────────────

function mockLlmService(respond: () => string): ILlmService {
  return {
    chat: async () => ({ text: respond() }),
  } as unknown as ILlmService;
}

const TMP_SETTINGS = path.join(os.tmpdir(), `cortex-mem-settings-${Date.now()}.json`);

beforeEach(() => {
  fs.writeFileSync(TMP_SETTINGS, JSON.stringify({ apiKey: "test-key", model: "deepseek-v4-flash" }), "utf-8");
  setJudgeModelPath(TMP_SETTINGS);
});

afterAll(() => {
  setJudgeLlmService(null);
  try { fs.unlinkSync(TMP_SETTINGS); } catch { /* ok */ }
});

// ═══════════════════════════════════════════════════════
// 1. MemoryJudge —— LLM 输出 → 候选提取/过滤契约
// ═══════════════════════════════════════════════════════

describe("MemoryJudge 契约：候选提取与规则过滤", () => {
  it("合法 L2 候选被提取（shouldWrite=true 通过）", async () => {
    setJudgeLlmService(mockLlmService(() => JSON.stringify([
      {
        layer: "L2",
        summary: "用户最近在学 TypeScript",
        importance: "medium",
        stability: "situational",
        certainty: "explicit",
        attribution: "user_explicit",
        evidenceQuotes: ["我最近在学 TypeScript"],
        contextSummary: "用户提到近期学习计划",
        shouldWrite: true,
        reason: "近期状态值得记录",
        forbiddenOverclaims: [],
      },
    ])));

    const judge = new MemoryJudge();
    const turns: MemoryJudgeTurn[] = [
      { userInput: "我最近在学 TypeScript", assistantReply: "很不错的学习计划" },
    ];
    const candidates = await judge.judgeRecentTurns(turns, "contract-test");
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.layer).toBe("L2");
    expect(candidates[0]!.content).toContain("TypeScript");
    expect(candidates[0]!.confidence).toBe(0.9); // explicit → 0.9
  });

  it("无值得记录的信息时返回空数组", async () => {
    setJudgeLlmService(mockLlmService(() => "[]"));
    const judge = new MemoryJudge();
    const candidates = await judge.judgeRecentTurns(
      [{ userInput: "今天天气不错", assistantReply: "是啊" }],
      "contract-test",
    );
    expect(candidates).toEqual([]);
  });

  it("L0 候选必须是 explicit + user_explicit——inferred 被过滤", async () => {
    setJudgeLlmService(mockLlmService(() => JSON.stringify([
      {
        layer: "L0",
        field: "preferredName",
        summary: "用户可能喜欢被叫宝宝",
        importance: "high",
        stability: "stable",
        certainty: "inferred",
        attribution: "assistant_inferred",
        evidenceQuotes: ["叫我宝宝"],
        contextSummary: "AI 推测的称呼偏好",
        shouldWrite: true,
        reason: "推测信息",
        forbiddenOverclaims: [],
      },
    ])));

    const judge = new MemoryJudge();
    const candidates = await judge.judgeRecentTurns(
      [{ userInput: "嗯", assistantReply: "好呀宝宝" }],
      "contract-test",
    );
    // inferred 不允许进 L0 → 整条被过滤
    expect(candidates).toEqual([]);
  });

  it("shouldWrite=false 的候选被过滤", async () => {
    setJudgeLlmService(mockLlmService(() => JSON.stringify([
      {
        layer: "L2",
        summary: "用户提到过一次加班",
        importance: "low",
        stability: "one_off",
        certainty: "explicit",
        attribution: "user_explicit",
        evidenceQuotes: ["昨晚加班了"],
        contextSummary: "一次性状态",
        shouldWrite: false,
        reason: "一次性状态不值得记",
        forbiddenOverclaims: [],
      },
    ])));

    const judge = new MemoryJudge();
    const candidates = await judge.judgeRecentTurns(
      [{ userInput: "昨晚加班了", assistantReply: "辛苦了" }],
      "contract-test",
    );
    expect(candidates).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════
// 2. MemoryScheduler —— 记忆维护调度周期契约
// ═══════════════════════════════════════════════════════

function makeL1(roundCount: number): L1Profile {
  return {
    recentGoals: "",
    recentPreferences: "",
    currentProject: "",
    generatedAt: 0,
    roundCount,
  };
}

function makeScheduler() {
  const calls = {
    ingestEntity: vi.fn(),
    judgeMemory: vi.fn<() => Promise<MemoryCandidate[]>>(async () => []),
    writeMemory: vi.fn<() => Promise<void>>(async () => undefined),
    getL1: vi.fn(async () => makeL1(0)),
    replaceL1Field: vi.fn(async () => undefined),
    runReflectionAndCompression: vi.fn(async () => undefined),
    runResolverQueueOnce: vi.fn(async () => ({ status: "skip" })),
    enqueueTask: vi.fn(async (_label: string, task: () => Promise<unknown>) => task()),
  };
  const scheduler = new MemoryScheduler(calls);
  return { scheduler, calls };
}

describe("MemoryScheduler 契约：维护周期触发", () => {
  it("每 6 轮触发一次 MemoryJudge + 写入选中的候选", async () => {
    const { scheduler, calls } = makeScheduler();
    calls.judgeMemory.mockResolvedValue([
      { layer: "L2", content: "用户最近在学 Rust", confidence: 0.9, triggerText: "学 Rust" },
    ]);
    calls.getL1.mockResolvedValue(makeL1(5)); // newCount = 6 → judge

    scheduler.scheduleMemoryWrite("我最近在学 Rust", "加油！");

    await vi.waitFor(() => {
      expect(calls.judgeMemory).toHaveBeenCalledTimes(1);
    });
    expect(calls.writeMemory).toHaveBeenCalledTimes(1);
    expect(calls.replaceL1Field).toHaveBeenCalledWith("roundCount", 6);
  });

  it("judge 无候选时不写入", async () => {
    const { scheduler, calls } = makeScheduler();
    calls.getL1.mockResolvedValue(makeL1(5)); // newCount = 6 → judge

    scheduler.scheduleMemoryWrite("随便聊聊", "嗯嗯");

    await vi.waitFor(() => {
      expect(calls.judgeMemory).toHaveBeenCalledTimes(1);
    });
    expect(calls.writeMemory).not.toHaveBeenCalled();
  });

  it("每 5 轮触发一次 Resolver 队列处理", async () => {
    const { scheduler, calls } = makeScheduler();
    calls.getL1.mockResolvedValue(makeL1(4)); // newCount = 5 → resolver

    scheduler.scheduleMemoryWrite("普通对话", "回复");

    await vi.waitFor(() => {
      expect(calls.runResolverQueueOnce).toHaveBeenCalledTimes(1);
    });
  });

  it("每 20 轮触发一次 Reflection + 压缩", async () => {
    const { scheduler, calls } = makeScheduler();
    calls.getL1.mockResolvedValue(makeL1(19)); // newCount = 20 → reflection

    scheduler.scheduleMemoryWrite("普通对话", "回复");

    await vi.waitFor(() => {
      expect(calls.runReflectionAndCompression).toHaveBeenCalledTimes(1);
    });
  });
});

// ═══════════════════════════════════════════════════════
// 3. MemoryResolver —— LLM 冲突解决输出规范化契约
// ═══════════════════════════════════════════════════════

function makeResolverPayload(): ResolverPayload {
  return {
    conflictLog: {
      id: "c1", createdAt: 0, status: "pending",
      sourceL2Id: "n1", targetL2Id: "o1",
      reason: "记忆冲突", confidence: 0.9, detector: "local",
    },
    newMemory: {
      id: "n1", content: "用户喜欢喝咖啡", triggerText: "", sourceConversationId: "s",
      createdAt: 0, lastAccessedAt: 0, accessCount: 0, weight: 1, isPinned: false, status: "active",
    },
    oldMemory: {
      id: "o1", content: "用户讨厌喝咖啡", triggerText: "", sourceConversationId: "s",
      createdAt: 0, lastAccessedAt: 0, accessCount: 0, weight: 1, isPinned: false, status: "active",
    },
    newEvidence: [],
    oldEvidence: [],
    conflictScore: 0.9,
    scoringSignals: { correctionIntent: true },
  };
}

describe("MemoryResolver 契约：resolvePayload 输出规范化", () => {
  it("合法 LLM JSON 被规范化为 MemoryConflictResolution", async () => {
    const deps = {
      callLLM: async () => JSON.stringify({
        resolutionType: "preference_evolution",
        reason: "用户偏好发生了变化",
        confidence: 0.8,
        actions: {
          createResolvedMemory: true,
          oldMemoryStatus: "archived",
          newMemoryStatus: "merged",
          shouldUpdateCoreMemory: false,
          shouldAskUser: false,
          clarificationNeeded: false,
        },
      }),
    };

    const resolution = await resolvePayload(makeResolverPayload(), deps);
    expect(resolution.resolutionType).toBe("preference_evolution");
    expect(resolution.reason).toBe("用户偏好发生了变化");
    expect(resolution.confidence).toBe(0.8);
    expect(resolution.actions.createResolvedMemory).toBe(true);
    expect(resolution.actions.oldMemoryStatus).toBe("archived");
    expect(resolution.actions.newMemoryStatus).toBe("merged");
  });

  it("非法 resolutionType 被拒绝并抛错", async () => {
    const deps = {
      callLLM: async () => JSON.stringify({
        resolutionType: "not_a_real_type",
        reason: "无效类型",
        confidence: 0.5,
        actions: {},
      }),
    };

    await expect(resolvePayload(makeResolverPayload(), deps)).rejects.toThrow("invalid resolver json");
  });
});
