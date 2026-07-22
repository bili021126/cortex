/**
 * @cortex/protocol — 协议版本协商
 *
 * 客户端连接时可声明期望的协议版本，服务端返回实际使用的版本。
 * 当前仅支持 1.0.0，但预留协商机制以便未来演进。
 */

/** 当前协议版本 */
export const PROTOCOL_VERSION = "1.0.0";

/** 服务端支持的所有版本（降序） */
export const SUPPORTED_VERSIONS: readonly string[] = ["1.0.0"];

/** 版本协商结果 */
export interface VersionNegotiation {
  /** 客户端请求的版本 */
  requested: string | undefined;
  /** 实际解析到的版本 */
  resolved: string;
  /** 服务端支持的全部版本 */
  supported: string[];
}

/**
 * 协商协议版本。
 * 若客户端请求的版本在服务端支持列表中，则使用该版本；否则回退到最新版本。
 */
export function negotiateVersion(requested?: string): VersionNegotiation {
  const resolved = requested && SUPPORTED_VERSIONS.includes(requested)
    ? requested
    : PROTOCOL_VERSION;
  return {
    requested,
    resolved,
    supported: [...SUPPORTED_VERSIONS],
  };
}
