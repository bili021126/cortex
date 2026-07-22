/**
 * @cortex/config — ConfigStore 数据持久层
 *
 * 为每个配置域提供 CRUD 能力——从"静态 JSON 加载"演进为"独立数据表"。
 *
 * 设计原则：
 *   1. FS-Agnostic —— readFile/writeFile 构造函数注入，解耦 Node/Browser
 *   2. 域自治 —— 每个域独立管理自己的 JSON 文件
 *   3. 封装键提取 —— dataKey 域的读写自动处理顶层包装
 *   4. 标签联动 —— AgentManifestStore 自动维护 _tags 主表
 *
 * @module store
 * @layer root — 零外部依赖（仅 path + loader 工具）
 */

import * as path from "node:path";
import { CONFIG_DOMAINS, loadConfigDomain, validateDomainWithSchema, type ConfigFileReader } from "./loader.js";
import type { ModelEntry } from "./interfaces/model.js";
import type { KeyEntry, ContextLimitEntry, KeysContextConfig } from "./interfaces/key-context.js";
import type { AgentProfile, AgentManifestConfig } from "./interfaces/agent-manifest.js";
import type { AgentManifest } from "./interfaces/agent.js";
import type { EnvVarEntry, TuningParams, TuningConfig } from "./interfaces/tuning.js";

// ─── 文件写入器类型 ────────────────────────────────────

/** 文件写入函数签名——调用方提供实现（Node: fs.writeFileSync, Browser: POST） */
export type ConfigFileWriter = (filePath: string, content: string) => void;

/** 获取域对应的 JSON 文件绝对路径 */
function getDomainFilePath(dataDir: string, domainName: string): string {
  const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
  if (!domain) {
    throw new Error(`[ConfigStore] 未知域: ${domainName}`);
  }
  return path.join(dataDir, domain.fileName);
}

// ─── ConfigStore 泛型基类 ──────────────────────────────

/**
 * ConfigStore<T> —— 单个配置域的持久层。
 *
 * 泛型 T 为域的数据类型（loadConfigDomain 返回的类型）。
 * 内部自动处理 dataKey 的包装/解包。
 */
export class ConfigStore<T> {
  /** 域的 dataKey（如 "models", "agents"），null 表示整个 JSON 即为数据 */
  private readonly _dataKey: string | null;

  /** 配置变更回调——每次成功写入后触发（参数为域名） */
  private _onChange: ((domain: string) => void) | null = null;

  constructor(
    protected readonly readFile: ConfigFileReader,
    protected readonly writeFile: ConfigFileWriter,
    protected readonly dataDir: string,
    protected readonly domainName: string,
  ) {
    const domain = CONFIG_DOMAINS.find((d) => d.name === domainName);
    if (!domain) {
      throw new Error(`[ConfigStore] 未知域: ${domainName}`);
    }
    this._dataKey = domain.dataKey ?? null;
  }

  /** 注册配置变更回调——每次成功写入后以域名触发 */
  onChange(fn: (domain: string) => void): void {
    this._onChange = fn;
  }

  /** 读取配置域全量数据 */
  read(): T {
    const data = loadConfigDomain<T>(this.domainName, this.readFile, this.dataDir);
    if (data === undefined) {
      throw new Error(`[ConfigStore] 域 "${this.domainName}" 加载失败`);
    }
    return data;
  }

  /** 写回全量数据到 JSON 文件 */
  write(data: T): void {
    // 写入前执行 JSON Schema 校验（硬阻断）
    validateDomainWithSchema(this.domainName, data);

    const filePath = getDomainFilePath(this.dataDir, this.domainName);

    if (this._dataKey) {
      // 有 dataKey：读取现有文件保留包装字段，仅替换 dataKey 的值
      let wrapper: Record<string, unknown> = {};
      try {
        const raw = this.readFile(filePath);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          wrapper = parsed as Record<string, unknown>;
        }
      } catch {
        // 文件不存在或解析失败——从零开始
      }
      wrapper[this._dataKey] = data;
      this.writeFile(filePath, JSON.stringify(wrapper, null, 2) + "\n");
    } else {
      // 无 dataKey：整个 JSON 替换
      this.writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
    }

    // 写入成功——通知变更监听者
    this._onChange?.(this.domainName);
  }

  /** 部分更新——浅合并 patch 到当前数据后写回 */
  update(patch: Partial<T>): void {
    const current = this.read();
    if (Array.isArray(current)) {
      // 数组类型不支持部分更新——退化为全量写入
      this.write(patch as T);
      return;
    }
    const merged = { ...current, ...patch } as T;
    this.write(merged);
  }

  /** 列举顶层 key（仅对 Record-like 结构有效） */
  listKeys(): string[] {
    const data = this.read();
    if (Array.isArray(data)) return [];
    if (data === null || typeof data !== "object") return [];
    return Object.keys(data as Record<string, unknown>);
  }

  /** 检查域是否存在 */
  exists(): boolean {
    try {
      const filePath = getDomainFilePath(this.dataDir, this.domainName);
      this.readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── ModelStore ────────────────────────────────────────

/**
 * ModelStore —— L1 模型层 CRUD。
 * 管理 models.json 中的模型注册表。
 */
export class ModelStore extends ConfigStore<Record<string, ModelEntry>> {
  constructor(
    readFile: ConfigFileReader,
    writeFile: ConfigFileWriter,
    dataDir: string,
  ) {
    super(readFile, writeFile, dataDir, "models");
  }

  /** 获取单个模型 */
  getModel(key: string): ModelEntry | undefined {
    return this.read()[key];
  }

  /** 列举所有模型 */
  listModels(): Record<string, ModelEntry> {
    return this.read();
  }

  /** 添加模型 */
  addModel(key: string, entry: ModelEntry): void {
    const data = this.read();
    if (data[key]) {
      throw new Error(`[ModelStore] 模型 "${key}" 已存在，请使用 updateModel()`);
    }
    data[key] = entry;
    this.write(data);
  }

  /** 更新模型（部分字段） */
  updateModel(key: string, patch: Partial<ModelEntry>): void {
    const data = this.read();
    const existing = data[key];
    if (!existing) {
      throw new Error(`[ModelStore] 模型 "${key}" 不存在`);
    }
    data[key] = { ...existing, ...patch };
    this.write(data);
  }

  /** 删除模型 */
  removeModel(key: string): void {
    const data = this.read();
    if (!data[key]) {
      throw new Error(`[ModelStore] 模型 "${key}" 不存在`);
    }
    delete data[key];
    this.write(data);
  }
}

// ─── KeyStore ──────────────────────────────────────────

/**
 * KeyStore —— L2 密钥+上下文层 CRUD。
 * 管理 keys-context.json 中的密钥和上下文限制。
 */
export class KeyStore extends ConfigStore<KeysContextConfig> {
  constructor(
    readFile: ConfigFileReader,
    writeFile: ConfigFileWriter,
    dataDir: string,
  ) {
    super(readFile, writeFile, dataDir, "keysContext");
  }

  // ── 密钥操作 ──

  /** 获取单个密钥 */
  getKey(key: string): KeyEntry | undefined {
    return this.read().keys[key];
  }

  /** 列举所有密钥 */
  listKeys2(): Record<string, KeyEntry> {
    return this.read().keys;
  }

  /** 添加密钥 */
  addKey(key: string, entry: KeyEntry): void {
    const data = this.read();
    if (data.keys[key]) {
      throw new Error(`[KeyStore] 密钥 "${key}" 已存在`);
    }
    data.keys[key] = entry;
    this.write(data);
  }

  /** 更新密钥 */
  updateKey(key: string, patch: Partial<KeyEntry>): void {
    const data = this.read();
    const existing = data.keys[key];
    if (!existing) {
      throw new Error(`[KeyStore] 密钥 "${key}" 不存在`);
    }
    data.keys[key] = { ...existing, ...patch };
    this.write(data);
  }

  /** 删除密钥 */
  removeKey(key: string): void {
    const data = this.read();
    if (!data.keys[key]) {
      throw new Error(`[KeyStore] 密钥 "${key}" 不存在`);
    }
    delete data.keys[key];
    this.write(data);
  }

  // ── 上下文限制操作 ──

  /** 获取上下文限制 */
  getContextLimit(key: string): ContextLimitEntry | undefined {
    return this.read().contextLimits[key];
  }

  /** 添加上下文限制 */
  addContextLimit(key: string, entry: ContextLimitEntry): void {
    const data = this.read();
    data.contextLimits[key] = entry;
    this.write(data);
  }

  /** 删除上下文限制 */
  removeContextLimit(key: string): void {
    const data = this.read();
    delete data.contextLimits[key];
    this.write(data);
  }
}

// ─── AgentManifestStore ────────────────────────────────

/**
 * AgentManifestStore —— L3 Agent 层 CRUD。
 * 管理 agent-manifests.json 中的 agent 声明、profile 预置、标签主表。
 * 自动维护 _tags 标签主表的一致性。
 */
export class AgentManifestStore extends ConfigStore<AgentManifestConfig> {
  constructor(
    readFile: ConfigFileReader,
    writeFile: ConfigFileWriter,
    dataDir: string,
  ) {
    super(readFile, writeFile, dataDir, "agentManifests");
  }

  // ── Agent 操作 ──

  /** 获取单个 agent */
  getAgent(key: string): AgentManifest | undefined {
    return this.read().agents[key];
  }

  /** 列举所有 agent */
  listAgents(): Record<string, AgentManifest> {
    return this.read().agents;
  }

  /** 添加 agent——自动注册 tags 到 _tags 主表 */
  addAgent(key: string, manifest: AgentManifest): void {
    const data = this.read();
    if (data.agents[key]) {
      throw new Error(`[AgentManifestStore] Agent "${key}" 已存在`);
    }
    data.agents[key] = manifest;

    // 自动注册标签
    this._syncTagsFromAgent(data, manifest);

    this.write(data);
  }

  /** 更新 agent——自动同步 tags */
  updateAgent(key: string, patch: Partial<AgentManifest>): void {
    const data = this.read();
    const existing = data.agents[key];
    if (!existing) {
      throw new Error(`[AgentManifestStore] Agent "${key}" 不存在`);
    }
    data.agents[key] = { ...existing, ...patch };

    // 自动同步标签
    if (patch.tags) {
      this._syncTagsFromAgent(data, data.agents[key]);
    }

    this.write(data);
  }

  /** 删除 agent——检查标签是否还被其他 agent 引用 */
  removeAgent(key: string): void {
    const data = this.read();
    if (!data.agents[key]) {
      throw new Error(`[AgentManifestStore] Agent "${key}" 不存在`);
    }
    delete data.agents[key];

    // 清理孤儿标签
    this._cleanOrphanTags(data);

    this.write(data);
  }

  // ── Profile 操作 ──

  /** 获取 profile */
  getProfile(key: string): AgentProfile | undefined {
    return this.read()._profiles[key];
  }

  /** 添加 profile */
  addProfile(key: string, profile: AgentProfile): void {
    const data = this.read();
    data._profiles[key] = profile;
    this.write(data);
  }

  /** 删除 profile */
  removeProfile(key: string): void {
    const data = this.read();
    delete data._profiles[key];
    this.write(data);
  }

  // ── 标签操作 ──

  /** 获取标签主表 */
  getTagVocabulary(): string[] {
    return this.read()._tags ?? [];
  }

  /** 获取指定 agent 的标签 */
  getAgentTags(agentKey: string): string[] {
    const agent = this.getAgent(agentKey);
    return agent?.tags ?? [];
  }

  /** 注册新标签到主表 */
  registerTag(tag: string): void {
    const data = this.read();
    if (!data._tags) {
      data._tags = [];
    }
    if (!data._tags.includes(tag)) {
      data._tags.push(tag);
      this.write(data);
    }
  }

  /** 删除标签（仅当无 agent 使用时） */
  removeTag(tag: string): boolean {
    const data = this.read();
    // 检查是否有 agent 在用
    const inUse = Object.values(data.agents).some(
      (a) => a.tags?.includes(tag),
    );
    if (!inUse && data._tags) {
      data._tags = data._tags.filter((t) => t !== tag);
      this.write(data);
      return true;
    }
    return false;
  }

  // ── 私有辅助 ──

  /** 从 agent 提取标签同步到 _tags */
  private _syncTagsFromAgent(data: AgentManifestConfig, agent: AgentManifest): void {
    if (!agent.tags || agent.tags.length === 0) return;
    if (!data._tags) data._tags = [];
    for (const tag of agent.tags) {
      if (!data._tags.includes(tag)) {
        data._tags.push(tag);
      }
    }
  }

  /** 清理无 agent 使用的孤儿标签 */
  private _cleanOrphanTags(data: AgentManifestConfig): void {
    if (!data._tags) return;
    const usedTags = new Set<string>();
    for (const agent of Object.values(data.agents)) {
      if (agent.tags) {
        for (const tag of agent.tags) usedTags.add(tag);
      }
    }
    data._tags = data._tags.filter((t) => usedTags.has(t));
  }
}

// ─── TuningStore ───────────────────────────────────────

/**
 * TuningStore —— L4 调参层 CRUD。
 * 管理 tuning.json 中的环境变量和调参分组。
 */
export class TuningStore extends ConfigStore<TuningConfig> {
  constructor(
    readFile: ConfigFileReader,
    writeFile: ConfigFileWriter,
    dataDir: string,
  ) {
    super(readFile, writeFile, dataDir, "tuning");
  }

  // ── 环境变量操作 ──

  /** 获取环境变量定义 */
  getEnv(key: string): EnvVarEntry | undefined {
    return this.read().env[key];
  }

  /** 设置/添加环境变量 */
  setEnv(key: string, entry: EnvVarEntry): void {
    const data = this.read();
    data.env[key] = entry;
    this.write(data);
  }

  /** 删除环境变量 */
  removeEnv(key: string): void {
    const data = this.read();
    delete data.env[key];
    this.write(data);
  }

  /** 列举所有环境变量名 */
  listEnvKeys(): string[] {
    return Object.keys(this.read().env);
  }

  // ── 调参操作 —— 支持点路径（如 "execution.reactMaxLoops"）──

  /** 获取调参值 */
  getTuningParam(path: string): number | undefined {
    const tuning = this.read().tuning as unknown as Record<string, unknown>;
    return this._getByPath(tuning, path);
  }

  /** 设置调参值 */
  setTuningParam(path: string, value: number): void {
    const data = this.read();
    this._setByPath(data.tuning as unknown as Record<string, unknown>, path, value);
    this.write(data);
  }

  /** 获取整个调参分组 */
  getTuningGroup<K extends keyof TuningParams>(group: K): TuningParams[K] {
    return this.read().tuning[group];
  }

  /** 替换整个调参分组 */
  setTuningGroup<K extends keyof TuningParams>(group: K, params: Partial<TuningParams[K]>): void {
    const data = this.read();
    data.tuning[group] = { ...data.tuning[group], ...params } as TuningParams[K];
    this.write(data);
  }

  // ── 私有辅助 ──

  private _getByPath(obj: Record<string, unknown>, path: string): number | undefined {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      if (key === undefined) return undefined;
      if (i === parts.length - 1) {
        const val = current[key];
        return typeof val === "number" ? val : undefined;
      }
      const next = current[key];
      if (next === null || typeof next !== "object" || Array.isArray(next)) return undefined;
      current = next as Record<string, unknown>;
    }
    return undefined;
  }

  private _setByPath(obj: Record<string, unknown>, path: string, value: number): void {
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (key === undefined) return;
      const next = current[key];
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }
    const lastKey = parts[parts.length - 1];
    if (lastKey !== undefined) {
      current[lastKey] = value;
    }
  }
}

// ─── 工厂函数 ─────────────────────────────────────────

/** 创建 ModelStore 实例 */
export function createModelStore(
  readFile: ConfigFileReader,
  writeFile: ConfigFileWriter,
  dataDir: string,
): ModelStore {
  return new ModelStore(readFile, writeFile, dataDir);
}

/** 创建 KeyStore 实例 */
export function createKeyStore(
  readFile: ConfigFileReader,
  writeFile: ConfigFileWriter,
  dataDir: string,
): KeyStore {
  return new KeyStore(readFile, writeFile, dataDir);
}

/** 创建 AgentManifestStore 实例 */
export function createAgentManifestStore(
  readFile: ConfigFileReader,
  writeFile: ConfigFileWriter,
  dataDir: string,
): AgentManifestStore {
  return new AgentManifestStore(readFile, writeFile, dataDir);
}

/** 创建 TuningStore 实例 */
export function createTuningStore(
  readFile: ConfigFileReader,
  writeFile: ConfigFileWriter,
  dataDir: string,
): TuningStore {
  return new TuningStore(readFile, writeFile, dataDir);
}
