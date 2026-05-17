import * as path from "node:path";
import type { MemoryWriteInput } from "@cortex/shared";
import type { IFileSystemAdapter } from "@cortex/shared";
import type { MemoryStore } from "../memory/memory-store.js";
import { InitVerifier } from "./init-verifier.js";
import type { ConsistencyReport } from "./init-verifier.js";
import { SchemaEnforcer } from "./schema-enforcer.js";
import type { ValidationResult } from "./schema-enforcer.js";

/**
 * ConsistencyLayer —— 记忆-现实一致性校验层 Facade（P1-六层防御）。
 *
 * 作为 MemoryStore 的外部中间件，组合 InitVerifier + SchemaEnforcer，
 * 在关键入口点（启动校验、写入前校验）插入一致性检查。
 *
 * 核心原则：不修改 MemoryStore 内部实现。
 *
 * @since P1-六层防御
 *
 * @fix D8 — 当 enableInitVerifier: true 但未提供 fs 时，通过 console.warn 显式告知用户
 *   InitVerifier 被静默禁用，避免用户误以为第一道防线已就绪。
 */

// ─── 配置 ────────────────────────────────────────

export interface ConsistencyLayerConfig {
  /** 项目根目录（用于文件路径解析） */
  projectRoot: string;
  /** 启动校验阈值：缺失比例超过此值标记 fatal（默认 0.3） */
  failThreshold?: number;
  /** 是否启用启动校验 */
  enableInitVerifier?: boolean;
  /** 是否启用结构校验 */
  enableSchemaEnforcer?: boolean;
  /** FileSystemAdapter（注入以实现可测试性） */
  fs?: IFileSystemAdapter;
}

// ─── Facade ──────────────────────────────────────

export class ConsistencyLayer {
  private readonly _memory: MemoryStore;
  private readonly _config: Omit<Required<ConsistencyLayerConfig>, 'fs'> & { fs: IFileSystemAdapter | undefined };
  private readonly _initVerifier: InitVerifier | null;
  private readonly _schemaEnforcer: SchemaEnforcer | null;

  constructor(
    memory: MemoryStore,
    config: ConsistencyLayerConfig,
  ) {
    this._memory = memory;
    this._config = {
      projectRoot: path.resolve(config.projectRoot),
      failThreshold: config.failThreshold ?? 0.3,
      enableInitVerifier: config.enableInitVerifier ?? true,
      enableSchemaEnforcer: config.enableSchemaEnforcer ?? true,
      fs: config.fs,
    };

    if (this._config.enableInitVerifier && !this._config.fs) {
      console.warn(
        "[ConsistencyLayer] enableInitVerifier=true 但未提供 fs (IFileSystemAdapter)，" +
        "InitVerifier 已静默禁用。记忆-现实一致性校验（六层防御第一道防线）将不生效。",
      );
    }
    this._initVerifier = this._config.enableInitVerifier && this._config.fs
      ? new InitVerifier(memory, this._config.fs, this._config.projectRoot, this._config.failThreshold)
      : null;

    this._schemaEnforcer = this._config.enableSchemaEnforcer
      ? new SchemaEnforcer()
      : null;
  }

  // ── 生命周期 ────────────────────────────────

  /**
   * 启动校验——在 MemoryStore.init() 之后调用。
   * 遍历所有 Active 记忆，校验文件引用的一致性。
   */
  async verify(): Promise<ConsistencyReport | null> {
    if (!this._initVerifier) return null;
    return this._initVerifier.run();
  }

  // ── 写前校验 ────────────────────────────────

  /**
   * 校验写入输入的结构完整性。
   */
  validateInput(input: MemoryWriteInput): ValidationResult {
    if (!this._schemaEnforcer) {
      return { valid: true, errors: [] };
    }
    return this._schemaEnforcer.validate(input);
  }

  /**
   * 自动注入默认字段。
   */
  annotateInput(input: MemoryWriteInput): MemoryWriteInput {
    if (!this._schemaEnforcer) return input;
    return this._schemaEnforcer.annotate(input);
  }

  // ── 状态查询 ────────────────────────────────

  /** 是否已启用启动校验 */
  get hasInitVerifier(): boolean {
    return this._initVerifier !== null;
  }

  /** 是否已启用结构校验 */
  get hasSchemaEnforcer(): boolean {
    return this._schemaEnforcer !== null;
  }
}
