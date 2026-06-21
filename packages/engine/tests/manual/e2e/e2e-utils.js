/**
 * e2e-utils.ts — E2E 测试共享工具
 *
 * 解决所有 E2E 测试的共性坑位：
 *   1. Windows .env 需清除 \r 后解析
 *   2. stdout 缓冲导致日志延迟——使用 stderr.write 强制刷新
 *   3. DeepSeek API 端点 /chat/completions（非 /v1/...）
 *   4. LlmAdapter 正确构造（非手搓，含 tool_choice 支持）
 *   5. 项目根路径 —— 向上搜索 cortex-agents.json
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
// ── 日志 ──────────────────────────────────────
/** 强制刷新到 stderr（不受 stdout 缓冲影响） */
export function log(msg) {
    process.stderr.write(msg + "\n");
}
// ── .env 加载 ─────────────────────────────────
/** 从指定目录加载 .env 到 process.env（处理 \r\n 换行符） */
export function loadEnv(dir) {
    const envPath = path.join(dir, ".env");
    if (!fs.existsSync(envPath))
        return;
    const content = fs.readFileSync(envPath, "utf-8").replace(/\r/g, "");
    for (const line of content.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m)
            process.env[m[1]] = m[2].trim();
    }
}
// ── 项目根 ────────────────────────────────────
/** 向上搜索项目根（sentinel: cortex-cognition.json——沙箱屏蔽 cortex-agents.json） */
export function findProjectRoot(startDir) {
    const SENTINEL = "cortex-cognition.json";
    // 优先取 CORTEX_ROOT 环境变量（沙箱场景）
    if (process.env["CORTEX_ROOT"] && fs.existsSync(path.join(process.env["CORTEX_ROOT"], SENTINEL))) {
        return process.env["CORTEX_ROOT"];
    }
    // 从当前模块路径向上推导（独立于 process.cwd）
    try {
        const moduleDir = path.dirname(fileURLToPath(import.meta.url));
        let dir = moduleDir;
        while (!fs.existsSync(path.join(dir, SENTINEL))) {
            const parent = path.dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
        if (fs.existsSync(path.join(dir, SENTINEL)))
            return dir;
    }
    catch { /* import.meta.url 不可用 */ }
    // 最后回退到 process.cwd
    let dir = startDir ?? process.cwd();
    while (!fs.existsSync(path.join(dir, SENTINEL))) {
        const parent = path.dirname(dir);
        if (parent === dir)
            throw new Error(`找不到 ${SENTINEL}——请在项目根目录下运行`);
        dir = parent;
    }
    return dir;
}
// ── LlmAdapter ────────────────────────────────
/** 创建标准 LlmAdapter（从 .env 加载密钥） */
export function createE2eAdapter() {
    const key = process.env["DEEPSEEK_API_KEY"];
    if (!key)
        throw new Error("DEEPSEEK_API_KEY 未设置");
    const baseUrl = process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com";
    return new LlmAdapter({
        apiKey: key,
        baseUrl,
        chatModel: process.env["DEEPSEEK_CHAT_MODEL"] ?? "deepseek-v4-flash",
        reasonerModel: process.env["DEEPSEEK_REASONER_MODEL"] ?? "deepseek-v4-pro",
        label: "e2e-test",
        extraBody: baseUrl.includes("deepseek") ? { thinking: { type: "enabled" } } : undefined,
    });
}
// ── E2E 引导 ──────────────────────────────────
/** 标准 E2E 引导：找到根 → 加载 .env → 创建适配器和工具包 */
export function e2eBootstrap() {
    const root = findProjectRoot();
    loadEnv(root);
    const llm = createE2eAdapter();
    const toolkit = new Toolkit();
    toolkit.setWorkspaceRoot(root);
    return { root, llm, toolkit };
}
//# sourceMappingURL=e2e-utils.js.map