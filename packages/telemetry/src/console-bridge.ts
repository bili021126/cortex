/**
 * console-bridge.ts — Console→PipelineObserver 桥接
 *
 * 拦截 console.warn/error/log，转为 PipelineObserver.emit() 事件。
 * 白名单豁免：MemoryStoreMonitor（合法消费者）、embedding 预热等已知合法裸 console 调用。
 *
 * 设计：
 * - installConsoleBridge(observer) — 安装拦截
 * - uninstallConsoleBridge() — 恢复原始 console 方法
 * - 桥接器内部用原始 console 输出（避免递归），通过闭包引用 _orig 方法
 *
 * @since v3.x — 全系统重构
 * @since v2.7 — 横向解耦：从 @cortex/engine 迁入 @cortex/telemetry
 */
/* eslint-disable no-console */

import { PipelinePriority, PipelineEventType, type IPipelineObserver } from "@cortex/shared";
import { telemetryController, TelemetryLevel } from "./telemetry-controller.js";

// ─── 白名单 ────────────────────────────────────────

/**
 * 消息内容前缀白名单——匹配首参字符串前缀，命中则直接透传到原始 console。
 * 例如 MemoryStoreMonitor 输出 [MemoryStoreMonitor] ALERT: ...
 */
const MESSAGE_PREFIX_WHITELIST: RegExp[] = [
  /^\[MemoryStoreMonitor\]/i,
  // [TRACE write_file] 移出白名单——参数中包含完整文件内容会淹屏
];

/**
 * 调用栈白名单——调用方文件名匹配，命中则透传。
 * 例如 embedding 预热阶段无 observer 可用，合法裸调 console。
 * 注意：桥接器内部代码全部通过 _orig* 闭包调用原始方法，不存在递归风险，
 * 因此无需将 console-bridge.ts 自身加入白名单。
 */
const STACK_WHITELIST: RegExp[] = [
  /embedding.*warmup/i,
];

// ─── 原始方法备份 ──────────────────────────────────

let _origLog: typeof console.log | null = null;
let _origWarn: typeof console.warn | null = null;
let _origError: typeof console.error | null = null;
let _installed = false;
let _inErrorHandler = false;
/** TUI模式下抑制 [console-bridge] stderr 输出 */
let _tuiQuiet = false;

/**
 * 白名单判决：消息前缀 OR 调用栈任一命中即透传。
 */
function _isWhitelisted(args: unknown[]): boolean {
  // 消息前缀检查（O(1) 首参字符串前缀匹配）
  if (args.length > 0 && typeof args[0] === "string") {
    const firstArg: string = args[0];
    if (MESSAGE_PREFIX_WHITELIST.some((p) => p.test(firstArg))) return true;
  }
  // 调用栈检查
  const stack = new Error().stack ?? "";
  return STACK_WHITELIST.some((p) => p.test(stack));
}

/** 将参数列表展平为单条消息字符串 */
function _flattenArgs(args: unknown[]): string {
  const joined = args
    .map((a) => {
      if (a instanceof Error) return a.message;
      return typeof a === "string" ? a : JSON.stringify(a);
    })
    .join(" ");
  // 截断超长输出——防止 TUI 被 HTML/大文件内容淹屏
  return joined.length > 500 ? joined.slice(0, 500) + "…" : joined;
}

/** 构造 ErrorReported 事件 */
function _buildErrorEvent(
  severity: "error" | "warn",
  message: string,
): Parameters<IPipelineObserver["emit"]>[0] {
  return {
    type: PipelineEventType.ErrorReported,
    priority: severity === "error" ? PipelinePriority.HIGH : PipelinePriority.NORMAL,
    payload: {
      source: "console_bridge",
      severity,
      error: message.slice(0, 500),
    },
    timestamp: Date.now(),
  };
}

// ─── 公开 API ──────────────────────────────────────

/**
 * 安装 ConsoleBridge——拦截所有 console.warn/error/log。
 * 白名单内的调用（MemoryStoreMonitor 等）透传到原始 console。
 */
export function installConsoleBridge(observer: IPipelineObserver): void {
  if (_installed) return;
  _origLog = console.log;
  _origWarn = console.warn;
  _origError = console.error;

  console.log = (...args: unknown[]) => {
    if (_isWhitelisted(args)) { _origLog?.(...args); } else {
      // [telemetry] 前缀 → 转发到 TelemetryController
      if (typeof args[0] === "string" && (args[0] as string).startsWith("[telemetry]")) {
        const parts = (args[0] as string).split(" ");
        const levelStr = parts.find(p => p.startsWith("level="))?.split("=")[1];
        const level = levelStr === "alert" ? TelemetryLevel.ALERT
          : levelStr === "notice" ? TelemetryLevel.NOTICE
          : TelemetryLevel.TRACE;
        telemetryController.record({
          metric: parts[1] ?? "unknown",
          value: parseFloat(parts.find(p => p.includes("="))?.split("=")[1] ?? "0"),
          level,
          tags: {},
        });
      }
      if (!_tuiQuiet) process.stderr.write(`[console-bridge] ${_flattenArgs(args)}\n`);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (_isWhitelisted(args)) { _origWarn?.(...args); return; }
    observer.emit(_buildErrorEvent("warn", _flattenArgs(args)));
  };

  console.error = (...args: unknown[]) => {
    if (_isWhitelisted(args)) { _origError?.(...args); return; }
    // 防重入锁：已在错误处理中时直接透传原始 console，防止 emit→handler 崩溃→console.error→emit 无限递归
    if (_inErrorHandler) {
      _origError?.(...args);
      return;
    }
    _inErrorHandler = true;
    try {
      const msg = _flattenArgs(args);
      const errType = args.find(a => a instanceof Error)?.constructor?.name ?? "Unknown";
      console.log(`[telemetry] error.type_distribution type=${errType} msg=${msg.slice(0,100)}`);
      observer.emit(_buildErrorEvent("error", msg));
    } finally {
      _inErrorHandler = false;
    }
  };

  _installed = true;
}

/** 卸载 ConsoleBridge——恢复原始 console 方法 */
export function uninstallConsoleBridge(): void {
  if (!_installed) return;
  if (_origLog) console.log = _origLog;
  if (_origWarn) console.warn = _origWarn;
  if (_origError) console.error = _origError;
  _origLog = null;
  _origWarn = null;
  _origError = null;
  _installed = false;
}

/** TUI 模式下抑制 [console-bridge] stderr 输出 */
export function setTuiQuietMode(quiet: boolean): void {
  _tuiQuiet = quiet;
}
