// @ci: unit
/**
 * CLI 测试：eval 命令（评测报告查看——默认模式）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createEvalHandler } from "../src/commands/eval.js";

const ORIG_CWD = process.cwd();
let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "cli-eval-"));
  process.chdir(ws);
});

afterEach(() => {
  process.chdir(ORIG_CWD);
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("createEvalHandler", () => {
  it("无报告时提示先运行 --run", async () => {
    const handler = createEvalHandler();
    const r = await handler(["show"], {}, null as never);
    expect(r.success).toBe(false);
    expect(r.output).toContain("暂无评测报告");
  });

  it("有报告时显示通过率", async () => {
    const dir = path.join(ws, ".cortex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "eval-report.json"), JSON.stringify({
      generatedAt: "2026-08-09T00:00:00.000Z",
      results: [
        { goldenId: "g1", passed: true },
        { goldenId: "g2", passed: false, error: "断言失败" },
      ],
    }), "utf-8");
    const handler = createEvalHandler();
    const r = await handler(["show"], {}, null as never);
    expect(r.success).toBe(true);
    expect(r.output).toContain("1/2");
    expect(r.output).toContain("✅ g1");
    expect(r.output).toContain("❌ g2");
  });

  it("help 请求返回帮助", async () => {
    const handler = createEvalHandler();
    const r = await handler(["--help"], {}, null as never);
    expect(r.success).toBe(true);
    expect(r.output).toContain("用法");
  });
});
