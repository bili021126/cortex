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
        process.stderr.write = (chunk) => { output += chunk.toString(); return true; };
        try {
            log.debug("should be filtered");
            expect(output).toBe("");
        }
        finally {
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
//# sourceMappingURL=smoke.test.js.map