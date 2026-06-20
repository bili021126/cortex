// @ci: unit
/**
 * session-store.test.ts — TUI session persistence full-depth tests
 *
 * Covers saveSession, loadSession, clearSession, round-trip integrity,
 * and edge cases (truncation, invalid data, missing fields, all modes).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentType } from "@cortex/shared";
import type { LlmMessage } from "@cortex/shared";
import { saveSession, loadSession, clearSession } from "../src/tui/session-store";
import type { SessionSnapshot } from "../src/tui/session-store";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Helpers ───────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cortex-session-test-"));
}

function msg(role: LlmMessage["role"] = "user", content = "hello"): LlmMessage {
  return { role, content };
}

function makeSession(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    mode: "chat",
    agent: AgentType.Meta,
    history: [msg("user", "hi"), msg("assistant", "hello")],
    talkTrio: false,
    partyRoster: [],
    ...overrides,
  };
}

const SESSION_REL = ".cortex/tui-session.json";
const MAX_HISTORY = 200;
const VALID_MODES = ["chat", "talk", "plan", "party", "command"];

// ── Suite ─────────────────────────────────────────────────

describe("tui/session-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── saveSession ────────────────────────────────────────

  describe("saveSession", () => {
    it("creates .cortex directory if it does not exist", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      expect(fs.existsSync(cortexDir)).toBe(false);

      saveSession(tmpDir, makeSession());

      expect(fs.existsSync(cortexDir)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, SESSION_REL))).toBe(true);
    });

    it("writes valid JSON that can be parsed back", () => {
      const session = makeSession();
      saveSession(tmpDir, session);

      const raw = fs.readFileSync(path.join(tmpDir, SESSION_REL), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.mode).toBe("chat");
      expect(parsed.agent).toBe(AgentType.Meta);
      expect(parsed.history).toHaveLength(2);
    });

    it("truncates history exceeding MAX_HISTORY to last 200 entries", () => {
      const bigHistory: LlmMessage[] = Array.from({ length: 300 }, (_, i) =>
        msg("user", `message-${i}`),
      );
      saveSession(tmpDir, makeSession({ history: bigHistory }));

      const raw = fs.readFileSync(path.join(tmpDir, SESSION_REL), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.history).toHaveLength(MAX_HISTORY);
      // Should keep the *last* 200 — first kept entry is message-100
      expect(parsed.history[0].content).toBe("message-100");
      expect(parsed.history[199].content).toBe("message-299");
    });

    it("does not truncate history at exactly MAX_HISTORY", () => {
      const exactHistory: LlmMessage[] = Array.from({ length: MAX_HISTORY }, (_, i) =>
        msg("user", `msg-${i}`),
      );
      saveSession(tmpDir, makeSession({ history: exactHistory }));

      const raw = fs.readFileSync(path.join(tmpDir, SESSION_REL), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.history).toHaveLength(MAX_HISTORY);
      expect(parsed.history[0].content).toBe("msg-0");
    });

    it("preserves history under MAX_HISTORY unchanged", () => {
      const smallHistory: LlmMessage[] = [msg("user", "one"), msg("assistant", "two")];
      saveSession(tmpDir, makeSession({ history: smallHistory }));

      const raw = fs.readFileSync(path.join(tmpDir, SESSION_REL), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.history).toHaveLength(2);
      expect(parsed.history[0].content).toBe("one");
    });

    it("overwrites existing session file", () => {
      saveSession(tmpDir, makeSession({ mode: "chat" }));
      saveSession(tmpDir, makeSession({ mode: "talk" }));

      const raw = fs.readFileSync(path.join(tmpDir, SESSION_REL), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.mode).toBe("talk");
    });

    it("silently handles write errors without throwing", () => {
      // Use an invalid path to trigger a write error
      expect(() => saveSession("/dev/null/impossible", makeSession())).not.toThrow();
    });
  });

  // ── loadSession ────────────────────────────────────────

  describe("loadSession", () => {
    it("returns null when session file does not exist", () => {
      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, SESSION_REL), "not-json{{{", "utf-8");

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null when data is null", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, SESSION_REL), "null", "utf-8");

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null when mode is missing", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({ agent: "meta", history: [] }),
        "utf-8",
      );

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null when mode is not a string", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({ mode: 123, agent: "meta", history: [] }),
        "utf-8",
      );

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null when history is missing", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({ mode: "chat", agent: "meta" }),
        "utf-8",
      );

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null when history is not an array", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({ mode: "chat", agent: "meta", history: "oops" }),
        "utf-8",
      );

      expect(loadSession(tmpDir)).toBeNull();
    });

    it("returns null for invalid mode value", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({ mode: "bogus", agent: "meta", history: [] }),
        "utf-8",
      );

      expect(loadSession(tmpDir)).toBeNull();
    });

    it.each(VALID_MODES)("accepts valid mode: %s", (mode) => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({
          mode,
          agent: AgentType.Meta,
          history: [],
          talkTrio: false,
          partyRoster: [],
        }),
        "utf-8",
      );

      const result = loadSession(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.mode).toBe(mode);
    });

    it("repairs missing partyRoster to empty array", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({
          mode: "chat",
          agent: AgentType.Meta,
          history: [msg("user", "hi")],
          talkTrio: false,
          // partyRoster intentionally omitted
        }),
        "utf-8",
      );

      const result = loadSession(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.partyRoster).toEqual([]);
    });

    it("repairs missing talkTrio to false", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({
          mode: "talk",
          agent: AgentType.Meta,
          history: [],
          partyRoster: [],
          // talkTrio intentionally omitted
        }),
        "utf-8",
      );

      const result = loadSession(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.talkTrio).toBe(false);
    });

    it("repairs non-boolean talkTrio to false", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({
          mode: "talk",
          agent: AgentType.Meta,
          history: [],
          talkTrio: "yes",
          partyRoster: [],
        }),
        "utf-8",
      );

      const result = loadSession(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.talkTrio).toBe(false);
    });

    it("repairs non-array partyRoster to empty array", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, SESSION_REL),
        JSON.stringify({
          mode: "party",
          agent: AgentType.Meta,
          history: [],
          talkTrio: false,
          partyRoster: "not-an-array",
        }),
        "utf-8",
      );

      const result = loadSession(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.partyRoster).toEqual([]);
    });

    it("returns valid snapshot with all fields intact", () => {
      const session = makeSession({
        mode: "plan",
        agent: AgentType.Code,
        history: [msg("user", "plan this"), msg("assistant", "ok")],
        talkTrio: true,
        partyRoster: [AgentType.Review, AgentType.Ops],
        planState: {
          nodes: [{ id: 1 }],
          intent: "build feature",
          approved: true,
          reviewStatus: "pending",
        },
      });

      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.mode).toBe("plan");
      expect(loaded!.agent).toBe(AgentType.Code);
      expect(loaded!.history).toHaveLength(2);
      expect(loaded!.talkTrio).toBe(true);
      expect(loaded!.partyRoster).toEqual([AgentType.Review, AgentType.Ops]);
      expect(loaded!.planState).toEqual({
        nodes: [{ id: 1 }],
        intent: "build feature",
        approved: true,
        reviewStatus: "pending",
      });
    });
  });

  // ── clearSession ───────────────────────────────────────

  describe("clearSession", () => {
    it("deletes the session file when it exists", () => {
      saveSession(tmpDir, makeSession());
      const filePath = path.join(tmpDir, SESSION_REL);
      expect(fs.existsSync(filePath)).toBe(true);

      clearSession(tmpDir);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("does not throw when session file does not exist", () => {
      expect(() => clearSession(tmpDir)).not.toThrow();
    });

    it("does not remove the .cortex directory itself", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      saveSession(tmpDir, makeSession());

      clearSession(tmpDir);
      expect(fs.existsSync(cortexDir)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, SESSION_REL))).toBe(false);
    });
  });

  // ── Round-trip ─────────────────────────────────────────

  describe("round-trip (save → load)", () => {
    it("returns identical data after save and load", () => {
      const session = makeSession({
        mode: "chat",
        agent: AgentType.Code,
        history: [
          msg("system", "You are helpful"),
          msg("user", "hi"),
          msg("assistant", "hello!"),
        ],
        talkTrio: false,
        partyRoster: [AgentType.Meta],
      });

      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.mode).toBe(session.mode);
      expect(loaded!.agent).toBe(session.agent);
      expect(loaded!.history).toEqual(session.history);
      expect(loaded!.talkTrio).toBe(session.talkTrio);
      expect(loaded!.partyRoster).toEqual(session.partyRoster);
    });

    it("round-trips with planState", () => {
      const session = makeSession({
        mode: "plan",
        agent: AgentType.Strategist,
        history: [msg("user", "plan")],
        planState: {
          nodes: [1, "two", null],
          intent: "refactor core",
          approved: false,
          reviewStatus: "draft",
        },
      });

      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.planState).toEqual(session.planState);
    });

    it("round-trips with empty history", () => {
      const session = makeSession({ history: [] });
      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.history).toEqual([]);
    });

    it("round-trips with partyRoster containing multiple agents", () => {
      const roster = [AgentType.Code, AgentType.Review, AgentType.Ops, AgentType.Loop];
      const session = makeSession({
        mode: "party",
        partyRoster: roster,
        talkTrio: true,
      });

      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded!.partyRoster).toEqual(roster);
      expect(loaded!.talkTrio).toBe(true);
    });

    it("truncates oversized history on save, then loads truncated version", () => {
      const bigHistory: LlmMessage[] = Array.from({ length: 250 }, (_, i) =>
        msg(i % 2 === 0 ? "user" : "assistant", `msg-${i}`),
      );
      const session = makeSession({ history: bigHistory });

      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded).not.toBeNull();
      expect(loaded!.history).toHaveLength(MAX_HISTORY);
      // First kept message should be msg-50 (index 50 of original 250)
      expect(loaded!.history[0].content).toBe("msg-50");
      expect(loaded!.history[MAX_HISTORY - 1].content).toBe("msg-249");
    });
  });

  // ── Edge cases ─────────────────────────────────────────

  describe("edge cases", () => {
    it("handles all valid modes in round-trip", () => {
      for (const mode of VALID_MODES) {
        // Use a fresh subdir for each mode to avoid file collision
        const subDir = path.join(tmpDir, mode);
        fs.mkdirSync(subDir, { recursive: true });

        const session = makeSession({ mode });
        saveSession(subDir, session);
        const loaded = loadSession(subDir);
        expect(loaded).not.toBeNull();
        expect(loaded!.mode).toBe(mode);
      }
    });

    it("handles LlmMessage with optional fields (tool_calls, name)", () => {
      const richHistory: LlmMessage[] = [
        { role: "system", content: "init" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "tc1", name: "read_file", arguments: { path: "/foo" } }],
        },
        {
          role: "tool",
          content: "file contents",
          tool_call_id: "tc1",
          name: "read_file",
        },
      ];
      const session = makeSession({ history: richHistory });
      saveSession(tmpDir, session);
      const loaded = loadSession(tmpDir);
      expect(loaded!.history).toEqual(richHistory);
    });

    it("handles session file in deeply nested project root", () => {
      const nested = path.join(tmpDir, "a", "b", "c", "project");
      fs.mkdirSync(nested, { recursive: true });
      const session = makeSession();
      saveSession(nested, session);
      const loaded = loadSession(nested);
      expect(loaded).not.toBeNull();
      expect(loaded!.mode).toBe("chat");
    });

    it("loadSession returns null for empty file", () => {
      const cortexDir = path.join(tmpDir, ".cortex");
      fs.mkdirSync(cortexDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, SESSION_REL), "", "utf-8");

      expect(loadSession(tmpDir)).toBeNull();
    });
  });
});
