/**
 * Preload 脚本 — contextBridge 安全暴露
 *
 * 将主进程的 IPC handler 暴露为 window.cortexDesktop API。
 * 渲染进程通过此 API 与主进程通信，不直接接触 Node.js API。
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels.js"; // D5 单源化

// ── IPC 通道名（D5：单源化——定义见 src/shared/ipc-channels.ts）──

/** P0 桥接统一信封：成功带 data、失败带 error。泛型默认 unknown 让 renderer 侧按调用点小化。 */
type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export interface CortexDesktopAPI {
  init: (projectRoot: string) => Promise<{ ok: boolean }>;
  chat: (input: string, agent?: string) => Promise<{ ok: boolean; data?: string }>;
  streamChat: (
    input: string,
    agent: string | undefined,
    onChunk: (chunk: string) => void,
    onDone: (full: string) => void,
    history?: Array<{ role: "user" | "assistant"; content: string }>,
    onTool?: (evt: { type: "start" | "result"; toolName: string; input?: string; success?: boolean; toolCallId: string }) => void,
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

  // ── P0：完整 Engine 接入面 —— renderer 通过 window.cortexDesktop.<domain>.<action>() 调用；
  //   返回统一 IpcResult 信封。复杂 DTO 参数用 unknown，由 renderer 调用点做类型收窄。
  memory: {
    search: (q: string, opts?: { kind?: string; limit?: number }) => Promise<IpcResult>;
    write: (entry: unknown) => Promise<IpcResult>;
    delete: (id: string) => Promise<IpcResult>;
  };
  scheduler: {
    snapshot: () => Promise<IpcResult>;
    execute: () => Promise<IpcResult>;
    submitNode: (node: unknown) => Promise<IpcResult>;
  };
  nodes: {
    list: (opts?: { page?: number; limit?: number; status?: string }) => Promise<IpcResult>;
    get: (id: string) => Promise<IpcResult>;
  };
  sessions: {
    list: () => Promise<IpcResult>;
    create: (req?: unknown) => Promise<IpcResult>;
    delete: (id: string) => Promise<IpcResult>;
  };
  state: { get: () => Promise<IpcResult> };
  health: { get: () => Promise<IpcResult>; daemonHealth: () => Promise<IpcResult> };
  capabilities: { get: () => Promise<IpcResult> };
  execute: (input: string) => Promise<IpcResult>;
  events: { list: (opts?: { page?: number; limit?: number; type?: string }) => Promise<IpcResult> };
  agent: { patch: (id: string, patch: Record<string, unknown>) => Promise<IpcResult> };
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
    onTool?: (evt: { type: "start" | "result"; toolName: string; input?: string; success?: boolean; toolCallId: string }) => void,
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
    // A2 吸收：工具调用内联事件订阅（🔧 调用中 → ✅ 完成）
    const toolHandler = (_event: Electron.IpcRendererEvent, evt: { type: "start" | "result"; toolName: string; input?: string; success?: boolean; toolCallId: string }) => onTool?.(evt);
    ipcRenderer.on(IPC_CHANNELS.CHAT_TOOL, toolHandler);
    return ipcRenderer.invoke(IPC_CHANNELS.CORTEX_STREAM_CHAT, input, agent, history).then(
      () => {
        ipcRenderer.removeListener(IPC_CHANNELS.CHAT_TOOL, toolHandler);
        return { ok: true };
      },
      () => {
        ipcRenderer.removeListener(IPC_CHANNELS.CHAT_TOOL, toolHandler);
        return { ok: false };
      },
    );
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

  // ── P0：完整 Engine 接入 —— renderer 侧 typed 门面 ──
  memory: {
    search: (q, opts) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_MEMORY_SEARCH, q, opts),
    write: (entry) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_MEMORY_WRITE, entry),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_MEMORY_DELETE, id),
  },
  scheduler: {
    snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_SCHEDULER_SNAPSHOT),
    execute: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_SCHEDULER_EXECUTE),
    submitNode: (node) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_NODE_SUBMIT, node),
  },
  nodes: {
    list: (opts) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_NODE_LIST, opts),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_NODE_GET, id),
  },
  sessions: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_SESSIONS_LIST),
    create: (req) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_SESSIONS_CREATE, req),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_SESSIONS_DELETE, id),
  },
  state: { get: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_STATE_GET) },
  health: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_HEALTH_GET),
    daemonHealth: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_DAEMON_HEALTH_GET),
  },
  capabilities: { get: () => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_CAPABILITIES_GET) },
  execute: (input) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_EXECUTE, input),
  events: { list: (opts) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_EVENTS_LIST, opts) },
  agent: { patch: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.CORTEX_AGENT_PATCH, id, patch) },
} satisfies CortexDesktopAPI);
