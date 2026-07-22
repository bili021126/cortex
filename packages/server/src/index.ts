/**
 * @cortex/server — Library export barrel
 *
 * Daemon package that hosts the Cortex engine and exposes it via HTTP/WS.
 * Layer L4 — depends on engine (L3).
 */

export { CortexDaemon, type DaemonOptions } from "./daemon.js";
export { EngineHost } from "./engine-host.js";
export { SessionManager } from "./session-manager.js";
export { ChatExecutor } from "./chat-executor.js";
export { RemoteGateBridge } from "./gate-bridge.js";
