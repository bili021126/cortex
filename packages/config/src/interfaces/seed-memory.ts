/**
 * @cortex/config — 种子记忆配置接口
 *
 * @module interfaces/seed-memory
 * @layer root — 零依赖，纯类型层
 */

/** 种子记忆条目 */
export interface SeedMemoryEntry {
  taskId: string;
  kind: string;
  agentType: string;
  content: unknown;
  summary: string;
  linkTo?: string;
}

/** 种子记忆配置 */
export interface SeedMemoriesConfig {
  description: string;
  entries: SeedMemoryEntry[];
}
