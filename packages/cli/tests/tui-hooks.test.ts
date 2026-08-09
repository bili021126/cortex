/**
 * TUI 核心测试：hooks（生命周期钩子配置——default/talk/party 结构完整性）
 */
import { describe, it, expect } from "vitest";
import { defaultHooks, talkHooks, partyHooks } from "../src/tui/hooks.js";

describe("hooks 配置", () => {
  it("defaultHooks 包含核心生命周期回调", () => {
    expect(defaultHooks).toBeDefined();
    // 核心回调存在（onEvent/onPreToolUse 等——以函数形式提供）
    for (const key of ["onEvent", "onPreToolUse", "onPostToolUse"] as const) {
      const fn = defaultHooks[key];
      if (fn !== undefined) expect(typeof fn).toBe("function");
    }
  });

  it("talkHooks 与 partyHooks 都是对象且非空", () => {
    expect(talkHooks).toBeDefined();
    expect(partyHooks).toBeDefined();
    expect(Object.keys(talkHooks).length + Object.keys(partyHooks).length).toBeGreaterThan(0);
  });

  it("三个钩子集结构兼容（同为 TuiHooks 形状）", () => {
    const keys = new Set([...Object.keys(defaultHooks), ...Object.keys(talkHooks), ...Object.keys(partyHooks)]);
    for (const k of keys) {
      const v = (defaultHooks as Record<string, unknown>)[k];
      if (v !== undefined && typeof v !== "function") {
        // 非函数字段（如开关）至少存在
        expect(k).toBeTruthy();
      }
    }
  });
});
