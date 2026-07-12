// ============================================================
// @cortex/factory — 认知配置加载器
//
// 从 @cortex/config 包加载 cognition.json。
// ============================================================

import * as fs from "node:fs";
import { resolveConfigDataDir, loadConfigDomain, type ConfigFileReader } from "@cortex/config";
import type { CortexCognitionConfig, ActivationEntry, AttentionStrategy } from "../types.js";

/** 默认注意力策略 */
const DEFAULT_ATTENTION: AttentionStrategy = {
  hcaWeight: 0.6,
  csaWeight: 0.4,
  maxMemoryItems: 20,
};

const readFileNode: ConfigFileReader = (fp: string) => fs.readFileSync(fp, "utf-8");

/**
 * 加载认知配置。
 * 该文件为可选——不存在时返回空默认配置。
 */
export function loadCognitionConfig(_projectRoot: string, dataDirOverride?: string): CortexCognitionConfig {
  const dataDir = dataDirOverride ?? resolveConfigDataDir();

  let config: CortexCognitionConfig | undefined;
  try {
    config = loadConfigDomain<CortexCognitionConfig>(
      "cognition",
      readFileNode,
      dataDir,
    );
  } catch {
    console.error(`[bootstrap] cognition.config_load_failed`);
    return {
      activationMatrix: [],
      attention: DEFAULT_ATTENTION,
    };
  }

  // 可选文件不存在时 loadConfigDomain 返回 undefined
  if (!config) {
    return {
      activationMatrix: [],
      attention: DEFAULT_ATTENTION,
    };
  }

  return _validateStructure(config);
}

function _validateStructure(config: CortexCognitionConfig): CortexCognitionConfig {
  if (!config || typeof config !== "object") {
    throw new Error("cognition.json: 顶层必须为对象");
  }

  if (!Array.isArray(config.activationMatrix)) {
    config.activationMatrix = [];
  }

  // 校验每项激活配置
  for (const entry of config.activationMatrix) {
    const e = entry as ActivationEntry;
    if (!e.agentType) {
      throw new Error("cognition.json: activationMatrix 项缺少 agentType");
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
