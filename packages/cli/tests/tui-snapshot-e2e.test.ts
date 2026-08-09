/**
 * TUI 集成测试：群聊快照持久化端到端（createGroup → saveSession → loadSession → restoreGroup）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GroupChatManager } from "../src/tui/group-chat.js";
import { saveSession, loadSession } from "../src/tui/session-store.js";

let ws: string;
let mgr: GroupChatManager;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tui-snap-"));
  mgr = new GroupChatManager();
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("群聊快照端到端", () => {
  it("创建群+消息 → 持久化 → 新进程恢复（消息/任务/状态完整）", () => {
    const id = mgr.createGroup("跨 Agent 修复", ["fix", "code"] as never);
    mgr.addMessage(id, { agent: "fix", type: "chat", content: "我来修" } as never);
    mgr.addMessage(id, { agent: "code", type: "chat", content: "我来写" } as never);

    // 持久化（含群快照）
    saveSession(ws, {
      agent: "cyrene",
      history: [{ role: "user", content: "hi" }],
      groups: [mgr.getActiveSnapshot() as never].filter(Boolean),
      talkTrio: false,
    });

    // 新进程恢复
    const loaded = loadSession(ws);
    expect(loaded).not.toBeNull();
    const mgr2 = new GroupChatManager();
    for (const g of loaded?.groups ?? []) {
      mgr2.restoreGroup(g as never);
    }
    const restored = mgr2.groups.get(id);
    expect(restored?.task).toBe("跨 Agent 修复");
    expect(restored?.messages.length).toBe(2);
    expect(restored?.messages.map((m) => m.content)).toEqual(["我来修", "我来写"]);
    expect(restored?.status).toBe("active");
    expect(mgr2.activeGroupId).toBe(id);
  });

  it("无群聊时持久化 groups 为空数组——恢复后无群", () => {
    saveSession(ws, { agent: "cyrene", history: [], groups: [], talkTrio: false });
    const loaded = loadSession(ws);
    expect(loaded?.groups).toEqual([]);
    const mgr2 = new GroupChatManager();
    for (const g of loaded?.groups ?? []) {
      mgr2.restoreGroup(g as never);
    }
    expect(mgr2.groups.size).toBe(0);
  });
});
