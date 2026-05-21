/**
 * commands/setup.ts — `cortex setup` 交互式配置界面
 *
 * 委托到独立控制台 cortex-cli.mjs (--mode setup)
 *
 * 用法:
 *   cortex setup
 *   node cortex-cli.mjs --mode setup
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { CommandHandler, CommandResult } from "../types.js";

export function createSetupHandler(): CommandHandler {
  return async (_args, _options, _context): Promise<CommandResult> => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    let projectRoot = path.resolve(__dirname, "..", "..", "..", "..");
    let scriptPath = path.join(projectRoot, "cortex-cli.mjs");

    if (!fs.existsSync(scriptPath)) {
      projectRoot = path.resolve(__dirname, "..", "..", "..");
      scriptPath = path.join(projectRoot, "cortex-cli.mjs");
    }

    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `找不到 cortex-cli.mjs，请先运行: pnpm build:config`,
        exitCode: 1,
      };
    }

    return runScript("node", [scriptPath, "--mode", "setup", "--dir", projectRoot], projectRoot);
  };
}

function runScript(cmd: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        exitCode: code ?? 1,
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        error: `无法启动独立脚本: ${err.message}`,
        exitCode: 1,
      });
    });
  });
}
