/**
 * smoke.ts — CLI 用户交互冒烟测试
 *
 * 目标：验证 CLI 命令处理器对用户可见的契约没有因内部重构而断裂。
 * 不依赖 LLM / Engine Bridge，只走纯函数路径。
 *
 * 用法:
 *   npx tsx packages/cli/tests/smoke.ts
 *   npx tsx packages/cli/tests/smoke.ts --verbose
 *
 * 验收标准（Core-1 终局）:
 *   全部 PASS → 退出码 0
 *   任一 FAIL → 退出码 1
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createInspectHandler } from "../src/commands/inspect.js";
import { createDocHandler } from "../src/commands/doc.js";
import { createConfigHandler } from "../src/commands/config.js";
import { createHelpHandler } from "../src/commands/help.js";
import { createVersionHandler } from "../src/commands/version.js";
import { ConfigManager } from "../src/services/config-manager.js";
import { CommandRegistry } from "../src/commands/index.js";
// ── 辅助 ────────────────────────────────────────
let passed = 0;
let failed = 0;
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
function ctx(overrides = {}) {
    return { format: "text", quiet: false, verbose: false, rawOptions: {}, ...overrides };
}
function ok(label, result) {
    if (result.success) {
        passed++;
        if (VERBOSE)
            console.log(`  ✅ ${label}`);
    }
    else {
        failed++;
        console.log(`  ❌ ${label}: ${result.error ?? "(unknown)"}`);
    }
}
function pass(label, condition) {
    if (condition) {
        passed++;
        if (VERBOSE)
            console.log(`  ✅ ${label}`);
    }
    else {
        failed++;
        console.log(`  ❌ ${label}`);
    }
}
function section(name) {
    console.log(`\n── ${name} ──`);
}
// ── 临时文件工具 ────────────────────────────────
let tempDir = "";
function tempFile(name, content) {
    if (!tempDir) {
        tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-smoke-"));
    }
    const fp = path.join(tempDir, name);
    const parent = path.dirname(fp);
    if (!fs.existsSync(parent))
        fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(fp, content, "utf-8");
    return fp;
}
function cleanup() {
    if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        if (VERBOSE)
            console.log(`  🧹 已清理: ${tempDir}`);
    }
}
// ── 题目 ─────────────────────────────────────────
console.log("╔══════════════════════════════════╗");
console.log("║  🚬  CLI 冒烟测试   Core-1 终局  ║");
console.log("╚══════════════════════════════════╝");
// ═════════════════════════════════════════
// 1. cortex version
// ═════════════════════════════════════════
section("cortex version");
{
    const h = createVersionHandler();
    const r = await h([], {}, ctx());
    ok("返回成功", r);
    pass("输出包含版本号", typeof r.output === "string" && r.output.includes("cortex v"));
    pass("输出包含阶段标识", typeof r.output === "string" && r.output.includes("Core-1"));
    pass("退出码为 0", r.exitCode === 0);
    const rj = await h([], { json: true }, ctx());
    ok("--json 返回成功", rj);
    pass("--json 包含 data 字段", rj.data != null && typeof rj.data === "object");
    const data = rj.data;
    pass("--json version 包含 Core-1", typeof data.version === "string" && data.version.includes("Core-1"));
    pass("--json runtime 非空", typeof data.runtime === "string" && data.runtime.length > 0);
}
// ═════════════════════════════════════════
// 2. cortex help (CommandRegistry)
// ═════════════════════════════════════════
section("cortex help (CommandRegistry)");
{
    const noop = async () => ({ success: true, exitCode: 0 });
    const registry = new CommandRegistry();
    registry.register({ name: "test", alias: "t", description: "测试命令", handler: noop });
    pass("注册后 find('test') 返回", registry.find("test") != null);
    pass("别名 find('t') 路由到 'test'", registry.find("t")?.name === "test");
    pass("不存在命令 find 返回 undefined", registry.find("zzz") === undefined);
    let dispatched = false;
    registry.register({
        name: "alpha",
        description: "分发测试",
        handler: async () => { dispatched = true; return { success: true, exitCode: 0 }; },
    });
    const dr = await registry.dispatch(["alpha"], ctx());
    pass("dispatch 成功调用 handler", dispatched && dr.success);
}
// ═════════════════════════════════════════
//    这同时也是 cortex run <file>.md 的 parser 路径
// ═════════════════════════════════════════
section("cortex doc convert（parser 路径）");
{
    const h = createDocHandler();
    const md = tempFile("sample.md", "# Hello World\n\n这是一段测试内容。\n");
    // convert 子命令
    const outPath = path.join(tempDir, "out.html");
    const r = await h(["convert", md], { output: outPath }, ctx());
    ok("convert 返回成功", r);
    pass("convert 输出路径正确", typeof r.output === "string" && r.output.includes("out.html"));
    const html = fs.readFileSync(outPath, "utf-8");
    pass("产出 HTML 包含 <h1>", html.includes("<h1>"));
    pass("产出 HTML 包含原文", html.includes("Hello World"));
    pass("产出 HTML 包含中文", html.includes("测试内容"));
    // --document 模式（完整 HTML 文档）
    const rd = await h(["convert", md], { document: true, title: "SmokeTest" }, ctx());
    ok("--document 模式成功", rd);
    pass("--document 包含 <!DOCTYPE html>", typeof rd.output === "string" && rd.output.includes("<!DOCTYPE html>"));
    pass("--document 包含 <title>", typeof rd.output === "string" && rd.output.includes("<title>SmokeTest</title>"));
    // 无子命令→help
    const rHelp = await h([], {}, ctx());
    ok("无子命令返回 help", rHelp);
    pass("help 输出包含用法说明", typeof rHelp.output === "string" && rHelp.output.includes("用法"));
    // 未知子命令
    const rBad = await h(["zzz"], {}, ctx());
    pass("未知子命令返回失败", !rBad.success);
    pass("未知子命令提示可用子命令", (rBad.error ?? "").includes("未知子命令"));
}
// ═════════════════════════════════════════
// 4. cortex config（配置管理）
// ═════════════════════════════════════════
section("cortex config");
{
    const cm = new ConfigManager();
    const h = createConfigHandler(cm);
    // list
    const rList = await h(["list"], { format: "json" }, ctx({ format: "json" }));
    ok("config list 成功", rList);
    pass("config list 返回 data", rList.data != null);
    // get（不存在的 key）
    const rGet = await h(["get", "nonexistent.key.xyz"], {}, ctx());
    pass("config get 不存在的 key 返回失败", !rGet.success);
    // validate
    const rVal = await h(["validate", "--strict"], {}, ctx());
    ok("config validate 成功", rVal);
    // help
    const rHelp = await h([], {}, ctx());
    ok("无子命令返回 help", rHelp);
    pass("help 输出包含子命令列表", typeof rHelp.output === "string" && rHelp.output.includes("子命令"));
    // 未知子命令
    const rBad = await h(["zzz"], {}, ctx());
    pass("未知子命令返回失败", !rBad.success);
}
// ═════════════════════════════════════════
// 5. cortex inspect dir（目录侦察）
// ═════════════════════════════════════════
section("cortex inspect dir");
{
    const h = createInspectHandler();
    const dir = tempFile("src/a.ts", "export const x = 1;\n");
    const parent = path.dirname(path.dirname(dir)); // .tmp-smoke-xxx/
    const r = await h(["dir", parent, "--depth", "1"], {}, ctx());
    ok("inspect dir 返回成功", r);
    pass("inspect dir 输出非空", typeof r.output === "string" && r.output.length > 0);
    // inspect dir 始终返回固定格式（不支持 --format tree）
    pass("inspect dir 输出包含目录结构", typeof r.output === "string" && r.output.includes("目录结构"));
    // help
    const rHelp = await h([], {}, ctx());
    ok("无子命令返回 help", rHelp);
    // 未知子命令
    const rBad = await h(["zzz"], {}, ctx());
    pass("未知子命令返回失败", !rBad.success);
}
// ═════════════════════════════════════════
// 6. cortex help（顶级 help）
// ═════════════════════════════════════════
section("cortex help");
{
    const registry = new CommandRegistry();
    const noop = async () => ({ success: true, exitCode: 0 });
    registry.register({ name: "run", alias: "r", description: "执行任务", handler: noop });
    registry.register({ name: "agent", alias: "a", description: "Agent管理", handler: noop });
    registry.register({ name: "task", description: "任务管理", handler: noop });
    const h = createHelpHandler(registry);
    const r = await h([], {}, ctx());
    ok("help 返回成功", r);
    pass("help 输出包含命令列表", typeof r.output === "string" && r.output.includes("run"));
    pass("help 输出包含 agent", typeof r.output === "string" && r.output.includes("agent"));
    // 特定命令的 help
    const rRun = await h(["run"], {}, ctx());
    ok("help run 返回成功", rRun);
}
// ═════════════════════════════════════════
// 终了
// ═════════════════════════════════════════
cleanup();
const total = passed + failed;
console.log(`\n╔══════════════════════════════════╗`);
console.log(`║  结果: ${passed}/${total} 通过`);
console.log(`╚══════════════════════════════════╝`);
if (failed > 0) {
    console.log(`\n❌ ${failed} 项失败`);
    process.exit(1);
}
console.log("✅ CLI 用户交互契约完整\n");
process.exit(0);
//# sourceMappingURL=smoke.js.map