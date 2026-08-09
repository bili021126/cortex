/**
 * TUI 核心测试：session-store（会话持久化——save/load/clear 往返 + 容错）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveSession, loadSession, clearSession, type SessionSnapshot } from "../src/tui/session-store.js";

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "tui-sess-"));
});

afterEach(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

const snapshot: SessionSnapshot = {
  agent: "cyrene",
  history: [
    { role: "user", content: "你好" },
    { role: "assistant", content: "伙伴～" },
  ],
  groups: [],
  talkTrio: false,
};

describe("saveSession / loadSession", () => {
  it("保存后能完整加载（往返一致）", () => {
    saveSession(ws, snapshot);
    const loaded = loadSession(ws);
    expect(loaded).not.toBeNull();
    expect(loaded?.agent).toBe("cyrene");
    expect(loaded?.history.length).toBe(2);
    expect(loaded?.history[1]?.content).toBe("伙伴～");
    expect(loaded?.talkTrio).toBe(false);
  });

  it("历史超过 MAX_HISTORY 时截断尾部", () => {
    const big: SessionSnapshot = {
      ...snapshot,
      history: Array.from({ length: 500 }, (_, i) => ({ role: "user" as const, content: `msg-${i}` })),
    };
    saveSession(ws, big);
    const loaded = loadSession(ws);
    expect(loaded?.history.length).toBeLessThanOrEqual(200);
    // 保留的是尾部（最新消息）
    expect(loaded?.history.at(-1)?.content).toBe("msg-499");
  });

  it("groups 非数组时容错为 []", () => {
    const dir = path.join(ws, ".cortex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(ws, ".cortex", "tui-session.json"), JSON.stringify({ ...snapshot, groups: "bad" }), "utf-8");
    const loaded = loadSession(ws);
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded?.groups)).toBe(true);
  });

  it("文件不存在 → null", () => {
    expect(loadSession(ws)).toBeNull();
  });

  it("损坏 JSON → null（不抛异常）", () => {
    const dir = path.join(ws, ".cortex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(ws, ".cortex", "tui-session.json"), "{not-json", "utf-8");
    expect(() => loadSession(ws)).not.toThrow();
    expect(loadSession(ws)).toBeNull();
  });

  it("history 非数组 → null（基本合法性校验）", () => {
    const dir = path.join(ws, ".cortex");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(ws, ".cortex", "tui-session.json"), JSON.stringify({ agent: "cyrene", history: "bad" }), "utf-8");
    expect(loadSession(ws)).toBeNull();
  });
});

describe("clearSession", () => {
  it("删除会话文件", () => {
    saveSession(ws, snapshot);
    expect(loadSession(ws)).not.toBeNull();
    clearSession(ws);
    expect(loadSession(ws)).toBeNull();
  });

  it("文件不存在时静默", () => {
    expect(() => clearSession(ws)).not.toThrow();
  });
});
