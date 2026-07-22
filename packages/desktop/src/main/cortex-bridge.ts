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

export class CortexBridge {
  private conn: CortexConnection | null = null;
  private initialized = false;

  /**
   * 初始化连接至 cortex daemon。
   * @param daemonPort - daemon 监听端口（默认 3210）
   */
  async init(daemonPort?: number): Promise<void> {
    if (this.initialized) return;
    this.conn = new CortexConnection({ port: daemonPort ?? 3210 });
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
