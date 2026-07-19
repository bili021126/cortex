// @ci: unit
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FileTransport, DefaultFormatter } from "@cortex/logging";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";

describe("logging deep", () => {
  let tmpDir: string;
  let logPath: string;
  let transport: FileTransport;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-deep-"));
    logPath = path.join(tmpDir, "test.log");
    transport = new FileTransport({ path: logPath, formatter: new DefaultFormatter() });
  });

  afterAll(async () => {
    await transport.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("FileTransport 写入后文件存在", async () => {
    await transport.write({
      level: "info",
      message: "hello deep test",
      timestamp: Date.now(),
      module: "test",
    });
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("FileTransport 写入内容可读", async () => {
    await transport.flush();
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("hello deep test");
  });

  it("FileTransport 追加写入不覆盖", async () => {
    await transport.write({
      level: "warn",
      message: "second line",
      timestamp: Date.now(),
      module: "test",
    });
    await transport.flush();
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
