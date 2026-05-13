// ============================================================
// @cortex/shared — 平台适配域
// ============================================================

import type { ConfirmationRequest, ConfirmationResponse } from "./toolkit.js";

export enum PlatformKind {
  CLI = "cli",
  Electron = "electron",
}

export interface PlatformContext {
  kind: PlatformKind;
  foreground: boolean; // 用户是否在关注
  idle: boolean; // 用户是否空闲
}

/**
 * PlatformBridge —— Engine ↔ 用户交互的抽象层。
 * Core-1 仅实现 CLIAdapter（stdin/stdout）。Core-2 追加 ElectronAdapter（IPC 弹窗）。
 */
export interface PlatformBridge {
  /** 阻塞等待用户确认（L2/L3 操作）。CLI 下为 stdin 读取，Electron 下为系统弹窗。 */
  confirm(request: ConfirmationRequest): Promise<ConfirmationResponse>;

  /** 通知用户（非阻塞）。 */
  notify(message: string): void;

  /** 获取当前平台上下文。 */
  getPlatformContext(): PlatformContext;
}
