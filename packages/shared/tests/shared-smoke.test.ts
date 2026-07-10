// @ci: unit
import { describe, it, expect } from "vitest";
import { AgentType, PipelineEventType, TAG_VOCABULARY } from "@cortex/shared";

describe("shared barrel smoke", () => {
  it("AgentType has expected values", () => {
    expect(AgentType.Code).toBe("code");
    expect(AgentType.Meta).toBe("meta");
  });
  
  it("PipelineEventType has expected values", () => {
    expect(PipelineEventType.NodeStart).toBeTruthy();
    expect(PipelineEventType.SchedulerDone).toBeTruthy();
  });
  
  it("TAG_VOCABULARY is non-empty", () => {
    expect(TAG_VOCABULARY.length).toBeGreaterThan(30);
  });
});
