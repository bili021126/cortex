/**
 * @cortex/config — 文档配置接口
 *
 * 文档类型 DocType 由 @cortex/shared 统一提供，本模块仅重新导出。
 *
 * @module interfaces/docs
 * @layer root — 零依赖，纯类型层
 */

import type { DocType } from "@cortex/shared";

/** 文档类型（由 @cortex/shared 统一定义） */
export type { DocType };

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
