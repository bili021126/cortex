// ============================================================
// engine-telemetry.ts —— 引擎遥测封装
//
// 提供：
//   1. 默认 ConsoleCollector（开发期直接可见）
//   2. record() 统一入口——所有引擎关键路径事件走此通道
//
// @since Cortex Core-2 — 上下文生命周期管理协议
// @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/telemetry
// ============================================================

import { ConsoleCollector, type ITelemetryCollector, type TelemetryData } from "./index.js";

let _collector: ITelemetryCollector | null = null;

/** 获取或创建默认遥测采集器 */
export function getTelemetry(): ITelemetryCollector {
  if (!_collector) {
    _collector = new ConsoleCollector();
  }
  return _collector;
}

/** 替换遥测采集器（测试/生产环境注入 FileCollector 等） */
export function setTelemetry(collector: ITelemetryCollector): void {
  void _collector?.shutdown();
  _collector = collector;
}

/** 记录引擎遥测事件 */
export async function recordTelemetry(
  name: string,
  value: number,
  tags?: { key: string; value: string }[],
  metadata?: Record<string, unknown>,
): Promise<void> {
  const data: TelemetryData = {
    id: `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    value,
    tags: tags ?? [],
    timestamp: Date.now(),
    metadata,
  };
  await getTelemetry().collect(data);
}

/** 关闭遥测（刷新缓冲区 + 释放资源） */
export function shutdownTelemetry(): void {
  void _collector?.shutdown();
  _collector = null;
}
