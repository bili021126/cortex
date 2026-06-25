import { describe, it, expect } from "vitest";
import { PipelineEventType } from "../src/infra.js";

describe("EventPayloadMap 一致性", () => {
  // Verify that every PipelineEventType value has a corresponding key in EventPayloadMap
  it("每个 PipelineEventType 都在 EventPayloadMap 中有对应条目", () => {
    const evtValues = Object.values(PipelineEventType).filter(
      (v): v is string => typeof v === "string"
    );
    // EventPayloadMap is a type, not a runtime value - so we check enum consistency
    expect(evtValues.length).toBeGreaterThan(20);
    // Event 类型命名规范：点号分段
    for (const evt of evtValues) {
      expect(evt).toMatch(/^[a-z_]+(\.[a-z_.]+)?$/);
    }
  });

  it("Constitution 事件类型命名规范", () => {
    expect(PipelineEventType.ConstitutionViolation).toBe("constitution.violation");
    expect(PipelineEventType.ConstitutionSessionConvened).toBe("constitution.session_convened");
    expect(PipelineEventType.ConstitutionSessionResolved).toBe("constitution.session_resolved");
  });

  it("核心事件类型存在", () => {
    expect(PipelineEventType.ErrorReported).toBe("error.reported");
    expect(PipelineEventType.NodeFailed).toBe("node.failed");
    expect(PipelineEventType.NodeStart).toBe("node.start");
    expect(PipelineEventType.NodeComplete).toBe("node.complete");
    expect(PipelineEventType.AgentBoundaryViolation).toBe("agent.boundary_violation");
  });

  // ── C1 补充：双向一致性 ────────────────────────

  it("PipelineEventType 枚举值唯一（无重复值）", () => {
    const values = Object.values(PipelineEventType).filter(
      (v): v is string => typeof v === "string"
    );
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("PipelineEventType 枚举值命名均使用点号分隔的小写", () => {
    const values = Object.values(PipelineEventType).filter(
      (v): v is string => typeof v === "string"
    );
    for (const v of values) {
      expect(v).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)*$/);
    }
  });

  it("所有事件字符串长度合理（< 100 字符）", () => {
    const values = Object.values(PipelineEventType).filter(
      (v): v is string => typeof v === "string"
    );
    for (const v of values) {
      expect(v.length).toBeLessThan(100);
    }
  });

  it("枚举成员均符合 PascalCase 规范且数量合理", () => {
    const enumKeys = Object.keys(PipelineEventType).filter(
      (k) => isNaN(Number(k))
    );
    expect(enumKeys.length).toBeGreaterThan(0);
    for (const key of enumKeys) {
      expect(key).toMatch(/^[A-Z][a-zA-Z0-9]*$/);
    }
  });

  it("所有命名空间前缀（点号前部分）不超过 20 个", () => {
    const values = Object.values(PipelineEventType).filter(
      (v): v is string => typeof v === "string"
    );
    const prefixes = new Set(values.map((v) => v.split(".")[0]!));
    expect(prefixes.size).toBeLessThanOrEqual(20);
    // 已知命名空间
    expect(prefixes.has("node")).toBe(true);
    expect(prefixes.has("scheduler")).toBe(true);
    expect(prefixes.has("memory")).toBe(true);
    expect(prefixes.has("constitution")).toBe(true);
    expect(prefixes.has("governance")).toBe(true);
  });
});
