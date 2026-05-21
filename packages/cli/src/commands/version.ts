/**
 * commands/version.ts — `cortex version` 版本信息命令
 *
 * @see CLI 设计文档 §4.15
 */

import type { CommandHandler, CommandResult, CommandContext } from "../types.js";
import { CORTEX_VERSION, CORTEX_PHASE, DEPENDENCY_VERSIONS } from "../constants.js";

export function createVersionHandler(): CommandHandler {
  return async (args, options, context): Promise<CommandResult> => {
    const jsonOutput = options["json"] as boolean;
    const full = options["full"] as boolean;

    const nodeVersion = process.version;
    const platform = `${process.platform}-${process.arch}`;

    const versionInfo: Record<string, string> = {
      version: `${CORTEX_VERSION} (${CORTEX_PHASE})`,
      ...DEPENDENCY_VERSIONS,
      runtime: `Node.js ${nodeVersion}`,
      platform,
    };

    if (jsonOutput) {
      return {
        success: true,
        data: versionInfo,
        output: JSON.stringify(versionInfo, null, 2),
        exitCode: 0,
      };
    }

    const lines = [
      `cortex v${CORTEX_VERSION} (${CORTEX_PHASE})`,
      `引擎:      ${versionInfo.engine}`,
      `LLM:       ${versionInfo.llm}`,
      `共享类型:   ${versionInfo.shared}`,
      `运行时:    ${versionInfo.runtime}`,
      `平台:      ${versionInfo.platform}`,
    ];

    if (full) {
      // 在完整模式下附加更多信息
      lines.push(`配置:      ${process.env["CORTEX_CONFIG"] ?? "默认路径"}`);
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: versionInfo,
      exitCode: 0,
    };
  };
}
