// @ci: unit
/**
 * RLM decompose 拆解引擎 —— 全场景全链路单元测试
 *
 * 覆盖维度:
 *   全场景: shouldDecompose 6 场景 / buildDecomposePrompt 2 场景 /
 *           parseDecomposeResponse 11 场景 / shouldExecuteDecomposition 5 场景 /
 *           decompose 7 场景(含 mock LLM)
 *   全周期: 递归深度 0→1→2→3→超限回退
 *   全链路: shouldDecompose → decompose → parse → shouldExecute 完整通路
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decompose,
  shouldDecompose,
  shouldExecuteDecomposition,
  parseDecomposeResponse,
  buildDecomposePrompt,
  MAX_RLM_DEPTH,
} from "@cortex/engine";
import type { LlmCallable } from "@cortex/engine";

// ── 辅助 ──────────────────────────────────────────────

/** 创建条件满足的 mock LLM */
function mockLlm(json: unknown): LlmCallable {
  return vi.fn<LlmCallable>().mockResolvedValue(JSON.stringify(json));
}

/** 创建会抛异常的 mock LLM */
function mockLlmThrow(): LlmCallable {
  return vi.fn<LlmCallable>().mockRejectedValue(new Error("network error"));
}

/** 长 payload（>200 字确保触发拆解） */
const LONG_PAYLOAD = "A".repeat(250);

/** 短 payload（<200 字不触发拆解） */
const SHORT_PAYLOAD = "Fix typo in file.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════
// shouldDecompose — 复杂度判定（6 场景）
// ════════════════════════════════════════════════════════

describe("shouldDecompose — 复杂度判定", () => {
  it("短 payload 无标签无策略 → false", () => {
    expect(shouldDecompose(SHORT_PAYLOAD, [], undefined)).toBe(false);
  });

  it("长 payload (>200 chars) → true", () => {
    expect(shouldDecompose(LONG_PAYLOAD, [], undefined)).toBe(true);
  });

  it("preferredStrategy='decompose' 无论 payload 长短 → true", () => {
    expect(shouldDecompose(SHORT_PAYLOAD, [], "decompose")).toBe(true);
  });

  it("tags 包含 'analysis' → true", () => {
    expect(shouldDecompose(SHORT_PAYLOAD, ["analysis"], undefined)).toBe(true);
  });

  it("tags 包含 'research' → true", () => {
    expect(shouldDecompose(SHORT_PAYLOAD, ["research"], undefined)).toBe(true);
  });

  it("preferredStrategy='direct' 短 payload → false（策略优先但长度不足）", () => {
    expect(shouldDecompose(SHORT_PAYLOAD, [], "direct")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════
// parseDecomposeResponse — JSON 解析（11 场景）
// ════════════════════════════════════════════════════════

describe("parseDecomposeResponse — JSON 解析", () => {
  // ── 正常 JSON ──
  it("解析标准 JSON 子任务列表", () => {
    const raw = JSON.stringify({
      subTasks: [
        { id: "st-1", description: "分析代码", dependsOn: [], density: "medium", confidence: 0.9 },
        { id: "st-2", description: "重构模块", dependsOn: ["st-1"], density: "heavy", confidence: 0.85 },
      ],
      confidence: 0.88,
      rationale: "两步走",
    });
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(2);
    expect(result.subTasks[0].id).toBe("st-1");
    expect(result.subTasks[1].dependsOn).toEqual(["st-1"]);
    expect(result.confidence).toBe(0.88);
    expect(result.rationale).toBe("两步走");
  });

  it("markdown 代码块包裹的 JSON → 正确提取", () => {
    const raw = '```json\n{"subTasks":[{"id":"st-1","description":"do it","dependsOn":[],"density":"light","confidence":0.95}],"confidence":1.0,"rationale":"atomic"}\n```';
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0].id).toBe("st-1");
  });

  it("markdown 代码块（无 json 标注）→ 正确提取", () => {
    const raw = '```\n{"subTasks":[{"id":"x","description":"y","dependsOn":[],"density":"medium","confidence":0.8}],"confidence":0.9,"rationale":"ok"}\n```';
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0].id).toBe("x");
  });

  it("空 subTasks → confidence 1.0 rationale 默认", () => {
    const raw = JSON.stringify({ subTasks: [], confidence: 1.0, rationale: "已原子化" });
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(0);
    expect(result.confidence).toBe(1.0);
  });

  it("缺少 confidence 字段 → 根据 subTasks 数量推定", () => {
    const raw = JSON.stringify({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 0.9 }] });
    const result = parseDecomposeResponse(raw);
    // 有子任务 → 推定 0.5
    expect(result.confidence).toBe(0.5);
  });

  it("缺少 confidence 字段且空 subTasks → 推定 1.0", () => {
    const raw = JSON.stringify({ subTasks: [] });
    const result = parseDecomposeResponse(raw);
    expect(result.confidence).toBe(1.0);
  });

  it("非法 density 值 → 默认 medium", () => {
    const raw = JSON.stringify({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "UNKNOWN", confidence: 0.9 }], confidence: 0.9 });
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks[0].density).toBe("medium");
  });

  it("confidence 越界 → 裁剪到 [0, 1]", () => {
    const raw = JSON.stringify({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 1.5 }], confidence: -0.5 });
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks[0].confidence).toBe(1.0);
    expect(result.confidence).toBe(0);
  });

  it("JSON 语法错误 → 回退空结果", () => {
    const result = parseDecomposeResponse("not json at all");
    expect(result.subTasks).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("JSON 解析失败");
  });

  it("纯文本但包含 JSON 片段 → 提取大括号内 JSON", () => {
    const raw = 'here is the result: {"subTasks":[{"id":"st-1","description":"x","dependsOn":[],"density":"light","confidence":0.9}],"confidence":0.9,"rationale":"ok"} end of response';
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0].id).toBe("st-1");
  });

  it("LLM 追加额外文字但 JSON 完整 → 提取成功", () => {
    const raw = '{"subTasks":[{"id":"st-1","description":"do it","dependsOn":[],"density":"medium","confidence":0.9}],"confidence":0.9,"rationale":"ok"} some trailing text';
    const result = parseDecomposeResponse(raw);
    expect(result.subTasks).toHaveLength(1);
    expect(result.rationale).toBe("ok");
  });
});

// ════════════════════════════════════════════════════════
// buildDecomposePrompt — 提示词构建（2 场景）
// ════════════════════════════════════════════════════════

describe("buildDecomposePrompt — 提示词构建", () => {
  it("depth=0 → 包含最大深度提示", () => {
    const prompt = buildDecomposePrompt("test payload", 0);
    expect(prompt).toContain(`最大拆解深度: ${MAX_RLM_DEPTH}`);
    expect(prompt).toContain("test payload");
  });

  it("depth=2 → 包含当前深度提示", () => {
    const prompt = buildDecomposePrompt("test payload", 2);
    expect(prompt).toContain(`当前拆解深度: 2/${MAX_RLM_DEPTH}`);
    expect(prompt).toContain("接近上限");
  });
});

// ════════════════════════════════════════════════════════
// shouldExecuteDecomposition — 拆解裁决（5 场景）
// ════════════════════════════════════════════════════════

describe("shouldExecuteDecomposition — 拆解裁决", () => {
  it("confidence < 0.6 → false", () => {
    expect(shouldExecuteDecomposition({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 0.9 }], confidence: 0.5, rationale: "low" })).toBe(false);
  });

  it("空 subTasks → false", () => {
    expect(shouldExecuteDecomposition({ subTasks: [], confidence: 1.0, rationale: "atomic" })).toBe(false);
  });

  it("单个子任务 confidence < 0.8 → false（拆了等于没拆）", () => {
    expect(shouldExecuteDecomposition({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 0.7 }], confidence: 0.9, rationale: "ok" })).toBe(false);
  });

  it("单个子任务 confidence ≥ 0.8 → true", () => {
    expect(shouldExecuteDecomposition({ subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 0.8 }], confidence: 0.9, rationale: "ok" })).toBe(true);
  });

  it("多个子任务 confidence ≥ 0.6 → true", () => {
    expect(shouldExecuteDecomposition({ subTasks: [
      { id: "st-1", description: "x", dependsOn: [], density: "medium", confidence: 0.9 },
      { id: "st-2", description: "y", dependsOn: [], density: "light", confidence: 0.85 },
    ], confidence: 0.8, rationale: "ok" })).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// decompose — 主拆解流程（7 场景，含 mock LLM）
// ════════════════════════════════════════════════════════

describe("decompose — 主拆解流程", () => {
  it("超长 payload LLM 成功返回 → 解析子任务", async () => {
    const llm = mockLlm({
      subTasks: [
        { id: "st-1", description: "step 1", dependsOn: [], density: "medium", confidence: 0.9 },
        { id: "st-2", description: "step 2", dependsOn: ["st-1"], density: "heavy", confidence: 0.85 },
      ],
      confidence: 0.88,
      rationale: "two steps",
    });
    const result = await decompose(llm, "test-model", LONG_PAYLOAD);
    expect(result.subTasks).toHaveLength(2);
    expect(result.confidence).toBe(0.88);
    expect(result.rationale).toBe("two steps");
    expect(llm).toHaveBeenCalledTimes(1);
    // 验证传入的 messages 结构
    const callArgs = (llm as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe("test-model");
    expect(callArgs[1]).toHaveLength(2); // system + user
    expect(callArgs[1][0].role).toBe("system");
    expect(callArgs[1][1].role).toBe("user");
  });

  it("短 payload → 不拆（复杂度不足）", async () => {
    const llm = mockLlm({ subTasks: [], confidence: 1.0 });
    const result = await decompose(llm, "test-model", SHORT_PAYLOAD);
    expect(result.subTasks).toHaveLength(0);
    expect(result.confidence).toBe(1.0);
    expect(result.rationale).toContain("复杂度不足");
    expect(llm).not.toHaveBeenCalled();
  });

  it("depth 超限 → 不拆", async () => {
    const llm = mockLlm({ subTasks: [], confidence: 1.0 });
    const result = await decompose(llm, "test-model", LONG_PAYLOAD, MAX_RLM_DEPTH);
    expect(result.subTasks).toHaveLength(0);
    expect(result.rationale).toContain("最大拆解深度");
    expect(llm).not.toHaveBeenCalled();
  });

  it("depth 刚好等于 MAX_RLM_DEPTH → 不拆", async () => {
    const llm = mockLlm({ subTasks: [], confidence: 1.0 });
    const result = await decompose(llm, "test-model", LONG_PAYLOAD, 3);
    expect(result.subTasks).toHaveLength(0);
    expect(result.rationale).toBe(`已达到最大拆解深度 ${MAX_RLM_DEPTH}，不再拆解`);
  });

  it("depth 临近上限（2/3）→ 正常拆解", async () => {
    const llm = mockLlm({
      subTasks: [{ id: "st-1", description: "x", dependsOn: [], density: "light", confidence: 0.95 }],
      confidence: 0.9,
      rationale: "ok",
    });
    const result = await decompose(llm, "test-model", LONG_PAYLOAD, 2);
    expect(result.subTasks).toHaveLength(1);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("LLM 调用异常 → 回退空结果 confidence=0", async () => {
    const llm = mockLlmThrow();
    const result = await decompose(llm, "test-model", LONG_PAYLOAD);
    expect(result.subTasks).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("LLM 调用失败");
  });

  it("LLM 返回 JSON 解析失败 → 回退空结果", async () => {
    const llm = vi.fn<LlmCallable>().mockResolvedValue("this is not valid JSON {broken");
    const result = await decompose(llm, "test-model", LONG_PAYLOAD);
    expect(result.subTasks).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.rationale).toContain("JSON 解析失败");
  });
});

// ════════════════════════════════════════════════════════
// 全链路集成 —— shouldDecompose → decompose → parse → shouldExecute
// ════════════════════════════════════════════════════════

describe("全链路集成", () => {
  it("长任务 → 检测复杂度 → LLM 拆解 → 解析 → 裁决通过", async () => {
    // 1. 复杂度检测
    expect(shouldDecompose(LONG_PAYLOAD, [], undefined)).toBe(true);

    // 2. LLM 拆解
    const llm = mockLlm({
      subTasks: [
        { id: "st-1", description: "分析需求", dependsOn: [], density: "medium", confidence: 0.9 },
        { id: "st-2", description: "实现代码", dependsOn: ["st-1"], density: "heavy", confidence: 0.85 },
        { id: "st-3", description: "编写测试", dependsOn: ["st-2"], density: "medium", confidence: 0.9 },
      ],
      confidence: 0.85,
      rationale: "标准三步",
    });
    const result = await decompose(llm, "test-model", LONG_PAYLOAD);

    // 3. 解析验证
    expect(result.subTasks).toHaveLength(3);
    expect(result.subTasks[1].dependsOn).toEqual(["st-1"]);

    // 4. 裁决通过
    expect(shouldExecuteDecomposition(result)).toBe(true);
  });

  it("短任务 → 检测不通过 → 跳过 LLM → 裁决不通过", async () => {
    expect(shouldDecompose(SHORT_PAYLOAD, [], undefined)).toBe(false);
    const emptyResult = { subTasks: [], confidence: 1.0, rationale: "短任务不拆" };
    expect(shouldExecuteDecomposition(emptyResult)).toBe(false);
  });

  it("长任务 LLM 异常 → 回退 → 裁决不通过", async () => {
    const llm = mockLlmThrow();
    const result = await decompose(llm, "test-model", LONG_PAYLOAD);
    expect(result.confidence).toBe(0);
    expect(shouldExecuteDecomposition(result)).toBe(false);
  });

  it("maxDepth 全链路：0→1→2→3 每层传递", async () => {
    // depth 0: 正常拆
    const llm0 = mockLlm({
      subTasks: [{ id: "st-1", description: "layer 0", dependsOn: [], density: "medium", confidence: 0.9 }],
      confidence: 0.9,
      rationale: "ok",
    });
    const r0 = await decompose(llm0, "test-model", LONG_PAYLOAD, 0);
    expect(r0.subTasks).toHaveLength(1);

    // depth 1: 正常拆
    const r1 = await decompose(mockLlm({ subTasks: [{ id: "s2", description: "l1", dependsOn: [], density: "light", confidence: 0.95 }], confidence: 0.9, rationale: "ok" }), "test-model", LONG_PAYLOAD, 1);
    expect(r1.subTasks).toHaveLength(1);

    // depth 2: 正常拆
    const r2 = await decompose(mockLlm({ subTasks: [{ id: "s3", description: "l2", dependsOn: [], density: "light", confidence: 0.95 }], confidence: 0.9, rationale: "ok" }), "test-model", LONG_PAYLOAD, 2);
    expect(r2.subTasks).toHaveLength(1);

    // depth 3: 超限不拆
    const r3 = await decompose(mockLlm({ subTasks: [], confidence: 1.0 }), "test-model", LONG_PAYLOAD, 3);
    expect(r3.subTasks).toHaveLength(0);
    expect(r3.rationale).toContain("最大拆解深度");
  });
});
