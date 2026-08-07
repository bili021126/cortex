// @ci: unit
/**
 * U1 消息状态机测试——转换表每边一个用例（TDD）
 */
import { describe, it, expect } from "vitest";
import {
  messageReducer,
  InvalidTransitionError,
  isRetryable,
  isStoppable,
  hasContent,
  UI_SPEC,
  type MessageState,
  type MessageEvent,
} from "./message-state-machine";

function step(state: MessageState, event: MessageEvent["type"]): MessageState {
  return messageReducer(state, { type: event });
}

describe("U1 消息状态机——转换表全边", () => {
  it("idle --submit--> queued", () => expect(step("idle", "submit")).toBe("queued"));
  it("queued --ack--> sending", () => expect(step("queued", "ack")).toBe("sending"));
  it("queued --stop--> idle（取消）", () => expect(step("queued", "stop")).toBe("idle"));
  it("sending --first-token--> streaming", () => expect(step("sending", "first-token")).toBe("streaming"));
  it("sending --stop--> stopped", () => expect(step("sending", "stop")).toBe("stopped"));
  it("sending --net-error--> interrupted", () => expect(step("sending", "net-error")).toBe("interrupted"));
  it("sending --timeout--> error_timeout", () => expect(step("sending", "timeout")).toBe("error_timeout"));
  it("sending --fatal--> error_fatal", () => expect(step("sending", "fatal")).toBe("error_fatal"));
  it("streaming --complete--> complete", () => expect(step("streaming", "complete")).toBe("complete"));
  it("streaming --stop--> stopped", () => expect(step("streaming", "stop")).toBe("stopped"));
  it("streaming --net-error--> interrupted", () => expect(step("streaming", "net-error")).toBe("interrupted"));
  it("streaming --timeout--> error_timeout", () => expect(step("streaming", "timeout")).toBe("error_timeout"));
  it("streaming --fatal--> error_fatal", () => expect(step("streaming", "fatal")).toBe("error_fatal"));
  it("complete --regenerate--> regenerating", () => expect(step("complete", "regenerate")).toBe("regenerating"));
  it("complete --edit-and-resubmit--> queued", () => expect(step("complete", "edit-and-resubmit")).toBe("queued"));
  it("stopped --regenerate--> regenerating", () => expect(step("stopped", "regenerate")).toBe("regenerating"));
  it("stopped --edit-and-resubmit--> queued", () => expect(step("stopped", "edit-and-resubmit")).toBe("queued"));
  it("interrupted --retry--> queued", () => expect(step("interrupted", "retry")).toBe("queued"));
  it("interrupted --edit-and-resubmit--> queued", () => expect(step("interrupted", "edit-and-resubmit")).toBe("queued"));
  it("error_timeout --retry--> queued", () => expect(step("error_timeout", "retry")).toBe("queued"));
  it("error_timeout --edit-and-resubmit--> queued", () => expect(step("error_timeout", "edit-and-resubmit")).toBe("queued"));
  it("error_fatal --edit-and-resubmit--> queued", () => expect(step("error_fatal", "edit-and-resubmit")).toBe("queued"));
  it("regenerating --first-token--> streaming", () => expect(step("regenerating", "first-token")).toBe("streaming"));
  it("regenerating --stop--> stopped", () => expect(step("regenerating", "stop")).toBe("stopped"));
  it("reset 任意状态 --> idle", () => {
    expect(messageReducer("error_fatal", { type: "reset" })).toBe("idle");
    expect(messageReducer("streaming", { type: "reset" })).toBe("idle");
  });
});

describe("U1 非法转换（reducer 必须拒绝）", () => {
  it("idle --complete--> 抛 InvalidTransitionError", () => {
    expect(() => step("idle", "complete")).toThrow(InvalidTransitionError);
  });
  it("complete --retry--> 抛 InvalidTransitionError（complete 不可重试）", () => {
    expect(() => step("complete", "retry")).toThrow(InvalidTransitionError);
  });
  it("error_fatal --retry--> 抛 InvalidTransitionError（fatal 不可重试）", () => {
    expect(() => step("error_fatal", "retry")).toThrow(InvalidTransitionError);
  });
  it("queued --complete--> 抛 InvalidTransitionError", () => {
    expect(() => step("queued", "complete")).toThrow(InvalidTransitionError);
  });
});

describe("U1 辅助谓词", () => {
  it("isRetryable 仅 interrupted/error_timeout", () => {
    expect(isRetryable("interrupted")).toBe(true);
    expect(isRetryable("error_timeout")).toBe(true);
    expect(isRetryable("error_fatal")).toBe(false);
    expect(isRetryable("complete")).toBe(false);
  });
  it("isStoppable 覆盖 queued/sending/streaming/regenerating", () => {
    for (const s of ["queued", "sending", "streaming", "regenerating"] as MessageState[]) {
      expect(isStoppable(s)).toBe(true);
    }
    expect(isStoppable("complete")).toBe(false);
  });
  it("hasContent 覆盖流式/完成/停止/中断/再生成", () => {
    for (const s of ["streaming", "complete", "stopped", "interrupted", "regenerating"] as MessageState[]) {
      expect(hasContent(s)).toBe(true);
    }
    expect(hasContent("queued")).toBe(false);
  });
});

describe("U1 UI 规格完整性", () => {
  it("十态全部有 UI 规格", () => {
    const states: MessageState[] = ["idle", "queued", "sending", "streaming", "complete", "stopped", "interrupted", "error_timeout", "error_fatal", "regenerating"];
    for (const s of states) {
      expect(UI_SPEC[s]).toBeDefined();
      expect(UI_SPEC[s].bubble.length).toBeGreaterThan(0);
    }
  });
  it("error_fatal 无重试主操作（不可重试语义）", () => {
    expect(UI_SPEC.error_fatal.primaryAction).toBeUndefined();
  });
});
