/**
 * @cortex/config — 配置接口定义（向后兼容桶重导出）
 *
 * 接口已按职责域拆分至 interfaces/ 子目录。
 * 此文件保留以确保现有 import 路径不中断。
 *
 * @deprecated 建议直接 import from "@cortex/config"（已包含所有新导出）
 */

export type {
  EngineConfig,
  ToolTimeoutsConfig,
  InspectorConfig,
  LlmConfig,
  FilePathsConfig,
  SkillSystemConfig,
  SearchProviderConfig,
  SearchAggregationConfig,
  SearchConfig,
  OutputFormat,
} from "./interfaces/index.js";

export { OUTPUT_FORMATS } from "./interfaces/index.js";
