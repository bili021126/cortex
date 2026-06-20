import { describe, it, expect } from "vitest";
import { SchemaEnforcer } from "../src/schema-enforcer.js";

describe("@cortex/consistency smoke", () => {
  it("SchemaEnforcer 可实例化", () => {
    const enforcer = new SchemaEnforcer();
    expect(enforcer).toBeInstanceOf(SchemaEnforcer);
  });

  it("校验合法 MemoryWriteInput", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(true);
  });

  it("校验拒绝缺少 kind", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: undefined as any,
      summary: "test summary",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("校验拒绝缺少 summary", () => {
    const enforcer = new SchemaEnforcer();
    const result = enforcer.validate({
      source: { agentType: "test" as any },
      kind: "test-kind" as any,
      summary: "",
      semantic_gist: "test gist",
      content_blob: { data: 1 },
    });
    expect(result.valid).toBe(false);
  });
});
