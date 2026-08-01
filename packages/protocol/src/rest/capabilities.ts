/**
 * @cortex/protocol — 服务端能力声明（阶段三 C5）
 *
 * 共面 + 专化的载体：client 连接任意服务端后先 getCapabilities()，
 * 依据 api 标记决定可用方法（未声明的方法调用应得到 404 并被调用方规避）。
 *
 * 共面定义（见 docs/analysis/refactor-phase3-api-surface.md）：
 *   通用（两端必支持）: state / health / nodes / agents / capabilities
 *   daemon 专化: chat / memory / sessions / daemonHealth / execute
 *   WebUI 专化: events / config
 */

/** REST 端点能力标记——true = 该端点可用 */
export interface ServerCapabilitiesApi {
  state: boolean;
  health: boolean;
  nodes: boolean;
  agents: boolean;
  chat: boolean;
  memory: boolean;
  sessions: boolean;
  daemonHealth: boolean;
  execute: boolean;
  events: boolean;
  config: boolean;
}

/** 服务端能力声明 */
export interface ServerCapabilities {
  /** 服务端身份 */
  server: "daemon" | "webui";
  /** 协议版本 */
  version: string;
  /** REST 端点能力标记 */
  api: ServerCapabilitiesApi;
  /** 可订阅的 WS 通道 */
  wsChannels: string[];
}
