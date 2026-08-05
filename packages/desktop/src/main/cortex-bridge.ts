/**
 * CortexBridge — 桌面端 LLM 桥接
 *
 * 通过 @cortex/client SDK 连接 cortex daemon（HTTP/WS）。
 * 桌宠只需要 chat 能力，daemon 负责完整的引擎调度管线。
 *
 * 架构：Desktop ── @cortex/client ──HTTP/WS── @cortex/server ──in-process── @cortex/engine
 *
 * @since 0.3.0 — 从直连 LlmAdapter → daemon 客户端模式
 */
import { CortexConnection, streamChat } from "@cortex/client";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";

export class CortexBridge {
  private conn: CortexConnection | null = null;
  private initialized = false;

  /**
   * 初始化连接至 cortex daemon。
   * @param daemonPort - daemon 监听端口（默认 3210）
   */
  async init(daemonPort?: number): Promise<void> {
    if (this.initialized) return;
    // R13-N3：读取 daemon 令牌文件（P0-3 后 WS 需鉴权——随机令牌同步）
    let wsToken: string | undefined;
    try {
      wsToken = fs.readFileSync(join(os.homedir(), ".cortex", "ws-token"), "utf-8").trim();
    } catch { /* daemon 未写令牌文件（env 配置时）——连接层回退 */ }
    this.conn = new CortexConnection({ port: daemonPort ?? 3210, authToken: wsToken });
    this.conn.connect();
    this.initialized = true;
    console.log(`[CortexBridge] Connected to daemon on port ${daemonPort ?? 3210}`);
  }

  /**
   * 发送对话，返回完整文本结果。
   */
  async chat(input: string, agent?: string): Promise<string> {
    if (!this.initialized || !this.conn) {
      throw new Error("CortexBridge not initialized");
    }
    return await this.conn.http.chat(input, { agent });
  }

  /**
   * 流式对话。
   */
  async streamChat(
    input: string,
    agent?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    if (!this.initialized || !this.conn) {
      throw new Error("CortexBridge not initialized");
    }

    const conn = this.conn;
    return await new Promise<string>((resolve, reject) => {
      let full = "";
      streamChat(conn, input, {
        onChunk: (content) => {
          full += content;
          onChunk?.(content);
        },
        onComplete: (output) => resolve(output || full),
        onError: (error) => reject(new Error(error)),
      }, { agent });
    });
  }

  /**
   * 获取可用 Agent 列表。
   */
  async getAgents(): Promise<string[]> {
    if (!this.initialized || !this.conn) {
      return ["cyrene"];
    }
    try {
      const agents = await this.conn.http.getAgents();
      return Object.keys(agents);
    } catch {
      return ["cyrene"];
    }
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** 暴露底层连接（供 PresenceBridge 订阅 WS 事件） */
  get connection(): CortexConnection {
    if (!this.conn) throw new Error("CortexBridge not initialized");
    return this.conn;
  }

  dispose(): void {
    this.conn?.disconnect();
    this.conn = null;
    this.initialized = false;
  }
}
