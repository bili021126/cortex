// ============================================================
// @cortex/self-examination/platform — 组件初始化（薄封装）
// ============================================================
//
// 核心逻辑委托给 bootstrapEngine，避免与 register-agents.ts 重复。
// 仅补充自审视专属配置：独立记忆库路径、bypass 定时刷新。

import * as path from "node:path";
import type { ExamConfig } from "./config.js";

let _bypassInterval: ReturnType<typeof setInterval> | null = null;

export interface Platform {
  observer: any;
  board: any;
  pool: any;
  scheduler: any;
  metaAgent: any;
  memory: any;
  toolkit: any;
  agents: any;
  strategistAgent: any;
  butlerAgent: any;
  gate: any;
  engine: any;
}

/** 清理定时器（供 shutdown 调用） */
export function stopPlatform(): void {
  if (_bypassInterval !== null) {
    clearInterval(_bypassInterval);
    _bypassInterval = null;
  }
}

export async function initPlatform(config: ExamConfig): Promise<Platform> {
  const root = config.workspaceRoot ?? process.cwd();
  const memoryDir = path.resolve(root, config.memoryDir);
  const dbPath = path.join(memoryDir, "self-exam.db");

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未设置");

  const { LlmAdapter } = await import("@cortex/llm");
  const { Toolkit } = await import("@cortex/platform");
  const { bootstrapEngine } = await import("@cortex/engine");

  const modelName = config.agentOverrides?.model ?? "deepseek-v4-flash";
  const llm = new LlmAdapter({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
    chatModel: modelName,
    reasonerModel: modelName,
    reasoningEffort: (config.agentOverrides?.reasoning ?? "none") as any,
  });
  llm.setCacheEnabled(true);

  const toolkit = new Toolkit();
  const engine: any = await bootstrapEngine(root, {
    llms: new Map([[modelName.startsWith("deepseek-v4-pro") ? "DEEPSEEK_REASONER" : "DEEPSEEK_CHAT", llm]]),
    toolkit,
    dbPath,
  });

  process.env["CONFIRM_GATE_TIMEOUT_MS"] = "100";
  if (_bypassInterval !== null) clearInterval(_bypassInterval);
  _bypassInterval = setInterval(() => {
    try { engine.gate?.bypassAll?.(); } catch {}
  }, 240_000);

  return {
    observer: engine.observer,
    board: engine.board,
    pool: engine.pool,
    scheduler: engine.scheduler,
    metaAgent: engine.metaAgent,
    memory: engine.memory,
    toolkit,
    agents: engine.agents,
    strategistAgent: engine.strategists?.values().next().value,
    butlerAgent: engine.butler,
    gate: engine.gate,
    engine,
  };
}
