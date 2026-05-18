// ============================================================
// @cortex/factory — 认知配置加载器
//
// 读取 cortex-cognition.json，解析激活矩阵和注意力策略。
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { CortexCognitionConfig, ActivationEntry, AttentionStrategy } from "../types.js";

/** 默认注意力策略 */
const DEFAULT_ATTENTION: AttentionStrategy = {
  hcaWeight: 0.6,
  csaWeight: 0.4,
  maxMemoryItems: 20,
};

/**
 * 加载 cortex-cognition.json。
 * 该文件为可选——不存在时返回空默认配置。
 */
export function loadCognitionConfig(projectRoot: string): CortexCognitionConfig {
  const filePath = path.join(projectRoot, "cortex-cognition.json");

  if (!fs.existsSync(filePath)) {
    // 文件不存在 → 返回默认空配置
    return {
      activationMatrix: [],
      attention: DEFAULT_ATTENTION,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    throw new Error(`读取 cortex-cognition.json 失败: ${String(e)}`, { cause: e });
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(`cortex-cognition.json JSON 解析失败: ${String(e)}`, { cause: e });
  }

  return _validateStructure(config as CortexCognitionConfig);
}

function _validateStructure(config: CortexCognitionConfig): CortexCognitionConfig {
  if (!config || typeof config !== "object") {
    throw new Error("cortex-cognition.json: 顶层必须为对象");
  }

  if (!Array.isArray(config.activationMatrix)) {
    config.activationMatrix = [];
  }

  // 校验每项激活配置
  for (const entry of config.activationMatrix) {
    const e = entry as ActivationEntry;
    if (!e.agentType) {
      throw new Error("cortex-cognition.json: activationMatrix 项缺少 agentType");
    }
  }

  // 注意力策略缺失时使用默认值
  if (!config.attention || typeof config.attention !== "object") {
    config.attention = DEFAULT_ATTENTION;
  } else {
    config.attention = {
      hcaWeight: config.attention.hcaWeight ?? DEFAULT_ATTENTION.hcaWeight,
      csaWeight: config.attention.csaWeight ?? DEFAULT_ATTENTION.csaWeight,
      maxMemoryItems: config.attention.maxMemoryItems ?? DEFAULT_ATTENTION.maxMemoryItems,
    };
  }

  return config;
}
