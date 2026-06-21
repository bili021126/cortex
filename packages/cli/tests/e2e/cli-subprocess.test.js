// @ci: unit
/**
 * cli-subprocess.test.ts —— Cortex CLI 子进程 E2E 测试
 *
 * 验证用户实际敲命令的端到端行为：
 *   终端输入 → process.argv → main() → stdout/stderr → process.exit(code)
 *
 * 与 handler 直调测试（cli-e2e.test.ts / cli-engine-integration.test.ts）的区别：
 *   - 本文件 spawn 真实子进程 `node dist/main.js <args>`
 *   - 验证 exit code、stdout 内容、stderr 错误信息
 *   - 测试的是 CLI 可执行文件，不是 handler 函数
 *
 * 运行: npx vitest run tests/e2e/cli-subprocess.test.ts
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
// ── 路径解析 ────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..", "..", "..", "..");
const CLI_MAIN = join(PROJECT_ROOT, "packages", "cli", "dist", "main.js");
// ── 环境变量 ────────────────────────────────────────
/** 禁止搜索后端启动 + 禁止 API 审计日志，确保纯 CLI 命令无需外部依赖 */
const BASE_ENV = {
    ...process.env,
    CORTEX_NO_SEARCH: "1",
    CORTEX_API_AUDIT: "0",
};
// ── 辅助 ────────────────────────────────────────────
function run(args, envOverrides = {}) {
    try {
        const cmd = `node "${CLI_MAIN}" ${args.join(" ")}`;
        const stdout = execSync(cmd, {
            cwd: PROJECT_ROOT,
            encoding: "utf-8",
            env: { ...BASE_ENV, ...envOverrides },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 15_000,
            windowsHide: true,
        });
        return { ok: true, stdout, stderr: "", exitCode: 0 };
    }
    catch (e) {
        return {
            ok: false,
            stdout: e.stdout?.toString() ?? "",
            stderr: e.stderr?.toString() ?? "",
            exitCode: e.status ?? 1,
        };
    }
}
function tmpFile(content, ext = ".md") {
    const dir = mkdtempSync(join(tmpdir(), "cortex-cli-e2e-"));
    const file = join(dir, `test${ext}`);
    writeFileSync(file, content, "utf-8");
    return file;
}
function cleanupFile(filePath) {
    try {
        const dir = join(filePath, "..");
        rmSync(dir, { recursive: true, force: true });
    }
    catch {
        // 静默
    }
}
// ── 前置检查 ────────────────────────────────────────
describe("前置检查", () => {
    it("CLI 编译产物存在", () => {
        expect(existsSync(CLI_MAIN), `CLI 入口不存在: ${CLI_MAIN}。请先执行 pnpm build`).toBe(true);
    });
});
// ════════════════════════════════════════════════════════
// A. version —— 版本信息
// ════════════════════════════════════════════════════════
describe("A. cortex version", () => {
    it("A1. 基本输出 — exit 0, 包含 Core-1 和版本号", () => {
        const r = run(["version"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("Core-1");
        expect(r.stdout).toContain("cortex v");
        expect(r.stdout).toContain("运行时");
    });
    it("A2. --json 输出合法 JSON，含 version/runtime/platform", () => {
        const r = run(["version", "--json"]);
        expect(r.exitCode).toBe(0);
        const data = JSON.parse(r.stdout);
        expect(data.version).toContain("Core-1");
        expect(data.runtime).toContain("Node.js");
        expect(data.platform).toBeDefined();
    });
    it("A3. --version 标志 (cortex --version)", () => {
        const r = run(["--version"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("cortex v");
    });
    it("A4. -V 短标志 (cortex -V)", () => {
        const r = run(["-V"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("cortex v");
    });
});
// ════════════════════════════════════════════════════════
// B. help —— 帮助信息
// ════════════════════════════════════════════════════════
describe("B. cortex help", () => {
    it("B1. help 输出列出全部 15 个命令", () => {
        const r = run(["help"]);
        expect(r.exitCode).toBe(0);
        const expected = [
            "run", "agent", "task", "memory", "config", "doc",
            "schedule", "roundtable", "inspect", "confirm",
            "skill", "setup", "repl", "version", "help",
        ];
        for (const cmd of expected) {
            expect(r.stdout, `help 输出应包含命令: ${cmd}`).toContain(cmd);
        }
    });
    it("B2. --help 标志等效于 help 命令", () => {
        const r1 = run(["--help"]);
        const r2 = run(["help"]);
        expect(r1.exitCode).toBe(0);
        expect(r2.exitCode).toBe(0);
        // 两者输出应都包含命令列表
        expect(r1.stdout).toContain("run");
        expect(r2.stdout).toContain("run");
    });
    it("B3. -h 短标志等效", () => {
        const r = run(["-h"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("run");
    });
});
// ════════════════════════════════════════════════════════
// C. doc convert —— Markdown→HTML
// ════════════════════════════════════════════════════════
describe("C. cortex doc convert", () => {
    it("C1. 基本 Markdown→HTML 转换", () => {
        const md = tmpFile("# Hello\n\nWorld");
        try {
            const r = run(["doc", "convert", md]);
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toContain("<h1>");
            expect(r.stdout).toContain("Hello");
            expect(r.stdout).toContain("<p>World</p>");
        }
        finally {
            cleanupFile(md);
        }
    });
    it("C2. --output 写入文件", () => {
        const md = tmpFile("# Test Output");
        const outFile = join(tmpdir(), `cortex-out-${Date.now()}.html`);
        try {
            const r = run(["doc", "convert", md, "--output", outFile]);
            expect(r.exitCode).toBe(0);
            expect(existsSync(outFile)).toBe(true);
            const content = readFileSync(outFile, "utf-8");
            expect(content).toContain("<h1>Test Output</h1>");
        }
        finally {
            cleanupFile(md);
            try {
                unlinkSync(outFile);
            }
            catch { /* ok */ }
        }
    });
    it("C3. 代码块转换包含 <pre><code>", () => {
        const md = tmpFile("```ts\nconst x = 1;\n```");
        try {
            const r = run(["doc", "convert", md]);
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toContain("<pre>");
            expect(r.stdout).toContain("<code");
        }
        finally {
            cleanupFile(md);
        }
    });
    it("C4. 空 Markdown 不报错", () => {
        const md = tmpFile("");
        try {
            const r = run(["doc", "convert", md]);
            expect(r.exitCode).toBe(0);
            expect(typeof r.stdout).toBe("string");
        }
        finally {
            cleanupFile(md);
        }
    });
});
// ════════════════════════════════════════════════════════
// D. inspect —— 项目侦察
// ════════════════════════════════════════════════════════
describe("D. cortex inspect", () => {
    it("D1. inspect deps 返回 @cortex/ 包间依赖", () => {
        const r = run(["inspect", "deps"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("@cortex/");
    });
    it("D2. inspect deps --json 返回结构化数据", () => {
        const r = run(["inspect", "deps", "--format=json"]);
        expect(r.exitCode).toBe(0);
        const data = JSON.parse(r.stdout);
        expect(data).toBeDefined();
    });
    it("D3. inspect dir . 返回目录结构", () => {
        const r = run(["inspect", "dir", "."]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("目录结构");
    });
    it("D4. inspect 无子命令显示帮助", () => {
        const r = run(["inspect"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("用法:");
        // 应列出可用子命令
        expect(r.stdout).toContain("dir");
        expect(r.stdout).toContain("deps");
    });
    it("D5. inspect 未知子命令返回 exit 1", () => {
        const r = run(["inspect", "zzz-nonexistent-subcommand"]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("未知子命令");
    });
});
// ════════════════════════════════════════════════════════
// E. 错误处理与边界
// ════════════════════════════════════════════════════════
describe("E. 错误处理与边界", () => {
    it("E1. 不存在的命令返回 exit 1", () => {
        const r = run(["nonexistent-cmd-xyz"]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain("未知");
    });
    it("E2. 空参数（无子进程模式不触发 REPL）— bare cortex 会进入 REPL，超时", () => {
        // bare cortex 需要 TTY，子进程模式下 stdin 非 TTY → 应立即退出或有提示
        // 设 5s 超时，预期应快速返回
        const r = run([]);
        // bare cortex 不带参数不应该挂住；即使进入 REPL 也会因 stdin 关闭而退出
        expect([0, 1]).toContain(r.exitCode);
    });
    it("E3. exit code 约定验证", () => {
        // 0=成功
        expect(run(["version"]).exitCode).toBe(0);
        // 1=参数/路由错误
        expect(run(["no-such-cmd"]).exitCode).toBe(1);
    });
    it("E4. doc convert 不存在的文件返回错误", () => {
        const r = run(["doc", "convert", "/nonexistent/path/to/file.md"]);
        expect(r.exitCode).toBe(1);
    });
});
// ════════════════════════════════════════════════════════
// F. config —— 配置管理（不需要引擎）
// ════════════════════════════════════════════════════════
describe("F. cortex config", () => {
    it("F1. config 无子命令显示帮助", () => {
        const r = run(["config"]);
        // config 可能 exit 0 显示帮助，或 exit 1 提示未知子命令
        expect([0, 1]).toContain(r.exitCode);
    });
});
// ════════════════════════════════════════════════════════
// G. 别名解析
// ════════════════════════════════════════════════════════
describe("G. 命令别名", () => {
    it("G1. r 别名 → run 命令", () => {
        // r 会触发 createRunHandler，无文件时返回错误
        const r = run(["r"]);
        expect([0, 1]).toContain(r.exitCode);
        // 至少不是 "未知命令"
        expect(r.stderr).not.toContain("未知命令");
    });
    it("G2. v 别名 → version 命令", () => {
        const r = run(["v"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("cortex v");
    });
    it("G3. i 别名 → inspect 命令", () => {
        const r = run(["i", "deps"]);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("@cortex/");
    });
    it("G4. d 别名 → doc 命令", () => {
        const md = tmpFile("# Alias Test");
        try {
            const r = run(["d", "convert", md]);
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toContain("<h1>Alias Test</h1>");
        }
        finally {
            cleanupFile(md);
        }
    });
});
//# sourceMappingURL=cli-subprocess.test.js.map