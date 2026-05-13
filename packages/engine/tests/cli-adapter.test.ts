// @ci: unit
import { describe, it, expect, afterEach, vi } from "vitest";
import { CLIAdapter } from "../src/cli-adapter.js";
import type { ConfirmationRequest } from "@cortex/shared";
import { ReversibilityLevel } from "@cortex/shared";

/**
 * CLIAdapter 测试。
 *
 * confirm() 依赖真实 stdin，在 CI/自动化测试中不可行。
 * 因此 confirm 测试通过直接模拟 readline 内部行为来验证逻辑，
 * 而 notify / getPlatformContext 直接测试。
 */
describe("CLIAdapter", () => {
  let adapter: CLIAdapter;

  afterEach(() => {
    // 确保每次测试后关闭 adapter
    if (adapter) {
      adapter.close();
    }
  });

  describe("getPlatformContext", () => {
    it("返回 CLI 上下文", () => {
      adapter = new CLIAdapter();
      const ctx = adapter.getPlatformContext();
      expect(ctx.kind).toBe("cli");
      expect(ctx.foreground).toBe(true);
      expect(ctx.idle).toBe(false);
    });
  });

  describe("notify", () => {
    it("写入 stdout", () => {
      adapter = new CLIAdapter();
      const spy = vi.spyOn(process.stdout, "write");
      adapter.notify("hello world");
      expect(spy).toHaveBeenCalledWith("[Cortex] hello world\n");
      spy.mockRestore();
    });
  });

  describe("confirm", () => {
    it("用户输入 y 返回 approved=true", async () => {
      adapter = new CLIAdapter();
      // 模拟 readline question 回调
      const rl = (adapter as any)._ensureRl();
      const originalQuestion = rl.question.bind(rl);
      rl.question = (_prompt: string, cb: (answer: string) => void) => {
        cb("y");
        return rl;
      };

      const req: ConfirmationRequest = {
        id: "test-1",
        level: ReversibilityLevel.L2,
        toolName: "write_file",
        summary: "Write to /etc/hosts",
      };
      const res = await adapter.confirm(req);
      expect(res.requestId).toBe("test-1");
      expect(res.approved).toBe(true);

      rl.question = originalQuestion;
    });

    it("用户输入 n 返回 approved=false", async () => {
      adapter = new CLIAdapter();
      const rl = (adapter as any)._ensureRl();
      const originalQuestion = rl.question.bind(rl);
      rl.question = (_prompt: string, cb: (answer: string) => void) => {
        cb("n");
        return rl;
      };

      const req: ConfirmationRequest = {
        id: "test-2",
        level: ReversibilityLevel.L3,
        toolName: "run_shell",
        summary: "rm -rf /tmp/build",
      };
      const res = await adapter.confirm(req);
      expect(res.approved).toBe(false);

      rl.question = originalQuestion;
    });

    it("非 y 输入（空/任意字符）返回 approved=false", async () => {
      adapter = new CLIAdapter();
      const rl = (adapter as any)._ensureRl();
      const originalQuestion = rl.question.bind(rl);
      rl.question = (_prompt: string, cb: (answer: string) => void) => {
        cb("");
        return rl;
      };

      const req: ConfirmationRequest = {
        id: "test-3",
        level: ReversibilityLevel.L2,
        toolName: "write_file",
        summary: "Some file",
      };
      const res = await adapter.confirm(req);
      expect(res.approved).toBe(false);

      rl.question = originalQuestion;
    });
  });

  describe("close", () => {
    it("关闭 readline 后 getPlatformContext 仍可用", () => {
      adapter = new CLIAdapter();
      adapter.close();
      const ctx = adapter.getPlatformContext();
      expect(ctx.kind).toBe("cli");
    });
  });
});
