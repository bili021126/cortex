/**
 * @cortex/desktop — IPC 通道常量（D5 单源化）
 *
 * 唯一事实源：main（ipc-handlers）与 preload 均从此处 import，
 * 禁止在两端各自维护副本（历史双份已漂移——SCREENSHOT/PRESENCE_EVENT 曾不同步）。
 */

export const IPC_CHANNELS = {
  CORTEX_INIT: "cortex:init",
  CORTEX_CHAT: "cortex:chat",
  CORTEX_STREAM_CHAT: "cortex:stream-chat",
  CORTEX_STREAM_CANCEL: "cortex:stream-cancel",
  CORTEX_GET_AGENTS: "cortex:get-agents",
  LIVE2D_SPEAK: "live2d:speak",
  LIVE2D_EXPRESSION: "live2d:expression",
  SETTINGS_GET: "settings:get",
  SETTINGS_SET: "settings:set",
  SCREENSHOT: "desktop:screenshot",
  PRESENCE_EVENT: "presence:event",
  DESKTOP_RESTART: "desktop:restart",
  EDITOR_SAVE: "editor:save",
  EDITOR_SAVE_AS: "editor:save-as",
  NOTIFICATION_EVENT: "notification:event",
  // D7b：确认门远程确认链路（gate.request → renderer 浮层 → gate.resolve）
  GATE_REQUEST: "gate:request",
  GATE_RESOLVE: "gate:resolve",
  // 工具调用内联事件（A2 吸收：🔧 调用中 → ✅ 完成）
  CHAT_TOOL: "chat:tool",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
