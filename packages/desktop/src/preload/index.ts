/**
 * Preload 脚本 — contextBridge 安全暴露
 *
 * 将主进程的 IPC handler 暴露为 window.cortexDesktop API。
 * 渲染进程通过此 API 与主进程通信，不直接接触 Node.js API。
 */
import { contextBridge, ipcRenderer } from "electron";

// ── IPC 通道名（与 ipc-handlers.ts 同步） ──────────────
const IPC_CHANNELS = {
  CORTEX_INIT: "cortex:init",
  CORTEX_CHAT: "cortex:chat",
  CORTEX_STREAM_CHAT: "cortex:stream-chat",
  CORTEX_GET_AGENTS: "cortex:get-agents",
  LIVE2D_SPEAK: "live2d:speak",
  LIVE2D_EXPRESSION: "live2d:expression",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  PRESENCE_EVENT: "presence:event",
} as const;

export interface CortexDesktopAPI {
  init: (projectRoot: string) => Promise<{ ok: boolean }>;
  chat: (input: string, agent?: string) => Promise<{ ok: boolean; data?: string }>;
  streamChat: (
    input: string,
    agent: string | undefined,
    onChunk: (chunk: string) => void,
    onDone: (full: string) => void,
  ) => Promise<{ ok: boolean }>;
  getAgents: () => Promise<{ ok: boolean; data?: string[] }>;
  speak: (text: string) => Promise<{ ok: boolean; error?: string }>;
  expression: (name: string) => Promise<{ ok: boolean }>;
  settings: {
    get: (key?: string) => Promise<{ ok: boolean; data?: unknown }>;
    set: (key: string, value: unknown) => Promise<{ ok: boolean }>;
  };
  /** 订阅 Presence 事件（WS → main → IPC → renderer）。返回取消订阅函数。 */
  onPresenceEvent: (cb: (event: { type: string; chunkLength?: number; success?: boolean; toolName?: string }) => void) => () => void;
}

contextBridge.exposeInMainWorld("cyrene", {
  minimize: () => ipcRenderer.send("window:minimize"),
  hide: () => ipcRenderer.send("window:hide"),
  quit: () => ipcRenderer.send("app:quit"),
  setInteractive: (v: boolean) => ipcRenderer.invoke("window:set-interactive", v),
  moveBy: (dx: number, dy: number) => ipcRenderer.send("window:move", dx, dy),
  moveTo: (x: number, y: number) => ipcRenderer.send("window:move-to", x, y),
  setDragging: (v: boolean) => ipcRenderer.send("window:set-dragging", v),
  captureFrame: () => ipcRenderer.invoke("window:capture-frame"),
  getCursorPosition: () => ipcRenderer.invoke("window:get-cursor-position"),
  onPetZoom: (cb: (zoom: number) => void) => {
    const listener = (_e: unknown, zoom: number) => cb(zoom);
    ipcRenderer.on("pet:zoom", listener);
    return () => { ipcRenderer.off("pet:zoom", listener); };
  },
  openChat: () => ipcRenderer.send("chat:open"),
});

contextBridge.exposeInMainWorld("cortexDesktop", {
  init: (projectRoot: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CORTEX_INIT, projectRoot),

  chat: (input: string, agent?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CORTEX_CHAT, input, agent),

  streamChat: (
    input: string,
    agent: string | undefined,
    onChunk: (chunk: string) => void,
    onDone: (full: string) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { chunk?: string; done?: boolean; full?: string },
    ) => {
      if (payload.done) {
        onDone(payload.full ?? "");
        ipcRenderer.removeListener(IPC_CHANNELS.CORTEX_STREAM_CHAT, handler);
      } else if (payload.chunk) {
        onChunk(payload.chunk);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.CORTEX_STREAM_CHAT, handler);
    return ipcRenderer.invoke(IPC_CHANNELS.CORTEX_STREAM_CHAT, input, agent);
  },

  getAgents: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CORTEX_GET_AGENTS),

  speak: (text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_SPEAK, text),

  expression: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIVE2D_EXPRESSION, name),

  settings: {
    get: (key?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET, key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, key, value),
  },

  onPresenceEvent: (cb: (event: { type: string; chunkLength?: number; success?: boolean; toolName?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: { type: string; chunkLength?: number; success?: boolean; toolName?: string }) => cb(event);
    ipcRenderer.on(IPC_CHANNELS.PRESENCE_EVENT, handler);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.PRESENCE_EVENT, handler); };
  },
} satisfies CortexDesktopAPI);
