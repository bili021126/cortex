import { describe, it, expect } from "vitest";
import { ConfirmGate } from "../src/confirm-gate.js";
import type { PlatformBridge, ConfirmationRequest, ConfirmationResponse, PlatformContext } from "@cortex/shared";
import { ReversibilityLevel, PlatformKind } from "@cortex/shared";

/**
 * 测试用 MockBridge —— 模拟 PlatformBridge，不依赖真实 stdin。
 */
class MockBridge implements PlatformBridge {
  /** 预设的确认结果 */
  private _nextApproval = true;

  setNextApproval(approved: boolean): void {
    this._nextApproval = approved;
  }

  async confirm(request: ConfirmationRequest): Promise<ConfirmationResponse> {
    return { requestId: request.id, approved: this._nextApproval };
  }

  notify(_message: string): void {
    // no-op
  }

  getPlatformContext(): PlatformContext {
    return { kind: PlatformKind.CLI, foreground: true, idle: false };
  }
}

describe("ConfirmGate + PlatformBridge 集成", () => {
  describe("有 bridge 时：真实用户交互路径", () => {
    it("bridge 返回 approved=true → waitFor 返回 true", async () => {
      const gate = new ConfirmGate();
      const bridge = new MockBridge();
      bridge.setNextApproval(true);
      gate.setBridge(bridge);

      const reqId = gate.request({
        id: "confirm-write-1",
        level: ReversibilityLevel.L2,
        toolName: "write_file",
        summary: "Write to /tmp/test.txt",
      });

      const result = await gate.waitFor(reqId);
      expect(result).toBe(true);
      // 确认后 pending 清空
      expect(gate.hasPending()).toBe(false);
    });

    it("bridge 返回 approved=false → waitFor 返回 false", async () => {
      const gate = new ConfirmGate();
      const bridge = new MockBridge();
      bridge.setNextApproval(false);
      gate.setBridge(bridge);

      const reqId = gate.request({
        id: "confirm-shell-1",
        level: ReversibilityLevel.L3,
        toolName: "run_shell",
        summary: "rm -rf /tmp/build",
      });

      const result = await gate.waitFor(reqId);
      expect(result).toBe(false);
      expect(gate.hasPending()).toBe(false);
    });

    it("L2 write_file 经 bridge 确认通过", async () => {
      const gate = new ConfirmGate();
      const bridge = new MockBridge();
      bridge.setNextApproval(true);
      gate.setBridge(bridge);

      expect(gate.needsConfirmation(ReversibilityLevel.L2)).toBe(true);

      const reqId = gate.request({
        id: "confirm-l2-1",
        level: ReversibilityLevel.L2,
        toolName: "write_file",
        summary: "Create new config file",
      });

      const approved = await gate.waitFor(reqId);
      expect(approved).toBe(true);
    });

    it("L3 run_shell 经 bridge 确认被拒", async () => {
      const gate = new ConfirmGate();
      const bridge = new MockBridge();
      bridge.setNextApproval(false);
      gate.setBridge(bridge);

      expect(gate.needsConfirmation(ReversibilityLevel.L3)).toBe(true);

      const reqId = gate.request({
        id: "confirm-l3-1",
        level: ReversibilityLevel.L3,
        toolName: "run_shell",
        summary: "Delete production database",
      });

      const approved = await gate.waitFor(reqId);
      expect(approved).toBe(false);
    });
  });

  describe("无 bridge 时：兼容旧的 resolve() 路径", () => {
    it("resolve(true) → waitFor 返回 true", async () => {
      const gate = new ConfirmGate();
      // 不注入 bridge——走旧路径

      const reqId = gate.request({
        id: "no-bridge-1",
        level: ReversibilityLevel.L2,
        toolName: "write_file",
        summary: "test",
      });

      // 异步 resolve
      setTimeout(() => gate.resolve({ requestId: reqId, approved: true }), 5);

      const result = await gate.waitFor(reqId);
      expect(result).toBe(true);
    });

    it("resolve(false) → waitFor 返回 false", async () => {
      const gate = new ConfirmGate();

      const reqId = gate.request({
        id: "no-bridge-2",
        level: ReversibilityLevel.L2,
        toolName: "run_shell",
        summary: "test",
      });

      setTimeout(() => gate.resolve({ requestId: reqId, approved: false }), 5);

      const result = await gate.waitFor(reqId);
      expect(result).toBe(false);
    });
  });
});
