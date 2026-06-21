export declare class WorkerPool {
    private options;
    private workers;
    private queue;
    private busy;
    constructor(options?: {
        maxWorkers?: number;
    });
    parseJson<T = unknown>(rawText: string, timeout?: number): Promise<T>;
    shutdown(): void;
    private _getIdleWorker;
    private _dispatch;
    private _drainQueue;
}
//# sourceMappingURL=worker-pool.d.ts.map