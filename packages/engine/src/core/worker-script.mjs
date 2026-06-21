import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("worker-script.mjs must be run as a Worker");

parentPort.on("message", (task) => {
  try {
    let result;
    switch (task.type) {
      case "parse-json":
        result = JSON.parse(task.payload);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
    parentPort?.postMessage({ success: true, data: result });
  } catch (e) {
    parentPort?.postMessage({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
});
