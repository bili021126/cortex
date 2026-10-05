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
  CORTEX_CONFIG_GET: "cortex:config-get",
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

  // ── P0：完整 Engine 接入（桥 CortexHttpClient 已存在 typed 方法到 renderer）
  //   策略：只补 Desktop 面板会直接用的能力；config 域（models/keys/tuning/
  //   validate/version）留待 P1 有 config 面板时一并补，不建"没消费者的通道"。
  //   双向覆盖由 desktop/tests/ipc-coverage.test.ts @ci:contract 守。
  CORTEX_MEMORY_SEARCH: "cortex:memory-search",
  CORTEX_MEMORY_WRITE: "cortex:memory-write",
  CORTEX_MEMORY_DELETE: "cortex:memory-delete",
  CORTEX_SCHEDULER_SNAPSHOT: "cortex:scheduler-snapshot",
  CORTEX_SCHEDULER_EXECUTE: "cortex:scheduler-execute",
  CORTEX_NODE_SUBMIT: "cortex:node-submit",
  CORTEX_NODE_LIST: "cortex:node-list",
  CORTEX_NODE_GET: "cortex:node-get",
  CORTEX_SESSIONS_LIST: "cortex:sessions-list",
  CORTEX_SESSIONS_CREATE: "cortex:sessions-create",
  CORTEX_SESSIONS_DELETE: "cortex:sessions-delete",
  CORTEX_STATE_GET: "cortex:state-get",
  CORTEX_HEALTH_GET: "cortex:health-get",
  CORTEX_DAEMON_HEALTH_GET: "cortex:daemon-health-get",
  CORTEX_CAPABILITIES_GET: "cortex:capabilities-get",
  CORTEX_EXECUTE: "cortex:execute",
  CORTEX_EVENTS_LIST: "cortex:events-list",
  CORTEX_AGENT_PATCH: "cortex:agent-patch",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
