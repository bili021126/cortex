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
import { WORKER_POOL_MAX_QUEUE } from "@cortex/config";

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
  private _shutdown = false;
  /** R4-H7 fix: worker → reject 映射，shutdown 时拒绝 in-flight 任务 */
  private _inFlight = new Map<Worker, { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }>();

  /** 队列最大长度上限——超出时新任务被立即拒绝，提供背压。 */
  private static readonly MAX_QUEUE_LENGTH = WORKER_POOL_MAX_QUEUE;

  constructor(private options: { maxWorkers?: number } = {}) {
    const count = options.maxWorkers ?? Math.max(1, cpus().length - 1);
    for (let i = 0; i < count; i++) {
      this.workers.push(new Worker(WORKER_SCRIPT));
    }
  }

  async parseJson<T = unknown>(rawText: string, timeout?: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
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
    this._shutdown = true;
    // 拒绝所有排队任务，防止 promise 悬空
    for (const q of this.queue) {
      q.reject(new Error("WorkerPool shutdown: queued task discarded"));
    }
    // R4-H7 fix: 拒绝所有 in-flight 任务（已 dispatch 到 busy worker 的任务）
    for (const w of this.workers) {
      const inFlight = this._inFlight.get(w);
      if (inFlight) {
        inFlight.reject(new Error("WorkerPool shutdown: in-flight task cancelled"));
        this._inFlight.delete(w);
      }
      void w.terminate();
    }
    this.workers = [];
    this.queue = [];
    this.busy.clear();
    this._inFlight.clear();
  }

  private _getIdleWorker(): Worker | null {
    for (const w of this.workers) {
      if (!this.busy.has(w)) return w;
    }
    return null;
  }

  private _dispatch(worker: Worker, task: WorkerTask, resolve: (result: WorkerResult) => void, reject: (err: Error) => void): void {
    this.busy.add(worker);
    // R4-H7 fix: 记录 in-flight 任务供 shutdown 拒绝
    this._inFlight.set(worker, { resolve, reject });
    // settled 守卫：message / error / timeout 三条路径互斥，杜绝双重 settle
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      this.busy.delete(worker);
      this._inFlight.delete(worker);
    };

    const onMessage = (result: WorkerResult): void => {
      if (settled) return;
      cleanup();
      clearTimeout(timeout);
      worker.removeListener("error", onError);
      this._drainQueue();
      if (result.success) resolve(result);
      else reject(new Error(result.error ?? "worker failed"));
    };

    const onError = (err: Error): void => {
      if (settled) return;
      cleanup();
      clearTimeout(timeout);
      worker.removeListener("message", onMessage);
      // error 事件意味着 worker 已抛未捕获异常、状态未知——替换而非复用
      this._replaceWorker(worker);
      this._drainQueue();
      reject(err);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      cleanup();
      // 关键修复：移除监听器，避免超时任务的迟到 message 命中下一个任务的 once 处理器
      worker.removeListener("message", onMessage);
      worker.removeListener("error", onError);
      // 超时的 worker 仍在处理旧任务、状态未知——终止并替换，绝不放回池复用
      this._replaceWorker(worker);
      this._drainQueue();
      reject(new Error(`Worker task ${task.type} timeout`));
    }, task.timeout ?? 30_000);

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage(task);
  }

  /**
   * 终止一个已污染（超时/出错）的 worker 并补充新 worker 维持池容量。
   * shutdown 后不再补充，避免泄漏。
   */
  private _replaceWorker(tainted: Worker): void {
    this.busy.delete(tainted);
    const idx = this.workers.indexOf(tainted);
    if (idx !== -1) this.workers.splice(idx, 1);
    void tainted.terminate();
    if (!this._shutdown && idx !== -1) {
      this.workers.push(new Worker(WORKER_SCRIPT));
    }
  }

  private _drainQueue(): void {
    if (this.queue.length === 0) return;
    const idle = this._getIdleWorker();
    if (!idle) return;
    const next = this.queue.shift();
    if (!next) return;
    this._dispatch(idle, next.task, next.resolve, next.reject);
  }
}
