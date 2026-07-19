// @ci: unit
import { describe, it, expect } from "vitest";
import { PersonaHeader, personaHeader } from "../../src/tui/renderer/persona-header.js";
import { AgentType } from "@cortex/shared";

describe("PersonaHeader（直接输出）", () => {
  it("update 方法存在", () => {
    const ph = new PersonaHeader();
    expect(typeof ph.update).toBe("function");
  });

  it("updateMulti 方法存在", () => {
    const ph = new PersonaHeader();
    expect(typeof ph.updateMulti).toBe("function");
  });

  it("全局单例 personaHeader 可用", () => {
    expect(personaHeader).toBeDefined();
    expect(typeof personaHeader.update).toBe("function");
  });


});
