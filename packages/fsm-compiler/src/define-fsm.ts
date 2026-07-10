import type { FsmDefinition } from "./types.js";

/**
 * 编译期类型安全的 FSM 定义构造器。
 *
 * 确保 states.id 必须是 State 联合类型的成员，
 * transitions.event 必须是 Event 联合类型的成员，
 * initialState / finalStates 必须是 State 联合类型的成员。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 *
 * @example
 * ```ts
 * type S = "idle" | "running";
 * type E = "start" | "stop";
 * const fsm = defineFsm<S, E>({ states: [{ id: "idle" }], ... });  // ✅
 * const bad = defineFsm<S, E>({ states: [{ id: "typo" }], ... });  // ❌ TS error
 * ```
 */
export function defineFsm<State extends string, Event extends string>(
  definition: FsmDefinition & {
    states: Array<{ id: State; displayName?: string; style?: string }>;
    transitions: Array<{
      id?: string;
      from: State;
      to: State;
      event: Event;
      guard?: string;
      action?: string;
    }>;
    initialState: State;
    finalStates: State[];
  },
): FsmDefinition {
  return definition;
}
