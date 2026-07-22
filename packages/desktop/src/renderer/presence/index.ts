/**
 * presence/index.ts — Presence 层公共导出
 *
 * 她活着，不需要理由。
 */

export { PresenceEngine, type PresenceEngineOptions } from "./presence-engine";
export { BootSequence, type BootPhase, type BootSequenceCallbacks, type BootSequenceOptions, type DaemonBootInfo } from "./boot-sequence";
export { IdleBehaviorController, type IdleBehaviorOptions } from "./idle-behavior";
export { resolveExpression, EMOTION_MAP, type ExpressionDelta, type PresenceEvent, type PresenceEventType } from "./emotion-map";
