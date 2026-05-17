// ============================================================
// @cortex/shared — 技能注册表类型定义
//
// @file-overview
// 仅保留类型与接口定义。SkillRegistry 类的具体实现已移至
// @cortex/engine，因为 shared 作为类型中枢不应包含运行时
// 实现代码（含 node:fs/node:path 依赖）。
//
// @moved-to @cortex/engine/src/skill-registry.ts
//   SkillRegistry 类（含 saveJson/loadJson 等文件 I/O 操作）
//   → 消费者改为 import { SkillRegistry } from "@cortex/engine"
// ============================================================

import type { SkillTemplate } from "./agent.js";

/** 技能注册表序列化形状 */
export interface SerializedSkillRegistry {
  version: number;
  templates: SkillTemplate[];
}
