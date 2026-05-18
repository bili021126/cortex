// ============================================================
// @cortex/factory — 文档配置加载器
//
// 读取 cortex-docs.json，解析文档注册表和宪法路径。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { CortexDocsConfig, DocEntry } from "../types.js";

/**
 * 加载 cortex-docs.json。
 * 该文件为可选——不存在时返回空默认配置。
 */
export function loadDocsConfig(projectRoot: string): CortexDocsConfig {
  const filePath = path.join(projectRoot, "cortex-docs.json");

  if (!fs.existsSync(filePath)) {
    return {
      constitutionPath: "docs/Cortex 概念顶层设计 v2.5.md",
      docRegistry: [],
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    throw new Error(`读取 cortex-docs.json 失败: ${String(e)}`, { cause: e });
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cortex-docs.json JSON 解析失败: ${String(e)}`, { cause: e });
  }

  return _validateStructure(config as CortexDocsConfig);
}

function _validateStructure(config: CortexDocsConfig): CortexDocsConfig {
  if (!config || typeof config !== "object") {
    throw new Error("cortex-docs.json: 顶层必须为对象");
  }

  if (!config.constitutionPath) {
    config.constitutionPath = "docs/Cortex 概念顶层设计 v2.5.md";
  }

  if (!Array.isArray(config.docRegistry)) {
    config.docRegistry = [];
  }

  // 校验每项文档注册
  for (const entry of config.docRegistry) {
    const e = entry as DocEntry;
    if (!e.path) {
      throw new Error("cortex-docs.json: docRegistry 项缺少 path");
    }
  }

  return config;
}
