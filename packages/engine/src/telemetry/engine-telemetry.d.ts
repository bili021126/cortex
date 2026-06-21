import { type ITelemetryCollector } from "@cortex/telemetry";
/** 获取或创建默认遥测采集器 */
export declare function getTelemetry(): ITelemetryCollector;
/** 替换遥测采集器（测试/生产环境注入 FileCollector 等） */
export declare function setTelemetry(collector: ITelemetryCollector): void;
/** 记录引擎遥测事件 */
export declare function recordTelemetry(name: string, value: number, tags?: {
    key: string;
    value: string;
}[], metadata?: Record<string, unknown>): Promise<void>;
/** 关闭遥测（刷新缓冲区 + 释放资源） */
export declare function shutdownTelemetry(): void;
//# sourceMappingURL=engine-telemetry.d.ts.map