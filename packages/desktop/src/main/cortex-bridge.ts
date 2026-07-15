/**
 * CortexBridge — 桌面端 LLM 桥接
 *
 * 轻量直连模式：跳过 bootstrapEngine，直接创建 LlmAdapter。
 * 桌宠只需要 chat 能力，不需要完整的引擎调度管线。
 *
 * @since 0.2.0 — 从 as never 空壳 → 真 LLM 接入
 */
import { LlmAdapter } from "@cortex/llm";
import type { LlmMessage } from "@cortex/shared";
import * as path from "path";
import * as fs from "fs";

export class CortexBridge {
  private llm: LlmAdapter | null = null;
  private initialized = false;
  private projectRoot = "";
  private systemPrompt = "";
  private model = "deepseek-v4-flash";

  /** 加载 .env 文件（不依赖 dotenv 包，手动解析） */
  private loadEnv(projectRoot: string): Record<string, string> {
    const env: Record<string, string> = {};
    const envPath = path.join(projectRoot, ".env");
    try {
      const raw = fs.readFileSync(envPath, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // 去掉引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
    } catch {
      // .env 不存在则回退到 process.env
    }
    return env;
  }

  /** 加载系统提示词 */
  private loadSystemPrompt(projectRoot: string): string {
    const parts: string[] = [];

    // 昔涟本体锚点
    const personaPath = path.join(projectRoot, ".cortex", "persona-talk.txt");
    try {
      const persona = fs.readFileSync(personaPath, "utf-8");
      parts.push(persona);
    } catch {
      // persona-talk 不存在，尝试 prompts 目录
    }

    // 补充系统提示词
    const sysPath = path.join(projectRoot, "prompts", "cyrene", "system.md");
    try {
      const sys = fs.readFileSync(sysPath, "utf-8");
      if (!parts.length || (parts[0] && !parts[0].includes(sys.slice(0, 50)))) {
        parts.push(sys);
      }
    } catch {
      // 降级：使用最简系统提示词
    }

    return parts.join("\n\n") || "你是昔涟——Cortex 的核心工作搭档。";
  }

  /**
   * 初始化桥接。传入项目根路径以加载 .env 和系统提示词。
   */
  async init(projectRoot: string): Promise<void> {
    if (this.initialized) return;
    this.projectRoot = projectRoot;

    const env = this.loadEnv(projectRoot);

    // 昔涟专用 API Key（独立人格 + 独立计费）
    const apiKey = env["DEEPSEEK_CYRENE_API_KEY"]
      || env["DEEPSEEK_API_KEY"]
      || process.env["DEEPSEEK_CYRENE_API_KEY"]
      || process.env["DEEPSEEK_API_KEY"]
      || "";

    const baseUrl = env["DEEPSEEK_BASE_URL"]
      || process.env["DEEPSEEK_BASE_URL"]
      || "https://api.deepseek.com/v1";

    const chatModel = env["DEEPSEEK_CYRENE_CHAT_MODEL"]
      || env["DEEPSEEK_CHAT_MODEL"]
      || process.env["DEEPSEEK_CYRENE_CHAT_MODEL"]
      || process.env["DEEPSEEK_CHAT_MODEL"]
      || "deepseek-v4-flash";

    if (!apiKey) {
      throw new Error(
        "[CortexBridge] 未找到 API Key。请在项目根目录的 .env 中设置 DEEPSEEK_CYRENE_API_KEY 或 DEEPSEEK_API_KEY。"
      );
    }

    this.llm = new LlmAdapter({
      baseUrl,
      apiKey,
      chatModel,
      label: "desktop-cyrene",
    });

    this.model = chatModel;
    this.systemPrompt = this.loadSystemPrompt(projectRoot);
    this.initialized = true;

    const maskedKey = apiKey.slice(0, 6) + "***" + apiKey.slice(-4);
    console.log(
      `[CortexBridge] 已初始化 — model=${chatModel}, key=${maskedKey}, base=${baseUrl}`
    );
  }

  /**
   * 发送对话，返回完整文本结果。
   */
  async chat(input: string, _agent?: string): Promise<string> {
    if (!this.initialized || !this.llm) {
      throw new Error("CortexBridge 未初始化，请先调用 init()");
    }

    const messages: LlmMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input },
    ];

    const res = await this.llm.chat(
      this.model,
      messages,
      [],
      undefined,
      undefined,
    );

    return res.content ?? "";
  }

  /**
   * 流式对话。
   */
  async streamChat(
    input: string,
    _agent?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<string> {
    if (!this.initialized || !this.llm) {
      throw new Error("CortexBridge 未初始化，请先调用 init()");
    }

    const messages: LlmMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input },
    ];

    let full = "";
    const res = await this.llm.chatStream(
      this.model,
      messages,
      [],
      (content) => {
        if (content) {
          full += content;
          onChunk?.(content);
        }
      },
    );

    // 流式结束后确保返回完整内容
    const final = res?.content ?? full;
    return final || full;
  }

  /**
   * 获取可用 Agent 列表。
   */
  async getAgents(): Promise<string[]> {
    return ["cyrene", "code", "review", "analysis"];
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}
