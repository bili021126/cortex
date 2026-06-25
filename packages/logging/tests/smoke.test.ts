import { describe, it, expect } from "vitest";
import { createLogger, LogLevel, configureRootLogger, Logger, DefaultFormatter } from "../src/index.js";
import type { LogEntry } from "../src/types.js";

describe("@cortex/logging smoke", () => {
  it("createLogger → info 不抛异常", () => {
    const log = createLogger("smoke-test");
    expect(() => {
      log.info("smoke test message", { key: "value" });
    }).not.toThrow();
  });

  it("级别过滤生效——Debug 默认低于 Info，被静默", () => {
    const log = createLogger("filter-test");
    let output = "";
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: any) => { output += chunk.toString(); return true; };
    try {
      log.debug("should be filtered");
      expect(output).toBe("");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("LogLevel 枚举对齐", () => {
    expect(LogLevel.Debug).toBe(0);
    expect(LogLevel.Info).toBe(10);
    expect(LogLevel.Warn).toBe(20);
    expect(LogLevel.Error).toBe(30);
    expect(LogLevel.Fatal).toBe(40);
  });

  it("configureRootLogger 可覆盖配置", () => {
    expect(() => configureRootLogger({ minLevel: LogLevel.Warn })).not.toThrow();
  });

  it("createLogger 返回 Logger 实例", () => {
    const log = createLogger("instance-test");
    expect(log).toBeInstanceOf(Logger);
    expect(log.name).toBe("instance-test");
  });

  it("不同日志级别可正常调用", () => {
    const log = createLogger("level-test");
    expect(() => {
      log.info("info message");
      log.warn("warn message");
      log.error("error message");
      log.fatal("fatal message");
    }).not.toThrow();
  });

  it("日志格式化含 logger name", () => {
    const entry: LogEntry = {
      timestamp: 1700000000000,
      level: LogLevel.Info,
      loggerName: "format-test",
      message: "format check",
      meta: undefined,
      error: undefined,
    };
    const formatter = new DefaultFormatter({ color: false, showTimestamp: false });
    const formatted = formatter.format(entry);
    expect(formatted).toContain("format-test");
    expect(formatted).toContain("format check");
    expect(formatted).toContain("[INFO]");
  });

  it("多参数日志不抛异常", () => {
    const log = createLogger("multiarg-test");
    expect(() => {
      log.info("msg with meta", { a: 1, b: "two" });
      log.error("err with error", { ctx: "test" }, new Error("test error"));
      log.info("just a string");
    }).not.toThrow();
  });
});
import { describe, it, expect } from "vitest";
import { createLogger, LogLevel, configureRootLogger } from "../src/index.js";

describe("@cortex/logging smoke", () => {
  it("createLogger → info 不抛异常", () => {
    const log = createLogger("smoke-test");
    expect(() => {
      log.info("smoke test message", { key: "value" });
    }).not.toThrow();
  });

  it("级别过滤生效——Debug 默认低于 Info，被静默", () => {
    const log = createLogger("filter-test");
    let output = "";
    const origWrite = process.stderr.write;
    process.stderr.write = (chunk: any) => { output += chunk.toString(); return true; };
    try {
      log.debug("should be filtered");
      expect(output).toBe("");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("LogLevel 枚举对齐", () => {
    expect(LogLevel.Debug).toBe(0);
    expect(LogLevel.Info).toBe(10);
    expect(LogLevel.Warn).toBe(20);
    expect(LogLevel.Error).toBe(30);
    expect(LogLevel.Fatal).toBe(40);
  });

  it("configureRootLogger 可覆盖配置", () => {
    expect(() => configureRootLogger({ minLevel: LogLevel.Warn })).not.toThrow();
  });
});
