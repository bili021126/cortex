/**
 * WorkerPool —— CPU 密集型操作独立线程池
 *
 * 将同步 CPU 操作（JSON 解析）搬到 worker_threads，
 * 确保 Agent A 的阻塞不打扰 Agent B 的超时触发。
 *
 * 调度器零改动。仅通过 parseJson 方法对调用方提供异步包装。
 */
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.resolve(__dirname, "worker-script.mjs");
export class WorkerPool {
    options;
    workers = [];
    queue = [];
    busy = new Set();
    constructor(options = {}) {
        this.options = options;
        const count = options.maxWorkers ?? Math.max(1, cpus().length - 1);
        for (let i = 0; i < count; i++) {
            this.workers.push(new Worker(WORKER_SCRIPT));
        }
    }
    async parseJson(rawText, timeout) {
        return new Promise((resolve, reject) => {
            const worker = this._getIdleWorker();
            const task = { type: "parse-json", payload: rawText, timeout };
            const wrappedResolve = (r) => {
                if (r.success)
                    resolve(r.data);
                else
                    reject(new Error(r.error ?? "worker failed"));
            };
            const wrappedReject = (err) => reject(err);
            if (worker) {
                this._dispatch(worker, task, wrappedResolve, wrappedReject);
            }
            else {
                this.queue.push({ task, resolve: wrappedResolve, reject: wrappedReject });
            }
        });
    }
    shutdown() {
        for (const w of this.workers)
            w.terminate();
        this.workers = [];
        this.queue = [];
        this.busy.clear();
    }
    _getIdleWorker() {
        for (const w of this.workers) {
            if (!this.busy.has(w))
                return w;
        }
        return null;
    }
    _dispatch(worker, task, resolve, reject) {
        this.busy.add(worker);
        const timeout = setTimeout(() => {
            this.busy.delete(worker);
            this._drainQueue();
            reject(new Error(`Worker task ${task.type} timeout`));
        }, task.timeout ?? 30_000);
        worker.once("message", (result) => {
            clearTimeout(timeout);
            this.busy.delete(worker);
            this._drainQueue();
            if (result.success)
                resolve(result.data);
            else
                reject(new Error(result.error ?? "worker failed"));
        });
        worker.once("error", (err) => {
            clearTimeout(timeout);
            this.busy.delete(worker);
            this._drainQueue();
            reject(err);
        });
        worker.postMessage(task);
    }
    _drainQueue() {
        if (this.queue.length === 0)
            return;
        const idle = this._getIdleWorker();
        if (!idle)
            return;
        const next = this.queue.shift();
        this._dispatch(idle, next.task, next.resolve, next.reject);
    }
}
//# sourceMappingURL=worker-pool.js.map