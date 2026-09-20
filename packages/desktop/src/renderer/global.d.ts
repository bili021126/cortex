/**
 * 渲染进程全局类型声明
 *
 * 定义 window 上的桌面端专属扩展属性。
 */
import type { Live2DTarget } from "./live2d/manager";
import type { CortexDesktopAPI } from "../preload/index";

interface Live2DSpeechAPI {
  onShowBubble: (callback: (payload: {
    text: string;
    audioBase64: string;
    format: "wav" | "mp3";
    durationMs: number;
    sceneId: string;
    itemId: string;
  }) => void) => () => void;
  onPrepare: (callback: () => void) => () => void;
  onMouthStart: (callback: (payload: { durationMs: number }) => void) => () => void;
  onMouthStop: (callback: () => void) => () => void;
  prepare: () => void;
  startMouth: (durationMs: number) => void;
  stopMouth: () => void;
}

interface OpenerBridgeAPI {
  feedback: (data: { type: string; sceneId: string; itemId: string }) => void;
}

interface DesktopWindowAPI {
  minimize: () => void;
  hide: () => void;
  quit: () => void;
  setInteractive: (v: boolean) => Promise<void>;
  moveBy: (dx: number, dy: number) => void;
  moveTo: (x: number, y: number) => void;
  setDragging: (v: boolean) => void;
  captureFrame: () => Promise<string | null>;
  saveShot: (dataUrl: string) => Promise<{ ok: boolean }>;
  getCursorPosition: () => Promise<{ x: number; y: number } | null>;
  onPetZoom: (cb: (zoom: number) => void) => () => void;
  openChat?: () => void;
}

declare global {
  interface Window {
    cyrene: DesktopWindowAPI;
    live2dSpeech?: Live2DSpeechAPI;
    live2dAction?: {
      onPlayAction: (callback: (target: Live2DTarget) => void) => () => void;
    };
    openerBridge?: OpenerBridgeAPI;
    settings?: {
      getGeneral: () => Promise<{ petZoom?: number } | undefined>;
    };
    cortexDesktop: CortexDesktopAPI;
  }
}

// CSS 副作用导入的环境声明见同目录 css-modules.d.ts（须为全局脚本文件才生效）。
