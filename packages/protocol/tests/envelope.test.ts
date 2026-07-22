import { describe, it, expect } from "vitest";
import { createEnvelope } from "../src/envelope.js";
import { problem, ErrorType } from "../src/problem-details.js";
import { negotiateVersion, PROTOCOL_VERSION } from "../src/version.js";

describe("envelope", () => {
  it("createEnvelope 生成完整信封", () => {
    const env = createEnvelope("test.event", { foo: 1 });
    expect(env.type).toBe("test.event");
    expect(env.payload).toEqual({ foo: 1 });
    expect(env.version).toBe("1.0.0");
    expect(typeof env.id).toBe("string");
    expect(env.id.length).toBeGreaterThan(0);
    expect(typeof env.timestamp).toBe("number");
  });
});

describe("problem-details", () => {
  it("problem() 构造标准错误", () => {
    const p = problem(404, "Not Found", "Node xyz missing", "req-123");
    expect(p.type).toBe(ErrorType.NotFound);
    expect(p.status).toBe(404);
    expect(p.title).toBe("Not Found");
    expect(p.detail).toBe("Node xyz missing");
    expect(p.instance).toBe("req-123");
  });

  it("422 带字段错误", () => {
    const p = problem(422, "Validation Failed", undefined, undefined, [
      { field: "input", message: "Required" },
    ]);
    expect(p.type).toBe(ErrorType.Validation);
    expect(p.errors).toHaveLength(1);
  });
});

describe("version", () => {
  it("协商到支持的版本", () => {
    const result = negotiateVersion("1.0.0");
    expect(result.resolved).toBe("1.0.0");
    expect(result.requested).toBe("1.0.0");
  });

  it("不支持的版本回退到最新", () => {
    const result = negotiateVersion("9.9.9");
    expect(result.resolved).toBe(PROTOCOL_VERSION);
  });

  it("未指定版本使用默认", () => {
    const result = negotiateVersion(undefined);
    expect(result.resolved).toBe(PROTOCOL_VERSION);
    expect(result.requested).toBeUndefined();
  });
});
