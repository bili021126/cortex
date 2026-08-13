// @ci: unit
/**
 * CLI 测试：status 命令（系统状态总览）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatusHandler } from "../src/commands/status.js";

const ORIG_CWD = process.cwd();
let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "cli-status-"));
  process.chdir(ws);
});

afterEach(() => {
  process.chdir(ORIG_CWD);
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("createStatusHandler", () => {
  it("help 请求返回帮助", async () => {
    const r = await createStatusHandler()(["--help"], {}, null as never);
    expect(r.success).toBe(true);
    expect(r.output).toContain("用法");
  });

  it("无报告时提示评测为空", async () => {
    const r = await createStatusHandler()(["show"], {}, null as never);
    expect(r.success).toBe(true);
    expect(r.output).toContain("评测");
  });

  it("有报告时显示通过率", async () => {
    const dir = path.join(ws, ".cortex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "eval-report.json"), JSON.stringify({
      generatedAt: "2026-08-09T00:00:00.000Z",
      results: [{ passed: true }, { passed: true }],
    }), "utf-8");
    const r = await createStatusHandler()(["show"], {}, null as never);
    expect(r.success).toBe(true);
    expect(r.output).toContain("2/2");
  });

  it("输出包含关键段落（daemon/评测/桌面端）", async () => {
    const r = await createStatusHandler()(["show"], {}, null as never);
    expect(r.output).toContain("daemon");
    expect(r.output).toContain("桌面端");
  });
});
