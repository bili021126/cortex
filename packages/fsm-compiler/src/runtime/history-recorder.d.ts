/**
 * @cortex/fsm-compiler — History Recorder
 *
 * Records all FSM transitions for audit, debugging, and replay.
 */
import type { TransitionRecord } from "./state-machine.js";
export interface HistoryRecorderOptions {
    /** Maximum number of records to keep in memory (0 = unlimited) */
    maxRecords?: number;
}
export declare class HistoryRecorder<TState extends string = string, TEvent extends string = string, TContext = unknown> {
    private _records;
    private _maxRecords;
    constructor(options?: HistoryRecorderOptions);
    /**
     * Record a transition.
     */
    record(record: TransitionRecord<TState, TEvent, TContext>): void;
    /**
     * Get all recorded transitions.
     */
    get all(): readonly TransitionRecord<TState, TEvent, TContext>[];
    /**
     * Get transitions from a specific state.
     */
    getFrom(state: TState): TransitionRecord<TState, TEvent, TContext>[];
    /**
     * Get transitions to a specific state.
     */
    getTo(state: TState): TransitionRecord<TState, TEvent, TContext>[];
    /**
     * Get transitions for a specific event.
     */
    getByEvent(event: TEvent): TransitionRecord<TState, TEvent, TContext>[];
    /**
     * Get the last N records.
     */
    last(n: number): TransitionRecord<TState, TEvent, TContext>[];
    /**
     * Clear all records.
     */
    clear(): void;
    /**
     * Total number of recorded transitions.
     */
    get size(): number;
    /**
     * Serialize to JSON.
     */
    toJSON(): string;
    /**
     * Deserialize from JSON.
     */
    static fromJSON<T extends string, E extends string, C>(json: string, options?: HistoryRecorderOptions): HistoryRecorder<T, E, C>;
}
//# sourceMappingURL=history-recorder.d.ts.map