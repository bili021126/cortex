/**
 * bootstrap/config.ts — ConfigStores 初始化与链接
 *
 * 在 CLI 启动早期调用，创建所有 ConfigStore 实例并完成跨 Store 链接。
 * 所有后续组件通过此入口获取配置读写能力，而非直接操作 JSON 文件。
 *
 * USAGE:
 *   const stores = bootstrapConfigStores(resolveConfigDataDir());
 *   stores.agentStore.addAgent(...);      // CRUD
 *   stores.tagRegistry.register("my-tag"); // 标签持久化
 */

import {
  resolveConfigDataDir,
  type ConfigFileReader,
  type ConfigFileWriter,
  AgentManifestStore,
  ModelStore,
  KeyStore,
  TuningStore,
  tagRegistry,
} from "@cortex/config";

import { readFileSync, writeFileSync } from "node:fs";
import { setAgentRegistry } from "@cortex/shared";

/** 适配 Node.js fs 到 ConfigFileReader */
const readFile: ConfigFileReader = (filePath: string) =>
  readFileSync(filePath, "utf-8");

/** 适配 Node.js fs 到 ConfigFileWriter */
const writeFile: ConfigFileWriter = (filePath: string, content: string) =>
  writeFileSync(filePath, content, "utf-8");

/** 已初始化的 ConfigStore 集合 */
export interface ConfigStores {
  modelStore: ModelStore;
  keyStore: KeyStore;
  agentStore: AgentManifestStore;
  tuningStore: TuningStore;
}

let _stores: ConfigStores | null = null;

/**
 * 初始化所有 ConfigStore 实例并完成跨 Store 链接。
 * 幂等——重复调用返回同一实例。
 *
 * @param dataDir config data 目录路径（默认 resolveConfigDataDir()）
 */
export function bootstrapConfigStores(dataDir?: string): ConfigStores {
  if (_stores) return _stores;

  const dir = dataDir ?? resolveConfigDataDir();

  const modelStore = new ModelStore(readFile, writeFile, dir);
  const keyStore = new KeyStore(readFile, writeFile, dir);
  const agentStore = new AgentManifestStore(readFile, writeFile, dir);
  const tuningStore = new TuningStore(readFile, writeFile, dir);

  // 链接 TagRegistry → AgentManifestStore 实现标签持久化闭环
  tagRegistry.setStore(agentStore);

  _stores = { modelStore, keyStore, agentStore, tuningStore };
  return _stores;
}

/** 获取已初始化的 ConfigStores（仅当 bootstrapConfigStores() 已调用） */
export function getConfigStores(): ConfigStores {
  if (!_stores) {
    throw new Error(
      "[bootstrap] ConfigStores 尚未初始化——请在启动早期调用 bootstrapConfigStores()",
    );
  }
  return _stores;
}

/**
 * 将 agent-manifests.json 的 tags / toolPermissions 注入 shared 层运行时注册表。
 * 应在 engine bootstrap 之后、scheduler dispatch 之前调用。
 */
export function injectAgentManifestsToRegistry(): void {
  const stores = getConfigStores();
  const manifests = stores.agentStore.listAgents();
  const tags: Record<string, readonly string[]> = {};
  const toolPermissions: Record<string, readonly string[]> = {};
  for (const [, m] of Object.entries(manifests)) {
    if (m.tags) tags[m.type] = [...m.tags];
    if (m.toolPermissions) toolPermissions[m.type] = [...m.toolPermissions];
  }
  setAgentRegistry(tags, toolPermissions);
}
