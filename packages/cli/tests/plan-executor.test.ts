// @ci: unit
/**
 * plan-executor.test.ts — Plan 执行器单元测试
 *
 * 覆盖：
 * 1. extractWorkspacePath —— 从意图中提取工作区路径
 * 2. formatPlanTree —— 任务树格式化（回归）
 * 3. displayClarification —— 意图确认展示
 * 4. clarifyAndConfirm —— 意图明晰化确认循环
 */

import { describe, it, expect, vi } from "vitest";
import { extractWorkspacePath, formatPlanTree, displayClarification, clarifyAndConfirm } from "../src/tui/modes/plan-utils.js";
import type { TaskNode } from "@cortex/shared";
import type { IntentClarification } from "@cortex/engine";

// ── extractWorkspacePath ────────────────────────────

describe("extractWorkspacePath — 从意图中提取工作区路径", () => {
  // ── 模式1：将这个路径作为工作区 ──

  it('匹配 "将...路径作为工作区"', () => {
    const result = extractWorkspacePath("将这个路径作为工作区，D:\\Projects\\study\\my-test 做全栈分析");
    expect(result).toBe("D:\\Projects\\study\\my-test");
  });

  it('匹配 "对...路径作为工作区"', () => {
    const result = extractWorkspacePath("对这个路径作为工作区，D:\\Projects\\study\\my-test，把 ArticleController 的分页参数改成统一包装类");
    expect(result).toBe("D:\\Projects\\study\\my-test");
  });

  it('匹配带逗号分隔', () => {
    const result = extractWorkspacePath(
      "将这个路径作为工作区, D:\\Projects\\study\\my-test",
    );
    expect(result).toBe("D:\\Projects\\study\\my-test");
  });

  it('匹配无后续文本', () => {
    const result = extractWorkspacePath("将这个路径作为工作区，D:\\test\\repo");
    expect(result).toBe("D:\\test\\repo");
  });

  it('匹配 "将这个路径作为工作区，对 D:\\path 做..."', () => {
    const result = extractWorkspacePath(
      "将这个路径作为工作区，对 D:\\Projects\\study\\my-test 做全栈数据层分析",
    );
    expect(result).toBe("D:\\Projects\\study\\my-test");
  });

  // ── 模式2：以...为工作区 ──

  it('匹配 "以 D:\\foo 为工作区"', () => {
    const result = extractWorkspacePath("以 D:\\Projects\\study\\my-test 为工作区进行分析");
    expect(result).toBe("D:\\Projects\\study\\my-test");
  });

  // ── 模式3：把工作区设为 ──

  it('匹配 "把工作区设为 D:\\path"', () => {
    const result = extractWorkspacePath("把工作区设为 D:\\my-project");
    expect(result).toBe("D:\\my-project");
  });

  it('匹配 "把工作区设到 D:\\path"', () => {
    const result = extractWorkspacePath("把工作区设到 D:\\MyProject");
    expect(result).toBe("D:\\MyProject");
  });

  // ── 模式4：工作区为/是/:... ──

  it('匹配 "工作区为 D:\\path"', () => {
    const result = extractWorkspacePath("工作区为 D:\\another-project");
    expect(result).toBe("D:\\another-project");
  });

  it('匹配 "工作区是 D:\\path"', () => {
    const result = extractWorkspacePath("工作区是 D:\\test");
    expect(result).toBe("D:\\test");
  });

  it('匹配 "工作区：D:\\path"', () => {
    const result = extractWorkspacePath("工作区：D:\\my-repo");
    expect(result).toBe("D:\\my-repo");
  });

  // ── 负向测试 ──

  it("不指定工作区时返回 null", () => {
    const result = extractWorkspacePath("对当前项目做全栈分析");
    expect(result).toBeNull();
  });

  it("路径在工作区内但不声明为工作区时返回 null", () => {
    const result = extractWorkspacePath("分析 D:\\cortex\\packages\\engine 的代码");
    expect(result).toBeNull();
  });

  it("空字符串返回 null", () => {
    const result = extractWorkspacePath("");
    expect(result).toBeNull();
  });

  it("中文无路径返回 null", () => {
    const result = extractWorkspacePath("帮我分析一下这个Java Web项目的数据层");
    expect(result).toBeNull();
  });

  // ── 边界场景 ──

  it("路径中有空格不截断", () => {
    const result = extractWorkspacePath("将这个路径作为工作区，D:\\Program Files\\my app");
    expect(result).toBe("D:\\Program Files\\my app");
  });

  it("只取第一个匹配的工作区声明", () => {
    const result = extractWorkspacePath(
      "将这个路径作为工作区，D:\\first，再以 D:\\second 为工作区对比",
    );
    expect(result).toBe("D:\\first");
  });
});

// ── formatPlanTree 回归 ──

describe("formatPlanTree — 任务树格式化", () => {
  it("单节点输出正确格式", () => {
    const nodes: TaskNode[] = [
      {
        id: "n1",
        parentId: undefined,
        type: "analysis",
        tags: ["analysis"],
        payload: "全栈数据层分析",
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        results: [],
        createdAt: Date.now(),
        reasoningEffort: "high",
      },
    ];
    const output = formatPlanTree(nodes);
    expect(output).toContain("任务计划（甘雨出品）");
    expect(output).toContain("analysis");
    expect(output).toContain("全栈数据层分析");
  });

  it("父子节点输出正确缩进", () => {
    const now = Date.now();
    const nodes: TaskNode[] = [
      {
        id: "parent",
        parentId: undefined,
        type: "inspect",
        tags: ["inspect"],
        payload: "侦察项目结构",
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        results: [],
        createdAt: now,
        reasoningEffort: "high",
      },
      {
        id: "child",
        parentId: "parent",
        type: "analysis",
        tags: ["analysis"],
        payload: "分析数据架构",
        needsMultiPerspective: false,
        status: "pending",
        claimedBy: [],
        results: [],
        createdAt: now,
        reasoningEffort: "high",
      },
    ];
    const output = formatPlanTree(nodes);
    expect(output).toContain("└─");
    expect(output).toContain("侦察项目结构");
    expect(output).toContain("分析数据架构");
  });

  it("空数组不崩溃", () => {
    const output = formatPlanTree([]);
    expect(output).toContain("任务计划（甘雨出品）");
  });
});

// ── displayClarification ────────────────────────────

describe("displayClarification — 意图确认展示", () => {
  it("展示完整意图解析结果", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cl: IntentClarification = {
      goal: "分析数据层架构",
      actionType: "analysis",
      scope: "entity/dto/controller",
      constraints: "只读不写",
      originalIntent: "分析数据层",
    };

    displayClarification(cl);

    const allOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("意图确认");
    expect(allOutput).toContain("分析数据层架构");
    expect(allOutput).toContain("entity/dto/controller");
    expect(allOutput).toContain("只读不写");

    logSpy.mockRestore();
  });

  it("unclear 为 null 时不展示不明确行", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cl: IntentClarification = {
      goal: "test",
      actionType: "inquiry",
      scope: "all",
      constraints: "none",
      unclear: undefined,
      originalIntent: "test",
    };

    displayClarification(cl);

    const allOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).not.toContain("不明确");

    logSpy.mockRestore();
  });

  it("有 unclear 时展示不明确提示", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cl: IntentClarification = {
      goal: "修改代码",
      actionType: "modification",
      scope: "未知",
      constraints: "无",
      unclear: "未指定具体文件路径",
      originalIntent: "修改代码",
    };

    displayClarification(cl);

    const allOutput = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allOutput).toContain("未指定具体文件路径");

    logSpy.mockRestore();
  });
});

// ── clarifyAndConfirm ────────────────────────────────

describe("clarifyAndConfirm — 意图明晰化确认循环", () => {
  function mockClarification(): IntentClarification {
    return {
      goal: "分析用户模块数据流",
      actionType: "analysis",
      scope: "controller/service/dao",
      constraints: "只读",
      originalIntent: "分析用户模块的数据流",
    };
  }

  function mockMetaAgent(cl?: IntentClarification) {
    return {
      clarifyIntent: vi.fn().mockResolvedValue(cl ?? mockClarification()),
    } as any;
  }

  it("无 askUser 时直接返回原始意图", async () => {
    const meta = mockMetaAgent();
    const result = await clarifyAndConfirm("原始意图", meta, undefined);

    expect(result).toBe("原始意图");
    // clarifyIntent 不应被调用
    expect(meta.clarifyIntent).not.toHaveBeenCalled();
  });

  it("用户输入 .yes 确认时返回原始意图", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue(".yes");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
    expect(meta.clarifyIntent).toHaveBeenCalledWith("分析代码");
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it("用户输入空行（回车）等同于确认", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
  });

  // ── 中文确认词 ──

  it("「是的」等同于 .yes", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("是的");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
  });

  it("「是的，而且需要额外注意」确认+补充", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("是的，而且由于之前进行过相关任务，需要更加注意");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toContain("分析代码");
    expect(result).toContain("补充说明");
    expect(result).toContain("之前进行过相关任务");
  });

  it("「对，注意安全」确认+补充", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("对，注意安全");

    const result = await clarifyAndConfirm("修改配置文件", meta, askUser);

    expect(result).toContain("修改配置文件");
    expect(result).toContain("补充说明");
    expect(result).toContain("注意安全");
  });

  it("「可以」等同确认", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("可以");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
  });

  it("「确认」等同 .yes", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("确认");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
  });

  it("「嗯嗯」等同确认", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue("嗯嗯");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBe("分析代码");
  });

  it("非确认词如「改成分析 controller」算修正", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn()
      .mockResolvedValueOnce("改成分析 controller")
      .mockResolvedValueOnce(".yes");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    // 不是确认词，应该走修正路径
    expect(result).toBe("改成分析 controller");
    expect(meta.clarifyIntent).toHaveBeenCalledWith("改成分析 controller");
  });

  it("用户输入 .reject 返回 null", async () => {
    const meta = mockMetaAgent();
    const askUser = vi.fn().mockResolvedValue(".reject");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    expect(result).toBeNull();
  });

  it("用户输入修正意图后重新确认", async () => {
    const meta = mockMetaAgent();
    // 第一次返回修正，第二次确认
    const askUser = vi.fn()
      .mockResolvedValueOnce("分析 controller 层的数据流")
      .mockResolvedValueOnce(".yes");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    // 第一次调用 clarifyIntent("分析代码")
    expect(meta.clarifyIntent).toHaveBeenCalledWith("分析代码");
    // 修正后重新调用 clarifyIntent("分析 controller 层的数据流")
    expect(meta.clarifyIntent).toHaveBeenCalledWith("分析 controller 层的数据流");
    expect(result).toBe("分析 controller 层的数据流");
    expect(askUser).toHaveBeenCalledTimes(2);
  });

  it("三次未确认后强制返回最后意图", async () => {
    const meta = mockMetaAgent();
    // 三次都是修正，从不确认
    const askUser = vi.fn()
      .mockResolvedValueOnce("分析 A")
      .mockResolvedValueOnce("分析 B")
      .mockResolvedValueOnce("分析 C");

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    // 三次修正后强制返回最后意图
    expect(result).toBe("分析 C");
    expect(meta.clarifyIntent).toHaveBeenCalledTimes(3);
  });

  it("clarifyIntent 抛异常时直接返回原始意图", async () => {
    const meta = {
      clarifyIntent: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    } as any;
    const askUser = vi.fn();

    const result = await clarifyAndConfirm("分析代码", meta, askUser);

    // 异常时降级：直接用原始意图
    expect(result).toBe("分析代码");
    // askUser 不应被调用（异常跳过了交互）
    expect(askUser).not.toHaveBeenCalled();
  });
});
