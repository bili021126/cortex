/**
 * commands/version.ts — `cortex version` 版本信息命令
 *
 * @see CLI 设计文档 §4.15
 */
import { CORTEX_VERSION, CORTEX_PHASE, DEPENDENCY_VERSIONS } from "@cortex/config";
/** 构建版本信息对象 */
function _buildVersionInfo() {
    return {
        version: `${CORTEX_VERSION} (${CORTEX_PHASE})`,
        ...DEPENDENCY_VERSIONS,
        runtime: `Node.js ${process.version}`,
        platform: `${process.platform}-${process.arch}`,
    };
}
/** 格式化版本信息为文本行 */
function _formatVersionLines(info, full) {
    const lines = [
        `cortex v${CORTEX_VERSION} (${CORTEX_PHASE})`,
        `引擎:      ${info.engine}`,
        `LLM:       ${info.llm}`,
        `共享类型:   ${info.shared}`,
        `运行时:    ${info.runtime}`,
        `平台:      ${info.platform}`,
    ];
    if (full)
        lines.push(`配置:      ${process.env["CORTEX_CONFIG"] ?? "默认路径"}`);
    return lines.join("\n");
}
export function createVersionHandler() {
    return async (args, options, _context) => {
        const json = options["json"];
        const full = options["full"];
        const info = _buildVersionInfo();
        if (json)
            return { success: true, data: info, output: JSON.stringify(info, null, 2), exitCode: 0 };
        return { success: true, output: _formatVersionLines(info, full), data: info, exitCode: 0 };
    };
}
//# sourceMappingURL=version.js.map