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

interface WorkerTask {
  type: "parse-json";
  payload: string;
  timeout?: number;
}

interface WorkerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface QueuedTask {
  task: WorkerTask;
  resolve: (result: WorkerResult) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private queue: QueuedTask[] = [];
  private busy = new Set<Worker>();

  /** 队列最大长度上限——超出时新任务被立即拒绝，提供背压。 */
  private static readonly MAX_QUEUE_LENGTH = 100;

  constructor(private options: { maxWorkers?: number } = {}) {
    const count = options.maxWorkers ?? Math.max(1, cpus().length - 1);
    for (let i = 0; i < count; i++) {
      this.workers.push(new Worker(WORKER_SCRIPT));
    }
  }

  async parseJson<T = unknown>(rawText: string, timeout?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = this._getIdleWorker();
      const task: WorkerTask = { type: "parse-json", payload: rawText, timeout };
      const wrappedResolve = (r: WorkerResult) => {
        if (r.success) resolve(r.data as T);
        else reject(new Error(r.error ?? "worker failed"));
      };
      const wrappedReject = (err: Error) => reject(err);
      if (worker) {
        this._dispatch(worker, task, wrappedResolve, wrappedReject);
      } else if (this.queue.length >= WorkerPool.MAX_QUEUE_LENGTH) {
        reject(new Error("WorkerPool queue full (max " + WorkerPool.MAX_QUEUE_LENGTH + "), task rejected"));
      } else {
        this.queue.push({ task, resolve: wrappedResolve, reject: wrappedReject });
      }
    });
  }

  shutdown(): void {
    // 拒绝所有排队任务，防止 promise 悬空
    for (const q of this.queue) {
      q.reject(new Error("WorkerPool shutdown: queued task discarded"));
    }
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
    this.busy.clear();
  }

  private _getIdleWorker(): Worker | null {
    for (const w of this.workers) {
      if (!this.busy.has(w)) return w;
    }
    return null;
  }

  private _dispatch(worker: Worker, task: WorkerTask, resolve: Function, reject: Function): void {
    this.busy.add(worker);
    const timeout = setTimeout(() => {
      this.busy.delete(worker);
      this._drainQueue();
      reject(new Error(`Worker task ${task.type} timeout`));
    }, task.timeout ?? 30_000);

    worker.once("message", (result: WorkerResult) => {
      clearTimeout(timeout);
      this.busy.delete(worker);
      this._drainQueue();
      if (result.success) resolve(result.data);
      else reject(new Error(result.error ?? "worker failed"));
    });

    worker.once("error", (err) => {
      clearTimeout(timeout);
      this.busy.delete(worker);
      this._drainQueue();
      reject(err);
    });

    worker.postMessage(task);
  }

  private _drainQueue(): void {
    if (this.queue.length === 0) return;
    const idle = this._getIdleWorker();
    if (!idle) return;
    const next = this.queue.shift()!;
    this._dispatch(idle, next.task, next.resolve, next.reject);
  }
}
