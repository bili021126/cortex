/**
 * @cortex/server — EngineHost
 *
 * Wraps bootstrapEngine() with config store initialization and LLM adapter
 * creation. Provides a clean facade for the daemon to access engine components.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { bootstrapEngine } from "@cortex/engine";
import type { BootstrapEngineResult } from "@cortex/engine";
import { LlmAdapter } from "@cortex/llm";
import { Toolkit } from "@cortex/platform";
import {
  resolveConfigDataDir,
  ModelStore,
  KeyStore,
  AgentManifestStore,
  TuningStore,
  LLM_KEY_NAMES,
  ENV_DEEPSEEK_BASE_URL,
  ENV_DEEPSEEK_CHAT_MODEL,
  ENV_DEEPSEEK_CYRENE_CHAT_MODEL,
  ENV_DEEPSEEK_GANYU_CHAT_MODEL,
  ENV_DEEPSEEK_REASONER_MODEL,
  ENV_DEEPSEEK_REASONING_EFFORT,
  ENV_DEEPSEEK_API_KEY,
  ENV_DEEPSEEK_CYRENE_API_KEY,
  ENV_DEEPSEEK_GANYU_API_KEY,
  ENV_DEEPSEEK_CHAT_API_KEY,
  ENV_DEEPSEEK_REASONER_API_KEY,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHAT_MODEL,
  type ConfigFileReader,
  type ConfigFileWriter,
} from "@cortex/config";
import { HealthCollector } from "@cortex/telemetry";
import type { IScheduler, ConfirmGate } from "@cortex/scheduler";
import type {
  IPipelineObserver,
  ITaskBoard,
  IAgentPool,
  IMemoryStore,
} from "@cortex/shared";

/** Config stores bundle */
export interface ConfigStores {
  modelStore: ModelStore;
  keyStore: KeyStore;
  agentStore: AgentManifestStore;
  tuningStore: TuningStore;
}

/** EngineHost creation options */
export interface EngineHostOptions {
  projectRoot: string;
  workspaceRoot?: string;
}

const readFile: ConfigFileReader = (filePath: string) => readFileSync(filePath, "utf-8");
const writeFile: ConfigFileWriter = (filePath: string, content: string) =>
  writeFileSync(filePath, content, "utf-8");

/**
 * EngineHost — wraps the full engine bootstrap lifecycle.
 * Provides typed getters for all engine subsystems.
 */
export class EngineHost {
  private result: BootstrapEngineResult;
  private readonly llms: Map<string, LlmAdapter>;
  private readonly toolkit: Toolkit;
  private readonly stores: ConfigStores;
  private readonly _healthCollector: HealthCollector;

  private constructor(
    result: BootstrapEngineResult,
    llms: Map<string, LlmAdapter>,
    toolkit: Toolkit,
    stores: ConfigStores,
    healthCollector: HealthCollector,
  ) {
    this.result = result;
    this.llms = llms;
    this.toolkit = toolkit;
    this.stores = stores;
    this._healthCollector = healthCollector;
  }

  /**
   * Factory: loads .env, creates config stores, LLM adapters, Toolkit,
   * then calls bootstrapEngine.
   */
  static async create(options: EngineHostOptions): Promise<EngineHost> {
    // Load .env file if present
    loadDotEnv(options.projectRoot);

    // Create config stores
    const stores = createConfigStores();

    // Create LLM adapters
    const llms = createLlmAdapters(stores);

    // Create Toolkit
    const toolkit = new Toolkit();

    // Bootstrap engine
    const result = await bootstrapEngine(options.projectRoot, {
      llms,
      toolkit,
      workspaceRoot: options.workspaceRoot,
    });

    // Create health collector
    const healthCollector = new HealthCollector();

    return new EngineHost(result, llms, toolkit, stores, healthCollector);
  }

  // ── Getters ──────────────────────────────────────────

  get scheduler(): IScheduler {
    return this.result.scheduler;
  }

  get observer(): IPipelineObserver {
    return this.result.observer;
  }

  get gate(): ConfirmGate {
    return this.result.gate;
  }

  get memory(): IMemoryStore | undefined {
    return this.result.memory;
  }

  get metaAgent(): BootstrapEngineResult["metaAgent"] {
    return this.result.metaAgent;
  }

  get board(): ITaskBoard {
    return this.result.board;
  }

  get pool(): IAgentPool {
    return this.result.pool;
  }

  get configStores(): ConfigStores {
    return this.stores;
  }

  get healthCollector(): HealthCollector {
    return this._healthCollector;
  }

  get llmAdapters(): Map<string, LlmAdapter> {
    return this.llms;
  }

  get toolkitInstance(): Toolkit {
    return this.toolkit;
  }

  /** Get the primary LLM adapter (first available) */
  get llm(): LlmAdapter {
    const first = this.llms.values().next();
    if (first.done || !first.value) {
      throw new Error("[EngineHost] No LLM adapters available — check API key configuration");
    }
    return first.value;
  }

  async shutdown(): Promise<void> {
    await this.result.shutdown();
  }

  /** 注册配置变更监听——任一配置域写入后以域名触发 */
  onConfigChange(fn: (domain: string) => void): void {
    this.stores.modelStore.onChange(fn);
    this.stores.keyStore.onChange(fn);
    this.stores.agentStore.onChange(fn);
    this.stores.tuningStore.onChange(fn);
  }
}

// ── Internal helpers ──────────────────────────────────────

function loadDotEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, ".env");
  if (!existsSync(envPath)) return;
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env read failure is non-fatal
  }
}

function createConfigStores(): ConfigStores {
  const dir = resolveConfigDataDir();
  const modelStore = new ModelStore(readFile, writeFile, dir);
  const keyStore = new KeyStore(readFile, writeFile, dir);
  const agentStore = new AgentManifestStore(readFile, writeFile, dir);
  const tuningStore = new TuningStore(readFile, writeFile, dir);
  return { modelStore, keyStore, agentStore, tuningStore };
}

function createLlmAdapters(stores: ConfigStores): Map<string, LlmAdapter> {
  const llms = new Map<string, LlmAdapter>();

  const llmBaseUrl = process.env[ENV_DEEPSEEK_BASE_URL] || DEFAULT_LLM_BASE_URL;
  const llmChatModel = process.env[ENV_DEEPSEEK_CHAT_MODEL] || DEFAULT_LLM_CHAT_MODEL;
  const llmCyreneChatModel = process.env[ENV_DEEPSEEK_CYRENE_CHAT_MODEL] || llmChatModel;
  const llmReasonerModel = process.env[ENV_DEEPSEEK_REASONER_MODEL] || "deepseek-reasoner";
  const llmGanyuChatModel = process.env[ENV_DEEPSEEK_GANYU_CHAT_MODEL] || llmReasonerModel;
  const llmReasoningEffort = (process.env[ENV_DEEPSEEK_REASONING_EFFORT] as "high" | "max") || undefined;

  const fallbackKey = process.env[ENV_DEEPSEEK_API_KEY];

  const makeAdapter = (
    key: string,
    label: string,
    chatModelOverride?: string,
    extra?: { reasoningEffort?: "high" | "max" },
  ): LlmAdapter =>
    new LlmAdapter({
      apiKey: key,
      baseUrl: llmBaseUrl,
      chatModel: chatModelOverride ?? llmChatModel,
      reasonerModel: llmReasonerModel,
      reasoningEffort: extra?.reasoningEffort,
      label,
    });

  // Cyrene
  const cyreneKey = process.env[ENV_DEEPSEEK_CYRENE_API_KEY] || fallbackKey;
  if (cyreneKey) {
    llms.set(LLM_KEY_NAMES.CYRENE, makeAdapter(cyreneKey, "cyrene", llmCyreneChatModel));
  }

  // Ganyu
  const ganyuKey = process.env[ENV_DEEPSEEK_GANYU_API_KEY] || fallbackKey;
  if (ganyuKey) {
    llms.set(LLM_KEY_NAMES.GANYU, makeAdapter(ganyuKey, "reasoner", llmGanyuChatModel, { reasoningEffort: llmReasoningEffort }));
  }

  // Chat pool
  const chatKey = process.env[ENV_DEEPSEEK_CHAT_API_KEY] || fallbackKey;
  if (chatKey) {
    llms.set(LLM_KEY_NAMES.CHAT, makeAdapter(chatKey, "chat"));
  }

  // Reasoner
  const reasonerKey = process.env[ENV_DEEPSEEK_REASONER_API_KEY] || fallbackKey;
  if (reasonerKey) {
    llms.set(LLM_KEY_NAMES.REASONER, makeAdapter(reasonerKey, "reasoner", undefined, { reasoningEffort: llmReasoningEffort }));
  }

  return llms;
}
