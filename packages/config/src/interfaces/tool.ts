/**
 * @cortex/config — 工具元数据接口
 *
 * @module interfaces/tool
 * @layer root — 零依赖，纯类型层
 */

/** 工具参数定义 */
export interface ToolParameterDef {
  type: "string" | "number" | "boolean";
  description: string;
}

/** 工具元数据 */
export interface ToolMeta {
  category: "Read" | "Write" | "Search" | "Shell";
  description: string;
  level: "L0" | "L1" | "L2" | "L3";
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterDef>;
    required: string[];
  };
}

/** 工具注册表 */
export type ToolRegistry = Record<string, ToolMeta>;
