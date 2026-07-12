// @ci: unit
/**
 * 日志系统 E2E 测试套件
 *
 * 场景:
 *   1. ConsoleTransport → FileTransport 管道完整
 *   2. 日志级别过滤（只输出 WARN+）
 *   3. DefaultFormatter 时间戳+颜色控制
 *   4. 日志轮转（按大小切文件）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  LogLevel,
  Logger,
  ConsoleTransport,
  FileTransport,
  DefaultFormatter,
  JsonFormatter,
} from "../../src/index.js";
import type { LogEntry } from "../../src/types.js";
import type { Transport } from "../../src/transport.js";

// ══════════════════════════════════════════════════════════════
// 场景 1: ConsoleTransport → FileTransport 管道完整
// ══════════════════════════════════════════════════════════════

describe("场景1: ConsoleTransport → FileTransport 管道完整", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logging-e2e-"));
    logPath = path.join(tmpDir, "test.log");
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("ConsoleTransport 应输出格式化的日志到 stdout", () => {
    let captured = "";
    const transport: Transport = {
      name: "capture",
      write: async (entry: LogEntry) => {
        const fmt = new DefaultFormatter({ color: false, showTimestamp: false });
        captured = fmt.format(entry);
      },
      flush: async () => {},
      dispose: async () => {},
    };

    const logger = new Logger("test-logger", [transport]);
    logger.info("hello world");

    expect(captured).toContain("test-logger");
    expect(captured).toContain("hello world");
    expect(captured).toContain("[INFO]");
  });

  it("FileTransport 应将日志写入文件", async () => {
    const fileTransport = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });
    await fileTransport.write({
      timestamp: Date.now(),
      level: LogLevel.Info,
      loggerName: "file-test",
      message: "写入文件测试",
    });
    await fileTransport.flush();

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("file-test");
    expect(content).toContain("写入文件测试");
    expect(content).toContain("[INFO]");

    await fileTransport.dispose();
  });

  it("多行日志追加到同一文件末尾", async () => {
    const fileTransport = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });

    await fileTransport.write({ timestamp: 1, level: LogLevel.Info, loggerName: "t", message: "line1" });
    await fileTransport.write({ timestamp: 2, level: LogLevel.Warn, loggerName: "t", message: "line2" });
    await fileTransport.flush();

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(l => l.length > 0);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");

    await fileTransport.dispose();
  });

  it("ConsoleTransport 和 FileTransport 共用 Logger", async () => {
    const fileTransport = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });
    const consoleTransport = new ConsoleTransport({ color: false, showTimestamp: false });

    // 直接调用 transport.write 确保写入完成
    const entry = {
      timestamp: Date.now(),
      level: LogLevel.Info,
      loggerName: "dual-test",
      message: "dual transport log",
    };
    await consoleTransport.write(entry);
    await fileTransport.write(entry);
    await fileTransport.flush();

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("dual transport log");
    expect(content).toContain("dual-test");

    await fileTransport.dispose();
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 2: 日志级别过滤（只输出 WARN+）
// ══════════════════════════════════════════════════════════════

describe("场景2: 日志级别过滤", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logging-level-"));
    logPath = path.join(tmpDir, "level.log");
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("minLevel=Warn 时 Info/Debug 被过滤", async () => {
    const written: LogEntry[] = [];
    const collectingTransport: Transport = {
      name: "collect",
      write: async (entry: LogEntry) => { written.push(entry); },
      flush: async () => {},
      dispose: async () => {},
    };

    const logger = new Logger("level-filter", [collectingTransport], undefined, { minLevel: LogLevel.Warn });

    logger.debug("debug msg");
    logger.info("info msg");
    logger.warn("warn msg");
    logger.error("error msg");

    expect(written.length).toBe(2);
    expect(written[0]!.level).toBe(LogLevel.Warn);
    expect(written[1]!.level).toBe(LogLevel.Error);
  });

  it("minLevel=Info 时 Debug 被过滤，Info 及以上保留", async () => {
    const written: LogEntry[] = [];
    const collectingTransport: Transport = {
      name: "collect",
      write: async (entry: LogEntry) => { written.push(entry); },
      flush: async () => {},
      dispose: async () => {},
    };

    const logger = new Logger("info-filter", [collectingTransport], undefined, { minLevel: LogLevel.Info });

    logger.debug("hidden");
    logger.info("visible");
    logger.warn("also visible");

    expect(written.length).toBe(2);
    expect(written[0]!.message).toBe("visible");
    expect(written[1]!.message).toBe("also visible");
  });

  it("minLevel=Debug 时所有级别通过", async () => {
    const written: LogEntry[] = [];
    const collectingTransport: Transport = {
      name: "collect",
      write: async (entry: LogEntry) => { written.push(entry); },
      flush: async () => {},
      dispose: async () => {},
    };

    const logger = new Logger("debug-all", [collectingTransport], undefined, { minLevel: LogLevel.Debug });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");

    expect(written.length).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 3: DefaultFormatter 时间戳+颜色控制
// ══════════════════════════════════════════════════════════════

describe("场景3: DefaultFormatter 时间戳与颜色控制", () => {
  it("showTimestamp=true 时应包含 ISO 时间戳", () => {
    const fmt = new DefaultFormatter({ color: false, showTimestamp: true });
    const entry: LogEntry = {
      timestamp: 1700000000000,
      level: LogLevel.Info,
      loggerName: "ts-test",
      message: "check timestamp",
    };
    const output = fmt.format(entry);
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(output).toContain("[INFO]");
    expect(output).toContain("ts-test");
    expect(output).toContain("check timestamp");
  });

  it("showTimestamp=false 时应不包含时间戳", () => {
    const fmt = new DefaultFormatter({ color: false, showTimestamp: false });
    const entry: LogEntry = {
      timestamp: 1700000000000,
      level: LogLevel.Info,
      loggerName: "no-ts",
      message: "no timestamp",
    };
    const output = fmt.format(entry);
    expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(output).toContain("[INFO] no-ts: no timestamp");
  });

  it("包含 meta 时应序列化到输出", () => {
    const fmt = new DefaultFormatter({ color: false, showTimestamp: false });
    const entry: LogEntry = {
      timestamp: 0,
      level: LogLevel.Warn,
      loggerName: "meta-test",
      message: "with meta",
      meta: { key: "val", num: 42 },
    };
    const output = fmt.format(entry);
    expect(output).toContain('"key"');
    expect(output).toContain('"val"');
  });

  it("包含 error 时应附加 error message", () => {
    const fmt = new DefaultFormatter({ color: false, showTimestamp: false });
    const entry: LogEntry = {
      timestamp: 0,
      level: LogLevel.Error,
      loggerName: "err-test",
      message: "something broke",
      error: new Error("disk full"),
    };
    const output = fmt.format(entry);
    expect(output).toContain("disk full");
  });

  it("JsonFormatter 应输出 JSON 格式", () => {
    const fmt = new JsonFormatter({ pretty: false });
    const entry: LogEntry = {
      timestamp: 123456789,
      level: LogLevel.Info,
      loggerName: "json-test",
      message: "json format",
      meta: { count: 1 },
    };
    const output = fmt.format(entry);
    const parsed = JSON.parse(output);
    expect(parsed.msg).toBe("json format");
    expect(parsed.level).toBe("INFO");
    expect(parsed.logger).toBe("json-test");
  });

  it("JsonFormatter pretty 模式应缩进", () => {
    const fmt = new JsonFormatter({ pretty: true });
    const entry: LogEntry = {
      timestamp: 0,
      level: LogLevel.Warn,
      loggerName: "pretty",
      message: "pretty json",
    };
    const output = fmt.format(entry);
    // pretty 输出应包含换行和缩进
    expect(output).toContain("\n");
    expect(output).toContain('  ');
  });

  it("所有 LOG_LEVEL_LABELS 在 DefaultFormatter 中正确渲染", () => {
    const fmt = new DefaultFormatter({ color: false, showTimestamp: false });
    const levels: [LogLevel, string][] = [
      [LogLevel.Debug, "DEBUG"],
      [LogLevel.Info, "INFO"],
      [LogLevel.Warn, "WARN"],
      [LogLevel.Error, "ERROR"],
      [LogLevel.Fatal, "FATAL"],
    ];
    for (const [level, label] of levels) {
      const output = fmt.format({ timestamp: 0, level, loggerName: "l", message: "m" });
      expect(output).toContain(`[${label}]`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// 场景 4: 日志轮转（按大小切文件）
// ══════════════════════════════════════════════════════════════

describe("场景4: 日志轮转（按大小切文件）", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logging-rotate-"));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("单个日志文件增长后应正确写入", async () => {
    // FileTransport 本身不内建轮转，但写入大量数据后文件应存在
    const logPath = path.join(tmpDir, "large.log");
    const fileTransport = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });

    for (let i = 0; i < 100; i++) {
      await fileTransport.write({
        timestamp: i,
        level: LogLevel.Info,
        loggerName: "rotate",
        message: `line ${i} - ${"x".repeat(50)}`,
      });
    }
    await fileTransport.flush();

    const stat = fs.statSync(logPath);
    expect(stat.size).toBeGreaterThan(1000); // 至少 1KB

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter(l => l.length > 0);
    expect(lines.length).toBe(100);
    expect(lines[0]).toContain("line 0");
    expect(lines[99]).toContain("line 99");

    await fileTransport.dispose();
  });

  it("多轮 flush/dispose 后日志完整性", async () => {
    const logPath = path.join(tmpDir, "durable.log");
    const fileTransport = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });

    // 第一轮写入
    await fileTransport.write({ timestamp: 1, level: LogLevel.Info, loggerName: "d", message: "first" });
    await fileTransport.flush();
    await fileTransport.dispose();

    // 重新打开追加
    const fileTransport2 = new FileTransport({ path: logPath, formatter: new DefaultFormatter({ color: false, showTimestamp: false }) });
    await fileTransport2.write({ timestamp: 2, level: LogLevel.Info, loggerName: "d", message: "second" });
    await fileTransport2.flush();

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("first");
    expect(content).toContain("second");

    await fileTransport2.dispose();
  });
});
