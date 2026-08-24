/**
 * Preload 脚本 — contextBridge 安全暴露
 *
 * 将主进程的 IPC handler 暴露为 window.cortexDesktop API。
 * 渲染进程通过此 API 与主进程通信，不直接接触 Node.js API。
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels.js"; // D5 单源化

// ── IPC 通道名（D5：单源化——定义见 src/shared/ipc-channels.ts）──

export interface CortexDesktopAPI {
  init: (projectRoot: string) => Promise<{ ok: boolean }>;
  chat: (input: string, agent?: string) => Promise<{ ok: boolean; data?: string }>;
  streamChat: (
    input: string,
    agent: string | undefined,
    onChunk: (chunk: string) => void,
    onDone: (full: string) => void,
    history?: Array<{ role: "user" | "assistant"; content: string }>,
  ) => Promise<{ ok: boolean }>;
  /** UX 停止：中断当前流式会话 */
  cancelStreamChat: () => Promise<{ ok: boolean }>;
  getAgents: () => Promise<{ ok: boolean; data?: string[] }>;
  /** 重启桌面：自动编译并重启应用 */
  restartDesktop: () => Promise<{ ok: boolean; error?: string }>;
  /** 编辑器保存：写回 userData/editor-files/ */
  editorSave: (fileName: string, content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  /** 另存为：dialog 选路径 */
  editorSaveAs: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  /** 通知订阅（通知铃接真——pipeline/notification 事件） */
  onNotification: (cb: (e: { channel: string; data: unknown }) => void) => () => void;
  /** D7b：确认门——gate.request 订阅（返回取消订阅函数） */
  onGateRequest: (cb: (e: { channel: string; data: unknown }) => void) => () => void;
  /** D7b：确认门——gate.resolve 回执 */
  resolveGate: (requestId: string, approved: boolean) => Promise<{ ok: boolean }>;
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
  saveShot: (dataUrl: string) => ipcRenderer.invoke("window:save-shot", dataUrl),
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
    history?: Array<{ role: "user" | "assistant"; content: string }>,
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
    return ipcRenderer.invoke(IPC_CHANNELS.CORTEX_STREAM_CHAT, input, agent, history);
  },

  cancelStreamChat: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CORTEX_STREAM_CANCEL),

  getAgents: () =>
    ipcRenderer.invoke(IPC_CHANNELS.CORTEX_GET_AGENTS),

  restartDesktop: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DESKTOP_RESTART),

  editorSave: (fileName: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EDITOR_SAVE, fileName, content),
  /** 另存为：dialog 选路径 */
  editorSaveAs: (content: string) => ipcRenderer.invoke(IPC_CHANNELS.EDITOR_SAVE_AS, content),

  onNotification: (cb: (e: { channel: string; data: unknown }) => void) => {
    const listener = (_: unknown, e: { channel: string; data: unknown }) => cb(e);
    ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_EVENT, listener);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_EVENT, listener); };
  },

  // D7b：确认门——gate.request 订阅 + gate.resolve 回执
  onGateRequest: (cb: (e: { channel: string; data: unknown }) => void) => {
    const listener = (_: unknown, e: { channel: string; data: unknown }) => cb(e);
    ipcRenderer.on(IPC_CHANNELS.GATE_REQUEST, listener);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.GATE_REQUEST, listener); };
  },
  resolveGate: (requestId: string, approved: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.GATE_RESOLVE, requestId, approved),

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
