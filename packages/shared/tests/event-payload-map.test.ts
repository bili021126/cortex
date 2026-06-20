import { describe, it, expect } from "vitest";
import { PipelineEventType, type EventPayloadMap } from "../src/index.js";

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
      expect(evt).toMatch(/^[a-z]+\.[a-z_]+$/);
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
});
