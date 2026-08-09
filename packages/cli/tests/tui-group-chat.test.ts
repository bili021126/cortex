/**
 * TUI 核心测试：group-chat（群聊管理——创建/消息/解散/事件/LRU）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GroupChatManager } from "../src/tui/group-chat.js";

let mgr: GroupChatManager;

beforeEach(() => {
  mgr = new GroupChatManager();
});

describe("GroupChatManager", () => {
  it("createGroup 创建并设为活跃群", () => {
    const id = mgr.createGroup("修复 daemon", ["fix", "analysis"] as never);
    expect(id).toMatch(/^gc-/);
    expect(mgr.activeGroupId).toBe(id);
    const g = mgr.groups.get(id);
    expect(g?.status).toBe("active");
    expect(g?.task).toBe("修复 daemon");
  });

  it("createGroup 对 agents 去重", () => {
    const id = mgr.createGroup("任务", ["fix", "fix", "code"] as never);
    expect(mgr.groups.get(id)?.agents.length).toBe(2);
  });

  it("addMessage 推送消息并触发 message 事件", () => {
    const events: string[] = [];
    mgr.on((e) => events.push(e.type));
    const id = mgr.createGroup("任务", ["fix"] as never);
    mgr.addMessage(id, { agent: "fix", type: "chat", content: "开始" } as never);
    expect(mgr.groups.get(id)?.messages.length).toBe(1);
    expect(events).toContain("message");
  });

  it("addMessage 到不存在的群静默忽略", () => {
    expect(() => mgr.addMessage("gc-nope", { agent: "fix", type: "chat", content: "x" } as never)).not.toThrow();
    expect(mgr.groups.size).toBe(0);
  });

  it("dissolveGroup 标记 done + 追加 summary 系统消息", () => {
    const id = mgr.createGroup("任务", ["fix"] as never);
    mgr.dissolveGroup(id, "全部完成");
    expect(mgr.groups.get(id)?.status).toBe("done");
    const msgs = mgr.groups.get(id)?.messages ?? [];
    expect(msgs.at(-1)?.type).toBe("system");
    expect(msgs.at(-1)?.content).toContain("全部完成");
  });

  it("dissolveGroup 触发 dissolved 事件", () => {
    const events: string[] = [];
    mgr.on((e) => events.push(e.type));
    const id = mgr.createGroup("任务", ["fix"] as never);
    mgr.dissolveGroup(id, "done");
    expect(events).toContain("dissolved");
  });

  it("on 返回退订函数——退订后不再收到事件", () => {
    const events: string[] = [];
    const off = mgr.on((e) => events.push(e.type));
    const id = mgr.createGroup("任务", ["fix"] as never);
    off();
    mgr.addMessage(id, { agent: "fix", type: "chat", content: "x" } as never);
    expect(events).toContain("created"); // 退订前的事件仍在
    expect(events.filter((t) => t === "message").length).toBe(0);
  });

  it("LRU 淘汰：超上限时淘汰最旧的已归档群", () => {
    // 先创建 20 个并归档（dissolve）
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = mgr.createGroup(`任务-${i}`, ["fix"] as never);
      mgr.dissolveGroup(id, "done");
      ids.push(id);
    }
    // 第 21 个（active）——触发 LRU 淘汰最旧的已归档群
    mgr.createGroup("新任务", ["fix"] as never);
    expect(mgr.groups.size).toBeLessThanOrEqual(20);
    // 最旧的归档群被淘汰
    expect(mgr.groups.has(ids[0] ?? "")).toBe(false);
  });

  it("restoreGroup 从快照恢复群聊（消息完整）", () => {
    const id = mgr.createGroup("任务", ["fix"] as never);
    mgr.addMessage(id, { agent: "fix", type: "chat", content: "开始" } as never);
    const snap = mgr.getActiveSnapshot();
    expect(snap).not.toBeNull();

    // 新 manager 恢复
    const mgr2 = new GroupChatManager();
    mgr2.restoreGroup(snap as never);
    const restored = mgr2.groups.get(id);
    expect(restored?.task).toBe("任务");
    expect(restored?.messages.length).toBe(1);
    expect(restored?.messages[0]?.content).toBe("开始");
    expect(restored?.status).toBe("active");
    expect(mgr2.activeGroupId).toBe(id);
  });

  it("restoreGroup 恢复非活跃群不设为 activeGroupId", () => {
    const id = mgr.createGroup("任务", ["fix"] as never);
    mgr.dissolveGroup(id, "done");
    const snap = mgr.getActiveSnapshot();
    // dissolve 后 activeGroupId 可能变化——直接构造 done 快照
    const doneSnap = { id: "gc-done-1", task: "旧任务", agents: ["fix"], messages: [], status: "done" };
    const mgr2 = new GroupChatManager();
    mgr2.restoreGroup(doneSnap as never);
    expect(mgr2.groups.get("gc-done-1")?.status).toBe("done");
    expect(mgr2.activeGroupId).not.toBe("gc-done-1");
  });
});
