/**
 * 审视工具集注册——只读 + 受限 write_file（含 OS 命令适配层）
 *
 * 硬约束模式（softMode=false）：
 *   - read_file / list_dir / search_code → 只读
 *   - write_file → 仅允许写入 outputDir/
 *   - run_shell / delete_file → FORBIDDEN 占位
 *
 * 软约束模式（softMode=true）：
 *   - read_file / list_dir / search_code → 只读
 *   - write_file → 仅允许写入 outputDir/
 *   - run_shell → 真实执行（含 Unix→Windows 命令转译）
 *   - delete_file → 真实执行
 */
import { Toolkit } from "@cortex/platform";
export declare function registerExaminationTools(toolkit: Toolkit, rootDir: string, outputDir: string, softMode?: boolean): void;
//# sourceMappingURL=examination-toolkit.d.ts.map