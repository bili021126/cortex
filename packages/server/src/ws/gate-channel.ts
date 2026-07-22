/**
 * @cortex/server — Gate Channel Handler
 *
 * Routes gate.resolve WS commands to the RemoteGateBridge.
 */

import type { WSGateResolveCommand } from "@cortex/protocol";
import type { RemoteGateBridge } from "../gate-bridge.js";

/**
 * Handle gate.resolve command.
 */
export function handleGateCommand(
  cmd: WSGateResolveCommand,
  gateBridge: RemoteGateBridge,
): void {
  if (cmd.type === "gate.resolve") {
    gateBridge.resolve(cmd.requestId, cmd.approved);
  }
}
