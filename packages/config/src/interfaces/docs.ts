/**
 * @cortex/config — 文档配置接口
 *
 * @module interfaces/docs
 * @layer root — 零依赖，纯类型层
 */

/** 文档类型 */
export type DocType = "constitution" | "design" | "audit" | "review" | "governance";

/** 文档注册项 */
export interface DocEntry {
  path: string;
  type: DocType;
  version: string;
  canonical: boolean;
}

/** 文档配置 */
export interface DocsConfig {
  constitutionPath: string;
  docRegistry: DocEntry[];
}
