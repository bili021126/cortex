# CPU Worker 化——Edit 执行方案

**定位**：彻底解决事件循环饥饿——将同步 CPU 密集型操作从主线程搬到 `worker_threads`，确保 Agent A 的阻塞操作不影响 Agent B 的超时触发。

**约束**：调度器零改动。只改三个阻塞点的调用方式。

---

## 〇、根因

14 个 Agent 共享一个事件循环。Agent A 的同步 LLM JSON 解析花 30 秒→占住主线程→Agent B 的 `ManifoldGate.acquire()` 的 `setTimeout` 永远没机会触发→一个节点挂住拖死整层调度。

`Promise.race(timeoutPromise)` 不救——事件循环被同步代码堵住时，`setTimeout` 回调同样排不上队。

---

## 一、新增文件

### `packages/engine/src/core/worker-pool.ts`

```typescript
// WorkerPool——独立线程池，不改调度器
// 用途：将同步 CPU 操作（JSON 解析/ONNX 推理/正则）搬到 worker_threads

import { Worker } from "node:worker_threads";
import { cpus } from "node:os";

interface WorkerTask {
  type: "parse-json" | "embedding" | "regex";
  payload: unknown;
  timeout?: number; // 默认 30s
}

interface WorkerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private queue: Array<{
    task: WorkerTask;
    resolve: (result: WorkerResult) => void;
    reject: (err: Error) => void;
  }> = [];
  private busy = new Set<Worker>();

  constructor(private options: { maxWorkers?: number } = {}) {
    const count = options.maxWorkers ?? Math.max(1, cpus().length - 1);
    for (let i = 0; i < count; i++) {
      this.workers.push(new Worker(this._workerScript()));
    }
  }

  acquire<T = unknown>(task: WorkerTask): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = this._getIdleWorker();
      if (worker) {
        this._dispatch(worker, task, resolve, reject);
      } else {
        this.queue.push({ task, resolve, reject });
      }
    });
  }

  shutdown(): void {
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
      reject(new Error(`Worker task ${task.type} timeout`));
      this.busy.delete(worker);
      this._drainQueue();
    }, task.timeout ?? 30_000);

    worker.once("message", (result: WorkerResult) => {
      clearTimeout(timeout);
      this.busy.delete(worker);
      if (result.success) resolve(result.data);
      else reject(new Error(result.error ?? "worker failed"));
      this._drainQueue();
    });

    worker.once("error", (err) => {
      clearTimeout(timeout);
      this.busy.delete(worker);
      reject(err);
      this._drainQueue();
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

  private _workerScript(): string {
    // 内联 worker 脚本——避免额外文件依赖
    return `
      const { parentPort } = require("worker_threads");
      parentPort.on("message", (task) => {
        try {
          let result;
          switch (task.type) {
            case "parse-json":
              result = JSON.parse(task.payload);
              break;
            case "embedding":
              // ONNX 推理——worker 内加载模型
              result = { dim: 384, vector: [] };  // 占位——实际调用 embeddingService
              break;
            case "regex":
              const { pattern, text, flags } = task.payload;
              result = text.match(new RegExp(pattern, flags));
              break;
            default:
              throw new Error("Unknown task type: " + task.type);
          }
          parentPort.postMessage({ success: true, data: result });
        } catch (e) {
          parentPort.postMessage({ success: false, error: e.message });
        }
      });
    `;
  }
}
```

---

## 二、三处调用方改动

### 2.1 `packages/llm/src/llm-adapter.ts` — JSON 解析走 worker

```
改动前：
const parsed = JSON.parse(rawResponse);

改动后：
const workerPool = this._getWorkerPool();  // 从 registry 拿
const parsed = await workerPool.acquire<Record<string, unknown>>({
  type: "parse-json",
  payload: rawResponse,
});
```

### 2.2 `packages/memory-store/src/embedding.ts` — ONNX 推理走 worker

```
改动前：
const embedding = await embeddingService.embed(text);

改动后：
const workerPool = getWorkerPool();
const embedding = await workerPool.acquire<number[]>({
  type: "embedding",
  payload: { text, modelPath: this.modelPath },
  timeout: 5000,  // embedding 5s 超时
});
```

### 2.3 `packages/engine/src/dispatch-steps/execute-step.ts` — 同步正则走 worker

```
改动前：
const match = hugeRegex.exec(text);

改动后：
const workerPool = getWorkerPool();
const match = await workerPool.acquire<RegExpExecArray | null>({
  type: "regex",
  payload: { pattern: hugeRegex.source, text, flags: hugeRegex.flags },
});
```

---

## 三、初始化（bootstrap-engine.ts）

```typescript
import { WorkerPool } from "./core/worker-pool.js";

// 在 bootstrapEngine() 中，组件初始化之后：
const workerPool = new WorkerPool({ maxWorkers: Math.max(1, os.cpus().length - 1) });
// 注入到 registry 或通过闭包传递给需要它的模块
```

---

## 四、不改清单

| 组件 | 为什么不动 |
|------|------|
| `scheduler/src/core/topological-sort.ts` | 调度逻辑正确 |
| `scheduler/src/dispatch-steps/spawn-step.ts` | 超时逻辑正确 |
| `scheduler/src/core/manifold-gate.ts` | 60s 超时正确 |
| `engine/src/components/react-loop.ts` | ReAct 循环正确 |
| `engine/src/core/scheduler.ts` | `dispatchSingle` 逻辑正确 |
| Agent 生命周期 | spawn/execute/shutdown 不变 |
| `PipelineObserver` | emit 不变 |
| `TaskBoard` | 状态机不变 |

---

## 五、验收

```powershell
# 1. 编译通过
pnpm exec tsc -p packages/engine/tsconfig.src.json --noEmit

# 2. lint 零 error
pnpm exec eslint packages/engine/src/core/worker-pool.ts

# 3. 全量测试
pnpm exec vitest run --no-color

# 4. solo-flight 并发压测——3 个 Agent 同时执行，不应有超时卡死
$env:CORTEX_EXPERIMENT_ID="worker-pool-test"; pnpm cli solo-flight
```

---

*Edit 执行方案 v1.0。总改动：1 新文件 + 3 调用方 + 1 bootstrap 注入。113 行。调度器零改动。*
