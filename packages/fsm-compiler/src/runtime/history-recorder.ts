/**
 * @cortex/fsm-compiler — History Recorder
 *
 * Records all FSM transitions for audit, debugging, and replay.
 */

import type { TransitionRecord } from "./state-machine.js";

// ────────────────────────────────────────────────────────────
// History Recorder
// ────────────────────────────────────────────────────────────

export interface HistoryRecorderOptions {
  /** Maximum number of records to keep in memory (0 = unlimited) */
  maxRecords?: number;
}

export class HistoryRecorder<TState extends string = string, TEvent extends string = string, TContext = unknown> {
  private _records: TransitionRecord<TState, TEvent, TContext>[] = [];
  private _maxRecords: number;

  constructor(options: HistoryRecorderOptions = {}) {
    this._maxRecords = options.maxRecords ?? 0;
  }

  /**
   * Record a transition.
   */
  record(record: TransitionRecord<TState, TEvent, TContext>): void {
    this._records.push(record);

    // Trim if over limit
    if (this._maxRecords > 0 && this._records.length > this._maxRecords) {
      this._records = this._records.slice(-this._maxRecords);
    }
  }

  /**
   * Get all recorded transitions.
   */
  get all(): readonly TransitionRecord<TState, TEvent, TContext>[] {
    return this._records;
  }

  /**
   * Get transitions from a specific state.
   */
  getFrom(state: TState): TransitionRecord<TState, TEvent, TContext>[] {
    return this._records.filter((r) => r.from === state);
  }

  /**
   * Get transitions to a specific state.
   */
  getTo(state: TState): TransitionRecord<TState, TEvent, TContext>[] {
    return this._records.filter((r) => r.to === state);
  }

  /**
   * Get transitions for a specific event.
   */
  getByEvent(event: TEvent): TransitionRecord<TState, TEvent, TContext>[] {
    return this._records.filter((r) => r.event === event);
  }

  /**
   * Get the last N records.
   */
  last(n: number): TransitionRecord<TState, TEvent, TContext>[] {
    return this._records.slice(-n);
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this._records = [];
  }

  /**
   * Total number of recorded transitions.
   */
  get size(): number {
    return this._records.length;
  }

  /**
   * Serialize to JSON.
   */
  toJSON(): string {
    return JSON.stringify(this._records);
  }

  /**
   * Deserialize from JSON.
   */
  static fromJSON<T extends string, E extends string, C>(
    json: string,
    options?: HistoryRecorderOptions,
  ): HistoryRecorder<T, E, C> {
    const recorder = new HistoryRecorder<T, E, C>(options);
    recorder._records = JSON.parse(json);
    return recorder;
  }
}
