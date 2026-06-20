// @ci: unit

import { describe, it, expect } from "vitest";
import {
  createDefaultConflictDetector,
  SchemaEnforcer,
  AGENT_MEMORY_SCOPES,
  DEFAULT_TEAM_COLLAB_CONFIG,
} from "@cortex/consistency";

describe("@cortex/consistency — 导出完整性", () => {
  it("createDefaultConflictDetector 可创建", () => {
    const detector = createDefaultConflictDetector();
    expect(detector).toBeDefined();
    expect(typeof detector.detect).toBe("function");
  });

  it("SchemaEnforcer 可实例化且 validate 可用", () => {
    const enforcer = new SchemaEnforcer();
    expect(enforcer).toBeDefined();
    expect(typeof enforcer.validate).toBe("function");
  });

  it("AGENT_MEMORY_SCOPES 为已定义常量", () => {
    expect(AGENT_MEMORY_SCOPES).toBeDefined();
    expect(typeof AGENT_MEMORY_SCOPES).toBe("object");
  });

  it("DEFAULT_TEAM_COLLAB_CONFIG 有合理默认值", () => {
    expect(DEFAULT_TEAM_COLLAB_CONFIG).toBeDefined();
    expect(typeof DEFAULT_TEAM_COLLAB_CONFIG).toBe("object");
  });
});
