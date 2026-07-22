/**
 * @cortex/protocol — Config REST API 类型
 *
 * 配置管理面的请求/响应 DTO。
 * 与 @cortex/config 内部类型解耦——客户端只需知道这些 DTO。
 */

// ─── Models ───────────────────────────────────────────

/** 模型条目 DTO（API 视角） */
export interface ModelEntryDTO {
  label: string;
  capabilities: string[];
  thinking: boolean;
  defaultFor: string[];
  maxOutputTokens?: number;
  contextWindow?: number;
  reasoningEffortLevels?: string[];
}

/** POST /models 请求 */
export interface CreateModelRequest {
  key: string;
  entry: ModelEntryDTO;
}

/** PATCH /models/:id 请求 */
export type PatchModelRequest = Partial<ModelEntryDTO>;

// ─── Keys（脱敏） ─────────────────────────────────────

/** 密钥条目 DTO（永远脱敏） */
export interface KeyEntryMaskedDTO {
  label: string;
  /** 环境变量名（非密钥值本身） */
  envVar: string;
  modelFallback: string;
  agents: string[];
  /** 标记已脱敏——客户端不应期望获取明文 */
  masked: true;
}

/** POST /keys 请求 */
export interface CreateKeyRequest {
  key: string;
  entry: {
    label: string;
    envVar: string;
    modelFallback: string;
    agents: string[];
  };
}

// ─── Agents ───────────────────────────────────────────

/** Agent 清单 DTO */
export interface AgentManifestDTO {
  id: string;
  type: string;
  role: string;
  model: string;
  key: string;
  produces: string[];
  tags?: string[];
  toolPermissions?: string[];
  maxInstances?: number;
  memoryQueryStrategy?: string;
}

/** PATCH /agents/:id 请求 */
export type PatchAgentRequest = Partial<Omit<AgentManifestDTO, "id">>;

// ─── Tuning ───────────────────────────────────────────

/** 调优配置 DTO */
export interface TuningConfigDTO {
  env: Record<string, { default: string | null; desc: string }>;
  tuning: Record<string, Record<string, number>>;
}

/** PATCH /tuning 请求 */
export interface PatchTuningRequest {
  /** 点路径（如 "execution.reactMaxLoops"） */
  path?: string;
  value?: number;
  /** 整组覆盖 */
  group?: string;
  params?: Record<string, number>;
}

// ─── Validate ─────────────────────────────────────────

/** POST /config/validate 请求 */
export interface ConfigValidateRequest {
  domain: string;
  data: unknown;
}

/** POST /config/validate 响应 */
export interface ConfigValidateResponse {
  ok: boolean;
  errors: Array<{ path: string; message: string }>;
}

// ─── Version ──────────────────────────────────────────

/** GET /config/version 响应 */
export interface ConfigVersionResponse {
  version: string;
  domains: string[];
}
