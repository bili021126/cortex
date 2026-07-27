// @ci: unit
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDefaultBindings, PERMISSION_BINDINGS } from "../src/tui/interaction/key-bindings.js";
import { KeyRegistry } from "../src/tui/interaction/key-registry.js";
import type { BindingCallbacks } from "../src/tui/interaction/key-bindings.js";

// ─── createDefaultBindings ────────────────────

describe("createDefaultBindings", () => {
  const callbacks: BindingCallbacks = {
    toggleCommandPalette: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleHelp: vi.fn(),
    focusInput: vi.fn(),
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    switchAgentNext: vi.fn(),
    switchAgentPrev: vi.fn(),
    togglePlanMode: vi.fn(),
    panelNext: vi.fn(),
    panelPrev: vi.fn(),
  };

  let bindings = createDefaultBindings(callbacks);

  it("11 个默认绑定", () => {
    expect(bindings).toHaveLength(11);
  });

  // ── 全局导航 ──────────────────────────
  it("ctrl+k → toggleCommandPalette (global)", () => {
    const b = bindings.find((x) => x.id === "command-palette")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+k");
    expect(b.context).toBe("global");
    expect(b.category).toBe("navigation");
    b.handler();
    expect(callbacks.toggleCommandPalette).toHaveBeenCalledOnce();
  });

  it("ctrl+b → toggleSidebar (global)", () => {
    const b = bindings.find((x) => x.id === "toggle-sidebar")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+b");
    expect(b.context).toBe("global");
    b.handler();
    expect(callbacks.toggleSidebar).toHaveBeenCalledOnce();
  });

  it("? → toggleHelp (global)", () => {
    const b = bindings.find((x) => x.id === "help")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("?");
    expect(b.context).toBe("global");
    b.handler();
    expect(callbacks.toggleHelp).toHaveBeenCalledOnce();
  });

  // ── 聊天区导航 ────────────────────────
  it("i → focusInput (chat)", () => {
    const b = bindings.find((x) => x.id === "focus-input")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("i");
    expect(b.context).toBe("chat");
    b.handler();
    expect(callbacks.focusInput).toHaveBeenCalledOnce();
  });

  it("ctrl+u → scrollUp (chat)", () => {
    const b = bindings.find((x) => x.id === "scroll-up")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+u");
    expect(b.context).toBe("chat");
    b.handler();
    expect(callbacks.scrollUp).toHaveBeenCalledOnce();
  });

  it("ctrl+d → scrollDown (chat)", () => {
    const b = bindings.find((x) => x.id === "scroll-down")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+d");
    expect(b.context).toBe("chat");
    b.handler();
    expect(callbacks.scrollDown).toHaveBeenCalledOnce();
  });

  // ── Agent 切换 ────────────────────────
  it("ctrl+] → switchAgentNext (global)", () => {
    const b = bindings.find((x) => x.id === "switch-agent-next")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+]");
    expect(b.context).toBe("global");
    expect(b.category).toBe("agent");
    b.handler();
    expect(callbacks.switchAgentNext).toHaveBeenCalledOnce();
  });

  it("ctrl+[ → switchAgentPrev (global)", () => {
    const b = bindings.find((x) => x.id === "switch-agent-prev")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+[");
    expect(b.context).toBe("global");
    expect(b.category).toBe("agent");
    b.handler();
    expect(callbacks.switchAgentPrev).toHaveBeenCalledOnce();
  });

  // ── 模式切换 ──────────────────────────
  it("ctrl+p → togglePlanMode (global)", () => {
    const b = bindings.find((x) => x.id === "mode-plan")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("ctrl+p");
    expect(b.context).toBe("global");
    expect(b.category).toBe("action");
    b.handler();
    expect(callbacks.togglePlanMode).toHaveBeenCalledOnce();
  });

  // ── 面板导航 ──────────────────────────
  it("} → panelNext (global)", () => {
    const b = bindings.find((x) => x.id === "panel-next")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("}");
    expect(b.context).toBe("global");
    b.handler();
    expect(callbacks.panelNext).toHaveBeenCalledOnce();
  });

  it("{ → panelPrev (global)", () => {
    const b = bindings.find((x) => x.id === "panel-prev")!;
    expect(b).toBeDefined();
    expect(b.key).toBe("{");
    expect(b.context).toBe("global");
    b.handler();
    expect(callbacks.panelPrev).toHaveBeenCalledOnce();
  });
});

// ─── PERMISSION_BINDINGS ──────────────────────

describe("PERMISSION_BINDINGS", () => {
  it("4 个权限绑定（return/a/n/s）", () => {
    expect(PERMISSION_BINDINGS).toHaveLength(4);
    const ids = PERMISSION_BINDINGS.map((b) => b.id);
    expect(ids).toContain("perm-approve");
    expect(ids).toContain("perm-approve-all");
    expect(ids).toContain("perm-deny");
    expect(ids).toContain("perm-skip");
    // 优先级 10（比默认高）
    PERMISSION_BINDINGS.forEach((b) => expect(b.priority).toBe(10));
    // 上下文 modal
    PERMISSION_BINDINGS.forEach((b) => expect(b.context).toBe("modal"));
  });
});

// ─── KeyRegistry ──────────────────────────────

describe("KeyRegistry", () => {
  let registry: KeyRegistry;

  beforeEach(() => {
    registry = new KeyRegistry();
  });

  it("register → unregister", () => {
    const unreg = registry.register({
      id: "test", key: "a", label: "A", category: "navigation", handler: vi.fn(),
    });
    expect(registry.getAllBindings()).toHaveLength(1);
    unreg();
    expect(registry.getAllBindings()).toHaveLength(0);
  });

  it("handleKeyPress 精确匹配", () => {
    const handler = vi.fn();
    registry.register({ id: "t", key: "a", label: "A", category: "navigation", handler });
    const consumed = registry.handleKeyPress("a");
    expect(consumed).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("handleKeyPress 返回 false 不匹配时", () => {
    const handler = vi.fn();
    registry.register({ id: "t", key: "b", label: "B", category: "navigation", handler });
    const consumed = registry.handleKeyPress("a");
    expect(consumed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("上下文感知：不匹配不同上下文的绑定", () => {
    const handler = vi.fn();
    registry.register({ id: "t", key: "x", label: "X", category: "navigation", context: "modal", handler });
    // 在 global 上下文不触发 modal 绑定
    const consumed = registry.handleKeyPress("x", "global");
    expect(consumed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    // 在 modal 上下文触发
    const consumed2 = registry.handleKeyPress("x", "modal");
    expect(consumed2).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("优先级冲突：高优先级胜出", () => {
    const low = vi.fn();
    const high = vi.fn();
    registry.register({ id: "low", key: "a", label: "A", category: "navigation", handler: low, priority: 1 });
    registry.register({ id: "high", key: "a", label: "A", category: "navigation", handler: high, priority: 10 });
    registry.handleKeyPress("a");
    // 高优先级被调用
    expect(high).toHaveBeenCalledOnce();
    expect(low).not.toHaveBeenCalled();
  });

  it("序列键：前缀等待", () => {
    registry.register({
      id: "seq", key: "g then i", label: "Go Input", category: "navigation", handler: vi.fn(),
    });
    // 按 'g' → 前缀匹配，等待
    const r1 = registry.handleKeyPress("g");
    expect(r1).toBe(false); // 未消费
    // 按 'i' → 完整序列
    const r2 = registry.handleKeyPress("i");
    expect(r2).toBe(true);
  });

  it("序列键超时后复位", () => {
    vi.useFakeTimers();
    registry.register({
      id: "seq", key: "g then i", label: "Go Input", category: "navigation", handler: vi.fn(),
    });
    registry.handleKeyPress("g"); // 前缀匹配
    vi.advanceTimersByTime(1100); // 超时
    const r = registry.handleKeyPress("i");
    expect(r).toBe(false); // 序列已复位，不匹配
    vi.useRealTimers();
  });

  it("getBindingsForContext 过滤", () => {
    registry.register({ id: "g", key: "a", label: "A", category: "navigation", handler: vi.fn(), context: "global" });
    registry.register({ id: "c", key: "b", label: "B", category: "navigation", handler: vi.fn(), context: "chat" });
    registry.register({ id: "m", key: "c", label: "C", category: "navigation", handler: vi.fn(), context: "modal" });
    const inChat = registry.getBindingsForContext("chat");
    const ids = inChat.map((b) => b.id);
    expect(ids).toContain("g"); // global 通配
    expect(ids).toContain("c"); // chat 精确匹配
    expect(ids).not.toContain("m"); // modal 不匹配
  });

  it("exportBindings 导出简约信息", () => {
    registry.register({
      id: "test", key: "ctrl+k", label: "命令面板", category: "navigation", handler: vi.fn(),
    });
    const exported = registry.exportBindings();
    expect(exported).toHaveLength(1);
    expect(exported[0]!.id).toBe("test");
    expect(exported[0]!.key).toBe("ctrl+k");
    expect(exported[0]!.label).toBe("命令面板");
    expect(exported[0]!.category).toBe("navigation");
    expect((exported[0] as any).handler).toBeUndefined();
  });

  it("destroy 清理所有", () => {
    registry.register({ id: "a", key: "a", label: "A", category: "navigation", handler: vi.fn() });
    registry.register({ id: "b", key: "b", label: "B", category: "navigation", handler: vi.fn() });
    expect(registry.getAllBindings()).toHaveLength(2);
    registry.destroy();
    expect(registry.getAllBindings()).toHaveLength(0);
  });
});
