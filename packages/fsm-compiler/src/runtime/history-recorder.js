/**
 * @cortex/fsm-compiler — History Recorder
 *
 * Records all FSM transitions for audit, debugging, and replay.
 */
export class HistoryRecorder {
    _records = [];
    _maxRecords;
    constructor(options = {}) {
        this._maxRecords = options.maxRecords ?? 0;
    }
    /**
     * Record a transition.
     */
    record(record) {
        this._records.push(record);
        // Trim if over limit
        if (this._maxRecords > 0 && this._records.length > this._maxRecords) {
            this._records = this._records.slice(-this._maxRecords);
        }
    }
    /**
     * Get all recorded transitions.
     */
    get all() {
        return this._records;
    }
    /**
     * Get transitions from a specific state.
     */
    getFrom(state) {
        return this._records.filter((r) => r.from === state);
    }
    /**
     * Get transitions to a specific state.
     */
    getTo(state) {
        return this._records.filter((r) => r.to === state);
    }
    /**
     * Get transitions for a specific event.
     */
    getByEvent(event) {
        return this._records.filter((r) => r.event === event);
    }
    /**
     * Get the last N records.
     */
    last(n) {
        return this._records.slice(-n);
    }
    /**
     * Clear all records.
     */
    clear() {
        this._records = [];
    }
    /**
     * Total number of recorded transitions.
     */
    get size() {
        return this._records.length;
    }
    /**
     * Serialize to JSON.
     */
    toJSON() {
        return JSON.stringify(this._records);
    }
    /**
     * Deserialize from JSON.
     */
    static fromJSON(json, options) {
        const recorder = new HistoryRecorder(options);
        recorder._records = JSON.parse(json);
        return recorder;
    }
}
//# sourceMappingURL=history-recorder.js.map