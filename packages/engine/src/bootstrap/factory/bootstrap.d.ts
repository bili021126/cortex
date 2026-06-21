import type { BootstrapResult } from "./types.js";
/**
 * Bootstrap —— 从配置文件到运行时对象的完整流水线。
 *
 * @param projectRoot 项目根目录（包含 cortex-agents.json 等配置文件）
 * @returns BootstrapResult —— 所有组装好的配置对象
 * @throws 若校验失败（编译期报错，拒绝启动）
 *
 * @example
 * ```typescript
 * import { bootstrap } from "@cortex/factory";
 * const result = bootstrap("/path/to/project");
 * // result.agentDefinitions → 供 Scheduler 注册
 * // result.eventRouting → 供 NotificationPipe 加载
 * ```
 */
export declare function bootstrap(projectRoot: string, dataDirOverride?: string): BootstrapResult;
//# sourceMappingURL=bootstrap.d.ts.map