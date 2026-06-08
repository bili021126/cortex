// @ci: unit
// ============================================================
// @cortex/factory — Bootstrap 加载器功能测试
//
// 覆盖三个 loader 和主 bootstrap 流水线的关键路径：
//   1. loadAgentsConfig —— 文件加载、解析、字段校验、prompt 文件解析
//   2. loadCognitionConfig —— 可选文件、默认值回退、校验
//   3. loadDocsConfig —— 可选文件、默认值回退、校验
//   4. bootstrap —— 四阶段流水线集成
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadAgentsConfig } from "../src/loaders/agents.loader.js";
import { loadCognitionConfig } from "../src/loaders/cognition.loader.js";
import { loadDocsConfig } from "../src/loaders/docs.loader.js";
import { bootstrap } from "../src/bootstrap.js";

let tmpDir: string;
let dataDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cortex-factory-test-"));
  dataDir = path.join(tmpDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════

/** 写入单个拆分 JSON 文件到 data/ 目录 */
function writeDataFile(fileName: string, data: unknown) {
  fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(data, null, 2), "utf-8");
}

/** 写入 agents 配置（拆分版——agents.json + event-routing.json） */
function writeAgentsConfig(cfg: Record<string, unknown>) {
  if (cfg.agents) {
    writeDataFile("agents.json", { agents: cfg.agents });
  }
  if (cfg.eventRouting) {
    writeDataFile("event-routing.json", cfg.eventRouting);
  }
  if (cfg.roundtableTemplates !== undefined) {
    writeDataFile("roundtable.json", { templates: cfg.roundtableTemplates });
  }
  if (cfg.tools !== undefined) {
    writeDataFile("tools.json", { tools: cfg.tools });
  }
}

function makeMinimalAgentsConfig() {
  return {
    agents: {
      test_agent: {
        type: "code",
        role: "测试 Agent",
        systemPrompt: "你是一个测试助手",
        produces: ["test_event"],
        model: "deepseek-v4-flash",
        key: "DEEPSEEK_CHAT",
      },
    },
    eventRouting: {
      routeTable: {
        test_event: { channel: "routine", ackRequired: false },
      },
    },
  };
}

// ════════════════════════════════════════════════════════
// agents.loader 测试
// ════════════════════════════════════════════════════════

describe("loadAgentsConfig", () => {
  it("文件不存在 → 抛出 Error", () => {
    expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/加载 agents\.json 失败/);
  });

  it("最小合法配置 → 成功加载", () => {
    writeAgentsConfig(makeMinimalAgentsConfig());
    const config = loadAgentsConfig(tmpDir, dataDir);
    expect(config.agents.test_agent).toBeDefined();
    expect(config.agents.test_agent.type).toBe("code");
    expect(config.agents.test_agent.id).toBe("test_agent");
    expect(config.eventRouting.routeTable.test_event).toBeDefined();
  });

  it("JSON 语法错误 → 抛出 Error", () => {
    fs.writeFileSync(path.join(dataDir, "agents.json"), "{ invalid json }", "utf-8");
    expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/JSON 解析失败/);
  });

  it("缺少 agents 字段 → 抛出 Error", () => {
    // agents.json 存在但缺少 dataKey "agents"
    writeDataFile("agents.json", { not_agents: {} });
    writeDataFile("event-routing.json", { routeTable: {} });
    expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少.*agents.*字段/);
  });

  it("缺少 eventRouting 字段 → 抛出 Error", () => {
    writeDataFile("agents.json", { agents: {} });
    expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/event-routing/);
  });

  it("缺少 routeTable → 抛出 Error", () => {
    writeDataFile("agents.json", { agents: {} });
    writeDataFile("event-routing.json", {});
    expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 routeTable/);
  });

  describe("Agent 字段校验", () => {
    it("缺少 type → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).type;
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 type/);
    });

    it("缺少 role → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).role;
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 role/);
    });

    it("缺少 systemPrompt 且无 systemPromptFile → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).systemPrompt;
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 systemPrompt/);
    });

    it("有 systemPromptFile 但无 systemPrompt → 成功（文件存在时）", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).systemPrompt;
      (cfg.agents.test_agent as any).systemPromptFile = "prompts/test.md";
      const promptDir = path.join(tmpDir, "prompts");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "test.md"), "来自文件的 system prompt", "utf-8");
      writeAgentsConfig(cfg);
      const config = loadAgentsConfig(tmpDir, dataDir);
      expect(config.agents.test_agent.systemPrompt).toBe("来自文件的 system prompt");
    });

    it("systemPromptFile 指向不存在文件 → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).systemPrompt;
      (cfg.agents.test_agent as any).systemPromptFile = "prompts/nonexistent.md";
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/Prompt 文件不存在/);
    });

    it("缺少 model → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).model;
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 model/);
    });

    it("缺少 key → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      delete (cfg.agents.test_agent as any).key;
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/缺少 key/);
    });

    it("produces 不是数组 → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).produces = "not_an_array";
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/produces 必须为数组/);
    });

    it("tags 不是数组 → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).tags = "not_an_array";
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/tags 必须为数组/);
    });

    it("toolPermissions 不是数组 → 抛出 Error", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).toolPermissions = "not_an_array";
      writeAgentsConfig(cfg);
      expect(() => loadAgentsConfig(tmpDir, dataDir)).toThrow(/toolPermissions 必须为数组/);
    });
  });

  describe("prompt 文件解析", () => {
    it("personaPromptFile → 成功加载", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).roundtable = { personaPromptFile: "prompts/persona.md" };
      const promptDir = path.join(tmpDir, "prompts");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "persona.md"), "圆桌角色 prompt", "utf-8");
      writeAgentsConfig(cfg);
      const config = loadAgentsConfig(tmpDir, dataDir);
      expect(config.agents.test_agent.roundtable?.personaPrompt).toBe("圆桌角色 prompt");
    });

    it("planningPromptFile → 成功加载", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).planningPromptFile = "prompts/planning.md";
      const promptDir = path.join(tmpDir, "prompts");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "planning.md"), "计划 prompt", "utf-8");
      writeAgentsConfig(cfg);
      const config = loadAgentsConfig(tmpDir, dataDir);
      expect(config.agents.test_agent.planningPrompt).toBe("计划 prompt");
    });

    it("replanPromptFile → 成功加载", () => {
      const cfg = makeMinimalAgentsConfig();
      (cfg.agents.test_agent as any).replanPromptFile = "prompts/replan.md";
      const promptDir = path.join(tmpDir, "prompts");
      fs.mkdirSync(promptDir, { recursive: true });
      fs.writeFileSync(path.join(promptDir, "replan.md"), "重计划 prompt", "utf-8");
      writeAgentsConfig(cfg);
      const config = loadAgentsConfig(tmpDir, dataDir);
      expect(config.agents.test_agent.replanPrompt).toBe("重计划 prompt");
    });
  });
});

// ════════════════════════════════════════════════════════
// cognition.loader 测试
// ════════════════════════════════════════════════════════

describe("loadCognitionConfig", () => {
  it("文件不存在 → 返回默认空配置", () => {
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect(config.activationMatrix).toEqual([]);
    expect(config.attention.hcaWeight).toBe(0.6);
    expect(config.attention.csaWeight).toBe(0.4);
    expect(config.attention.maxMemoryItems).toBe(20);
  });

  it("合法配置 → 成功加载", () => {
    writeDataFile("cognition.json", {
      activationMatrix: [
        { agentType: "code", hcaWeight: 0.7, csaWeight: 0.3 },
      ],
      attention: { hcaWeight: 0.8, csaWeight: 0.2, maxMemoryItems: 30 },
    });
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect(config.activationMatrix).toHaveLength(1);
    expect(config.activationMatrix[0].agentType).toBe("code");
    expect(config.attention.hcaWeight).toBe(0.8);
    expect(config.attention.maxMemoryItems).toBe(30);
  });

  it("activationMatrix 不是数组 → 回退为 []", () => {
    writeDataFile("cognition.json", {
      activationMatrix: "not_an_array",
    });
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect(config.activationMatrix).toEqual([]);
  });

  it("缺少 attention → 使用默认值", () => {
    writeDataFile("cognition.json", {
      activationMatrix: [],
    });
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect(config.attention.hcaWeight).toBe(0.6);
    expect(config.attention.csaWeight).toBe(0.4);
  });

  it("attention 部分字段缺失 → 补全默认值", () => {
    writeDataFile("cognition.json", {
      activationMatrix: [],
      attention: { hcaWeight: 0.9 },
    });
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect(config.attention.hcaWeight).toBe(0.9);
    expect(config.attention.csaWeight).toBe(0.4); // 默认
    expect(config.attention.maxMemoryItems).toBe(20); // 默认
  });

  it("activationMatrix 项缺少 agentType → 抛出 Error", () => {
    writeDataFile("cognition.json", {
      activationMatrix: [{ hcaWeight: 0.7 }],
    });
    expect(() => loadCognitionConfig(tmpDir, dataDir)).toThrow(/缺少 agentType/);
  });

  it("content-negotiation 字段保留不丢失", () => {
    writeDataFile("cognition.json", {
      activationMatrix: [],
      "content-negotiation": { strategy: "round_robin" },
    });
    const config = loadCognitionConfig(tmpDir, dataDir);
    expect((config as any)["content-negotiation"]).toEqual({ strategy: "round_robin" });
  });
});

// ════════════════════════════════════════════════════════
// docs.loader 测试
// ════════════════════════════════════════════════════════

describe("loadDocsConfig", () => {
  it("文件不存在 → 返回默认配置", () => {
    const config = loadDocsConfig(tmpDir, dataDir);
    expect(config.constitutionPath).toBe("docs/Cortex 概念顶层设计 v2.5.md");
    expect(config.docRegistry).toEqual([]);
  });

  it("合法配置 → 成功加载", () => {
    writeDataFile("docs.json", {
      constitutionPath: "docs/my-constitution.md",
      docRegistry: [
        { path: "docs/design.md", refreshOnBoot: true },
      ],
    });
    const config = loadDocsConfig(tmpDir, dataDir);
    expect(config.constitutionPath).toBe("docs/my-constitution.md");
    expect(config.docRegistry).toHaveLength(1);
    expect(config.docRegistry[0].path).toBe("docs/design.md");
  });

  it("缺少 constitutionPath → 使用默认值", () => {
    writeDataFile("docs.json", { docRegistry: [] });
    const config = loadDocsConfig(tmpDir, dataDir);
    expect(config.constitutionPath).toBe("docs/Cortex 概念顶层设计 v2.5.md");
  });

  it("docRegistry 不是数组 → 回退为 []", () => {
    writeDataFile("docs.json", { docRegistry: "not_an_array" });
    const config = loadDocsConfig(tmpDir, dataDir);
    expect(config.docRegistry).toEqual([]);
  });

  it("docRegistry 项缺少 path → 抛出 Error", () => {
    writeDataFile("docs.json", {
      docRegistry: [{ refreshOnBoot: true }],
    });
    expect(() => loadDocsConfig(tmpDir, dataDir)).toThrow(/缺少 path/);
  });
});

// ════════════════════════════════════════════════════════
// bootstrap 集成测试
// ════════════════════════════════════════════════════════

describe("bootstrap 主流水线", () => {
  it("最小合法配置 → 返回 BootstrapResult", () => {
    writeAgentsConfig(makeMinimalAgentsConfig());
    const result = bootstrap(tmpDir, dataDir);
    expect(result.agentDefinitions).toHaveLength(1);
    expect(result.agentDefinitions[0].id).toBe("test_agent");
    expect(result.eventRouting.routeTable.test_event).toBeDefined();
    expect(result.cognition.activationMatrix).toEqual([]); // 文件不存在 → 默认
    expect(result.docs.docRegistry).toEqual([]); // 文件不存在 → 默认
    expect(result.warnings).toBeDefined();
  });

  it("cortex-agents.json 不存在 → 抛出 Error", () => {
    expect(() => bootstrap(tmpDir, dataDir)).toThrow(/cortex-agents\.json/);
  });

  it("跨字段校验失败 → 拒绝启动", () => {
    const cfg = makeMinimalAgentsConfig();
    // agent produces 但 routeTable 缺少对应路由
    cfg.agents.test_agent.produces = ["code_changed", "unrouted_event"];
    writeAgentsConfig(cfg);
    expect(() => bootstrap(tmpDir, dataDir)).toThrow(/跨字段校验失败/);
  });

  it("有 cognition 和 docs 配置 → 全部加载", () => {
    writeAgentsConfig(makeMinimalAgentsConfig());
    writeDataFile("cognition.json", {
      activationMatrix: [{ agentType: "code" }],
    });
    writeDataFile("docs.json", {
      docRegistry: [{ path: "docs/test.md" }],
    });
    const result = bootstrap(tmpDir, dataDir);

    expect(result.cognition.activationMatrix).toHaveLength(1);
    expect(result.docs.docRegistry).toHaveLength(1);
  });

  it("roundtableTemplates 和 tools 可选字段 → 正确处理", () => {
    const cfg = makeMinimalAgentsConfig() as any;
    cfg.roundtableTemplates = [
      { name: "code-review", description: "代码审阅", personas: 4, rounds: 3, agents: ["刻晴"] },
    ];
    cfg.tools = { knownTools: ["read_file", "write_file"] };
    writeAgentsConfig(cfg);

    const result = bootstrap(tmpDir, dataDir);
    expect(result.roundtableTemplates).toHaveLength(1);
    expect(result.tools).toBeDefined();
    expect(result.tools!.knownTools).toContain("write_file");
  });

  it("无 roundtableTemplates → 默认为空数组", () => {
    writeAgentsConfig(makeMinimalAgentsConfig());
    const result = bootstrap(tmpDir, dataDir);
    expect(result.roundtableTemplates).toEqual([]);
  });
});
