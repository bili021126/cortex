// @ci: unit

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveSession,
  loadSession,
  clearSession,
} from "../src/session-store.js";
import type { SessionSnapshot } from "../src/session-store.js";

describe("SessionStore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-test-"));
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  /** 创建有效的会话快照 */
  function validSession(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
    return {
      agent: "code" as any,
      history: [{ role: "user", content: "hello" }],
      talkTrio: false,
      groups: [],
      ...overrides,
    };
  }

  it("should save and load session", () => {
    const session = validSession({
      agent: "architect" as any,
      history: [
        { role: "user" as const, content: "plan this" },
        { role: "assistant" as const, content: "let me think" },
      ],
    });

    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.agent).toBe("architect");
    expect(loaded!.history).toHaveLength(2);
    expect(loaded!.talkTrio).toBe(false);
    expect(loaded!.groups).toEqual([]);
  });

  it("should handle missing session file", () => {
    const result = loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it("should handle corrupted session file", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "这不是有效 JSON{{{", "utf-8");

    const result = loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it("should handle empty session file", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "", "utf-8");

    const result = loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it("should handle corrupted JSON (null value)", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "null", "utf-8");

    const result = loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it("should preserve session agent type", () => {
    const session = validSession({ agent: "fix" as any });
    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);
    expect(loaded!.agent).toBe("fix");
  });

  it("should preserve session history", () => {
    const history = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
      { role: "user" as const, content: "how are you?" },
    ];
    const session = validSession({ history });
    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);
    expect(loaded!.history).toHaveLength(3);
    expect(loaded!.history[0]!.content).toBe("hello");
    expect(loaded!.history[2]!.content).toBe("how are you?");
  });

  it("should handle invalid/extra fields gracefully", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    // \u65E7\u7248\u672C\u5B57\u6BB5\uFF08mode/partyRoster/planState\uFF09\u4E0D\u5E94\u963B\u6B62\u52A0\u8F7D
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ mode: "invalid_mode", agent: "code", history: [], talkTrio: false, partyRoster: [] }),
      "utf-8",
    );

    const result = loadSession(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.agent).toBe("code");
    expect(result!.history).toEqual([]);
  });

  it("should reject session without history array", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ mode: "chat", agent: "code", talkTrio: false, partyRoster: [] }),
      "utf-8",
    );

    const result = loadSession(tmpDir);
    expect(result).toBeNull();
  });

  it("should save with talkTrio and groups", () => {
    const session = validSession({
      talkTrio: true,
      groups: [{ id: "g1", agents: ["code", "fix"], status: "active" }],
    });

    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);

    expect(loaded!.talkTrio).toBe(true);
    expect(loaded!.groups).toHaveLength(1);
    expect(loaded!.groups[0]!.id).toBe("g1");
  });

  it("should handle history truncation (> MAX_HISTORY)", () => {
    // 创建超过 200 条的历史（MAX_HISTORY = 200）
    const manyMessages = Array.from({ length: 250 }, (_, i) => ({
      role: "user" as const,
      content: `message ${i}`,
    }));
    const session = validSession({ history: manyMessages });

    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);

    // 保存时应截断到 MAX_HISTORY
    expect(loaded!.history.length).toBeLessThanOrEqual(200);
    // 应保留最新的消息
    expect(loaded!.history[loaded!.history.length - 1]!.content).toBe("message 249");
  });

  it("should handle non-existent project root (save not throw)", () => {
    const nonExistent = path.join(tmpDir, "nonexistent", "deep");

    expect(() => {
      saveSession(nonExistent, validSession());
    }).not.toThrow();
  });

  it("clearSession should delete session file", () => {
    saveSession(tmpDir, validSession());
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    expect(fs.existsSync(sessionPath)).toBe(true);

    clearSession(tmpDir);
    expect(fs.existsSync(sessionPath)).toBe(false);
  });

  it("clearSession on non-existent file should not throw", () => {
    expect(() => clearSession(tmpDir)).not.toThrow();
  });

  it("loadSession should fix missing groups/talkTrio defaults", () => {
    const sessionPath = path.join(tmpDir, ".cortex", "tui-session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    // \u7F3A\u5C11 groups \u548C talkTrio \u5B57\u6BB5
    fs.writeFileSync(
      sessionPath,
      JSON.stringify({ agent: "code", history: [] }),
      "utf-8",
    );
  
    const loaded = loadSession(tmpDir);
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded!.groups)).toBe(true);
    expect(loaded!.talkTrio).toBe(false);
  });
});
