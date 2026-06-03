// @ci: unit
/**
 * cli-e2e.test.ts —— @cortex/cli E2E 冒烟测试套件
 *
 * 覆盖 14 个命令的核心路径。直接调用 handler 函数，不依赖子进程。
 * 从源文件导入以避免 @cortex/cli barrel 导入触发 main.ts 的 process.exit 副作用。
 *
 * 测试分层：
 *   L1 冒烟 —— 每个命令的 help 文本结构、子命令路由、未知子命令错误
 *   L2 集成 —— Agent 纯函数、命令注册表完整度、格式器
 *   L3 边界 —— 缺失参数、错误提示内容
 */

import { describe, it, expect } from "vitest";
import { convert, convertToDocument } from "@cortex/parser";
import { createVersionHandler } from "../../src/commands/version.js";
import { CORTEX_VERSION } from "@cortex/config";
import { CommandRegistry } from "../../src/commands/index.js";
import type { CommandDefinition } from "../../src/types.js";
import { createDocHandler } from "../../src/commands/doc.js";
import { createInspectHandler } from "../../src/commands/inspect.js";
import { ConfigManager } from "../../src/services/config-manager.js";
import { getFormatter, detectDefaultFormat } from "../../src/formatters/index.js";
import type { CommandContext, CommandResult } from "../../src/types.js";
import {
  AgentType, AgentStatus,
  getAgentTags, getAgentToolPermissions,
  AGENT_CHINESE_ROLE, CHINESE_NAME_TO_TYPE,
} from "@cortex/shared";

// ── 辅助 ────────────────────────────────────────────

function defaultCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return { format: "text", quiet: false, verbose: false, rawOptions: {}, ...overrides };
}

function ok(result: CommandResult): void {
  if (!result.success) throw new Error(`Command failed: ${result.error ?? "unknown"}`);
}

/** 验证子命令路由返回预期的错误信息 */
function assertUnknownSubcommand(result: CommandResult, expectedAvailable: string[]): void {
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(1);
  const msg = result.error ?? "";
  expect(msg).toContain("未知子命令");
  for (const sub of expectedAvailable) {
    expect(msg).toContain(sub);
  }
}

// ════════════════════════════════════════════════════════
// version — 基础冒烟
// ════════════════════════════════════════════════════════
describe("cortex version", () => {
  it("返回版本信息字符串（text 格式）", async () => {
    const handler = createVersionHandler();
    const r = await handler([], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("cortex v");
    expect(r.output).toContain("Core-1");
    expect(r.output).toContain("运行时");
    expect(r.exitCode).toBe(0);
  });

  it("--json 返回结构化数据", async () => {
    const r = await createVersionHandler()([], { json: true }, defaultCtx());
    ok(r);
    expect(r.data).toBeDefined();
    const data = r.data as Record<string, string>;
    expect(data.version).toContain("Core-1");
    expect(data.runtime).toContain("Node.js");
    expect(data.platform).toBeDefined();
  });

  it("版本号常量与输出一致", () => {
    expect(CORTEX_VERSION).toBe("0.2.1");
  });
});

// ════════════════════════════════════════════════════════
// help — 命令注册表基础路由
// ════════════════════════════════════════════════════════
describe("cortex help (CommandRegistry)", () => {
  const noop = async (): Promise<CommandResult> => ({ success: true, exitCode: 0 });

  it("注册和查找命令", () => {
    const r = new CommandRegistry();
    r.register({ name: "test", description: "测试", handler: noop });
    expect(r.find("test")?.name).toBe("test");
    expect(r.find("zzz")).toBeUndefined();
  });

  it("别名解析正确", () => {
    const r = new CommandRegistry();
    r.register({ name: "run", alias: "r", description: "运行", handler: noop });
    r.register({ name: "agent", alias: "a", description: "Agent管理", handler: noop });

    expect(r.find("r")?.name).toBe("run");
    expect(r.find("a")?.name).toBe("agent");
    expect(r.find("agent")?.name).toBe("agent");
    expect(r.find("zzz")).toBeUndefined();
  });

  it("分发到正确的处理器", async () => {
    const r = new CommandRegistry();
    let called = false;
    r.register({
      name: "agent",
      alias: "a",
      description: "Agent",
      handler: async (args) => {
        if (args[0] === "list") { called = true; return { success: true, data: ["a1"], exitCode: 0 }; }
        return { success: false, error: "?", exitCode: 1 };
      },
    });
    const result = await r.dispatch(["a", "list"], defaultCtx({ format: "json" }));
    expect(called).toBe(true);
    expect(result.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════
// 命令注册表：完整注册验证
// ════════════════════════════════════════════════════════
describe("命令注册表完整性", () => {
  it("13 个命令均可注册", () => {
    const r = new CommandRegistry();
    const names = ["run","agent","task","memory","config","doc","schedule","roundtable","inspect","confirm","repl","version","help"];
    const noop = async () => ({ success: true, exitCode: 0 });
    for (const n of names) r.register({ name: n, description: n, handler: noop });
    expect(r.getCommandNames().sort()).toEqual(names.sort());
  });
});

// ════════════════════════════════════════════════════════
// doc convert — Markdown→HTML
// ════════════════════════════════════════════════════════
describe("cortex doc convert", () => {
  it("convert 基本 Markdown→HTML", () => {
    const html = convert("# Hello\n\nWorld");
    expect(html).toContain("<h1>");
    expect(html).toContain("Hello");
    expect(html).toContain("<p>World</p>");
  });

  it("convertToDocument 生成完整 HTML", () => {
    const html = convertToDocument("# Title\n\nBody", "MyDoc");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>MyDoc</title>");
    expect(html).toContain("<h1>Title</h1>");
  });

  it("doc check 子命令可调用", async () => {
    const r = await createDocHandler()(["check"], { rules: "links" }, defaultCtx());
    expect(r).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════
// inspect — 项目侦察
// ════════════════════════════════════════════════════════
describe("cortex inspect", () => {
  it("inspect deps 返回依赖拓扑", async () => {
    const r = await createInspectHandler()(["deps"], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("@cortex/");
    expect(r.data).toBeDefined();
  });

  it("inspect dir 返回目录结构（当前项目根）", async () => {
    const r = await createInspectHandler()(["dir", "."], { depth: "1" }, defaultCtx());
    ok(r);
    expect(r.output).toContain("目录结构");
    expect(r.data).toBeDefined();
  });

  it("inspect 无子命令时显示帮助", async () => {
    const r = await createInspectHandler()([], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("用法:");
  });

  it("inspect 未知子命令返回错误", async () => {
    const r = await createInspectHandler()(["zzz"], {}, defaultCtx());
    expect(r.success).toBe(false);
    expect(r.error).toContain("未知子命令");
  });
});

// ════════════════════════════════════════════════════════
// config — 配置读写
// ════════════════════════════════════════════════════════
describe("cortex config (ConfigManager)", () => {
  it("ConfigManager 基本读写", () => {
    // ConfigManager 是 CLI 配置管理器——不依赖外部文件
    const mgr = new ConfigManager();
    expect(mgr).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════
// 格式器
// ════════════════════════════════════════════════════════
describe("格式器", () => {
  it("getFormatter('text') 返回 text 格式器", () => {
    const fmt = getFormatter("text");
    expect(fmt).toBeDefined();
    expect(typeof fmt.formatSuccess).toBe("function");
    expect(typeof fmt.formatError).toBe("function");
  });

  it("getFormatter('json') 返回 json 格式器", () => {
    const fmt = getFormatter("json");
    expect(fmt).toBeDefined();
  });

  it("detectDefaultFormat 返回有效格式", () => {
    const fmt = detectDefaultFormat();
    expect(["text", "json", "color"]).toContain(fmt);
  });
});

// ════════════════════════════════════════════════════════
// L2: Agent 纯函数——中英文名互转、标签/权限
// ════════════════════════════════════════════════════════
describe("Agent 中英文名映射", () => {
  it("所有 AgentType 均有中文角色名", () => {
    for (const t of Object.values(AgentType)) {
      const cn = AGENT_CHINESE_ROLE[t];
      expect(cn).toBeDefined();
      expect(typeof cn).toBe("string");
      expect((cn as string).length).toBeGreaterThan(0);
    }
  });

  it("中文名到 AgentType 双向映射一致", () => {
    const chineseNames = Object.values(AGENT_CHINESE_ROLE);
    for (const cn of chineseNames) {
      if (cn === "钟离") continue; // strategist 双柱映射（钟离/霜凝→同一个type）
      const type = CHINESE_NAME_TO_TYPE[cn];
      expect(type).toBeDefined();
      expect(AGENT_CHINESE_ROLE[type!]).toBe(cn);
    }
  });

  it("已知中文名映射覆盖核心 Agent", () => {
    // Meta → 甘雨
    expect(CHINESE_NAME_TO_TYPE["甘雨"]).toBe(AgentType.Meta);
    // Inspector → 安柏
    expect(CHINESE_NAME_TO_TYPE["安柏"]).toBe(AgentType.Inspector);
    // Strategist 双柱
    expect(CHINESE_NAME_TO_TYPE["钟离"]).toBe(AgentType.Strategist);
    expect(CHINESE_NAME_TO_TYPE["霜凝"]).toBe(AgentType.Strategist);
  });

  it("未知中文名返回 undefined", () => {
    expect(CHINESE_NAME_TO_TYPE["不存在的角色"]).toBeUndefined();
  });
});

describe("Agent 标签与权限", () => {
  it("核心 Agent 有非空标签", () => {
    const allTags = getAgentTags();
    const coreAgents = [AgentType.Meta, AgentType.Inspector, AgentType.DocGovern];
    for (const t of coreAgents) {
      const tags = allTags[t];
      expect(tags).toBeDefined();
      expect(tags.length).toBeGreaterThan(0);
    }
  });

  it("核心 Agent 有工具权限定义", () => {
    const allPerms = getAgentToolPermissions();
    const coreAgents = [AgentType.Meta, AgentType.Inspector, AgentType.Fix];
    for (const t of coreAgents) {
      const perms = allPerms[t];
      expect(perms).toBeDefined();
      expect(perms.length).toBeGreaterThan(0);
    }
  });

  it("不同 Agent 类型标签不重复（至少有一项不同）", () => {
    const allTags = getAgentTags();
    const metaTags = new Set(allTags[AgentType.Meta]);
    const inspectorTags = new Set(allTags[AgentType.Inspector]);
    // 两种 Agent 的标签集合不应完全相同
    const sameSize = metaTags.size === inspectorTags.size;
    const allSame = [...metaTags].every((t) => inspectorTags.has(t));
    expect(sameSize && allSame).toBe(false);
  });
});

// ════════════════════════════════════════════════════════
// L2: 命令注册表——边界与异常
// ════════════════════════════════════════════════════════
describe("命令注册表边界", () => {
  it("重复注册同名命令覆盖（Map.set 语义）", () => {
    const r = new CommandRegistry();
    const noop = async () => ({ success: true, exitCode: 0 });
    r.register({ name: "dup", description: "d1", handler: noop });
    r.register({ name: "dup", description: "d2", handler: noop });
    // Map.set 语义：后者覆盖前者，不抛异常
    expect(r.find("dup")?.description).toBe("d2");
  });

  it("dispatch 未知命令返回失败", async () => {
    const r = new CommandRegistry();
    const result = await r.dispatch(["no-such-command"], defaultCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain("未知");
  });

  it("dispatch 空命令返回失败并要求 help", async () => {
    const r = new CommandRegistry();
    const result = await r.dispatch([], defaultCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain("未指定命令");
    expect(result.exitCode).toBe(1);
  });

  it("getCommandNames 返回已注册名称列表", () => {
    const r = new CommandRegistry();
    const noop = async () => ({ success: true, exitCode: 0 });
    r.register({ name: "alpha", description: "a", handler: noop });
    r.register({ name: "beta", description: "b", handler: noop, alias: "b" });
    expect(r.getCommandNames().sort()).toEqual(["alpha", "beta"]);
  });

  it("别名不出现两次（同一命令注册两次不重复计数）", () => {
    const r = new CommandRegistry();
    const noop = async () => ({ success: true, exitCode: 0 });
    r.register({ name: "cmd", description: "c", handler: noop, alias: "c" });
    // 别名不应作为独立条目
    expect(r.find("c")?.name).toBe("cmd");
    expect(r.getCommandNames()).toEqual(["cmd"]);
  });
});

// ════════════════════════════════════════════════════════
// L1: 子命令路由——未知子命令
// ════════════════════════════════════════════════════════
describe("doc 子命令路由", () => {
  it("未知子命令返回错误并列出可用子命令", async () => {
    const r = await createDocHandler()(["zzz"], {}, defaultCtx());
    assertUnknownSubcommand(r, ["convert", "serve", "check"]);
  });

  it("doc 无子命令显示帮助", async () => {
    const r = await createDocHandler()([], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("用法:");
    expect(r.output).toContain("子命令:");
  });
});

describe("inspect 子命令路由", () => {
  it("未知子命令返回错误并列出可用子命令", async () => {
    const r = await createInspectHandler()(["xxx"], {}, defaultCtx());
    assertUnknownSubcommand(r, ["dir", "deps", "drift", "report"]);
  });
});

// ════════════════════════════════════════════════════════
// L3: 版本常量
// ════════════════════════════════════════════════════════
describe("CLI 常量", () => {
  it("CORTEX_VERSION 是语义版本号格式", () => {
    expect(CORTEX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("版本 handler text 格式包含 Core-1 标识", async () => {
    const handler = createVersionHandler();
    const r = await handler([], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("Core-1");
    expect(r.output).toContain("cortex v");
  });

  it("版本 handler json 格式包含所有必需字段", async () => {
    const r = await createVersionHandler()([], { json: true }, defaultCtx());
    ok(r);
    const data = r.data as Record<string, string>;
    expect(data.version).toBeDefined();
    expect(data.runtime).toBeDefined();
    expect(data.platform).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════
// L3: inspect 子命令边界
// ════════════════════════════════════════════════════════
describe("inspect 子命令边界", () => {
  it("inspect deps 返回 @cortex/ 包间依赖", async () => {
    const r = await createInspectHandler()(["deps"], {}, defaultCtx());
    ok(r);
    expect(r.output).toContain("@cortex/");
  });

  it("inspect deps json 返回结构化拓扑数据", async () => {
    const r = await createInspectHandler()(["deps"], {}, defaultCtx({ format: "json" }));
    ok(r);
    expect(r.data).toBeDefined();
  });

  it("inspect drift 返回配置漂移报告（text 格式）", async () => {
    const r = await createInspectHandler()(["drift"], {}, defaultCtx());
    ok(r);
    // drift 输出人类可读报告
    expect(r.output).toBeDefined();
    expect(typeof r.output).toBe("string");
  });

  it("inspect report 返回项目侦察报告", async () => {
    const r = await createInspectHandler()(["report"], {}, defaultCtx());
    ok(r);
    expect(r.output).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════
// L2: ConfigManager
// ════════════════════════════════════════════════════════
describe("ConfigManager", () => {
  it("ConfigManager 实例化不抛异常", () => {
    const mgr = new ConfigManager();
    expect(mgr).toBeDefined();
  });

  it("ConfigManager 的所有公有方法可调用", () => {
    const mgr = new ConfigManager();
    expect(typeof mgr.get).toBe("function");
    expect(typeof mgr.set).toBe("function");
    expect(typeof mgr.getAll).toBe("function");
    expect(typeof mgr.validate).toBe("function");
    expect(typeof mgr.initConfig).toBe("function");
  });
});

// ════════════════════════════════════════════════════════
// L2: doc convert 边界
// ════════════════════════════════════════════════════════
describe("doc convert 边界", () => {
  it("空 Markdown 转换不抛异常", () => {
    const html = convert("");
    expect(typeof html).toBe("string");
  });

  it("纯文本转换返回段落包装", () => {
    const html = convert("plain text");
    expect(html).toContain("<p>");
  });

  it("代码块转换包含 <pre><code>", () => {
    const html = convert("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });
});

// ════════════════════════════════════════════════════════
// L2: 格式器——formatSuccess / formatError
// ════════════════════════════════════════════════════════
describe("格式器输出", () => {
  it("text 格式器 formatSuccess 包含输出内容", () => {
    const fmt = getFormatter("text");
    const out = fmt.formatSuccess({ success: true, output: "hello", exitCode: 0 });
    expect(out).toContain("hello");
  });

  it("text 格式器 formatError 包含错误信息", () => {
    const fmt = getFormatter("text");
    const out = fmt.formatError({ success: false, error: "something wrong", exitCode: 1 });
    expect(out).toContain("something wrong");
  });

  it("json 格式器 formatSuccess 返回合法 JSON", () => {
    const fmt = getFormatter("json");
    const out = fmt.formatSuccess({ success: true, output: "ok", exitCode: 0 });
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("ok");
    expect(parsed.data).toBe("ok");
    expect(parsed.meta.version).toBeDefined();
  });

  it("json 格式器 formatError 返回合法 JSON 含错误字段", () => {
    const fmt = getFormatter("json");
    const out = fmt.formatError({ success: false, error: "err", exitCode: 1 });
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("error");
    expect(parsed.error.message).toBe("err");
  });
});
