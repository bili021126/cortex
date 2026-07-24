// @ci: unit
/**
 * @cortex/server — Daemon unit tests
 *
 * Basic construction tests that don't require engine dependencies.
 */

import { describe, it, expect } from "vitest";
import { CortexDaemon, type DaemonOptions } from "../src/daemon.js";
import { SessionManager } from "../src/session-manager.js";
import { RemoteGateBridge } from "../src/gate-bridge.js";

describe("CortexDaemon", () => {
  it("can be constructed with minimal options", () => {
    const options: DaemonOptions = {
      projectRoot: "/tmp/test-project",
    };
    const daemon = new CortexDaemon(options);
    expect(daemon).toBeDefined();
    expect(daemon.uptime).toBe(0);
    expect(daemon.activeSessions).toBe(0);
  });

  it("accepts full options", () => {
    const options: DaemonOptions = {
      projectRoot: "/tmp/test-project",
      port: 4000,
      host: "0.0.0.0",
      workspaceRoot: "/tmp/workspace",
    };
    const daemon = new CortexDaemon(options);
    expect(daemon).toBeDefined();
  });
});

describe("SessionManager", () => {
  it("creates and retrieves sessions", () => {
    const manager = new SessionManager();
    const session = manager.create("cyrene", "chat", () => {});

    expect(session.id).toBeDefined();
    expect(session.agent).toBe("cyrene");
    expect(session.mode).toBe("chat");
    expect(session.messageCount).toBe(0);
    expect(session.history).toEqual([]);

    const retrieved = manager.get(session.id);
    expect(retrieved).toBe(session);
  });

  it("destroys sessions", () => {
    const manager = new SessionManager();
    const session = manager.create("cyrene", "chat", () => {});
    manager.destroy(session.id);
    expect(manager.get(session.id)).toBeUndefined();
  });

  it("lists sessions as DTOs", () => {
    const manager = new SessionManager();
    manager.create("cyrene", "chat", () => {});
    manager.create("ganyu", "plan", () => {});

    const list = manager.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.agent).toBe("cyrene");
    expect(list[1]!.agent).toBe("ganyu");
  });

  it("reports size", () => {
    const manager = new SessionManager();
    expect(manager.size).toBe(0);
    manager.create("cyrene", "chat", () => {});
    expect(manager.size).toBe(1);
  });
});

describe("RemoteGateBridge", () => {
  it("resolves pending confirmations", async () => {
    const broadcasts: { channel: string; data: unknown }[] = [];
    const bridge = new RemoteGateBridge((channel, data) => {
      broadcasts.push({ channel, data });
    });

    // Start a confirm request (don't await yet)
    const confirmPromise = bridge.confirm({
      id: "req-1",
      level: "L2" as never,
      toolName: "write_file",
      summary: "Write to file",
    });

    // Should have broadcast a gate.request
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.channel).toBe("gate");

    // Resolve it
    const resolved = bridge.resolve("req-1", true);
    expect(resolved).toBe(true);

    const response = await confirmPromise;
    expect(response.approved).toBe(true);
    expect(response.requestId).toBe("req-1");
  });

  it("cancelAll rejects pending with approved=false", async () => {
    const bridge = new RemoteGateBridge(() => {});

    const confirmPromise = bridge.confirm({
      id: "req-2",
      level: "L2" as never,
      toolName: "delete_file",
      summary: "Delete file",
    });

    bridge.cancelAll();

    const response = await confirmPromise;
    expect(response.approved).toBe(false);
  });

  it("returns false for unknown requestId", () => {
    const bridge = new RemoteGateBridge(() => {});
    expect(bridge.resolve("nonexistent", true)).toBe(false);
  });

  it("provides platform context", () => {
    const bridge = new RemoteGateBridge(() => {});
    const ctx = bridge.getPlatformContext();
    expect(ctx.kind).toBe("cli");
    expect(ctx.foreground).toBe(true);
    expect(ctx.idle).toBe(false);
  });
});
