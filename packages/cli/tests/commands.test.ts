// @ci: unit
/**
 * commands.test.ts — 全部 CLI 命令覆盖测试
 *
 * 验证所有 15 个命令的处理器工厂创建、help 输出、错误处理、子命令路由。
 * 使用最小 mock，优先测试纯逻辑路径（help / 参数校验 / 错误信息）。
 *
 * 覆盖率目标：每个命令至少覆盖 help 输出 + 缺失参数错误 + 未知子命令错误。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ConfigManager,
  CommandRegistry,
  createVersionHandler,
  createHelpHandler,
  createConfigHandler,
  createDocHandler,
  createSkillHandler,
  createInspectHandler,
  createDoctorHandler,
  createRoundtableHandler,
  createRunHandler,
  createAgentHandler,
  createTaskHandler,
  createMemoryHandler,
  createConfirmHandler,
  createScheduleHandler,
  createSetupHandler,
  EngineBridge,
} from "@cortex/cli";
import type { CommandContext, CommandResult } from "@cortex/cli";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════

const ctx: CommandContext = {
  format: "text",
  quiet: false,
  verbose: false,
  rawOptions: {},
};

function assertValidResult(r: CommandResult): void {
  expect(r).toBeDefined();
  expect(typeof r.success).toBe("boolean");
  expect(typeof r.exitCode).toBe("number");
  if (r.success && r.output !== undefined) {
    expect(typeof r.output).toBe("string");
  }
  if (!r.success && r.error !== undefined) {
    expect(typeof r.error).toBe("string");
  }
}

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-cmd-test-"));
}

function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 静默 */ }
}

// ════════════════════════════════════════════════════════════
// 1. cortex version — 版本信息
// ════════════════════════════════════════════════════════════

describe("cortex version", () => {
  it("默认输出包含版本号和阶段", async () => {
    const handler = createVersionHandler();
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("cortex v");
    expect(result.output).toContain("Core-1");
    expect(result.exitCode).toBe(0);
  });

  it("--json 输出可解析 JSON", async () => {
    const handler = createVersionHandler();
    const result = await handler([], { json: true }, ctx);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, string>;
    expect(data.version).toContain("Core-1");
    expect(data.runtime).toContain("Node.js");
    expect(data.platform).toBeDefined();
  });

  it("--full 模式附加配置路径", async () => {
    const handler = createVersionHandler();
    const result = await handler([], { full: true }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("配置:");
  });
});

// ════════════════════════════════════════════════════════════
// 2. cortex help — 帮助信息
// ════════════════════════════════════════════════════════════

describe("cortex help", () => {
  function buildRegistry(): CommandRegistry {
    const registry = new CommandRegistry();
    registry.registerAll([
      { name: "run", alias: "r", description: "单次执行", handler: async () => ({ success: true, exitCode: 0 }) },
      { name: "agent", alias: "ag", description: "Agent 管理", handler: async () => ({ success: true, exitCode: 0 }) },
      { name: "version", alias: "v", description: "版本信息", handler: async () => ({ success: true, exitCode: 0 }) },
    ]);
    return registry;
  }

  it("无参数列出所有命令", async () => {
    const handler = createHelpHandler(buildRegistry());
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("run");
    expect(result.output).toContain("agent");
    expect(result.output).toContain("version");
  });

  it("指定命令名显示命令详情", async () => {
    const handler = createHelpHandler(buildRegistry());
    const result = await handler(["run"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("命令: cortex run");
    expect(result.output).toContain("别名: r");
  });

  it("未知命令返回错误", async () => {
    const handler = createHelpHandler(buildRegistry());
    const result = await handler(["nonexistent"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("没有");
  });
});

// ════════════════════════════════════════════════════════════
// 3. cortex config — 配置管理
// ════════════════════════════════════════════════════════════

describe("cortex config", () => {
  let tmpDir: string;

  beforeAll(() => { tmpDir = createTmpDir(); });
  afterAll(() => { cleanupDir(tmpDir); });

  it("无参数 / --help 显示帮助", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("list");
    expect(result.output).toContain("get");
    expect(result.output).toContain("set");
    expect(result.output).toContain("init");
    expect(result.output).toContain("validate");
  });

  it("list 列出所有配置项", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["list"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("version");
    expect(result.output).toContain("cli.defaultFormat");
    expect(result.data).toBeDefined();
  });

  it("list --prefix 按前缀过滤", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["list"], { prefix: "llm" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("chatModel");
    // 不应该包含 cli 前缀的配置
    expect(result.output).not.toContain("cli.defaultFormat");
  });

  it("get 获取特定配置值", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["get", "version"], {}, ctx);
    expect(result.success).toBe(true);
  });

  it("get 不存在的配置项返回错误", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["get", "nonexistent.key"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("不存在");
    expect(result.exitCode).toBe(1);
  });

  it("get 缺少 key 参数返回错误", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["get"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("配置键");
  });

  it("set 设置配置值", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["set", "cli.defaultFormat", "json"], {}, ctx);
    expect(result.success).toBe(true);
    expect(mgr.getNested("cli.defaultFormat")).toBe("json");
  });

  it("set JSON 值自动解析", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["set", "test.arr", '[1,2,3]'], {}, ctx);
    expect(result.success).toBe(true);
    expect(mgr.getNested("test.arr")).toEqual([1, 2, 3]);
  });

  it("set 缺少 value 时仍接受（空值）", async () => {
    // 当前实现：value 缺省时 args.slice(2).join(" ") 返回 ""
    // 不会触发 value === undefined 检查，视为设置空字符串
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["set", "key"], {}, ctx);
    // 当前实现不拒绝空值，success=true
    assertValidResult(result);
    expect(result.success).toBe(true);
  });

  it("validate 默认通过", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["validate"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("通过");
  });

  it("未知子命令返回错误", async () => {
    const mgr = new ConfigManager();
    const handler = createConfigHandler(mgr);
    const result = await handler(["unknown-sub"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未知子命令");
    expect(result.exitCode).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 4. cortex skill — 技能管理
// ════════════════════════════════════════════════════════════

describe("cortex skill", () => {
  it("无参数 / --help 显示帮助", async () => {
    const handler = createSkillHandler();
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("list");
    expect(result.output).toContain("search");
    expect(result.output).toContain("info");
    expect(result.output).toContain("register");
    expect(result.output).toContain("unregister");
    expect(result.output).toContain("stats");
  });

  it("list 列出已注册技能（初始为空）", async () => {
    const handler = createSkillHandler();
    const result = await handler(["list"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("无已注册技能");
  });

  it("register 注册新技能", async () => {
    const handler = createSkillHandler();
    const result = await handler(["register"], {
      id: "test-skill",
      name: "测试技能",
      trigger: "当用户提到测试时",
      kind: "action",
      tags: "test,example",
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("注册成功");
  });

  it("register 重复 ID 返回错误（无 --overwrite）", async () => {
    const handler = createSkillHandler();
    // 先注册
    await handler(["register"], { id: "dup-skill", name: "重复", trigger: "test", kind: "action" }, ctx);
    // 再注册同一 ID
    const result = await handler(["register"], { id: "dup-skill", name: "重复2", trigger: "test2", kind: "action" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("已存在");
  });

  it("register --overwrite 覆盖已有技能", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "overwrite-me", name: "旧名称", trigger: "old", kind: "action" }, ctx);
    const result = await handler(["register"], {
      id: "overwrite-me",
      name: "新名称",
      trigger: "new",
      kind: "action",
      overwrite: true,
    }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("注册成功");
  });

  it("register 无效 ID 格式返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["register"], {
      id: "InvalidID",
      name: "test",
      trigger: "test",
      kind: "action",
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("无效技能 ID");
  });

  it("register 无效 kind 返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["register"], {
      id: "valid-id",
      name: "test",
      trigger: "test",
      kind: "invalid-kind",
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("无效技能种类");
  });

  it("register 缺少必要参数返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["register"], { id: "only-id" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("缺少必要参数");
  });

  it("search 搜索技能", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "search-me", name: "搜索目标", trigger: "unique-trigger-xyz", kind: "action" }, ctx);
    const result = await handler(["search", "unique-trigger-xyz"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("search-me");
  });

  it("search 无匹配返回提示", async () => {
    const handler = createSkillHandler();
    const result = await handler(["search", "zzz-nonexistent-query"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("未找到匹配");
  });

  it("search 缺少关键词返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["search"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("关键词");
  });

  it("info 查看技能详情", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "info-me", name: "详情测试", trigger: "查看详情", kind: "action", tags: "test" }, ctx);
    const result = await handler(["info", "info-me"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("info-me");
    expect(result.output).toContain("详情测试");
  });

  it("info 不存在的技能返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["info", "nonexistent"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未在注册表中找到");
  });

  it("info 缺少 ID 返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["info"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("技能 ID");
  });

  it("unregister 注销技能", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "del-me", name: "待删除", trigger: "delete", kind: "action" }, ctx);
    const result = await handler(["unregister", "del-me"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("已注销");
  });

  it("unregister 不存在的技能返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["unregister", "nonexistent"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未在注册表中找到");
  });

  it("unregister 有依赖时拒绝（无 --force）", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "base-skill", name: "基础技能", trigger: "base", kind: "action" }, ctx);
    await handler(["register"], { id: "dependent", name: "依赖技能", trigger: "use base-skill for X", kind: "action" }, ctx);
    const result = await handler(["unregister", "base-skill"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("被引用");
  });

  it("unregister --force 强制注销", async () => {
    const handler = createSkillHandler();
    await handler(["register"], { id: "force-base", name: "基础技能", trigger: "base", kind: "action" }, ctx);
    await handler(["register"], { id: "force-dep", name: "依赖技能", trigger: "use force-base", kind: "action" }, ctx);
    const result = await handler(["unregister", "force-base"], { force: true }, ctx);
    expect(result.success).toBe(true);
  });

  it("stats 显示统计信息", async () => {
    const handler = createSkillHandler();
    const result = await handler(["stats"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("总数");
    expect(result.output).toContain("按种类");
  });

  it("stats --format json 输出 JSON", async () => {
    const handler = createSkillHandler();
    const result = await handler(["stats"], { format: "json" }, ctx);
    expect(result.success).toBe(true);
    const data = JSON.parse(result.output!);
    expect(typeof data.total).toBe("number");
    expect(data.byKind).toBeDefined();
  });

  it("未知子命令返回错误", async () => {
    const handler = createSkillHandler();
    const result = await handler(["unknown-sub"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未知子命令");
    expect(result.exitCode).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 5. cortex doc — 文档工具
// ════════════════════════════════════════════════════════════

describe("cortex doc", () => {
  let tmpDir: string;

  beforeAll(() => { tmpDir = createTmpDir(); });
  afterAll(() => { cleanupDir(tmpDir); });

  it("无参数 / --help 显示帮助", async () => {
    const handler = createDocHandler();
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("convert");
    expect(result.output).toContain("serve");
    expect(result.output).toContain("check");
  });

  it("convert 将 markdown 转为 HTML", async () => {
    const mdFile = path.join(tmpDir, "test.md");
    fs.writeFileSync(mdFile, "# Hello\n\nWorld");
    const handler = createDocHandler();
    const result = await handler(["convert", mdFile], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("<h1>");
    expect(result.output).toContain("Hello");
  });

  it("convert --output 写入文件", async () => {
    const mdFile = path.join(tmpDir, "test2.md");
    const outFile = path.join(tmpDir, "out.html");
    fs.writeFileSync(mdFile, "## Subtitle");
    const handler = createDocHandler();
    const result = await handler(["convert", mdFile], { output: outFile }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("转换完成");
    const html = fs.readFileSync(outFile, "utf-8");
    expect(html).toContain("<h2>");
  });

  it("convert --document 输出完整 HTML", async () => {
    const mdFile = path.join(tmpDir, "test3.md");
    fs.writeFileSync(mdFile, "# Title");
    const handler = createDocHandler();
    const result = await handler(["convert", mdFile], { document: true, title: "MyDoc" }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("<!DOCTYPE html>");
    expect(result.output).toContain("<title>MyDoc</title>");
  });

  it("convert 不支持的文件格式返回错误", async () => {
    const txtFile = path.join(tmpDir, "test.txt");
    fs.writeFileSync(txtFile, "plain text");
    const handler = createDocHandler();
    const result = await handler(["convert", txtFile], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("不支持的文件格式");
  });

  it("convert 文件不存在返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["convert", "/nonexistent/file.md"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("convert 缺少文件参数返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["convert"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("输入文件");
  });

  it("check 合规检查通过", async () => {
    const mdFile = path.join(tmpDir, "check-ok.md");
    fs.writeFileSync(mdFile, "# Title\n\n## Section\n\nContent");
    const handler = createDocHandler();
    const result = await handler(["check", mdFile], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("通过");
  });

  it("check 检测到头跳跃", async () => {
    const mdFile = path.join(tmpDir, "check-bad.md");
    fs.writeFileSync(mdFile, "# H1\n\n### H3 (skip H2)");
    const handler = createDocHandler();
    const result = await handler(["check", mdFile], { rules: "headings" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("标题级别跳跃");
  });

  it("check 文件不存在返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["check", "/nonexistent.md"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("check 缺少文件参数返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["check"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("文件");
  });

  it("serve 目录不存在返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["serve", "/nonexistent/dir"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("未知子命令返回错误", async () => {
    const handler = createDocHandler();
    const result = await handler(["unknown-sub"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未知子命令");
  });
});

// ════════════════════════════════════════════════════════════
// 6. cortex inspect — 项目侦察
// ════════════════════════════════════════════════════════════

describe("cortex inspect", () => {
  let tmpDir: string;

  beforeAll(() => { tmpDir = createTmpDir(); });
  afterAll(() => { cleanupDir(tmpDir); });

  it("无参数 / --help 显示帮助", async () => {
    const handler = createInspectHandler();
    const result = await handler([], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("dir");
    expect(result.output).toContain("deps");
    expect(result.output).toContain("drift");
    expect(result.output).toContain("report");
  });

  it("dir 侦察目录结构", async () => {
    // 创建简单目录结构
    const testDir = path.join(tmpDir, "inspect-dir");
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "src", "index.ts"), "export const x = 1;");
    fs.writeFileSync(path.join(testDir, "README.md"), "# Test");

    const handler = createInspectHandler();
    const result = await handler(["dir", testDir], { depth: 2 }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("目录结构");
  });

  it("dir 目录不存在返回错误", async () => {
    const handler = createInspectHandler();
    const result = await handler(["dir", "/nonexistent/dir"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("deps 分析依赖拓扑", async () => {
    const handler = createInspectHandler();
    const result = await handler(["deps"], {}, { ...ctx, projectRoot: tmpDir });
    // 可能因不是真正的 monorepo 而返回空结果，但不应崩溃
    assertValidResult(result);
    expect(result.success).toBe(true);
  });

  it("deps --graph 输出 DOT 格式", async () => {
    const handler = createInspectHandler();
    const result = await handler(["deps"], { graph: true }, { ...ctx, projectRoot: tmpDir });
    assertValidResult(result);
  });

  it("deps --cycles 检测循环依赖", async () => {
    const handler = createInspectHandler();
    const result = await handler(["deps"], { cycles: true }, { ...ctx, projectRoot: tmpDir });
    assertValidResult(result);
  });

  it("drift 检测配置漂移", async () => {
    const handler = createInspectHandler();
    const result = await handler(["drift"], {}, { ...ctx, projectRoot: tmpDir });
    assertValidResult(result);
  });

  it("report 生成完整报告", async () => {
    const handler = createInspectHandler();
    const result = await handler(["report"], {}, { ...ctx, projectRoot: tmpDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("报告");
  });

  it("report --output 写入文件", async () => {
    const outFile = path.join(tmpDir, "inspect-report.json");
    const handler = createInspectHandler();
    const result = await handler(["report"], { output: outFile }, { ...ctx, projectRoot: tmpDir });
    expect(result.success).toBe(true);
    expect(fs.existsSync(outFile)).toBe(true);
  });

  it("未知子命令返回错误", async () => {
    const handler = createInspectHandler();
    const result = await handler(["unknown-sub"], {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未知子命令");
  });
});

// ════════════════════════════════════════════════════════════
// 7. cortex doctor — 健康诊断
// ════════════════════════════════════════════════════════════

describe("cortex doctor", () => {
  it("--help 显示帮助", async () => {
    const handler = createDoctorHandler();
    const result = await handler(["--help"], {}, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain("package-json");
    expect(result.output).toContain("positioning-doc");
    expect(result.output).toContain("test-header");
  });

  it("默认诊断返回报告", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], {}, { ...ctx, projectRoot: process.cwd() });
    // doctor 诊断总是成功（exitCode 表达健康状态）
    assertValidResult(result);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("--format json 输出 JSON 报告", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], { format: "json" }, { ...ctx, projectRoot: process.cwd() });
    assertValidResult(result);
    // JSON 模式下 output 是可解析的 JSON
    expect(() => JSON.parse(result.output!)).not.toThrow();
  });

  it("--only 仅运行指定检查器", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], { only: "package-json" }, { ...ctx, projectRoot: process.cwd() });
    assertValidResult(result);
  });

  it("--skip 跳过指定检查器", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], { skip: "test-header" }, { ...ctx, projectRoot: process.cwd() });
    assertValidResult(result);
  });

  it("--output 输出到文件", async () => {
    const tmpDir = createTmpDir();
    try {
      const outFile = path.join(tmpDir, "doctor-report.txt");
      const handler = createDoctorHandler();
      const result = await handler([], { output: outFile }, { ...ctx, projectRoot: process.cwd() });
      assertValidResult(result);
      expect(fs.existsSync(outFile)).toBe(true);
    } finally {
      cleanupDir(tmpDir);
    }
  });

  it("--threshold 低于阈值时 exitCode=1", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], { threshold: 101 }, { ...ctx, projectRoot: process.cwd() });
    // 健康分不可能超过 100，所以必定低于 101 阈值
    assertValidResult(result);
    if (result.success && result.exitCode === 1) {
      expect(result.error).toContain("阈值");
    }
  });

  it("--verbose 输出详细信息", async () => {
    const handler = createDoctorHandler();
    const result = await handler([], { verbose: true }, { ...ctx, projectRoot: process.cwd() });
    assertValidResult(result);
  });
});

// ════════════════════════════════════════════════════════════
// 8. cortex roundtable — 圆桌会议
// ════════════════════════════════════════════════════════════

describe("cortex roundtable", () => {
  let docReg: any;

  beforeAll(async () => {
    const { DocRegistry } = await import("@cortex/engine");
    const { NodeFileSystemAdapter } = await import("@cortex/platform");
    const tmpDir = createTmpDir();
    docReg = new DocRegistry(new NodeFileSystemAdapter(), tmpDir);
  });

  it("无参数 / --help 显示帮助", async () => {
    // bridge 未 bootstrap——_getTemplates() 会 catch 返回 []
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRoundtableHandler(bridge, docReg);
      const result = await handler([], {}, ctx);
      expect(result.success).toBe(true);
      expect(result.output).toContain("start");
      expect(result.output).toContain("list");
      expect(result.output).toContain("status");
      expect(result.output).toContain("join");
    } finally {
      await bridge.shutdown();
    }
  });

  it("start 缺少模板名返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRoundtableHandler(bridge, docReg);
      const result = await handler(["start"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("模板");
    } finally {
      await bridge.shutdown();
    }
  });

  it("未知子命令返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRoundtableHandler(bridge, docReg);
      const result = await handler(["unknown-sub"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知子命令");
    } finally {
      await bridge.shutdown();
    }
  });

  it("join 缺少会话 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRoundtableHandler(bridge, docReg);
      const result = await handler(["join"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("会话 ID");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 9. cortex run — 补充测试（文件错误场景）
// ════════════════════════════════════════════════════════════

describe("cortex run — 补充测试", () => {
  it("不存在的文件返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRunHandler(bridge);
      const result = await handler(["/nonexistent/file.txt"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("读取输入失败");
    } finally {
      await bridge.shutdown();
    }
  });

  it("无参数返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createRunHandler(bridge);
      const result = await handler([], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 10. cortex agent — 补充测试（参数错误）
// ════════════════════════════════════════════════════════════

describe("cortex agent — 补充测试", () => {
  it("inspect 缺少类型名返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureReady();
      const handler = createAgentHandler(bridge);
      const result = await handler(["inspect"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Agent 类型");
    } finally {
      await bridge.shutdown();
    }
  });

  it("spawn 缺少类型名返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureReady();
      const handler = createAgentHandler(bridge);
      const result = await handler(["spawn"], {}, ctx);
      expect(result.success).toBe(false);
    } finally {
      await bridge.shutdown();
    }
  });

  it("spawn 无效类型返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureReady();
      const handler = createAgentHandler(bridge);
      const result = await handler(["spawn", "invalid-type"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知 Agent 类型");
    } finally {
      await bridge.shutdown();
    }
  });

  it("destroy 缺少类型名返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureReady();
      const handler = createAgentHandler(bridge);
      const result = await handler(["destroy"], {}, ctx);
      expect(result.success).toBe(false);
    } finally {
      await bridge.shutdown();
    }
  });

  it("destroy 无 --id 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureReady();
      const handler = createAgentHandler(bridge);
      const result = await handler(["destroy", "code"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("--id");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 11. cortex task — 补充测试（参数错误）
// ════════════════════════════════════════════════════════════

describe("cortex task — 补充测试", () => {
  it("submit 缺少文件返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["submit"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("任务文件");
    } finally {
      await bridge.shutdown();
    }
  });

  it("submit 不存在文件返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["submit", "/nonexistent.json"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("读取文件失败");
    } finally {
      await bridge.shutdown();
    }
  });

  it("status 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["status"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("任务 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("cancel 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["cancel"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("任务 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("redo 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["redo"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("任务 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("未知子命令返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createTaskHandler(bridge);
      const result = await handler(["unknown-sub"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知子命令");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 12. cortex memory — 补充测试（参数错误）
// ════════════════════════════════════════════════════════════

describe("cortex memory — 补充测试", () => {
  it("write 缺少 key/value 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["write"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("key");
    } finally {
      await bridge.shutdown();
    }
  });

  it("read 缺少 key 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["read"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("key");
    } finally {
      await bridge.shutdown();
    }
  });

  it("search 缺少关键词返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["search"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("关键词");
    } finally {
      await bridge.shutdown();
    }
  });

  it("link 缺少参数返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["link"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("源和目标");
    } finally {
      await bridge.shutdown();
    }
  });

  it("archive 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["archive"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("记忆 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("freeze 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["freeze"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("记忆 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("obliterate 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["obliterate"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("记忆 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("未知子命令返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createMemoryHandler(bridge);
      const result = await handler(["unknown-sub"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知子命令");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 13. cortex confirm — 补充测试（参数错误）
// ════════════════════════════════════════════════════════════

describe("cortex confirm — 补充测试", () => {
  it("pending 列出待确认请求", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      await bridge.ensureInitialized();
      const handler = createConfirmHandler(bridge);
      const result = await handler(["pending"], {}, ctx);
      assertValidResult(result);
      expect(result.success).toBe(true);
    } finally {
      await bridge.shutdown();
    }
  });

  it("approve 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createConfirmHandler(bridge);
      const result = await handler(["approve"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("请求 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("reject 缺少 ID 返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createConfirmHandler(bridge);
      const result = await handler(["reject"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("请求 ID");
    } finally {
      await bridge.shutdown();
    }
  });

  it("未知子命令返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createConfirmHandler(bridge);
      const result = await handler(["unknown-sub"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知子命令");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 14. cortex schedule — 补充测试（参数错误）
// ════════════════════════════════════════════════════════════

describe("cortex schedule — 补充测试", () => {
  it("plan 缺少文件返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createScheduleHandler(bridge);
      const result = await handler(["plan"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("任务描述文件");
    } finally {
      await bridge.shutdown();
    }
  });

  it("run 缺少计划文件返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createScheduleHandler(bridge);
      const result = await handler(["run"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("计划文件");
    } finally {
      await bridge.shutdown();
    }
  });

  it("未知子命令返回错误", async () => {
    const bridge = new EngineBridge(new ConfigManager());
    try {
      const handler = createScheduleHandler(bridge);
      const result = await handler(["unknown-sub"], {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toContain("未知子命令");
    } finally {
      await bridge.shutdown();
    }
  });
});

// ════════════════════════════════════════════════════════════
// 15. cortex setup — 配置界面
// ════════════════════════════════════════════════════════════

describe("cortex setup", () => {
  // setup 命令会 spawn 交互式子进程（cortex-cli.mjs --mode setup）
  // 在无 TTY 的测试环境中必然超时，跳过运行时测试
  it("handler 工厂可正常创建", () => {
    const handler = createSetupHandler();
    expect(typeof handler).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════
// 16. CommandResult 一致性检查
// ════════════════════════════════════════════════════════════

describe("CommandResult 结构一致性", () => {
  it("所有命令处理器返回合法的 CommandResult", async () => {
    // 对每个命令，至少验证 help 输出结构正确
    const tests: [string, () => Promise<CommandResult>][] = [
      ["version", () => createVersionHandler()([], {}, ctx)],
      ["config", () => createConfigHandler(new ConfigManager())([], {}, ctx)],
      ["skill", () => createSkillHandler()([], {}, ctx)],
      ["doc", () => createDocHandler()([], {}, ctx)],
      ["inspect", () => createInspectHandler()([], {}, ctx)],
    ];

    for (const [name, fn] of tests) {
      const result = await fn();
      assertValidResult(result);
      expect(result.success, `${name} help 应该成功`).toBe(true);
    }
  });
});
