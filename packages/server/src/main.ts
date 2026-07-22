#!/usr/bin/env node
/**
 * @cortex/server — CLI entry point
 *
 * Parses environment variables, creates CortexDaemon, starts it,
 * and handles graceful shutdown on SIGINT/SIGTERM.
 * Windows: registers process.on("exit") for PID file cleanup.
 */

import { CortexDaemon } from "./daemon.js";

const VERSION = "0.1.0";
const projectRoot = process.env["CORTEX_PROJECT_ROOT"] ?? process.cwd();
const port = Number(process.env["CORTEX_DAEMON_PORT"]) || 3210;
const host = process.env["CORTEX_DAEMON_HOST"] ?? "127.0.0.1";

const daemon = new CortexDaemon({
  projectRoot,
  port,
  host,
  workspaceRoot: process.env["CORTEX_WORKSPACE_ROOT"],
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // 防止重复触发
  shuttingDown = true;
  console.error(`[cortex-daemon] received ${signal}, shutting down...`);

  // 强制超时——10s 后无论如何都退出
  const forceTimer = setTimeout(() => {
    console.error("[cortex-daemon] forced exit (shutdown timeout 10s)");
    process.exit(1);
  }, 10_000);
  if (forceTimer.unref) forceTimer.unref();

  try {
    await daemon.stop();
  } catch (err) {
    console.error("[cortex-daemon] error during shutdown:", err);
  }
  clearTimeout(forceTimer);
  process.exit(0);
}

// Unix signals
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Windows: process.on("exit") 清理 PID 文件（Windows 无 SIGTERM）
process.on("exit", (code) => {
  if (!shuttingDown && code === 0) {
    // 正常退出时尝试同步清理 PID 文件
    daemon.cleanupPidSync();
  }
});

// 未捕获异常——记录后优雅关闭
process.on("uncaughtException", (err) => {
  console.error("[cortex-daemon] uncaught exception:", err);
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  console.error("[cortex-daemon] unhandled rejection:", reason);
});

daemon
  .start()
  .then(() => {
    console.error(
      `[cortex-daemon] v${VERSION} ready — pid=${process.pid} listen=${host}:${port} project=${projectRoot}`,
    );
  })
  .catch((err) => {
    console.error("[cortex-daemon] fatal startup error:", err);
    process.exit(1);
  });
